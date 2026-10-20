import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  brands,
  newsletterCampaigns,
  productImages,
  products,
  promotionProducts,
  promotions,
  sourceSites,
  syncChanges,
  syncRuns,
} from "@catalog/db/schema";
import type { Database } from "@catalog/db";
// Types only: the modules are imported in `beforeAll`, once the test database is chosen.
import type * as Actions from "@/lib/newsletter/actions";
import type * as Campaigns from "@/lib/newsletter/campaigns";
import type * as TemplateActions from "@/lib/newsletter/template-actions";
import type * as TemplateData from "@/lib/newsletter/template-data";
import { parseMarkdown } from "@/emails/markdown";
import { isDatabaseAvailable, useTestDatabase } from "./helpers/test-db";

/**
 * Starting a letter, against a real catalog and real promotions: the monthly
 * letter's new arrivals (since the last letter, and never an import of the
 * catalog) and reductions (the shop's own promotions first), a promotion's
 * announcement from its row, `createNewsletterFromTemplate` as the panel and
 * the promotions page post to it, a test copy to any one address, and a copy
 * of a letter into a new draft.
 *
 * Nothing reaches Resend: the SDK is replaced, and a test copy lands in a list.
 */

const harness = vi.hoisted(() => ({
  signedIn: true,
  sent: [] as { to: string; subject: string; html: string }[],
}));

vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock("@/lib/auth", () => ({ isSignedIn: async () => harness.signedIn }));
vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (message: { to: string; subject: string; html: string }) => {
        harness.sent.push(message);
        return { data: { id: "re_test" }, error: null };
      },
    };
  },
}));

const available = await isDatabaseAvailable();
const suite = available ? describe : describe.skip;

const DAY = 24 * 60 * 60 * 1000;

