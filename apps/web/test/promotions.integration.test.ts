import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  brands,
  categories,
  productCategories,
  products,
  promotionProducts,
  promotions,
  sourceSites,
  syncChanges,
  syncRuns,
  type PromotionTargets,
} from "@catalog/db/schema";
import type { Database } from "@catalog/db";
// Types only: the modules are imported in `beforeAll`, once the test database is chosen.
import type * as Actions from "@/lib/promotions/actions";
import type * as Membership from "@/lib/promotions/membership";
import type * as Refresh from "@/lib/promotions/refresh";
import type * as Preview from "@/lib/promotions/preview";
import type * as Queries from "@/lib/catalog/queries";
import type * as CronRoute from "@/app/api/cron/promotions/route";
import { addDays, todayInSofia } from "@/lib/promotions/days";
import { PROMOTION_MESSAGES } from "@/lib/promotions/schemas";
import { isDatabaseAvailable, useTestDatabase } from "./helpers/test-db";

/**
 * The shop's own promotions against a real database: which products a
 * promotion covers (brands, a category and everything below it, single
 * products, exclusions), the 30-day lowest price computed from the sync's
 * real `sync_changes` and from earlier promotions, when it is settled, the
 * panel's actions and their rules (what a running promotion may change, stop,
 * delete only before the start, duplicate, the confirmation above 20%), and
 * the hourly cron. The price the shop then charges is read through the price
 * layer, as every page reads it.
 */

const available = await isDatabaseAvailable();
const suite = available ? describe : describe.skip;

const harness = vi.hoisted(() => ({
  signedIn: true,
  revalidated: [] as string[],
}));

