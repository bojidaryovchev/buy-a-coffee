import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { factRows } from "@/components/catalog/facts-table";
import { systemListingHref } from "@/lib/catalog/product-facts";
import type * as Queries from "@/lib/catalog/queries";
import type { ProductCardView, ProductDetailView } from "@/lib/catalog/types";
import { BREWING_SYSTEMS } from "@/lib/recommend/systems";
import { categoryHref } from "@/lib/routes";

/**
 * The product-detail queries against a database holding the real catalog.
 *
 * Read-only. Skipped, not failed, when no database is reachable or the catalog
 * is empty: a clean checkout has neither, and a fixture database of a handful
 * of rows proves nothing about seven brewing systems.
 */

let queries: typeof Queries | null = null;
let close: (() => Promise<void>) | null = null;
/** One product per brewing system, where the catalog has one. */
const samples = new Map<string, ProductDetailView>();

beforeAll(async () => {
  if (!process.env.DATABASE_URL) return;
  try {
    const loaded = await import("@/lib/catalog/queries");
    const slugs = await loaded.listAllProductSlugs();
    if (slugs.length < 50) return;

    for (const { slug } of slugs) {
      if (samples.size === BREWING_SYSTEMS.length) break;
      const product = await loaded.getProductBySlug(slug);
      if (product?.systemId && !samples.has(product.systemId)) {
        samples.set(product.systemId, product);
      }
    }
    queries = loaded;
    // The pool is cached on `globalThis` by `lib/db`; closing it lets the run exit.
    close = globalThis.__catalogDb?.close ?? null;
  } catch {
    queries = null;
  }
}, 60_000);

afterAll(async () => {
  await close?.();
});

describe("getProductBySlug", () => {
  it("carries the enriched facts as null or as usable values, never as blanks", ({ skip }) => {
    if (!queries || samples.size === 0) skip();

    for (const product of samples.values()) {
      if (product.arabicaPercent !== null) {
        expect(Number.isInteger(product.arabicaPercent)).toBe(true);
        expect(product.arabicaPercent).toBeGreaterThanOrEqual(0);
        expect(product.arabicaPercent).toBeLessThanOrEqual(100);
      }
      for (const value of [product.origin, product.roast, product.sku]) {
        if (value !== null) expect(value.trim()).toBe(value);
        expect(value).not.toBe("");
      }
      // Whatever is null, the table still renders, and every row has a label.
      const rows = factRows(product, "bg");
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]?.label).toBe("Система");
    }
  });

  it("resolves the system badge's link from the product's own categories", ({ skip }) => {
    if (!queries || samples.size === 0) skip();

    for (const product of samples.values()) {
      const href = systemListingHref("bg", product.systemId, product.categories);
      expect(href, product.slug).not.toBeNull();
      expect(product.categories.map((category) => categoryHref("bg", category))).toContain(href);
    }
  });
});

describe("getRelatedProducts", () => {
  it("never offers a product from another brewing system", async ({ skip }) => {
    if (!queries || samples.size === 0) skip();

    for (const product of samples.values()) {
      const related: readonly ProductCardView[] = await queries!.getRelatedProducts(product, 4);
      expect(related.length).toBeLessThanOrEqual(4);
      for (const card of related) {
        expect(card.systemId, `${product.slug} → ${card.slug}`).toBe(product.systemId);
        expect(card.id).not.toBe(product.id);
      }
    }
  });
});
