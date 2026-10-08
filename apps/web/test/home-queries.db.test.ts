import { afterAll, describe, expect, it, vi } from "vitest";
import { createDatabase } from "@catalog/db";

/*
 * `@/lib/db` opens a pool on import and throws without `DATABASE_URL`; see
 * `vending.test.ts`. Without a database this whole file is skipped.
 */
vi.mock("@/lib/db", async (importOriginal) =>
  process.env.DATABASE_URL ? await importOriginal() : { db: {} },
);

import { listHeroShelfCandidates } from "@/lib/catalog/home-queries";
import { HERO_SHELF_SIZE, selectHeroShelf } from "@/lib/catalog/home-shelf";
import { getSystemAvailability, listNewArrivals } from "@/lib/catalog/queries";
import { BREWING_SYSTEMS } from "@/lib/recommend/systems";

/**
 * The hero-shelf query against a real catalog. Read-only.
 *
 * Skipped, not failed, when no database is reachable or it holds no catalog.
 */

async function probe(): Promise<boolean> {
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  try {
    const { sql, close } = createDatabase({ url, max: 1, connectTimeoutSeconds: 3 });
    try {
      const [row] = await sql`select count(*)::int as n from products where status = 'active'`;
      return Number(row?.n ?? 0) >= 50;
    } finally {
      await close();
    }
  } catch {
    return false;
  }
}

const hasCatalog = await probe();

afterAll(async () => {
  // Without this the pool keeps the Vitest worker alive.
  await globalThis.__catalogDb?.close();
  globalThis.__catalogDb = undefined;
});

describe.skipIf(!hasCatalog)("listHeroShelfCandidates", () => {
  it("ranks each system's photographed products from 1, without gaps", async () => {
    const candidates = await listHeroShelfCandidates();
    expect(candidates.length).toBeGreaterThan(0);

    for (const system of BREWING_SYSTEMS) {
      const ranks = candidates
        .filter((candidate) => candidate.systemId === system.id)
        .map((candidate) => candidate.rank);
      expect(ranks).toEqual(ranks.map((_, index) => index + 1));
      expect(ranks.length).toBeLessThanOrEqual(HERO_SHELF_SIZE);
    }
  });

  it("only returns a system the availability query also counts", async () => {
    const [candidates, availability] = await Promise.all([
      listHeroShelfCandidates(),
      getSystemAvailability(),
    ]);

    for (const candidate of candidates) {
      expect(availability[candidate.systemId]).toBeGreaterThan(0);
      expect(candidate.image.url).not.toContain("placeholder");
    }
  });

  it("respects the per-system bound it is given", async () => {
    const one = await listHeroShelfCandidates(1);
    expect(one.every((candidate) => candidate.rank === 1)).toBe(true);
    expect(one.length).toBeLessThanOrEqual(BREWING_SYSTEMS.length);
  });

  it("returns the same rows, in the same order, on every call", async () => {
    const first = await listHeroShelfCandidates();
    const second = await listHeroShelfCandidates();

    expect(second).toEqual(first);
    expect(selectHeroShelf(second)).toEqual(selectHeroShelf(first));
  });

  it("agrees with the new-arrivals row about which product is newest", async () => {
    const [candidates, arrivals] = await Promise.all([
      listHeroShelfCandidates(1),
      listNewArrivals(1),
    ]);
    const newest = arrivals[0];
    // The newest product overall is the newest of its own system, provided it
    // has a photograph and a system at all.
    if (newest?.image && newest.systemId) {
      expect(candidates.map((candidate) => candidate.id)).toContain(newest.id);
    }
  });
});