vi.mock("next/cache", () => ({
  revalidatePath: (path: string, type?: string) => {
    harness.revalidated.push(type ? `${path} ${type}` : path);
  },
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock("@/lib/auth", () => ({ isSignedIn: async () => harness.signedIn }));

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const SHOP = "/(site)/[lang] layout";

/** Where an action sent the browser, or a failure if it did not. */
async function redirected(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const match = /^REDIRECT (.+)$/.exec(error instanceof Error ? error.message : "");
    if (match) return match[1]!;
    throw error;
  }
  throw new Error("expected a redirect");
}

function formOf(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
}

const targetsOf = (targets: Partial<PromotionTargets>): string =>
  JSON.stringify({
    productIds: [],
    brandIds: [],
    categoryIds: [],
    excludedProductIds: [],
    ...targets,
  });

suite("promotions (integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let actions: typeof Actions;
  let membership: typeof Membership;
  let refresh: typeof Refresh;
  let preview: typeof Preview;
  let queries: typeof Queries;
  let cron: typeof CronRoute;

  let siteId: string;
  let runId: string;
  const brand: Record<"lavazza" | "vergnano", string> = { lavazza: "", vergnano: "" };
  const category: Record<"capsules" | "nespresso" | "original" | "beans", string> = {
    capsules: "",
    nespresso: "",
    original: "",
    beans: "",
  };
  const product: Record<
    | "lavazzaCapsules"
    | "lavazzaBeans"
    | "vergnanoCapsules"
    | "vergnanoBeans"
    | "missing"
    | "removed",
    string
  > = {
    lavazzaCapsules: "",
    lavazzaBeans: "",
    vergnanoCapsules: "",
    vergnanoBeans: "",
    missing: "",
    removed: "",
  };

  beforeAll(async () => {
    ({ db, close } = await useTestDatabase("promotions"));
    actions = await import("@/lib/promotions/actions");
    membership = await import("@/lib/promotions/membership");
    refresh = await import("@/lib/promotions/refresh");
    preview = await import("@/lib/promotions/preview");
    queries = await import("@/lib/catalog/queries");
    cron = await import("@/app/api/cron/promotions/route");
  });

  afterAll(async () => {
    await close?.();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const addProduct = async (
    key: string,
    input: {
      brandId: string;
      categoryId: string;
      price: string | null;
      status?: "active" | "missing" | "removed";
      availability?: "in_stock" | "out_of_stock";
    },
  ) => {
    const [row] = await db
      .insert(products)
      .values({
        sourceSiteId: siteId,
        sourceKey: `/${key}/`,
        sourceUrl: `https://example.test/${key}/`,
        sourcePath: `/${key}/`,
        semanticHash: key,
        slug: key,
        name: `Кафе на зърна Lavazza ${key} 1кг.`,
        brandId: input.brandId,
        currentPrice: input.price,
        currency: "EUR",
        status: input.status ?? "active",
        availability: input.availability ?? "in_stock",
        firstSeenAt: new Date(Date.now() - 90 * DAY),
      })
      .returning({ id: products.id });
    await db.insert(productCategories).values({
      productId: row!.id,
      categoryId: input.categoryId,
      isPrimary: true,
    });
    return row!.id;
  };

  const addCategory = async (key: string, parentId: string | null) => {
    const [row] = await db
      .insert(categories)
      .values({ sourceSiteId: siteId, sourceKey: key, slug: key, name: key, parentId })
      .returning({ id: categories.id });
    return row!.id;
  };

  const addBrand = async (key: string) => {
    const [row] = await db
      .insert(brands)
      .values({ sourceSiteId: siteId, sourceKey: key, slug: key, name: key })
      .returning({ id: brands.id });
    return row!.id;
  };

  /** A price change, as the sync records one, `at` the given instant. */
  const priceChange = async (productId: string, at: Date, before: string, after: string) => {
    await db.insert(syncChanges).values({
      syncRunId: runId,
      productId,
      sourceKey: `/${productId}/`,
      changeType: "updated",
      changedFields: ["currentPrice"],
      before: { currentPrice: before },
      after: { currentPrice: after },
      createdAt: at,
    });
  };

  /** A promotion written directly, for history the panel would take days to make. */
  const addPromotion = async (input: {
    percentOff: number;
    startsAt: Date;
    endsAt: Date;
    stoppedAt?: Date | null;
    targets?: Partial<PromotionTargets>;
    members?: Array<{ productId: string; addedAt?: Date; removedAt?: Date | null }>;
  }) => {
    const [row] = await db
      .insert(promotions)
      .values({
        name: `−${input.percentOff}%`,
        percentOff: input.percentOff,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        stoppedAt: input.stoppedAt ?? null,
        targets: JSON.parse(targetsOf(input.targets ?? {})) as PromotionTargets,
      })
      .returning({ id: promotions.id });
    for (const member of input.members ?? []) {
      await db.insert(promotionProducts).values({
        promotionId: row!.id,
        productId: member.productId,
        addedAt: member.addedAt ?? input.startsAt,
        removedAt: member.removedAt ?? null,
      });
    }
    return row!.id;
  };

  const rowsOf = (promotionId: string) =>
    db
      .select()
      .from(promotionProducts)
      .where(eq(promotionProducts.promotionId, promotionId))
      .then((rows) => new Map(rows.map((row) => [row.productId, row])));

  const cardOf = async (id: string) => (await queries.listProductsForOrder([id])).get(id)!.card;

  beforeEach(async () => {
    harness.signedIn = true;
    harness.revalidated = [];
    await db.execute(
      sql`truncate table promotion_products, promotions, sync_changes, sync_runs, product_categories, categories, products, brands, source_sites restart identity cascade`,
    );
    const [site] = await db
      .insert(sourceSites)
      .values({
        key: "promotions-test",
        name: "Test",
        baseUrl: "https://example.test",
        canonicalHost: "example.test",
      })
      .returning({ id: sourceSites.id });
    siteId = site!.id;
    const [run] = await db
      .insert(syncRuns)
      .values({ sourceSiteId: siteId, status: "succeeded" })
      .returning({ id: syncRuns.id });
    runId = run!.id;

    brand.lavazza = await addBrand("lavazza");
    brand.vergnano = await addBrand("vergnano");
    category.capsules = await addCategory("capsules", null);
    category.nespresso = await addCategory("nespresso", category.capsules);
    category.original = await addCategory("nespresso-original", category.nespresso);
    category.beans = await addCategory("beans", null);

    product.lavazzaCapsules = await addProduct("lavazza-capsules", {
      brandId: brand.lavazza,
      categoryId: category.nespresso,
      price: "10.00",
    });
    product.lavazzaBeans = await addProduct("lavazza-beans", {
      brandId: brand.lavazza,
      categoryId: category.beans,
      price: "20.00",
    });
    product.vergnanoCapsules = await addProduct("vergnano-capsules", {
      brandId: brand.vergnano,
      categoryId: category.original,
      price: "8.00",
      availability: "out_of_stock",
    });
    product.vergnanoBeans = await addProduct("vergnano-beans", {
      brandId: brand.vergnano,
      categoryId: category.beans,
      price: "25.00",
    });
    product.missing = await addProduct("lavazza-missing", {
      brandId: brand.lavazza,
      categoryId: category.beans,
      price: "15.00",
      status: "missing",
    });
    product.removed = await addProduct("lavazza-removed", {
      brandId: brand.lavazza,
      categoryId: category.beans,
      price: "12.00",
      status: "removed",
    });
  });

  /* -- what a promotion covers ---------------------------------------------- */

  describe("membership", () => {
    const resolve = (targets: Partial<PromotionTargets>) =>
      membership
        .resolveTargets(db, JSON.parse(targetsOf(targets)) as PromotionTargets)
        .then((ids) => new Set(ids));

    it("covers a brand's products, one the sync is unsure of too, not one it removed", async () => {
      expect(await resolve({ brandIds: [brand.lavazza] })).toEqual(
        new Set([product.lavazzaCapsules, product.lavazzaBeans, product.missing]),
      );
    });

    it("covers a category and every category below it", async () => {
      expect(await resolve({ categoryIds: [category.capsules] })).toEqual(
        new Set([product.lavazzaCapsules, product.vergnanoCapsules]),
      );
      expect(await resolve({ categoryIds: [category.original] })).toEqual(
        new Set([product.vergnanoCapsules]),
      );
    });

    it("adds single products, and an exclusion wins over every inclusion", async () => {
      expect(
        await resolve({
          productIds: [product.vergnanoBeans, product.lavazzaCapsules],
          categoryIds: [category.capsules],
          excludedProductIds: [product.lavazzaCapsules],
        }),
      ).toEqual(new Set([product.vergnanoBeans, product.vergnanoCapsules]));
      expect(await resolve({ excludedProductIds: [product.lavazzaBeans] })).toEqual(new Set());
    });

    it("deletes a leaver before the start, keeps it as history after, and takes it back", async () => {
      const now = new Date();
      const upcoming = {
        id: await addPromotion({
          percentOff: 10,
          startsAt: new Date(now.getTime() + DAY),
          endsAt: new Date(now.getTime() + 8 * DAY),
        }),
        percentOff: 10,
        startsAt: new Date(now.getTime() + DAY),
        endsAt: new Date(now.getTime() + 8 * DAY),
      };
      await membership.syncMembership(
        db,
        upcoming,
        [product.lavazzaBeans, product.vergnanoBeans],
        now,
      );
      const dropped = await membership.syncMembership(db, upcoming, [product.lavazzaBeans], now);
      expect(dropped.dropped).toEqual([product.vergnanoBeans]);
      expect([...(await rowsOf(upcoming.id)).keys()]).toEqual([product.lavazzaBeans]);

      const startsAt = new Date(now.getTime() - DAY);
      const running = {
        id: await addPromotion({ percentOff: 10, startsAt, endsAt: new Date(now.getTime() + DAY) }),
        percentOff: 10,
        startsAt,
        endsAt: new Date(now.getTime() + DAY),
      };
      const joinedAt = new Date(now.getTime() - 5 * HOUR);
      await membership.syncMembership(db, running, [product.lavazzaBeans], joinedAt);
      const leftAt = new Date(now.getTime() - 2 * HOUR);
      const left = await membership.syncMembership(db, running, [], leftAt);
      expect(left.left).toEqual([product.lavazzaBeans]);
      const kept = (await rowsOf(running.id)).get(product.lavazzaBeans)!;
      expect(kept.removedAt?.getTime()).toBe(leftAt.getTime());

      const back = await membership.syncMembership(db, running, [product.lavazzaBeans], now);
      expect(back.rejoined.get(product.lavazzaBeans)).toEqual({
        percentOff: 10,
        from: joinedAt.getTime(),
        to: leftAt.getTime(),
      });
      const returned = (await rowsOf(running.id)).get(product.lavazzaBeans)!;
      expect(returned.removedAt).toBeNull();
      expect(returned.addedAt.getTime()).toBe(now.getTime());
      expect(returned.referenceFinal).toBe(false);
    });
  });

  /* -- the 30-day lowest price ------------------------------------------------ */

  describe("the reference price", () => {
    it("is the lowest price the sync recorded in the 30 days before the product joined", async () => {
      const now = new Date();
      await priceChange(product.lavazzaBeans, new Date(now.getTime() - 40 * DAY), "22.00", "19.00");
      await priceChange(product.lavazzaBeans, new Date(now.getTime() - 20 * DAY), "19.00", "18.50");
      await priceChange(product.lavazzaBeans, new Date(now.getTime() - 5 * DAY), "18.50", "20.00");
      const id = await addPromotion({
        percentOff: 10,
        startsAt: new Date(now.getTime() - HOUR),
        endsAt: new Date(now.getTime() + 7 * DAY),
        targets: { productIds: [product.lavazzaBeans] },
      });
      await refresh.refreshPromotions(now);
      const row = (await rowsOf(id)).get(product.lavazzaBeans)!;
      expect(row.referencePrice).toBe("18.50");
      expect(row.referenceFinal).toBe(true);
      // Joined a running promotion: T is the moment it joined.
      expect(row.referenceAt?.getTime()).toBe(now.getTime());

      // The shop: 20.00 less 10% is 18.00, struck at 18.50, a 2% badge.
      const card = await cardOf(product.lavazzaBeans);
      expect(card.price?.amount).toBe("18.00");
      expect(card.oldPrice?.amount).toBe("18.50");
      expect(card.discountPercent).toBe(2);
    });

    it("counts an earlier promotion in the window, so the badge is smaller or gone", async () => {
      const now = new Date();
      await addPromotion({
        percentOff: 20,
        startsAt: new Date(now.getTime() - 12 * DAY),
        endsAt: new Date(now.getTime() + 2 * DAY),
        stoppedAt: new Date(now.getTime() - 9 * DAY),
        members: [{ productId: product.lavazzaBeans }],
      });
      const id = await addPromotion({
        percentOff: 10,
        startsAt: new Date(now.getTime() - HOUR),
        endsAt: new Date(now.getTime() + 7 * DAY),
        targets: { productIds: [product.lavazzaBeans, product.vergnanoBeans] },
      });
      await refresh.refreshPromotions(now);
      const rows = await rowsOf(id);
      // 20.00 less the earlier 20%: 16.00, below this promotion's 18.00.
      expect(rows.get(product.lavazzaBeans)!.referencePrice).toBe("16.00");
      expect(rows.get(product.vergnanoBeans)!.referencePrice).toBe("25.00");

      const card = await cardOf(product.lavazzaBeans);
      expect(card.price?.amount).toBe("18.00");
      expect(card.oldPrice).toBeNull();
      expect(card.discountPercent).toBeNull();
      expect(card.promotion?.id).toBe(id);
    });

    it("is provisional until the start, settled at the first refresh after it, and then never moves", async () => {
      const now = new Date();
      const startsAt = new Date(now.getTime() + 2 * HOUR);
      const id = await addPromotion({
        percentOff: 10,
        startsAt,
        endsAt: new Date(now.getTime() + 7 * DAY),
        targets: { brandIds: [brand.vergnano] },
      });
      await refresh.refreshPromotions(now);
      let row = (await rowsOf(id)).get(product.vergnanoBeans)!;
      expect(row.referenceFinal).toBe(false);
      expect(row.referencePrice).toBe("25.00");
      expect(row.referenceAt?.getTime()).toBe(startsAt.getTime());

      // The source lowers the price an hour before the start.
      await priceChange(product.vergnanoBeans, new Date(now.getTime() + HOUR), "25.00", "23.00");
      await db
        .update(products)
        .set({ currentPrice: "23.00" })
        .where(eq(products.id, product.vergnanoBeans));
      // And raises it again after the start, before the next refresh.
      await priceChange(
        product.vergnanoBeans,
        new Date(startsAt.getTime() + 10 * 60 * 1000),
        "23.00",
        "21.00",
      );

      const report = await refresh.refreshPromotions(new Date(startsAt.getTime() + HOUR));
      expect(report.started).toBe(1);
      expect(report.shopChanged).toBe(true);
      row = (await rowsOf(id)).get(product.vergnanoBeans)!;
      // Computed at exactly T: the 23.00 counts, the 21.00 after T does not.
      expect(row.referencePrice).toBe("23.00");
      expect(row.referenceFinal).toBe(true);

      await priceChange(
        product.vergnanoBeans,
        new Date(startsAt.getTime() + 2 * HOUR),
        "21.00",
        "5.00",
      );
      await refresh.refreshPromotions(new Date(startsAt.getTime() + 3 * HOUR));
      row = (await rowsOf(id)).get(product.vergnanoBeans)!;
      expect(row.referencePrice).toBe("23.00");
    });

    it("settles what an ended promotion priced, once, and then leaves it alone", async () => {
      const now = new Date();
      const id = await addPromotion({
        percentOff: 15,
        startsAt: new Date(now.getTime() - 3 * DAY),
        endsAt: new Date(now.getTime() - DAY),
        members: [{ productId: product.lavazzaCapsules }],
      });
      const first = await refresh.refreshPromotions(now);
      expect(first.ended).toBe(1);
      expect(first.finalized).toBe(1);
      expect((await rowsOf(id)).get(product.lavazzaCapsules)!.referenceFinal).toBe(true);

      const second = await refresh.refreshPromotions(new Date(now.getTime() + HOUR));
      expect(second.promotions).toBe(0);
      expect(second.shopChanged).toBe(false);
    });

    it("counts a returning product's own earlier time in the promotion", async () => {
      const now = new Date();
      const startsAt = new Date(now.getTime() - 10 * DAY);
      const id = await addPromotion({
        percentOff: 30,
        startsAt,
        endsAt: new Date(now.getTime() + 10 * DAY),
        targets: { productIds: [product.lavazzaBeans] },
        members: [
          {
            productId: product.lavazzaBeans,
            addedAt: startsAt,
            removedAt: new Date(now.getTime() - 3 * DAY),
          },
        ],
      });
      await refresh.refreshPromotions(now);
      const row = (await rowsOf(id)).get(product.lavazzaBeans)!;
      expect(row.removedAt).toBeNull();
      // It sold at 14.00 a week ago in this very promotion: that is the lowest.
      expect(row.referencePrice).toBe("14.00");
      expect((await cardOf(product.lavazzaBeans)).discountPercent).toBeNull();
    });

    it("lets a product the sync brings into a promoted brand join at the next refresh", async () => {
      const now = new Date();
      const id = await addPromotion({
        percentOff: 10,
        startsAt: new Date(now.getTime() - DAY),
        endsAt: new Date(now.getTime() + DAY),
        targets: { brandIds: [brand.lavazza] },
      });
      await refresh.refreshPromotions(now);
      expect((await rowsOf(id)).size).toBe(3);
      await db.update(products).set({ status: "active" }).where(eq(products.id, product.removed));
      const report = await refresh.refreshPromotions(new Date(now.getTime() + HOUR));
      expect(report.joined).toBe(1);
      expect(report.shopChanged).toBe(true);
      expect((await rowsOf(id)).get(product.removed)?.referenceFinal).toBe(true);
    });

    it("keeps a product through a run that missed it, its reference untouched", async () => {
      const now = new Date();
      const id = await addPromotion({
        percentOff: 10,
        startsAt: new Date(now.getTime() - DAY),
        endsAt: new Date(now.getTime() + DAY),
        targets: { brandIds: [brand.lavazza] },
      });
      await refresh.refreshPromotions(now);
      const before = (await rowsOf(id)).get(product.lavazzaBeans)!;
      await db
        .update(products)
        .set({ status: "missing" })
        .where(eq(products.id, product.lavazzaBeans));
      const missed = await refresh.refreshPromotions(new Date(now.getTime() + HOUR));
      expect(missed.left).toBe(0);
      await db
        .update(products)
        .set({ status: "active" })
        .where(eq(products.id, product.lavazzaBeans));
      const back = await refresh.refreshPromotions(new Date(now.getTime() + 2 * HOUR));
      expect(back.rejoined).toBe(0);
      const after = (await rowsOf(id)).get(product.lavazzaBeans)!;
      expect(after).toMatchObject({
        removedAt: null,
        referencePrice: before.referencePrice,
        referenceFinal: true,
      });
      expect(after.addedAt.getTime()).toBe(before.addedAt.getTime());
      expect((await cardOf(product.lavazzaBeans)).discountPercent).toBe(10);

      // Removed for good, it leaves, and keeps its row as history.
      await db
        .update(products)
        .set({ status: "removed" })
        .where(eq(products.id, product.lavazzaBeans));
      const gone = await refresh.refreshPromotions(new Date(now.getTime() + 3 * HOUR));
      expect(gone.left).toBe(1);
      expect((await rowsOf(id)).get(product.lavazzaBeans)!.removedAt).not.toBeNull();
    });
  });

  /* -- the panel ---------------------------------------------------------- */

  describe("the editor's actions", () => {
    const today = () => todayInSofia();
    const fields = (overrides: Record<string, string> = {}) => ({
      id: "",
      version: "",
      name: "Есен — Lavazza",
      label: "Есенни дни",
      percent: "10",
      confirmHigh: "",
      startDay: today(),
      endDay: addDays(today(), 6),
      targets: targetsOf({ brandIds: [brand.lavazza] }),
      ...overrides,
    });
    const create = async (overrides: Record<string, string> = {}) => {
      const to = await redirected(actions.savePromotion({}, formOf(fields(overrides))));
      const match = /^\/admin\/promotsii\/([0-9a-f-]{36})\?izvestie=zapazena$/.exec(to);
      expect(match).not.toBeNull();
      return match![1]!;
    };
    const versionOf = async (id: string) => {
      const [row] = await db.select().from(promotions).where(eq(promotions.id, id));
      return String(row!.updatedAt.getTime());
    };

    it("creates a promotion that starts today, live at once, and refreshes the whole shop", async () => {
      const id = await create();
      const rows = await rowsOf(id);
      expect(new Set(rows.keys())).toEqual(
        new Set([product.lavazzaCapsules, product.lavazzaBeans, product.missing]),
      );
      expect([...rows.values()].every((row) => row.referenceFinal)).toBe(true);
      expect(harness.revalidated).toContain(SHOP);

      const card = await cardOf(product.lavazzaBeans);
      expect(card.price?.amount).toBe("18.00");
      expect(card.oldPrice?.amount).toBe("20.00");
      expect(card.discountPercent).toBe(10);
      expect(card.promotion).toMatchObject({ id, label: "Есенни дни", percentOff: 10 });
    });

    it("asks for the confirmation above 20%, on the server too", async () => {
      const refused = await actions.savePromotion({}, formOf(fields({ percent: "30" })));
      expect(refused.fieldErrors).toEqual({ confirmHigh: PROMOTION_MESSAGES.confirm(30) });
      expect(await db.select().from(promotions)).toHaveLength(0);

      const id = await create({ percent: "30", confirmHigh: "30" });
      const [row] = await db.select().from(promotions).where(eq(promotions.id, id));
      expect(row!.percentOff).toBe(30);
    });

    it("refuses without a session, and writes nothing", async () => {
      harness.signedIn = false;
      const answer = await actions.savePromotion({}, formOf(fields()));
      expect(answer.error).toMatch(/Сесията е изтекла/);
      expect(await db.select().from(promotions)).toHaveLength(0);
    });

    it("lets a running promotion change its name, end and products, never its percentage or start", async () => {
      const id = await create();
      const version = await versionOf(id);

      const locked = await actions.savePromotion(
        {},
        formOf(fields({ id, version, percent: "15" })),
      );
      expect(locked.error).toMatch(/спрете тази и започнете нова/);
      const moved = await actions.savePromotion(
        {},
        formOf(fields({ id, version, startDay: addDays(today(), 1) })),
      );
      expect(moved.error).toMatch(/спрете тази и започнете нова/);

      const saved = await actions.savePromotion(
        {},
        formOf(
          fields({
            id,
            version,
            name: "Есен — само зърна",
            endDay: addDays(today(), 13),
            targets: targetsOf({
              brandIds: [brand.lavazza],
              excludedProductIds: [product.lavazzaCapsules],
            }),
          }),
        ),
      );
      expect(saved.error).toBeUndefined();
      expect(saved.version).toBeDefined();
      const rows = await rowsOf(id);
      // Started, so the product that left keeps its row, stamped.
      expect(rows.get(product.lavazzaCapsules)!.removedAt).not.toBeNull();
      expect(rows.get(product.lavazzaBeans)!.removedAt).toBeNull();
      expect((await cardOf(product.lavazzaCapsules)).promotion).toBeNull();

      // A second save over the old version is refused.
      const stale = await actions.savePromotion({}, formOf(fields({ id, version })));
      expect(stale.error).toMatch(/в друг раздел/);
    });

    it("may not end a running promotion before today", async () => {
      const id = await create();
      const answer = await actions.savePromotion(
        {},
        formOf(fields({ id, version: await versionOf(id), endDay: addDays(today(), -1) })),
      );
      expect(answer.fieldErrors?.endDay).toBeDefined();
    });

    it("stops a running promotion: the regular price is back at once", async () => {
      const id = await create();
      harness.revalidated = [];
      const to = await redirected(actions.stopPromotion(formOf({ id })));
      expect(to).toBe(`/admin/promotsii/${id}?izvestie=spryana`);
      expect(harness.revalidated).toContain(SHOP);
      const [row] = await db.select().from(promotions).where(eq(promotions.id, id));
      expect(row!.stoppedAt).not.toBeNull();
      const card = await cardOf(product.lavazzaBeans);
      expect(card.price?.amount).toBe("20.00");
      expect(card.promotion).toBeNull();

      // Stopped is over: no more edits, no second stop, no delete.
      const edit = await actions.savePromotion(
        {},
        formOf(fields({ id, version: String(row!.updatedAt.getTime()) })),
      );
      expect(edit.error).toMatch(/приключила/);
      expect(await redirected(actions.stopPromotion(formOf({ id })))).toBe(
        `/admin/promotsii/${id}?otkaz=ne-teche`,
      );
      expect(await redirected(actions.deletePromotion(formOf({ id })))).toBe(
        `/admin/promotsii/${id}?otkaz=zapochnala`,
      );
    });

    it("deletes only before the start", async () => {
      const running = await create();
      expect(await redirected(actions.deletePromotion(formOf({ id: running })))).toBe(
        `/admin/promotsii/${running}?otkaz=zapochnala`,
      );
      expect(await db.select().from(promotions).where(eq(promotions.id, running))).toHaveLength(1);

      const upcoming = await create({
        startDay: addDays(today(), 3),
        endDay: addDays(today(), 5),
      });
      expect((await rowsOf(upcoming)).size).toBe(3);
      expect(await redirected(actions.stopPromotion(formOf({ id: upcoming })))).toBe(
        `/admin/promotsii/${upcoming}?otkaz=ne-teche`,
      );
      expect(await redirected(actions.deletePromotion(formOf({ id: upcoming })))).toBe(
        "/admin/promotsii?izvestie=iztrita",
      );
      expect(await db.select().from(promotions).where(eq(promotions.id, upcoming))).toHaveLength(0);
      expect(
        await db
          .select()
          .from(promotionProducts)
          .where(eq(promotionProducts.promotionId, upcoming)),
      ).toHaveLength(0);
    });

    it("duplicates into a copy that starts tomorrow, for as many days", async () => {
      const source = await create({
        endDay: addDays(today(), 9),
        percent: "25",
        confirmHigh: "25",
      });
      const to = await redirected(actions.duplicatePromotion(formOf({ id: source })));
      const match = /^\/admin\/promotsii\/([0-9a-f-]{36})\?izvestie=kopie$/.exec(to);
      expect(match).not.toBeNull();
      const [copy] = await db.select().from(promotions).where(eq(promotions.id, match![1]!));
      expect(copy).toMatchObject({
        name: "Есен — Lavazza (копие)",
        label: "Есенни дни",
        percentOff: 25,
        stoppedAt: null,
      });
      const { daysFromPeriod } = await import("@/lib/promotions/days");
      expect(daysFromPeriod(copy!)).toEqual({
        startDay: addDays(today(), 1),
        endDay: addDays(today(), 10),
      });
      expect(copy!.targets).toEqual(JSON.parse(targetsOf({ brandIds: [brand.lavazza] })));
    });

    it("moves the products' start to the save when an upcoming promotion is brought forward to today", async () => {
      const id = await create({ startDay: addDays(today(), 2), endDay: addDays(today(), 4) });
      const before = (await rowsOf(id)).get(product.lavazzaBeans)!;
      expect(before.referenceFinal).toBe(false);
      const pressed = Date.now();
      const saved = await actions.savePromotion(
        {},
        formOf(fields({ id, version: await versionOf(id), endDay: addDays(today(), 4) })),
      );
      expect(saved.error).toBeUndefined();
      const after = (await rowsOf(id)).get(product.lavazzaBeans)!;
      expect(after.referenceFinal).toBe(true);
      expect(after.referenceAt!.getTime()).toBeGreaterThanOrEqual(pressed);
      expect((await cardOf(product.lavazzaBeans)).price?.amount).toBe("18.00");
    });
  });

  /* -- the preview ---------------------------------------------------------- */

  describe("the preview", () => {
    it("shows each product's price, struck price and badge as the shop will, and why one is missing", async () => {
      const now = new Date();
      await addPromotion({
        percentOff: 20,
        startsAt: new Date(now.getTime() - 12 * DAY),
        endsAt: new Date(now.getTime() - 8 * DAY),
        members: [{ productId: product.lavazzaBeans }],
      });
      // Coming in two days, at a larger reduction: it will win while both run.
      await addPromotion({
        percentOff: 25,
        startsAt: new Date(now.getTime() + 2 * DAY),
        endsAt: new Date(now.getTime() + 20 * DAY),
        members: [{ productId: product.vergnanoBeans, addedAt: now }],
      });
      const answer = await preview.previewPromotion(
        {
          promotionId: null,
          percent: 10,
          startDay: todayInSofia(now),
          endDay: addDays(todayInSofia(now), 6),
          targets: JSON.parse(
            targetsOf({ categoryIds: [category.beans], brandIds: [brand.vergnano] }),
          ) as PromotionTargets,
        },
        now,
      );
      expect(answer.total).toBe(3);
      expect(answer.reduced).toBe(3);
      const row = (id: string) => answer.rows.find((entry) => entry.id === id)!;

      expect(row(product.lavazzaBeans)).toMatchObject({ badge: null, struck: null });
      expect(row(product.lavazzaBeans).notes.map((note) => note.kind)).toEqual(["noBadge"]);

      expect(row(product.vergnanoCapsules).badge).toBe(10);
      expect(row(product.vergnanoCapsules).notes.map((note) => note.kind)).toEqual(["soldOut"]);

      const overlapping = row(product.vergnanoBeans);
      expect(overlapping.badge).toBe(10);
      expect(overlapping.notes).toEqual([
        expect.objectContaining({ kind: "overlap", text: expect.stringMatching(/важи тя/) }),
      ]);
    });
  });

  /* -- the cron ------------------------------------------------------------- */

  describe("the hourly cron", () => {
    const call = (authorization?: string) =>
      cron.GET(
        new Request("http://localhost/api/cron/promotions", {
          headers: authorization ? { authorization } : {},
        }),
      );

    it("does not exist without a secret, and refuses a wrong one", async () => {
      vi.stubEnv("CRON_SECRET", "");
      expect((await call("Bearer anything")).status).toBe(404);
      vi.stubEnv("CRON_SECRET", "cron-test-secret");
      expect((await call()).status).toBe(401);
      expect((await call("Bearer wrong")).status).toBe(401);
      expect(harness.revalidated).toEqual([]);
    });

    it("refreshes, revalidates the shop when a promotion started, and answers with counts", async () => {
      vi.stubEnv("CRON_SECRET", "cron-test-secret");
      const now = new Date();
      const id = await addPromotion({
        percentOff: 10,
        startsAt: new Date(now.getTime() - 10 * 60 * 1000),
        endsAt: new Date(now.getTime() + DAY),
        targets: { brandIds: [brand.vergnano] },
      });
      const response = await call("Bearer cron-test-secret");
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toMatchObject({ promotions: 1, joined: 2, started: 1, revalidated: true });
      expect(harness.revalidated).toContain(SHOP);
      expect([...(await rowsOf(id)).values()].every((row) => row.referenceFinal)).toBe(true);

      harness.revalidated = [];
      const again = (await (await call("Bearer cron-test-secret")).json()) as Record<
        string,
        unknown
      >;
      expect(again).toMatchObject({ joined: 0, started: 0, revalidated: false });
      expect(harness.revalidated).toEqual([]);
    });
  });
});
