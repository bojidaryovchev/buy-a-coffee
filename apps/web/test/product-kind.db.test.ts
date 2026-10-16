import { afterAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase, type Database } from "@catalog/db";
import { products } from "@catalog/db/schema";
import { isInstantCoffeeName, packServings, productKind } from "@catalog/shared";

/*
 * `@/lib/db` opens a pool the moment it is imported and throws when there is
 * no `DATABASE_URL`. Without one the module is replaced by an inert stand-in so
 * this file can still load, and every suite below skips itself.
 */
vi.mock("@/lib/db", async (importOriginal) =>
  process.env.DATABASE_URL ? await importOriginal() : { db: {} },
);

import { isInstantCoffee } from "@/lib/catalog/product-kind-sql";
import { getSystemAvailability, listRecommendationCandidates } from "@/lib/catalog/queries";
import { BREWING_SYSTEMS } from "@/lib/recommend/systems";

/**
 * The kind of coffee, in TypeScript and in SQL, against the real catalog.
 *
 * `productKind` decides in code and `isInstantCoffee` in queries, over one
 * pattern string; this holds the two together over every product, and checks
 * that what follows from the kind — the dose the sync stored, no brewing
 * system, no recommendation — holds in the stored catalog. Read-only, like
 * every `*.db.test.ts`.
 */

const databaseUrl = process.env.DATABASE_URL;

async function probe(): Promise<{ reachable: boolean; hasCatalog: boolean }> {
  if (!databaseUrl) return { reachable: false, hasCatalog: false };
  try {
    const { sql, close } = createDatabase({ url: databaseUrl, max: 1, connectTimeoutSeconds: 3 });
    try {
      const [row] = await sql`select count(*)::int as count from products where status = 'active'`;
      return { reachable: true, hasCatalog: Number(row?.count ?? 0) > 0 };
    } finally {
      await close();
    }
  } catch {
    return { reachable: false, hasCatalog: false };
  }
}

const { reachable, hasCatalog } = await probe();

async function realDb(): Promise<Database> {
  return (await import("@/lib/db")).db;
}

afterAll(async () => {
  await globalThis.__catalogDb?.close();
  globalThis.__catalogDb = undefined;
});

describe.skipIf(!reachable || !hasCatalog)("instant coffee in the catalog", () => {
  it("is the same set of products in SQL as in code", async () => {
    const db = await realDb();
    const rows = await db
      .select({ name: products.name, instant: isInstantCoffee })
      .from(products)
      .where(eq(products.status, "active"));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.instant, row.name).toBe(isInstantCoffeeName(row.name));
  });

  it("is stored with the cups instant coffee's dose gives", async () => {
    const db = await realDb();
    const rows = await db
      .select({
        slug: products.slug,
        name: products.name,
        weightValue: products.weightValue,
        weightUnit: products.weightUnit,
        servings: products.servings,
      })
      .from(products)
      .where(eq(products.status, "active"));
    const instant = rows.filter((row) => productKind(row.name) === "instant");
    for (const row of instant) {
      const servings = packServings(row.weightValue, row.weightUnit, "instant");
      expect(Number(row.servings), row.slug).toBe(Number(servings?.exact));
    }
  });

  it("is in no brewing system, and is never a candidate for the wizard", async () => {
    const db = await realDb();
    const instantCount = (
      await db.select({ name: products.name }).from(products).where(eq(products.status, "active"))
    ).filter((row) => isInstantCoffeeName(row.name)).length;
    const availability = await getSystemAvailability();
    const active = await db.select({ id: products.id }).from(products);
    const inSystems = Object.values(availability).reduce((sum, count) => sum + count, 0);
    expect(inSystems).toBeLessThanOrEqual(active.length - instantCount);

    for (const system of BREWING_SYSTEMS) {
      for (const candidate of await listRecommendationCandidates(system)) {
        expect(candidate.kind, `${system.id}: ${candidate.slug}`).toBe("roasted");
      }
    }
  });
});
