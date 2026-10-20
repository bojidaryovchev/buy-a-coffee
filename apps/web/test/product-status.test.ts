import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cartBlock } from "@/lib/cart/view";
import { SITEMAP_PRODUCT_STATUSES, isIndexable, isOrderable } from "@/lib/catalog/product-status";
import { offerAvailability } from "@/lib/seo/json-ld";

/*
 * One failed fetch marks a product `missing`; three in a row mark it
 * `removed`. Only the second is a product we no longer sell, so only the
 * second leaves the index. Neither can be ordered: a missing product's price
 * is the last one the sync saw.
 */

describe("a product's status", () => {
  it("keeps a missing product indexable and in the sitemap, and only that", () => {
    expect(isIndexable("active")).toBe(true);
    expect(isIndexable("missing")).toBe(true);
    expect(isIndexable("removed")).toBe(false);
    expect([...SITEMAP_PRODUCT_STATUSES].sort()).toEqual(["active", "missing"]);
  });

  it("lets only an active product be ordered, in the page and in the cart", () => {
    expect(isOrderable("active")).toBe(true);
    expect(isOrderable("missing")).toBe(false);
    expect(isOrderable("removed")).toBe(false);
    expect(cartBlock("missing", "in_stock")).toBe("unavailable");
    expect(cartBlock("removed", "in_stock")).toBe("unavailable");
  });

  it("never says InStock behind a page that is not on sale", () => {
    expect(offerAvailability({ status: "missing", availability: "in_stock" })).toBe(
      "https://schema.org/OutOfStock",
    );
    expect(offerAvailability({ status: "removed", availability: "in_stock" })).toBe(
      "https://schema.org/Discontinued",
    );
  });

  /* The page is a server component over the database; what it decides is
     read from its source, so the two cannot be wired the old way round. */
  it("is what the product page decides its robots and its order panel by", () => {
    const page = readFileSync(
      path.resolve(
        import.meta.dirname,
        "../src/app/(site)/[lang]/[slug]/_components/product-page.tsx",
      ),
      "utf8",
    );
    expect(page).toContain("robots: robotsFor(isIndexable(product.status))");
    expect(page).toContain("const unavailable = !isOrderable(product.status);");
    expect(page).toContain("Временно недостъпен");
    expect(page).not.toMatch(/robotsFor\(product\.status === "active"\)/);
  });
});
