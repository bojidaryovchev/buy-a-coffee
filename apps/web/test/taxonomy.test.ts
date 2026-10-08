import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { categoryCopy, categoryCopyFor } from "../content/category-copy";
import { BREWING_SYSTEMS } from "@/lib/recommend/systems";

interface ReferenceCategory {
  readonly name: string;
  readonly sourceKey: string;
  readonly rawSlug: string;
}

const referenceCategories = (
  JSON.parse(
    readFileSync(
      path.resolve(import.meta.dirname, "../../../reference/latest/categories.json"),
      "utf8",
    ),
  ) as { categories: ReferenceCategory[] }
).categories;

/* --- Brewing systems against the snapshot -------------------------------- */

describe("brewing systems resolve to real categories", () => {
  const sourceKeys = new Set(referenceCategories.map((category) => category.sourceKey));
  const rawSlugs = new Set(referenceCategories.map((category) => category.rawSlug));

  it("reads a snapshot that actually has categories", () => {
    expect(referenceCategories.length).toBeGreaterThan(0);
  });

  /*
   * The wizard counts a system's products through these keys. If the source
   * renames a category, the count silently becomes zero and the system drops
   * out of the wizard without an error anywhere. This is where it fails loudly
   * instead — when the snapshot is refreshed, before the storefront notices.
   */
  it.each(BREWING_SYSTEMS.map((system) => [system.id, system] as const))(
    "%s matches at least one category in the snapshot",
    (_id, system) => {
      const matched =
        system.categorySourceKeys.some((key) => sourceKeys.has(key)) ||
        system.categorySlugs.some((slug) => rawSlugs.has(slug));
      expect(matched, `no reference category for ${system.id}`).toBe(true);
    },
  );

  it("matches by source key specifically, the identity that survives a rename", () => {
    for (const system of BREWING_SYSTEMS) {
      expect(
        system.categorySourceKeys.some((key) => sourceKeys.has(key)),
        `${system.id} is only reachable by slug`,
      ).toBe(true);
    }
  });

  it("claims each category for one system only", () => {
    const owners = new Map<string, string>();
    for (const system of BREWING_SYSTEMS) {
      for (const key of system.categorySourceKeys) {
        expect(owners.get(key), `${key} is claimed twice`).toBeUndefined();
        owners.set(key, system.id);
      }
    }
  });
});

/* --- Category introductions ---------------------------------------------- */

const CATEGORY_KEYS = [
  "kafe-na-zyrna",
  "kafe-kapsuli",
  "nespresso",
  "dolce-gusto",
  "lavazza-blue",
  "caffitaly",
  "a-modo-mio",
  "kafe-dozi",
];

describe("category introductions", () => {
  it("has exactly the eight categories", () => {
    expect(Object.keys(categoryCopy).sort()).toEqual([...CATEGORY_KEYS].sort());
  });

  it("covers every category in the reference snapshot", () => {
    for (const category of referenceCategories) {
      expect(
        categoryCopyFor({ slug: category.rawSlug, sourceKey: category.sourceKey }),
        `no introduction for ${category.sourceKey}`,
      ).not.toBeNull();
    }
  });

  it("is two or three short paragraphs under a heading", () => {
    for (const [key, copy] of Object.entries(categoryCopy)) {
      expect(copy.heading.trim().length, key).toBeGreaterThan(0);
      expect(copy.paragraphs.length, key).toBeGreaterThanOrEqual(2);
      expect(copy.paragraphs.length, key).toBeLessThanOrEqual(3);
      for (const paragraph of copy.paragraphs) {
        expect(paragraph, key).toBe(paragraph.trim());
        expect(paragraph.length, key).toBeLessThan(450);
      }
    }
  });

  it("carries nothing that goes stale: no prices, no counts of products", () => {
    const stale = /€|лв\.|EUR|BGN|\d+\s*(продукт|вида|разновидност|марки)/iu;
    for (const [key, copy] of Object.entries(categoryCopy)) {
      for (const paragraph of copy.paragraphs) expect(paragraph, key).not.toMatch(stale);
    }
  });

  it("points an unsure visitor at the wizard and the machine list", () => {
    for (const [key, copy] of Object.entries(categoryCopy)) {
      expect(copy.paragraphs.at(-1), key).toMatch(/помощник|списъка с машини/iu);
    }
  });

  it("writes each one separately rather than repeating a paragraph", () => {
    const all = Object.values(categoryCopy).flatMap((copy) => copy.paragraphs);
    expect(new Set(all).size).toBe(all.length);
  });

  it("finds an entry by source key, by slug, and through an alias", () => {
    expect(categoryCopyFor({ slug: "anything", sourceKey: "nespresso" })).toBe(
      categoryCopy["nespresso"],
    );
    expect(categoryCopyFor({ slug: "kafe-na-zarna", sourceKey: null })).toBe(
      categoryCopy["kafe-na-zyrna"],
    );
    expect(categoryCopyFor({ slug: "kapsuli", sourceKey: "kapsuli" })).toBe(
      categoryCopy["kafe-kapsuli"],
    );
  });

  it("returns null for a category nobody has written about", () => {
    expect(categoryCopyFor({ slug: "chay", sourceKey: "chay" })).toBeNull();
    expect(categoryCopyFor({ slug: "constructor", sourceKey: "toString" })).toBeNull();
  });
});
