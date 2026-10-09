import { describe, expect, it } from "vitest";
import {
  allocateProductSlug,
  discriminatedSlug,
  planProductSlugs,
  planSlugMoves,
  slugDiscriminator,
} from "../src/product-slug.ts";

describe("slugDiscriminator", () => {
  it("is a function of the source key alone", () => {
    expect(slugDiscriminator("/lavazza-crema-aroma-1/#1000g")).toBe(
      slugDiscriminator("/lavazza-crema-aroma-1/#1000g"),
    );
    expect(slugDiscriminator("/lavazza-crema-aroma-1/#1000g")).not.toBe(
      slugDiscriminator("/lavazza-crema-aroma-expert-1/#1000g"),
    );
  });

  it("is six slug-safe characters", () => {
    for (const key of ["", "/a/", "/кафе/#1000g", "/x/#16pc", "id:42"]) {
      expect(slugDiscriminator(key)).toMatch(/^[a-z0-9]{6}$/);
    }
  });
});

describe("allocateProductSlug", () => {
  it("gives a newcomer its base when nothing holds it", () => {
    expect(allocateProductSlug("lavazza-oro", "/a/", () => false)).toBe("lavazza-oro");
  });

  it("settles a collision from the newcomer's own key, not from a counter", () => {
    const taken = new Set(["lavazza-oro"]);
    const slug = allocateProductSlug("lavazza-oro", "/b/", (candidate) => taken.has(candidate));
    expect(slug).toBe(discriminatedSlug("lavazza-oro", "/b/"));
    expect(slug).not.toBe("lavazza-oro-2");
  });

  it("still returns something unique if the discriminated slug is taken too", () => {
    const taken = new Set(["x", discriminatedSlug("x", "/b/")]);
    expect(allocateProductSlug("x", "/b/", (candidate) => taken.has(candidate))).toBe(
      `${discriminatedSlug("x", "/b/")}-2`,
    );
  });
});

describe("planProductSlugs", () => {
  const a = { sourceKey: "/a/", base: "lavazza-oro" };
  const b = { sourceKey: "/b/", base: "lavazza-oro" };
  const c = { sourceKey: "/c/", base: "kimbo-capri" };

  it("gives a product alone on its base the base", () => {
    expect(planProductSlugs([a, c])).toEqual(
      new Map([
        ["/a/", "lavazza-oro"],
        ["/c/", "kimbo-capri"],
      ]),
    );
  });

  it("gives every product on a shared base a slug of its own, and nobody the bare base", () => {
    const plan = planProductSlugs([a, b, c]);
    expect(plan.get("/a/")).toBe(discriminatedSlug("lavazza-oro", "/a/"));
    expect(plan.get("/b/")).toBe(discriminatedSlug("lavazza-oro", "/b/"));
    expect(plan.get("/c/")).toBe("kimbo-capri");
  });

  it("does not depend on the order the products are given in", () => {
    expect(planProductSlugs([c, b, a])).toEqual(planProductSlugs([a, b, c]));
  });

  it("never hands out a reserved slug", () => {
    const plan = planProductSlugs([{ sourceKey: "/m/", base: "marki" }], new Set(["marki"]));
    expect(plan.get("/m/")).toBe(discriminatedSlug("marki", "/m/"));
  });

  it("leaves an address another product used to have to that product", () => {
    const plan = planProductSlugs([
      { sourceKey: "/a/", base: "lavazza-oro-nuovo", previousSlugs: ["kimbo-capri"] },
      c,
    ]);
    expect(plan.get("/c/")).toBe(discriminatedSlug("kimbo-capri", "/c/"));
  });

  it("leaves an address another product is at now, even one it is about to leave", () => {
    // `/a/` sits on the slug `/c/` would be planned into, and is itself moving.
    const products = [{ sourceKey: "/a/", base: "lavazza-oro", slug: "kimbo-capri" }, c];
    const plan = planProductSlugs(products);
    expect(plan.get("/a/")).toBe("lavazza-oro");
    expect(plan.get("/c/")).toBe(discriminatedSlug("kimbo-capri", "/c/"));
    // And the same once it has left, so the second run changes nothing.
    expect(
      planProductSlugs([
        {
          sourceKey: "/a/",
          base: "lavazza-oro",
          slug: "lavazza-oro",
          previousSlugs: ["kimbo-capri"],
        },
        { ...c, slug: plan.get("/c/") },
      ]),
    ).toEqual(plan);
  });

  it("lets a product return to an address only it has had", () => {
    expect(planProductSlugs([{ ...a, previousSlugs: ["lavazza-oro"] }]).get("/a/")).toBe(
      "lavazza-oro",
    );
  });

  it("refuses two rows with one source key", () => {
    expect(() => planProductSlugs([a, { ...a }])).toThrow(/share the source key/);
  });
});

describe("planSlugMoves", () => {
  it("lists only the products that are not where the plan puts them, by source key", () => {
    const moves = planSlugMoves([
      { sourceKey: "/z/", base: "z-new", slug: "z-old" },
      { sourceKey: "/a/", base: "a-new", slug: "a-old" },
      { sourceKey: "/k/", base: "k", slug: "k" },
    ]);
    expect(moves).toEqual([
      { sourceKey: "/a/", from: "a-old", to: "a-new" },
      { sourceKey: "/z/", from: "z-old", to: "z-new" },
    ]);
  });

  it("is empty once the catalog matches the plan", () => {
    expect(
      planSlugMoves([{ sourceKey: "/a/", base: "a", slug: "a", previousSlugs: ["a-old"] }]),
    ).toEqual([]);
  });
});
