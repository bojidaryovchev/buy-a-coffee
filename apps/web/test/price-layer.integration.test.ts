import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  products,
  promotionProducts,
  promotions,
  sourceSites,
  syncChanges,
  syncRuns,
} from "@catalog/db/schema";
import type { Database } from "@catalog/db";
// Types only: the module is imported in `beforeAll`, once the test database is chosen.
import type * as Queries from "@/lib/catalog/queries";
import * as priceSql from "@/lib/catalog/price-sql";
import { isDatabaseAvailable, useTestDatabase } from "./helpers/test-db";

/**
 * The price layer against a real database (`lib/catalog/price-sql.ts`): what a
 * running promotion does to the price every reader selects, which promotion
 * wins, what the struck price is, and which products count as new.
 */

const available = await isDatabaseAvailable();
const suite = available ? describe : describe.skip;

const DAY = 24 * 60 * 60 * 1000;

suite("price layer (integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let queries: typeof Queries;
  let siteId: string;

  beforeAll(async () => {
    ({ db, close } = await useTestDatabase("price_layer"));
    queries = await import("@/lib/catalog/queries");
  });

  afterAll(async () => {
    await close?.();
  });

  beforeEach(async () => {
    await db.execute(
      sql`truncate table promotion_products, promotions, sync_changes, sync_runs, products, source_sites restart identity cascade`,
    );
    const [site] = await db
      .insert(sourceSites)
      .values({
        key: "price-test",
        name: "Test",
        baseUrl: "https://example.test",
        canonicalHost: "example.test",
      })
      .returning({ id: sourceSites.id });
    siteId = site!.id;
  });

  const addProduct = async (
    slug: string,
    price: string | null,
    extra: { oldPrice?: string } = {},
  ) => {
    const [row] = await db
      .insert(products)
      .values({
        sourceSiteId: siteId,
        sourceKey: `/${slug}/`,
        sourceUrl: `https://example.test/${slug}/`,
        sourcePath: `/${slug}/`,
        semanticHash: slug,
        slug,
        name: `Кафе на зърна Lavazza ${slug} 1кг.`,
        currentPrice: price,
        oldPrice: extra.oldPrice ?? null,
        currency: "EUR",
        status: "active",
        availability: "in_stock",
        firstSeenAt: new Date(Date.now() - 90 * DAY),
      })
      .returning({ id: products.id });
    return row!.id;
  };

  const addPromotion = async (input: {
    percentOff: number;
    startsInDays?: number;
    endsInDays?: number;
    stopped?: boolean;
    label?: string;
    members: Array<{ productId: string; reference?: string | null; removed?: boolean }>;
  }) => {
    const [promotion] = await db
      .insert(promotions)
      .values({
        name: `−${input.percentOff}%`,
        label: input.label ?? null,
        percentOff: input.percentOff,
        startsAt: new Date(Date.now() + (input.startsInDays ?? -1) * DAY),
        endsAt: new Date(Date.now() + (input.endsInDays ?? 7) * DAY),
        stoppedAt: input.stopped ? new Date() : null,
      })
      .returning({ id: promotions.id });
    for (const member of input.members) {
      await db.insert(promotionProducts).values({
        promotionId: promotion!.id,
        productId: member.productId,
        referencePrice: member.reference === undefined ? null : member.reference,
        removedAt: member.removed ? new Date() : null,
      });
    }
    return promotion!.id;
  };

  const cardOf = async (id: string) => (await queries.listProductsForOrder([id])).get(id)!.card;

  it("takes the reduction off, rounding down to the cent", async () => {
    const id = await addProduct("a", "9.95");
    const promotionId = await addPromotion({
      percentOff: 10,
      label: "Есенни дни",
      members: [{ productId: id, reference: "9.95" }],
    });
    const card = await cardOf(id);
    // 9.95 × 0.9 = 8.955: down to 8.95, so the badge still says 10%.
    expect(card.price?.amount).toBe("8.95");
    expect(card.oldPrice?.amount).toBe("9.95");
    expect(card.discountPercent).toBe(10);
    expect(card.promotion).toMatchObject({
      id: promotionId,
      label: "Есенни дни",
      percentOff: 10,
      regularPrice: { amount: "9.95" },
    });
    expect(Date.parse(card.promotion!.endsAt)).toBeGreaterThan(Date.now());
  });

  it("strikes the 30-day lowest price, never the regular price when that was higher", async () => {
    const rose = await addProduct("rose", "20.00");
    const fell = await addProduct("fell", "20.00");
    await addPromotion({
      percentOff: 10,
      members: [
        // It cost 19.00 within the 30 days: that is the struck price.
        { productId: rose, reference: "19.00" },
        // The reference was taken at 22.00; it costs 20.00 now.
        { productId: fell, reference: "22.00" },
      ],
    });
    const raised = await cardOf(rose);
    expect(raised.price?.amount).toBe("18.00");
    expect(raised.oldPrice?.amount).toBe("19.00");
    expect(raised.discountPercent).toBe(5);

    const lowered = await cardOf(fell);
    expect(lowered.oldPrice?.amount).toBe("20.00");
    expect(lowered.discountPercent).toBe(10);
  });

  it("prices a product whose 30-day lowest is already lower, without a badge", async () => {
    const id = await addProduct("b", "20.00");
    await addPromotion({ percentOff: 10, members: [{ productId: id, reference: "17.00" }] });
    const card = await cardOf(id);
    expect(card.price?.amount).toBe("18.00");
    expect(card.oldPrice).toBeNull();
    expect(card.discountPercent).toBeNull();
    expect(card.promotion?.percentOff).toBe(10);
    expect(await queries.countPromotions()).toBe(0);
  });

  it("ignores a promotion that has not started, has ended, was stopped, or the product left", async () => {
    const future = await addProduct("future", "10.00");
    const ended = await addProduct("ended", "10.00");
    const stopped = await addProduct("stopped", "10.00");
    const left = await addProduct("left", "10.00");
    await addPromotion({ percentOff: 20, startsInDays: 1, members: [{ productId: future }] });
    await addPromotion({
      percentOff: 20,
      startsInDays: -10,
      endsInDays: -1,
      members: [{ productId: ended }],
    });
    await addPromotion({ percentOff: 20, stopped: true, members: [{ productId: stopped }] });
    await addPromotion({ percentOff: 20, members: [{ productId: left, removed: true }] });
    for (const id of [future, ended, stopped, left]) {
      const card = await cardOf(id);
      expect(card.price?.amount).toBe("10.00");
      expect(card.promotion).toBeNull();
    }
  });

  it("applies in a query of the products table alone, where Drizzle drops table names", async () => {
    // A select list over one table renders `${products.id}` as a bare "id",
    // which inside the promotion subquery would mean the promotion's id
    // (docs/architecture.md, "One trap worth knowing about").
    const id = await addProduct("solo", "10.00");
    await addProduct("plain", "10.00");
    await addPromotion({ percentOff: 10, members: [{ productId: id, reference: "10.00" }] });
    const summary = await queries.getCatalogSummary();
    expect(summary.promotions).toBe(1);
    const [row] = await db
      .select({ price: priceSql.retailPrice })
      .from(products)
      .where(sql`${products.id} = ${id}`);
    expect(row?.price).toBe("9.00");

    const [run] = await db
      .insert(syncRuns)
      .values({ sourceSiteId: siteId, status: "succeeded" })
      .returning({ id: syncRuns.id });
    await db.execute(
      sql`update products set first_seen_at = now() - interval '1 day' where id = ${id}`,
    );
    await db.insert(syncChanges).values({
      syncRunId: run!.id,
      productId: id,
      sourceKey: "/solo/",
      changeType: "created",
    });
    const [fresh] = await db
      .select({ isNew: priceSql.isRecentArrival })
      .from(products)
      .where(sql`${products.id} = ${id}`);
    expect(fresh?.isNew).toBe(true);
  });

  it("gives a product in two running promotions the larger reduction", async () => {
    const id = await addProduct("c", "10.00");
    await addPromotion({ percentOff: 10, members: [{ productId: id, reference: "10.00" }] });
    const larger = await addPromotion({
      percentOff: 25,
      members: [{ productId: id, reference: "10.00" }],
    });
    const card = await cardOf(id);
    expect(card.price?.amount).toBe("7.50");
    expect(card.promotion?.id).toBe(larger);
    expect(await queries.countPromotions()).toBe(1);
  });

  it("strikes the regular price when no reference was computed yet", async () => {
    const id = await addProduct("d", "12.00");
    await addPromotion({ percentOff: 15, members: [{ productId: id, reference: null }] });
    const card = await cardOf(id);
    expect(card.price?.amount).toBe("10.20");
    expect(card.oldPrice?.amount).toBe("12.00");
  });

  it("leaves a product without a price without one", async () => {
    const id = await addProduct("e", null);
    await addPromotion({ percentOff: 10, members: [{ productId: id }] });
    const card = await cardOf(id);
    expect(card.price).toBeNull();
    expect(card.oldPrice).toBeNull();
  });

  it("keeps the source's own struck price when no promotion runs", async () => {
    const id = await addProduct("f", "8.00", { oldPrice: "10.00" });
    const card = await cardOf(id);
    expect(card.oldPrice?.amount).toBe("10.00");
    expect(card.discountPercent).toBe(20);
    expect(card.promotion).toBeNull();
  });

  it("counts as new only what an ordinary sync created, not an import", async () => {
    const [ordinary] = await db
      .insert(syncRuns)
      .values({ sourceSiteId: siteId, status: "succeeded" })
      .returning({ id: syncRuns.id });
    const [bulk] = await db
      .insert(syncRuns)
      .values({ sourceSiteId: siteId, status: "succeeded" })
      .returning({ id: syncRuns.id });
    const fresh = await addProduct("fresh", "10.00");
    const imported = await addProduct("imported", "10.00");
    const old = await addProduct("old", "10.00");
    await db.execute(
      sql`update products set first_seen_at = now() - interval '2 days' where id in (${fresh}, ${imported})`,
    );
    await db.insert(syncChanges).values({
      syncRunId: ordinary!.id,
      productId: fresh,
      sourceKey: "/fresh/",
      changeType: "created",
    });
    await db.insert(syncChanges).values(
      Array.from({ length: 26 }, (_, index) => ({
        syncRunId: bulk!.id,
        productId: index === 0 ? imported : null,
        sourceKey: `/bulk-${index}/`,
        changeType: "created" as const,
      })),
    );
    await db.insert(syncChanges).values({
      syncRunId: ordinary!.id,
      productId: old,
      sourceKey: "/old/",
      changeType: "created",
    });
    expect((await cardOf(fresh)).isNew).toBe(true);
    expect((await cardOf(imported)).isNew).toBe(false);
    // Created by an ordinary run, but 90 days ago.
    expect((await cardOf(old)).isNew).toBe(false);
  });
});
