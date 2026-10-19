"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { composeNewsletterEmail } from "@/emails/newsletter";
import { isSignedIn } from "@/lib/auth";
import { splitErrors } from "@/lib/forms/admin-schemas";
import { formText } from "@/lib/forms/schemas";
import { MAIL_FROM, NOTIFY_TO } from "@/lib/mail/identity";
import {
  claimResume,
  createDraft,
  deleteDraft,
  isUuid,
  saveDraft,
  startCampaign,
} from "./campaigns";
import { unsubscribeUrl } from "./links";
import { resyncActiveSubscribers, type ResyncReport } from "./resync";
import { newsletterDraftSchema, requireContent, resolveIntent } from "./schemas";
import { abandonRun, resendBatchClient, runCampaign } from "./send";

/**
 * The newsletter's admin actions: write a draft, send a test of it, send it,
 * pick up a send that stopped, throw a draft away, and copy the list into
 * Resend again.
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

const VISIBLE_FIELDS = ["subject", "preheader", "body", "attachments"];

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
  });
  if (!parsed.success) return splitErrors(parsed.error, VISIBLE_FIELDS);
  const { id, version: shown, ...draft } = parsed.data;

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
    if (!NOTIFY_TO) {
      return { savedAt, version, error: "Липсва MAIL_TO — няма къде да отиде пробното писмо." };
    }
    /* A real copy, through the same template, to the shop's own inbox. Its
       unsubscribe link carries no token, so the page it opens unsubscribes
       nobody, and the copy says so at the top. Not on the batch path and not
       recorded as a delivery: it is not part of the campaign. */
    const { html, text } = await composeNewsletterEmail(draft, {
      unsubscribeUrl: unsubscribeUrl("probno"),
      test: true,
    });
    const { Resend } = await import("resend");
    const sent = await new Resend(key).emails.send({
      from: MAIL_FROM,
      to: NOTIFY_TO,
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
    return { savedAt, version, testSentTo: NOTIFY_TO };
  }

  /* intent === "send". The number on the confirmation is checked against the
     list as it is now, and the letter against the version just saved; if
     either moved in between, nothing starts. */
  const confirmed = Number(formText(formData, "confirmCount"));
  const started = await startCampaign(
    id,
    Number.isInteger(confirmed) ? confirmed : -1,
    Number(version),
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

/** "Нов бюлетин": an empty draft, so uploads have a campaign to belong to. */
export async function createNewsletter(): Promise<void> {
  if (!(await isSignedIn())) redirect("/admin/vhod");
  const id = await createDraft();
  redirect(`/admin/byuletin/${id}`);
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
