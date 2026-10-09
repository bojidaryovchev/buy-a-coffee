import { describe, expect, it } from "vitest";
import {
  CATEGORY_LANDING_SLUGS,
  RESERVED_PRODUCT_SLUGS,
  RESERVED_ROUTE_SLUGS,
} from "../src/storefront-data.ts";

/**
 * The reserved set is read from the storefront's slug tables, so these are
 * spot checks that the reading works, not a second list to keep in step.
 * `apps/web/test/product-identity.test.ts` checks that it equals the web app's own.
 */
describe("reserved first-level slugs", () => {
  it("holds every route in both languages, and the locale codes", () => {
    for (const slug of ["marki", "brands", "tarsene", "search", "blog", "journal", "bg", "en"]) {
      expect(RESERVED_ROUTE_SLUGS.has(slug), slug).toBe(true);
    }
  });

  it("leaves nested segments alone: they are not first-level addresses", () => {
    expect(RESERVED_ROUTE_SLUGS.has("rezultat")).toBe(false);
    expect(RESERVED_ROUTE_SLUGS.has("otpisvane")).toBe(false);
  });

  it("adds every category's landing slug for a product", () => {
    for (const slug of ["kafe-kapsuli", "nespresso-kapsuli", "kafe-na-zarna", "coffee-beans"]) {
      expect(CATEGORY_LANDING_SLUGS.has(slug), slug).toBe(true);
      expect(RESERVED_PRODUCT_SLUGS.has(slug), slug).toBe(true);
    }
    expect(RESERVED_PRODUCT_SLUGS.has("marki")).toBe(true);
  });
});
