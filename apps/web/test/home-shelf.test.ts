import { describe, expect, it } from "vitest";
import {
  HERO_SHELF_MIN,
  HERO_SHELF_SIZE,
  selectHeroShelf,
  type HeroShelfCandidate,
} from "@/lib/catalog/home-shelf";
import { BREWING_SYSTEMS, type BrewingSystemId } from "@/lib/recommend/systems";

/**
 * The rule that fills the hero shelf (DESIGN.md, "Home page", section 1):
 * the newest photographed product in each brewing system, in
 * `BREWING_SYSTEMS` order, the first six.
 */

function candidate(systemId: BrewingSystemId, rank: number, id?: string): HeroShelfCandidate {
  const key = id ?? `${systemId}-${rank}`;
  return {
    id: key,
    slug: key,
    name: `Продукт ${key}`,
    systemId,
    rank,
    image: { url: `/media/${key}.jpg`, alt: key, width: 600, height: 600 },
  };
}

/** `depth` ranked candidates in each of the given systems. */
function catalog(systems: readonly BrewingSystemId[], depth: number): HeroShelfCandidate[] {
  return systems.flatMap((system) =>
    Array.from({ length: depth }, (_, index) => candidate(system, index + 1)),
  );
}

const ALL = BREWING_SYSTEMS.map((system) => system.id);

/** The same items, interleaved from both ends: a different order, no randomness. */
function reordered<T>(items: readonly T[]): T[] {
  const result: T[] = [];
  for (let low = 0, high = items.length - 1; low <= high; low += 1, high -= 1) {
    result.push(items[high] as T);
    if (low !== high) result.push(items[low] as T);
  }
  return result;
}

describe("selectHeroShelf", () => {
  it("takes the newest of each system, in system order, and stops at six", () => {
    const shelf = selectHeroShelf(catalog(ALL, 4));

    expect(shelf).toHaveLength(HERO_SHELF_SIZE);
    expect(shelf.map((item) => item.id)).toEqual(
      ALL.slice(0, HERO_SHELF_SIZE).map((system) => `${system}-1`),
    );
  });

  it("is spread: with six or more systems stocked, no system appears twice", () => {
    const systems = selectHeroShelf(catalog(ALL, 6)).map((item) => item.systemId);
    expect(new Set(systems).size).toBe(systems.length);
  });

  it("is stable: the same candidates in any order give the same shelf", () => {
    const candidates = catalog(ALL, 3);
    const first = selectHeroShelf(candidates);

    expect(selectHeroShelf(reordered(candidates))).toEqual(first);
    expect(selectHeroShelf([...candidates].reverse())).toEqual(first);
    expect(selectHeroShelf(candidates)).toEqual(first);
  });

  it("breaks a tie in rank by id, so equal ranks cannot flip", () => {
    const tied = [candidate("beans", 1, "b"), candidate("beans", 1, "a"), candidate("beans", 2)];
    const expected = ["a", "b", "beans-2"];

    expect(selectHeroShelf(tied).map((item) => item.id)).toEqual(expected);
    expect(selectHeroShelf([...tied].reverse()).map((item) => item.id)).toEqual(expected);
  });

  it("is bounded by the requested size, whatever the catalog holds", () => {
    expect(selectHeroShelf(catalog(ALL, 12))).toHaveLength(HERO_SHELF_SIZE);
    expect(selectHeroShelf(catalog(ALL, 12), { size: 4 })).toHaveLength(4);
    expect(selectHeroShelf(catalog(ALL, 12), { size: 0, min: 0 })).toHaveLength(0);
  });

  it("falls back to the next newest when fewer than six systems are stocked", () => {
    const shelf = selectHeroShelf(catalog(["dolce-gusto", "beans"], 4));

    // Systems still take turns, so the small catalog is spread as far as it goes.
    expect(shelf.map((item) => item.id)).toEqual([
      "dolce-gusto-1",
      "beans-1",
      "dolce-gusto-2",
      "beans-2",
      "dolce-gusto-3",
      "beans-3",
    ]);
  });

  it("shows what there is when the catalog cannot fill six wells", () => {
    const shelf = selectHeroShelf(catalog(["ese-pod", "nespresso-original"], 2));
    expect(shelf.map((item) => item.id)).toEqual([
      "nespresso-original-1",
      "ese-pod-1",
      "nespresso-original-2",
      "ese-pod-2",
    ]);
  });

  it("is empty below three photographed products: two wells are not a shelf", () => {
    expect(selectHeroShelf(catalog(["beans"], HERO_SHELF_MIN - 1))).toEqual([]);
    expect(selectHeroShelf([])).toEqual([]);
    expect(selectHeroShelf(catalog(["beans"], HERO_SHELF_MIN))).toHaveLength(HERO_SHELF_MIN);
  });

  it("never puts one product on the shelf twice", () => {
    // Filed under two systems, and the newest in both.
    const shared = [
      candidate("nespresso-original", 1, "shared"),
      candidate("dolce-gusto", 1, "shared"),
      candidate("dolce-gusto", 2),
      candidate("beans", 1),
    ];

    expect(selectHeroShelf(shared).map((item) => item.id)).toEqual([
      "shared",
      "dolce-gusto-2",
      "beans-1",
    ]);
  });
});
