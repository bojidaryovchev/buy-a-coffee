import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCALES } from "@/i18n/config";
import type * as Queries from "@/lib/catalog/queries";
import type { CategoryView } from "@/lib/catalog/types";
import { RESERVED_SLUGS, categorySlug, productSlug } from "@/lib/routes";

/**
 * Categories and products share the first level under the locale —
 * `/bg/kafe-kapsuli`, `/bg/<product>` — beside the static routes (`marki`,
 * `tarsene`, …). Against the real catalog:
 *
 *   - no category or product slug is a static route in any locale's spelling,
 *     where it would be unreachable behind the static folder;
 *   - no product takes a slug a category is published at, or its stored slug,
 *     where `[slug]` would show the category and the product would be lost.
 *
 * A category that would collide is published at `<slug>-kategoriya` by
 * `categorySlug` itself. A product slug is allocated by the sync, which is the
 * place that must refuse one; until it does, this is the check that it has
 * not had to.
 *
 * Read-only. Skipped, not failed, when no database is reachable or the catalog
 * is empty.
 */

let queries: typeof Queries | null = null;
let close: (() => Promise<void>) | null = null;
let categories: CategoryView[] = [];
let productSlugs: string[] = [];

const flatten = (nodes: readonly CategoryView[]): CategoryView[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

beforeAll(async () => {
  if (!process.env.DATABASE_URL) return;
  try {
    const loaded = await import("@/lib/catalog/queries");
    productSlugs = (await loaded.listAllProductSlugs()).map((row) => row.slug);
    if (productSlugs.length === 0) return;
    categories = flatten(await loaded.getCategoryTree());
    queries = loaded;
    close = globalThis.__catalogDb?.close ?? null;
  } catch {
    queries = null;
  }
}, 60_000);

afterAll(async () => {
  await close?.();
});

describe("first-level slugs in the catalog", () => {
  it("never take a static route's name", ({ skip }) => {
    if (!queries) skip();
    for (const locale of LOCALES) {
      for (const category of categories) {
        expect(RESERVED_SLUGS.has(categorySlug(locale, category)), category.slug).toBe(false);
      }
      for (const slug of productSlugs) {
        expect(RESERVED_SLUGS.has(productSlug(locale, { slug })), slug).toBe(false);
      }
    }
  });

  it("never let a product share a category's address", ({ skip }) => {
    if (!queries) skip();
    const taken = new Set(
      categories.flatMap((category) => [
        category.slug,
        ...LOCALES.map((locale) => categorySlug(locale, category)),
      ]),
    );
    for (const locale of LOCALES) {
      for (const slug of productSlugs) {
        expect(taken.has(productSlug(locale, { slug })), slug).toBe(false);
      }
    }
  });

  it("give every category one address per locale", ({ skip }) => {
    if (!queries) skip();
    for (const locale of LOCALES) {
      const published = categories.map((category) => categorySlug(locale, category));
      expect(new Set(published).size).toBe(published.length);
    }
  });

  it("publish the curated landing slugs for the catalog's own categories", ({ skip }) => {
    if (!queries) skip();
    const bySource = new Map(categories.map((category) => [category.sourceKey, category]));
    const capsules = bySource.get("kafe-kapsuli");
    if (capsules) expect(categorySlug("bg", capsules)).toBe("kafe-kapsuli");
    const nespresso = bySource.get("nespresso");
    if (nespresso) expect(categorySlug("bg", nespresso)).toBe("nespresso-kapsuli");
  });
});
