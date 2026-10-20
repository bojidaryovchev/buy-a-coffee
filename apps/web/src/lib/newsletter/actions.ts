"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { composeNewsletterEmail } from "@/emails/newsletter";
import { isSignedIn } from "@/lib/auth";
import { splitErrors } from "@/lib/forms/admin-schemas";
import { formText } from "@/lib/forms/schemas";
import { MAIL_FROM } from "@/lib/mail/identity";
import { createRateLimiter, sharedStore } from "@/lib/rate-limit";
import {
  claimResume,
  deleteDraft,
  duplicateCampaign,
  getCampaign,
  isUuid,
  saveDraft,
  startCampaign,
} from "./campaigns";
import { claimNotes } from "./claims";
import { composeCampaign, copyBytes } from "./batch";
import { LETTER_MAX_BYTES } from "./deliverability";
import { unsubscribeUrl } from "./links";
import { blockProblems, describeBlockProblems, type ProductBlocksSnapshot } from "./product-blocks";
import { resolveLetterProducts } from "./product-source";
import { resyncActiveSubscribers, type ResyncReport } from "./resync";
import { newsletterDraftSchema, requireContent, resolveIntent, testAddressSchema } from "./schemas";
import { abandonRun, resendBatchClient, runCampaign, stopRun } from "./send";
import { letterPromotions } from "./template-data";

/**
 * The newsletter's admin actions: write a draft, send a test of it, send it,
 * pick up a send that stopped, copy a letter into a new draft, throw a draft
 * away, and copy the list into Resend again. (Starting a draft from a
 * template is `template-actions.ts`.) (The composer's product search is a route,
 * `/api/admin/newsletter/products`: actions run one at a time per page, and a
 * search must never hold up a save.)
 *
 * Each one checks the session itself. The panel's layout redirects a visitor
 * who is not signed in, but an action is a public endpoint — and these send
 * mail to the whole list over the shop's own DKIM signature.
 *
 * Sending happens after the answer (`after()`), so the press returns at once
 * and the campaign's page shows the progress; the run has the function's
 * lifetime, which is why the newsletter pages set `maxDuration`.
 */

const SESSION_EXPIRED = "Сесията е изтекла. Влезте отново и опитайте пак.";
const NO_KEY = "Липсва RESEND_API_KEY — от тази инсталация не може да се изпраща.";
const CHANGED_ELSEWHERE =
  "Черновата е променена в друг раздел или прозорец, след като е отворена тук. Нищо не е записано: копирайте текста, ако ви трябва, и презаредете страницата.";
const NO_PRODUCTS_READ =
  "Продуктите в писмото не можаха да бъдат прочетени от каталога. Нищо не е изпратено; опитайте отново след минута.";

/**
 * Test copies: a real message over the shop's DKIM signature, to an address
 * typed into the panel, so they are counted. One operator, one counter;
 * generous for checking a letter, and far short of what a stolen session
 * could make of it. Fails open, to the per-process counter, like the shop's
 * forms: refusing the owner a test because the counter's table is
 * unreachable would be the limiter doing the damage.
 */
const testLimiter = createRateLimiter({
  name: "newsletter-test",
  limit: 10,
  windowMs: 60 * 60_000,
  onStoreError: "allow",
  store: sharedStore,
});

/** The letter's products from the catalog as it stands, or null when it could not be read. */
async function letterProducts(
  draft: { subject: string; body: string },
  campaignId: string,
): Promise<ProductBlocksSnapshot | null> {
  try {
    return await resolveLetterProducts(draft);
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "newsletter.products_failed",
        campaignId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return null;
  }
}

export type NewsletterFormState = {
  error?: string;
  /** Under the field each belongs to. */
  fieldErrors?: Record<string, string>;
  /** The draft was written; when, for the line under the buttons. */
  savedAt?: string;
  /** The version this tab now holds (see `draftVersion`). */
  version?: string;
  /** Where the test copy went. */
  testSentTo?: string;
};

const VISIBLE_FIELDS = ["subject", "preheader", "body", "attachments", "testTo"];

/** Run the campaign once the response is out. Never throws into the request. */
function sendLater(campaignId: string, key: string): void {
  after(async () => {
    try {
      const report = await runCampaign(campaignId, { client: await resendBatchClient(key) });
      console.info(JSON.stringify({ level: "info", msg: "newsletter.run", campaignId, ...report }));
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          msg: "newsletter.run_failed",
          campaignId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      await abandonRun(campaignId, error).catch(() => undefined);
    }
  });
}

/**
 * The composer's one action, three buttons: save the draft, save it and send
 * a test copy to the shop's own inbox, or save it and send it to the list.
 * Every press saves first, so what was tested or sent is what is stored — and
 * only over the version this tab was showing, so a press in a stale tab can
 * neither overwrite nor send a letter another tab changed.
 */
