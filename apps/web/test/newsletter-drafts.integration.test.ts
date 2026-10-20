import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  brands,
  newsletterCampaigns,
  newsletterSubscribers,
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
 * letter's new arrivals (since the last monthly letter was prepared, never
 * further back than the "Ново" badge's 30 days, and never an import of the
 * catalog) and reductions (the shop's own promotions first), a promotion's
 * announcement from its row with only the products whose badges carry its
 * percentage, `createNewsletterFromTemplate` as the panel and the promotions
 * page post to it; what a send refuses about promotions (a promotion that
 * has not started or is over, a badge short of the claim, a listed reduction
 * that is no longer one); a test copy to any one address, and a copy of a
 * letter into a new draft.
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

  /** A promotion of the shop's, each member with its 30-day "before" price (or none on record). */
  const promote = async (input: {
    members: readonly { id: string; reference: string | null; removed?: boolean }[];
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

  /** A letter that went out `sentDaysAgo` days ago; a monthly one, prepared `preparedDaysAgo`. */
  const sentLetter = async (sentDaysAgo: number, monthly?: { preparedDaysAgo: number }) => {
    await db.insert(newsletterCampaigns).values({
      subject: "Предишното",
      body: "Текст",
      status: "sent",
      startedAt: new Date(Date.now() - sentDaysAgo * DAY),
      sentAt: new Date(Date.now() - sentDaysAgo * DAY),
      ...(monthly
        ? {
            template: "monthly" as const,
            attachments: [
              {
                kind: "letter-plan" as const,
                version: 1,
                preparedAt: new Date(Date.now() - monthly.preparedDaysAgo * DAY).toISOString(),
                named: [],
                leftOut: {},
              },
            ],
          }
        : {}),
    });
  };

  const slugsOf = (body: string) =>
    parseMarkdown(body).flatMap((block) =>
      block.type === "products" &&
      (block.token.spec?.kind === "picked" || block.token.spec?.kind === "reduced")
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
    it("counts as new what arrived after the last monthly letter was prepared, and never an import", async () => {
      // Prepared ten days ago, sent five days ago.
      await sentLetter(5, { preparedDaysAgo: 10 });
      const before = await add({ slug: "predi", daysOld: 12 });
      // Arrived between the preparation and the send: never in that letter.
      const between = await add({ slug: "mezhdu", daysOld: 7 });
      const newest = await add({ slug: "nay-nov", daysOld: 1 });
      const soldOut = await add({ slug: "izcherpan", daysOld: 1, availability: "out_of_stock" });
      await arrive([before, between, newest, soldOut]);
      // Taken in with the vending consumables: 26 created at once.
      await arrive([await add({ slug: "vnos", daysOld: 1 })], 26);

      const plan = await data.monthlyPlan(new Date());
      expect(plan.input.newArrivals).toEqual(["nay-nov", "mezhdu"]);
      expect(plan.sinceLetter).toBe(true);
      expect(Math.abs(plan.since.getTime() - (Date.now() - 10 * DAY))).toBeLessThan(60_000);
    });

    it("is moved only by a monthly letter: a promotion's or a blank one said nothing of what is new", async () => {
      await sentLetter(20, { preparedDaysAgo: 21 });
      await sentLetter(2);
      await arrive([await add({ slug: "sedmitsa", daysOld: 7 })]);
      const plan = await data.monthlyPlan(new Date());
      expect(plan.input.newArrivals).toEqual(["sedmitsa"]);
    });

    it("never reaches past the badge's 30 days, before the first letter or long after the last", async () => {
      await arrive([
        await add({ slug: "25-dni", daysOld: 25 }),
        await add({ slug: "40-dni", daysOld: 40 }),
      ]);
      expect((await data.monthlyPlan(new Date())).input.newArrivals).toEqual(["25-dni"]);
      await sentLetter(60, { preparedDaysAgo: 61 });
      const plan = await data.monthlyPlan(new Date());
      expect(plan.input.newArrivals).toEqual(["25-dni"]);
      expect(plan.sinceLetter).toBe(false);
    });

    it("puts a reduced arrival the letter has no room for among the reductions", async () => {
      const ids = [];
      for (let index = 0; index < 13; index += 1) {
        ids.push(
          await add({
            slug: `nov-${String(index).padStart(2, "0")}`,
            daysOld: 1 + index / 100,
            // The oldest of them is reduced: ranked past the twelve.
            ...(index === 12 ? { price: "8.00", oldPrice: "10.00" } : {}),
          }),
        );
      }
      await arrive(ids);
      const plan = await data.monthlyPlan(new Date());
      expect(plan.input.reduced).toEqual(["nov-12"]);
      expect(plan.input.newArrivals).toHaveLength(11);
      expect(plan.input.newArrivals).not.toContain("nov-12");
      expect(plan.plan.leftOut).toEqual({ newOverflow: 1 });
    });

    it("has room for twelve new arrivals beside the reductions, and says how many more did not fit", async () => {
      const ids = [];
      for (let index = 0; index < 14; index += 1) {
        ids.push(
          await add({ slug: `nov-${String(index).padStart(2, "0")}`, daysOld: 1 + index / 100 }),
        );
      }
      await arrive(ids);
      await add({ slug: "namalen", price: "8.00", oldPrice: "10.00" });
      const plan = await data.monthlyPlan(new Date());
      expect(plan.input.reduced).toEqual(["namalen"]);
      expect(plan.input.newArrivals).toHaveLength(11);
      expect(plan.plan.leftOut).toEqual({ newOverflow: 3 });
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

  describe("Обява за промоция with nothing it can claim", () => {
    it("is not started, and the list says why; the choices count only what can carry the reduction", async () => {
      // Priced only after it joined: no 30-day price on record, no badge (the reviewer's case).
      const fresh = await add({ slug: "bez-istoriya", price: "20.00" });
      const soldOut = await add({
        slug: "izcherpan",
        price: "20.00",
        availability: "out_of_stock",
      });
      const empty = await promote({
        members: [
          { id: fresh, reference: null },
          { id: soldOut, reference: "20.00" },
        ],
        percentOff: 20,
      });
      const { outcome, campaign } = await pressed({ template: "promotion", promotionId: empty });
      expect(outcome).toBe(`REDIRECT /admin/byuletin?promotsiya=prazna&p=${empty}`);
      expect(campaign).toBeNull();
      expect(await db.select().from(newsletterCampaigns)).toHaveLength(0);

      const honest = await add({ slug: "chesten", price: "20.00" });
      const other = await promote({ members: [{ id: honest, reference: "20.00" }] });
      const choices = await data.promotionChoices(new Date());
      expect(choices.map((choice) => [choice.id, choice.products, choice.leftOut])).toEqual(
        expect.arrayContaining([
          [empty, 0, { unbacked: 1, soldOut: 1, elsewhere: 0 }],
          [other, 1, { unbacked: 0, soldOut: 0, elsewhere: 0 }],
        ]),
      );
      const reason = data.noMembersReason(
        { percentOff: 20 },
        { unbacked: 1, soldOut: 1, elsewhere: 0 },
      );
      expect(reason).toContain("един продукт няма 30-дневна история на цената");
      expect(reason).toContain("един продукт е изчерпан");
    });
  });

  describe("Нов бюлетин", () => {
    it("starts the monthly letter from the catalog, as an explicit list the owner can edit", async () => {
      await arrive([await add({ slug: "nov", daysOld: 2 })]);
      const ours = await add({ slug: "nasha", price: "20.00" });
      const promotionId = await promote({ members: [{ id: ours, reference: "20.00" }] });

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
      expect(campaign!.body).toContain("[[промоции: nasha]]");
      expect(campaign!.body).toContain("**Есенни дни** — намалени цени до");
      expect(campaign!.body).not.toMatch(/\d+\s*%/);
      // What it was written from, kept with it, through a save.
      const plan = () => campaign!.attachments.find((entry) => entry.kind === "letter-plan");
      expect(plan()).toMatchObject({
        named: [
          {
            id: promotionId,
            label: "Есенни дни",
            line: expect.stringMatching(/^\*\*Есенни дни\*\* — намалени цени до /),
            slugs: ["nasha"],
          },
        ],
      });
      await actions.submitNewsletter(
        {},
        form({
          id: campaign!.id,
          version: campaigns.draftVersion(campaign!),
          intent: "save",
          subject: campaign!.subject,
          preheader: campaign!.preheader,
          body: campaign!.body,
          attachments: "[]",
        }),
      );
      const saved = (await campaigns.getCampaign(campaign!.id))!;
      expect(saved.revision).toBe(1);
      expect(saved.attachments).toEqual([plan()]);
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
      expect(campaign!.subject).toMatch(/^Намалени цени (от|на) /);
      expect(`${campaign!.subject} ${campaign!.preheader} ${campaign!.body}`).not.toMatch(/%/);
      expect(slugsOf(campaign!.body)).toEqual([["skoro"]]);
    });

    it("lists only the products whose own badge carries the promotion's percentage, and says why the rest are not there", async () => {
      // Its 30-day price is today's: the badge shows the whole −10%.
      const honest = await add({ slug: "chesten", price: "20.00" });
      // Cheaper lately: the struck price is lower, the badge smaller.
      const smaller = await add({ slug: "po-malko", price: "20.00" });
      // No 30-day price on record: no struck price, no badge at all.
      const none = await add({ slug: "bez-istoriya", price: "20.00" });
      const id = await promote({
        members: [
          { id: honest, reference: "20.00" },
          { id: smaller, reference: "19.00" },
          { id: none, reference: null },
        ],
      });
      const { campaign } = await pressed({ template: "promotion", promotionId: id });
      expect(slugsOf(campaign!.body)).toEqual([["chesten"]]);
      expect(campaign!.attachments).toEqual([
        expect.objectContaining({ kind: "letter-plan", leftOut: { unbacked: 2 } }),
      ]);
      // Prepared ahead, the same rule from what the cards will show.
      const ahead = await promote({
        members: [
          { id: honest, reference: "20.00" },
          { id: smaller, reference: "19.00" },
          { id: none, reference: null },
        ],
        startsInDays: 3,
      });
      const upcoming = await pressed({ template: "promotion", promotionId: ahead });
      expect(slugsOf(upcoming.campaign!.body)).toEqual([["chesten"]]);
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

  describe("what a send refuses about promotions", () => {
    const sendPress = async (
      campaign: NonNullable<Awaited<ReturnType<typeof campaigns.getCampaign>>>,
    ) =>
      actions.submitNewsletter(
        {},
        form({
          id: campaign.id,
          version: campaigns.draftVersion(campaign),
          intent: "send",
          subject: campaign.subject,
          preheader: campaign.preheader,
          body: campaign.body,
          attachments: "[]",
          confirmCount: "1",
        }),
      );

    beforeEach(async () => {
      await db.insert(newsletterSubscribers).values({ email: "reader@example.test" });
    });

    it("refuses a monthly letter whose promotion ended before the send", async () => {
      await arrive([await add({ slug: "nov", daysOld: 2 })]);
      const ours = await add({ slug: "nasha", price: "20.00" });
      const id = await promote({ members: [{ id: ours, reference: "20.00" }] });
      const { campaign } = await pressed({ template: "monthly" });
      // It ends before the owner presses Send.
      await db
        .update(promotions)
        .set({ endsAt: new Date(Date.now() - 60 * 60 * 1000) })
        .where(eq(promotions.id, id));
      const answer = await sendPress(campaign!);
      expect(answer.error).toMatch(/^Изпращането не започна/);
      expect(answer.error).toContain(
        "Промоцията „Есенни дни“ („Есен 2026 (вътрешно)“) е приключила",
      );
      // And its product, no longer reduced, is named.
      expect(answer.error).toContain("[[промоции: nasha]] — вече не са намалени: „Lavazza nasha“");
      expect((await campaigns.getCampaign(campaign!.id))!.status).toBe("draft");
    });

    it("refuses a listed reduction that is no longer one, naming it", async () => {
      await add({ slug: "namalen", price: "8.00", oldPrice: "10.00" });
      const { campaign } = await pressed({ template: "monthly" });
      expect(campaign!.body).toContain("[[промоции: namalen]]");
      await db.update(products).set({ oldPrice: null }).where(eq(products.slug, "namalen"));
      const answer = await sendPress(campaign!);
      expect(answer.error).toContain("вече не са намалени: „Lavazza namalen“");
    });

    it("waits for an upcoming promotion to start before its letter goes", async () => {
      const product = await add({ slug: "skoro", price: "20.00" });
      const id = await promote({ members: [{ id: product, reference: "20.00" }], startsInDays: 2 });
      const { campaign } = await pressed({ template: "promotion", promotionId: id });
      const answer = await sendPress(campaign!);
      expect(answer.error).toContain("Промоцията още не е започнала");
      expect((await campaigns.getCampaign(campaign!.id))!.status).toBe("draft");
    });

    it("refuses a promotion's letter once a product's badge shows less than the letter claims", async () => {
      const product = await add({ slug: "chesten", price: "20.00" });
      const id = await promote({ members: [{ id: product, reference: "20.00" }] });
      const { campaign } = await pressed({ template: "promotion", promotionId: id });
      expect(slugsOf(campaign!.body)).toEqual([["chesten"]]);
      // The 30-day lowest turns out lower: the badge shrinks below −10%.
      await db
        .update(promotionProducts)
        .set({ referencePrice: "19.00" })
        .where(eq(promotionProducts.productId, product));
      const answer = await sendPress(campaign!);
      expect(answer.error).toContain("Продукт без −10% на значката");
      expect(answer.error).toContain("„Lavazza chesten“");
    });

    it("refuses a promotion's letter none of whose products the promotion prices", async () => {
      const product = await add({ slug: "chesten", price: "20.00" });
      const id = await promote({ members: [{ id: product, reference: "20.00" }] });
      const { campaign } = await pressed({ template: "promotion", promotionId: id });
      // The owner swaps its products for others, reduced by the source, not by the promotion.
      await add({ slug: "drug", price: "7.00", oldPrice: "10.00" });
      const swapped = {
        ...campaign!,
        body: campaign!.body.replace("[[продукти: chesten]]", "[[продукти: drug]]"),
      };
      const answer = await sendPress(swapped);
      expect(answer.error).toContain("В писмото няма продукт от промоцията");
    });

    it("refuses a promotion's letter once the promotion was changed after it was written", async () => {
      const product = await add({ slug: "chesten", price: "20.00" });
      const id = await promote({ members: [{ id: product, reference: "20.00" }] });
      const { campaign } = await pressed({ template: "promotion", promotionId: id });
      await db.update(promotions).set({ label: "Зимни дни" }).where(eq(promotions.id, id));
      const answer = await sendPress(campaign!);
      expect(answer.error).toContain("Промоцията е променена след като обявата е подготвена");
      expect(answer.error).toContain("за клиентите се казва „Зимни дни“, а не „Есенни дни“");
    });

    it("lets a monthly letter go once the ended promotion's line and products are taken out", async () => {
      await arrive([await add({ slug: "nov", daysOld: 2 })]);
      const ours = await add({ slug: "nasha", price: "20.00" });
      const id = await promote({ members: [{ id: ours, reference: "20.00" }] });
      const { campaign } = await pressed({ template: "monthly" });
      await db
        .update(promotions)
        .set({ endsAt: new Date(Date.now() - 60 * 60 * 1000) })
        .where(eq(promotions.id, id));
      // As the note says: the section goes — heading, line, products and link.
      const body = campaign!.body.replace(
        /## Промоции[\s\S]*?страницата с промоциите\]\([^)]*\)\.\n\n/,
        "",
      );
      expect(body).not.toContain("Есенни дни");
      expect(body).not.toContain("[[промоции:");
      await expect(sendPress({ ...campaign!, body })).rejects.toThrow(
        `REDIRECT /admin/byuletin/${campaign!.id}`,
      );
    });

    it("lets an honest promotion's letter go", async () => {
      const product = await add({ slug: "chesten", price: "20.00" });
      const id = await promote({ members: [{ id: product, reference: "20.00" }] });
      const { campaign } = await pressed({ template: "promotion", promotionId: id });
      await expect(sendPress(campaign!)).rejects.toThrow(
        `REDIRECT /admin/byuletin/${campaign!.id}`,
      );
      expect((await campaigns.getCampaign(campaign!.id))!.status).toBe("sending");
    });
  });

  describe("Спри изпращането", () => {
    it("asks a visitor who is not signed in to sign in, and otherwise lands back on the campaign", async () => {
      harness.signedIn = false;
      const refused = await actions
        .stopNewsletter(form({ id: "00000000-0000-4000-8000-000000000000" }))
        .then(
          () => "",
          (error: Error) => error.message,
        );
      expect(refused).toBe("REDIRECT /admin/vhod");
      harness.signedIn = true;
      const back = await actions
        .stopNewsletter(form({ id: "00000000-0000-4000-8000-000000000000" }))
        .then(
          () => "",
          (error: Error) => error.message,
        );
      expect(back).toBe("REDIRECT /admin/byuletin/00000000-0000-4000-8000-000000000000");
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
          attachments: [
            file,
            { kind: "product-blocks", version: 1, blocks: [] },
            {
              kind: "letter-plan",
              version: 1,
              preparedAt: new Date().toISOString(),
              named: [],
              announced: null,
              leftOut: {},
            },
          ],
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