suite("starting a newsletter (integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let actions: typeof Actions;
  let campaigns: typeof Campaigns;
  let templateActions: typeof TemplateActions;
  let data: typeof TemplateData;
  let siteId: string;
  let brandId: string;

  beforeAll(async () => {
    process.env.RESEND_API_KEY = "re_test_not_a_real_key";
    ({ db, close } = await useTestDatabase("newsletter_drafts"));
    actions = await import("@/lib/newsletter/actions");
    campaigns = await import("@/lib/newsletter/campaigns");
    templateActions = await import("@/lib/newsletter/template-actions");
    data = await import("@/lib/newsletter/template-data");
  });

  afterAll(async () => {
    await close?.();
  });

  beforeEach(async () => {
    harness.signedIn = true;
    harness.sent.length = 0;
    await db.execute(
      sql`truncate table newsletter_deliveries, newsletter_campaigns, newsletter_subscribers, promotion_products, promotions, product_images, sync_changes, sync_runs, products, brands, source_sites, rate_limit_buckets restart identity cascade`,
    );
    const [site] = await db
      .insert(sourceSites)
      .values({
        key: "drafts-test",
        name: "Test",
        baseUrl: "https://example.test",
        canonicalHost: "example.test",
      })
      .returning({ id: sourceSites.id });
    siteId = site!.id;
    const [brand] = await db
      .insert(brands)
      .values({ sourceSiteId: siteId, sourceKey: "lavazza", name: "Lavazza", slug: "lavazza" })
      .returning({ id: brands.id });
    brandId = brand!.id;
  });

  const add = async (input: {
    slug: string;
    price?: string;
    oldPrice?: string | null;
    daysOld?: number;
    availability?: "in_stock" | "out_of_stock";
    status?: "active" | "removed";
  }) => {
    const [row] = await db
      .insert(products)
      .values({
        sourceSiteId: siteId,
        sourceKey: `/${input.slug}/`,
        sourceUrl: `https://example.test/${input.slug}/`,
        sourcePath: `/${input.slug}/`,
        semanticHash: input.slug,
        slug: input.slug,
        name: `Кафе на зърна Lavazza ${input.slug} 1кг.`,
        brandId,
        currentPrice: input.price ?? "20.00",
        oldPrice: input.oldPrice ?? null,
        currency: "EUR",
        weightValue: "1000",
        weightUnit: "g",
        status: input.status ?? "active",
        availability: input.availability ?? "in_stock",
        firstSeenAt: new Date(Date.now() - (input.daysOld ?? 90) * DAY),
      })
      .returning({ id: products.id });
    await db.insert(productImages).values({
      productId: row!.id,
      sourceUrl: `https://example.test/img/${input.slug}.jpg`,
      objectKey: `catalog/ab/cd/${input.slug}.jpg`,
      width: 800,
      height: 800,
    });
    return row!.id;
  };

  /** Created by one sync run; `runSize` pads it into an import of the catalog. */
  const arrive = async (ids: readonly string[], runSize = ids.length) => {
    const [run] = await db
      .insert(syncRuns)
      .values({ sourceSiteId: siteId, status: "succeeded" })
      .returning({ id: syncRuns.id });
    await db.insert(syncChanges).values(
      Array.from({ length: Math.max(runSize, ids.length) }, (_, index) => ({
        syncRunId: run!.id,
        productId: ids[index] ?? null,
        sourceKey: `/created-${index}/`,
        changeType: "created" as const,
      })),
    );
  };

  /** A promotion of the shop's, each member with its 30-day "before" price. */
  const promote = async (input: {
    members: readonly { id: string; reference: string; removed?: boolean }[];
    label?: string | null;
    percentOff?: number;
    startsInDays?: number;
    endsInDays?: number;
    stopped?: boolean;
  }) => {
    const [row] = await db
      .insert(promotions)
      .values({
        name: "Есен 2026 (вътрешно)",
        label: input.label === undefined ? "Есенни дни" : input.label,
        percentOff: input.percentOff ?? 10,
        startsAt: new Date(Date.now() + (input.startsInDays ?? -3) * DAY),
        endsAt: new Date(Date.now() + (input.endsInDays ?? 10) * DAY),
        stoppedAt: input.stopped ? new Date() : null,
      })
      .returning({ id: promotions.id });
    if (input.members.length > 0) {
      await db.insert(promotionProducts).values(
        input.members.map((member) => ({
          promotionId: row!.id,
          productId: member.id,
          referencePrice: member.reference,
          removedAt: member.removed ? new Date() : null,
        })),
      );
    }
    return row!.id;
  };

  /** A letter that went out `daysAgo` days ago. */
  const sentLetter = async (daysAgo: number) => {
    await db.insert(newsletterCampaigns).values({
      subject: "Предишното",
      body: "Текст",
      status: "sent",
      startedAt: new Date(Date.now() - daysAgo * DAY),
      sentAt: new Date(Date.now() - daysAgo * DAY),
    });
  };

  const slugsOf = (body: string) =>
    parseMarkdown(body).flatMap((block) =>
      block.type === "products" && block.token.spec?.kind === "picked"
        ? [block.token.spec.slugs]
        : [],
    );

  const form = (fields: Record<string, string>) => {
    const formData = new FormData();
    for (const [key, value] of Object.entries(fields)) formData.set(key, value);
    return formData;
  };

  /** The draft a press made, from the redirect it answered with. */
  const pressed = async (fields: Record<string, string>) => {
    const outcome = await templateActions.createNewsletterFromTemplate(form(fields)).then(
      () => "no redirect",
      (error: Error) => error.message,
    );
    const id = /^REDIRECT \/admin\/byuletin\/([0-9a-f-]{36})$/.exec(outcome)?.[1];
    return { outcome, campaign: id ? await campaigns.getCampaign(id) : null };
  };

  describe("the monthly letter's data", () => {
    it("counts as new what arrived since the last letter, newest first, and never an import", async () => {
      await sentLetter(5);
      const before = await add({ slug: "predi", daysOld: 10 });
      const after = await add({ slug: "sled", daysOld: 2 });
      const newest = await add({ slug: "nay-nov", daysOld: 1 });
      const soldOut = await add({ slug: "izcherpan", daysOld: 1, availability: "out_of_stock" });
      await arrive([before, after, newest, soldOut]);
      // Taken in with the vending consumables: 26 created at once.
      await arrive([await add({ slug: "vnos", daysOld: 1 })], 26);

      const plan = await data.monthlyPlan(new Date());
      expect(plan.input.newArrivals).toEqual(["nay-nov", "sled"]);
      expect(Math.abs(plan.since.getTime() - (Date.now() - 5 * DAY))).toBeLessThan(60_000);
    });

    it("looks back 30 days before the first letter", async () => {
      await arrive([
        await add({ slug: "25-dni", daysOld: 25 }),
        await add({ slug: "40-dni", daysOld: 40 }),
      ]);
      const plan = await data.monthlyPlan(new Date());
      expect(plan.input.newArrivals).toEqual(["25-dni"]);
    });

    it("puts the shop's own promotions first among the reductions, and names them", async () => {
      // The source's reduction is the bigger share, but the shop's own come first.
      await add({ slug: "iztochnik", price: "10.00", oldPrice: "20.00" });
      const ours = await add({ slug: "nasha", price: "20.00" });
      await promote({ members: [{ id: ours, reference: "20.00" }] });
      const nova = await add({
        slug: "nova-i-namalena",
        daysOld: 1,
        price: "8.00",
        oldPrice: "10.00",
      });
      await arrive([nova]);

      const plan = await data.monthlyPlan(new Date());
      // A new arrival that is also reduced is shown once, among the new.
      expect(plan.input.newArrivals).toEqual(["nova-i-namalena"]);
      expect(plan.input.reduced).toEqual(["nasha", "iztochnik"]);
      expect(plan.input.promotions).toEqual([
        expect.objectContaining({ label: "Есенни дни", percentOff: 10 }),
      ]);
    });
  });

  describe("Нов бюлетин", () => {
    it("starts the monthly letter from the catalog, as an explicit list the owner can edit", async () => {
      await arrive([await add({ slug: "nov", daysOld: 2 })]);
      const ours = await add({ slug: "nasha", price: "20.00" });
      await promote({ members: [{ id: ours, reference: "20.00" }] });

      const { campaign } = await pressed({ template: "monthly" });
      expect(campaign).toMatchObject({
        status: "draft",
        template: "monthly",
        autoPeriod: null,
        promotionId: null,
      });
      expect(campaign!.subject).toMatch(
        /^Новото в магазина през \p{L}+: нови продукти и промоции$/u,
      );
      expect(slugsOf(campaign!.body)).toEqual([["nov"], ["nasha"]]);
      expect(campaign!.body).toContain("**Есенни дни**: −10% до");
    });

    it("starts a promotion's announcement from its row: its orderable members, the biggest saving first", async () => {
      const cheap = await add({ slug: "evtino", price: "10.00" });
      const dear = await add({ slug: "skapo", price: "30.00" });
      const middle = await add({ slug: "sredno", price: "20.00" });
      const soldOut = await add({
        slug: "izcherpano",
        price: "50.00",
        availability: "out_of_stock",
      });
      const removed = await add({ slug: "maknato", price: "40.00" });
      const id = await promote({
        members: [
          { id: cheap, reference: "10.00" },
          { id: dear, reference: "30.00" },
          { id: middle, reference: "20.00" },
          { id: soldOut, reference: "50.00" },
          { id: removed, reference: "40.00", removed: true },
        ],
      });

      const { campaign } = await pressed({ template: "promotion", promotionId: id });
      expect(campaign).toMatchObject({ template: "promotion", promotionId: id });
      expect(campaign!.subject).toMatch(/^Есенни дни: −10% до \d{1,2} \p{L}+$/u);
      expect(slugsOf(campaign!.body)).toEqual([["skapo", "sredno", "evtino"]]);
      // The owner's own name for it never reaches the letter.
      expect(campaign!.body).not.toContain("вътрешно");
      expect(campaign!.subject).not.toContain("вътрешно");
    });

    it("announces an upcoming promotion, and offers it with the running ones", async () => {
      const product = await add({ slug: "skoro", price: "20.00" });
      const id = await promote({
        members: [{ id: product, reference: "20.00" }],
        label: null,
        percentOff: 15,
        startsInDays: 4,
        endsInDays: 12,
      });
      await promote({ members: [], endsInDays: -1, startsInDays: -9 });
      await promote({ members: [], stopped: true });

      const choices = await data.promotionChoices(new Date());
      expect(choices.map((choice) => [choice.id, choice.products])).toEqual([[id, 1]]);

      const { campaign } = await pressed({ template: "promotion", promotionId: id });
      expect(campaign!.subject).toMatch(/^−15% на избрани продукти (от|на) /);
      expect(campaign!.body).toMatch(/ще бъдат намалени с 15%/);
    });

    it("does not announce a promotion that has ended or was stopped, and says why", async () => {
      const ended = await promote({ members: [], endsInDays: -1, startsInDays: -9 });
      const stopped = await promote({ members: [], stopped: true });
      for (const promotionId of [
        ended,
        stopped,
        "not-a-uuid",
        "00000000-0000-4000-8000-000000000000",
      ]) {
        const { outcome, campaign } = await pressed({ template: "promotion", promotionId });
        expect(outcome).toBe("REDIRECT /admin/byuletin?promotsiya=nyama");
        expect(campaign).toBeNull();
      }
      expect(await db.select().from(newsletterCampaigns)).toHaveLength(0);
    });

    it("starts a blank draft, as before", async () => {
      const { campaign } = await pressed({ template: "blank" });
      expect(campaign).toMatchObject({ subject: "", body: "", template: null, status: "draft" });
    });

    it("asks a visitor who is not signed in to sign in, and makes nothing", async () => {
      harness.signedIn = false;
      const { outcome } = await pressed({ template: "monthly" });
      expect(outcome).toBe("REDIRECT /admin/vhod");
      expect(await db.select().from(newsletterCampaigns)).toHaveLength(0);
    });
  });

  describe("a test copy", () => {
    const testPress = async (testTo: string) => {
      const id = await campaigns.createDraft();
      const version = campaigns.draftVersion((await campaigns.getCampaign(id))!);
      return actions.submitNewsletter(
        {},
        form({
          id,
          version,
          intent: "test",
          subject: "Новите кафета",
          preheader: "",
          body: "Здравейте,\n\nНови кафета.",
          attachments: "[]",
          testTo,
        }),
      );
    };

    it("goes to the address typed, marked as a test, and to nobody else", async () => {
      const answer = await testPress("  Colleague@Example.org ");
      expect(answer.testSentTo).toBe("colleague@example.org");
      expect(harness.sent).toEqual([
        expect.objectContaining({ to: "colleague@example.org", subject: "[Пробно] Новите кафета" }),
      ]);
      expect(harness.sent[0]!.html).toContain("Пробно писмо");
    });

    it("is refused for something that is not an address, and saves all the same", async () => {
      const answer = await testPress("не е адрес");
      expect(answer.fieldErrors?.testTo).toMatch(/Това не е имейл адрес/);
      expect(answer.savedAt).toBeTruthy();
      expect(harness.sent).toHaveLength(0);
      expect((await testPress("")).fieldErrors?.testTo).toMatch(/Напишете адреса/);
    });

    it("is counted: ten an hour", async () => {
      for (let count = 0; count < 10; count += 1) {
        expect((await testPress("owner@example.org")).testSentTo).toBe("owner@example.org");
      }
      const refused = await testPress("owner@example.org");
      expect(refused.error).toMatch(/много пробни писма/);
      expect(harness.sent).toHaveLength(10);
    });
  });

  describe("Дублирай", () => {
    it("copies a letter that went out into a new draft: its words, files and template, not its products or month", async () => {
      const file = {
        url: "https://abc.public.blob.vercel-storage.com/newsletter/x/ceni.pdf",
        name: "Цени.pdf",
        contentType: "application/pdf",
        size: 1000,
        kind: "file" as const,
      };
      const [source] = await db
        .insert(newsletterCampaigns)
        .values({
          subject: "Ноември",
          preheader: "Новото.",
          body: "Здравейте,\n\n[[промоции]]",
          status: "sent",
          template: "monthly",
          autoPeriod: "2026-11",
          startedAt: new Date(),
          attachments: [file, { kind: "product-blocks", version: 1, blocks: [] }],
        })
        .returning({ id: newsletterCampaigns.id });

      const outcome = await actions.duplicateNewsletter(form({ id: source!.id })).then(
        () => "",
        (error: Error) => error.message,
      );
      const copyId = /([0-9a-f-]{36})$/.exec(outcome)![1]!;
      expect(copyId).not.toBe(source!.id);
      const copy = (await campaigns.getCampaign(copyId))!;
      expect(copy).toMatchObject({
        status: "draft",
        subject: "Ноември",
        preheader: "Новото.",
        body: "Здравейте,\n\n[[промоции]]",
        template: "monthly",
        autoPeriod: null,
        attachments: [file],
        revision: 0,
      });
      // The original is untouched.
      const [original] = await db
        .select({ status: newsletterCampaigns.status })
        .from(newsletterCampaigns)
        .where(eq(newsletterCampaigns.id, source!.id));
      expect(original!.status).toBe("sent");
    });

    it("lands back on the list for an id that names nothing", async () => {
      const outcome = await actions
        .duplicateNewsletter(form({ id: "00000000-0000-4000-8000-000000000000" }))
        .then(
          () => "",
          (error: Error) => error.message,
        );
      expect(outcome).toBe("REDIRECT /admin/byuletin");
    });
  });
});