export async function submitNewsletter(
  _previous: NewsletterFormState,
  formData: FormData,
): Promise<NewsletterFormState> {
  if (!(await isSignedIn())) return { error: SESSION_EXPIRED };

  const intent = resolveIntent(formData);
  const parsed = newsletterDraftSchema.safeParse({
    id: formText(formData, "id"),
    version: formText(formData, "version"),
    subject: formText(formData, "subject"),
    preheader: formText(formData, "preheader"),
    body: formText(formData, "body"),
    attachments: formText(formData, "attachments"),
    testTo: formText(formData, "testTo"),
  });
  if (!parsed.success) return splitErrors(parsed.error, VISIBLE_FIELDS);
  const { id, version: shown, testTo, ...draft } = parsed.data;

  const saved = await saveDraft(id, draft, shown);
  if (!saved.ok) {
    return {
      error:
        saved.reason === "conflict"
          ? CHANGED_ELSEWHERE
          : "Този бюлетин вече се изпраща или е изпратен и не може да се променя.",
    };
  }
  revalidatePath("/admin/byuletin");
  const savedAt = new Date().toISOString();
  const version = saved.version;

  if (intent === "save") return { savedAt, version };

  const missing = requireContent(draft);
  if (missing) return { savedAt, version, fieldErrors: missing };

  const key = process.env.RESEND_API_KEY;
  if (!key) return { savedAt, version, error: NO_KEY };

  if (intent === "test") {
    const address = testAddressSchema.safeParse(testTo ?? "");
    if (!address.success) {
      return {
        savedAt,
        version,
        fieldErrors: { testTo: address.error.issues[0]?.message ?? "" },
      };
    }
    const to = address.data;
    if (!(await testLimiter.check("panel")).allowed) {
      return {
        savedAt,
        version,
        error: "Изпратени са много пробни писма за кратко време. Опитайте отново след час.",
      };
    }
    /* A real copy, through the same template, to the address in the field —
       the owner's own inbox unless they typed another. Its unsubscribe link
       carries no token, so the page it opens unsubscribes nobody, and the
       copy says so at the top. Not on the batch path and not recorded as a
       delivery: it is not part of the campaign. Its products are the
       catalog's as it stands, as in the preview. */
    const products = await letterProducts(draft, id);
    if (!products) return { savedAt, version, error: NO_PRODUCTS_READ };
    const { html, text } = await composeNewsletterEmail(
      { ...draft, products },
      { unsubscribeUrl: unsubscribeUrl("probno"), test: true },
    );
    const { Resend } = await import("resend");
    const sent = await new Resend(key).emails.send({
      from: MAIL_FROM,
      to,
      subject: `[Пробно] ${draft.subject}`,
      html,
      text,
      tags: [{ name: "category", value: "newsletter-test" }],
    });
    if (sent.error) {
      console.error(
        JSON.stringify({
          level: "error",
          msg: "newsletter.test_failed",
          campaignId: id,
          error: sent.error.message,
        }),
      );
      return {
        savedAt,
        version,
        error: "Пробното писмо не беше изпратено. Опитайте отново след минута.",
      };
    }
    return { savedAt, version, testSentTo: to };
  }

  /* intent === "send". The number on the confirmation is checked against the
     list as it is now, and the letter against the version just saved; if
     either moved in between, nothing starts. The products are read once,
     here, from the body just saved, and go into the campaign with the start:
     every copy of the send draws them. */
  const products = await letterProducts(draft, id);
  if (!products) return { savedAt, version, error: NO_PRODUCTS_READ };

  /* The products as they are now, not as the owner last saw them. A line
     that is not the letter the owner meant — unreadable, an address that is
     no product's — or a letter left with nothing in it stops here; a product
     sold out since, or a section left empty, does not: the letter goes out
     without it, as the preview and the notes showed (`blockIssues`). */
  const problems = blockProblems(draft.body, products);

  /* What it says about the shop's promotions, against the promotions as they
     stand: a promotion's letter only while it runs and only over products
     whose badges carry its percentage, and no promotion named that is over
     (`claims.ts`). The same notes the composer shows. Every reason at once,
     so one press says all there is to put right. */
  const campaign = await getCampaign(id);
  const claims = campaign
    ? claimNotes({
        ...(await letterPromotions(campaign)),
        products: products.blocks.flatMap((block) => block.products),
      }).filter((note) => note.blocksSend)
    : [];
  if (problems.length > 0 || claims.length > 0) {
    const reasons = [
      ...(problems.length > 0
        ? [`${describeBlockProblems(problems)}. Поправете или махнете тези блокове.`]
        : []),
      ...claims.map((note) => `${note.title} — ${note.detail}`),
    ];
    return { savedAt, version, error: `Изпращането не започна: ${reasons.join(" ")}` };
  }

  /* And as one reader will get it, measured as Gmail measures it. */
  const bytes = copyBytes(await composeCampaign({ ...draft, products }));
  if (bytes > LETTER_MAX_BYTES) {
    return {
      savedAt,
      version,
      error: `Писмото е около ${Math.round(bytes / 1000)} KB, а Gmail съкращава писмата над около 102 KB и скрива края им — заедно с връзката за отписване. Изпращането не започна: махнете блок с продукти или съкратете текста.`,
    };
  }

  const confirmed = Number(formText(formData, "confirmCount"));
  const started = await startCampaign(
    id,
    Number.isInteger(confirmed) ? confirmed : -1,
    Number(version),
    products,
  );
  if (!started.ok) {
    switch (started.reason) {
      case "not_draft":
        return { savedAt, version, error: "Този бюлетин вече се изпраща или е изпратен." };
      case "changed":
        return { savedAt, error: CHANGED_ELSEWHERE };
      case "no_subscribers":
        return { savedAt, version, error: "Няма активни абонати — няма до кого да се изпрати." };
      case "count_changed":
        return {
          savedAt,
          version,
          error: `Списъкът се промени: активните абонати вече са ${started.recipients}. Потвърдете изпращането отново.`,
        };
    }
  }

  sendLater(id, key);
  revalidatePath("/admin/byuletin");
  redirect(`/admin/byuletin/${id}`);
}

/**
 * "Дублирай": a new draft with this campaign's letter — sent or not — to
 * write the next one from (`duplicateCampaign` says what is copied).
 */
export async function duplicateNewsletter(formData: FormData): Promise<void> {
  if (!(await isSignedIn())) redirect("/admin/vhod");
  const id = formText(formData, "id");
  const copy = isUuid(id) ? await duplicateCampaign(id) : null;
  revalidatePath("/admin/byuletin");
  redirect(copy ? `/admin/byuletin/${copy}` : "/admin/byuletin");
}

/** Drafts only; a campaign that went out stays as the record of it. */
export async function deleteNewsletter(formData: FormData): Promise<void> {
  if (!(await isSignedIn())) return;
  const id = formText(formData, "id");
  if (isUuid(id)) await deleteDraft(id);
  revalidatePath("/admin/byuletin");
  redirect("/admin/byuletin");
}

export type ResumeState = { error?: string };

/**
 * Pick up a send that stopped (`partial`) or whose sender vanished (a
 * `sending` campaign with no heartbeat for ten minutes) — which also finishes
 * one that has nobody left to send to but was never marked done. Only
 * recipients without an answer are sent to; see `send.ts` for why that is
 * enough to never mail anybody twice.
 */
export async function resumeNewsletter(
  _previous: ResumeState,
  formData: FormData,
): Promise<ResumeState> {
  if (!(await isSignedIn())) return { error: SESSION_EXPIRED };
  const key = process.env.RESEND_API_KEY;
  if (!key) return { error: NO_KEY };

  const id = formText(formData, "id");
  if (!(await claimResume(id))) {
    return { error: "Изпращането вече тече или е приключило. Презаредете страницата." };
  }
  sendLater(id, key);
  revalidatePath(`/admin/byuletin/${id}`);
  revalidatePath("/admin/byuletin");
  return {};
}

/**
 * "Спри изпращането": end a send that stopped instead of continuing it —
 * nobody else gets the letter (`stopRun`). Behind a second press on the
 * page; refused for a send that is running, which only "Продължи"'s own
 * lock could have started.
 */
export async function stopNewsletter(formData: FormData): Promise<void> {
  if (!(await isSignedIn())) redirect("/admin/vhod");
  const id = formText(formData, "id");
  if (!isUuid(id)) redirect("/admin/byuletin");
  await stopRun(id);
  revalidatePath(`/admin/byuletin/${id}`);
  revalidatePath("/admin/byuletin");
  redirect(`/admin/byuletin/${id}`);
}

export type ResyncState = { error?: string; report?: ResyncReport };

/**
 * Copy every active subscriber into Resend again (`resync.ts`), from where
 * the last press stopped (`after`). Runs within the request — it reports what
 * it did — and stops on its own well inside the page's `maxDuration`.
 */
export async function syncAllSubscribers(
  _previous: ResyncState,
  formData: FormData,
): Promise<ResyncState> {
  if (!(await isSignedIn())) return { error: SESSION_EXPIRED };
  const from = formText(formData, "after");
  const outcome = await resyncActiveSubscribers({ after: isUuid(from) ? from : null });
  if ("error" in outcome) {
    return { error: `Не може да се синхронизира: ${outcome.error}.` };
  }
  return { report: outcome };
}
