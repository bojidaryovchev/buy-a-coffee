import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LOCALES } from "@/i18n/config";
import { ROUTE_SEGMENTS, SLUGS } from "@/i18n/slugs";
import {
  RESERVED_SLUGS,
  assertSlugTables,
  canonicalSegments,
  categoryHref,
  categorySlug,
  href,
  isReservedSlug,
  productHref,
  productSlug,
  resolveLocalisedPath,
  routes,
  storedProductSlug,
  switchLocalePath,
  targetHref,
} from "@/lib/routes";

/*
 * The route table and the link helper: every URL the storefront writes, and
 * the reverse mapping the proxy reads. Pure, so every rule is a plain
 * assertion.
 */

const LANG_ROOT = path.resolve(import.meta.dirname, "../src/app/(site)/[lang]");

/** Static route folders under `[lang]`, by canonical path: `marki`, `izbor-na-kafe/rezultat`. */
function staticFolders(directory: string, parents: readonly string[] = []): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !/^[[_(]/.test(entry.name))
    .flatMap((entry) => {
      const key = [...parents, entry.name].join("/");
      return [key, ...staticFolders(path.join(directory, entry.name), [...parents, entry.name])];
    });
}

describe("the route table", () => {
  it("names every static folder under [lang], and nothing else", () => {
    // Canonical segments ARE the folder names, so the two lists must agree.
    expect([...ROUTE_SEGMENTS].sort()).toEqual(staticFolders(LANG_ROOT).sort());
  });

  it("is made of canonical paths that exist as folders", () => {
    const folders = new Set(staticFolders(LANG_ROOT));
    for (const value of Object.values(routes)) {
      const path = typeof value === "function" ? value("x") : value;
      const segments = path.split("/").filter(Boolean);
      const statics = segments.filter((_, index) =>
        folders.has(segments.slice(0, index + 1).join("/")),
      );
      // Everything but a trailing slug is a folder.
      expect(statics.length, path).toBeGreaterThanOrEqual(Math.max(0, segments.length - 1));
    }
  });

  it("keeps its slug tables sound", () => {
    expect(() => assertSlugTables()).not.toThrow();
  });

  it("gives every locale the same category keys", () => {
    const keys = Object.keys(SLUGS.bg.categories).sort();
    for (const locale of LOCALES)
      expect(Object.keys(SLUGS[locale].categories).sort()).toEqual(keys);
  });
});

describe("href", () => {
  it("prefixes every locale, Bulgarian included", () => {
    expect(href("bg", routes.home)).toBe("/bg");
    expect(href("en", routes.home)).toBe("/en");
    expect(href("bg", routes.brands)).toBe("/bg/marki");
  });

  it("publishes the Bulgarian plan from the market study", () => {
    expect(href("bg", routes.vending)).toBe("/bg/kafe-za-vending-mashini");
    expect(href("bg", routes.consumables)).toBe("/bg/konsumativi");
    expect(href("bg", routes.journal)).toBe("/bg/blog");
    expect(href("bg", routes.article("koya-kapsula"))).toBe("/bg/blog/koya-kapsula");
    expect(href("bg", routes.wizard)).toBe("/bg/izbor-na-kafe");
    expect(href("bg", routes.wizardResult)).toBe("/bg/izbor-na-kafe/rezultat");
    expect(href("bg", routes.machines)).toBe("/bg/za-kafemashina");
    expect(href("bg", routes.machineBrand("krups"))).toBe("/bg/za-kafemashina/krups");
    expect(href("bg", routes.search)).toBe("/bg/tarsene");
    expect(href("bg", routes.promotions)).toBe("/bg/promotsii");
    expect(href("bg", routes.delivery)).toBe("/bg/dostavka-i-plashtane");
    expect(href("bg", routes.contact)).toBe("/bg/kontakti");
    expect(href("bg", routes.privacy)).toBe("/bg/poveritelnost");
    expect(href("bg", routes.terms)).toBe("/bg/obshti-usloviya");
    expect(href("bg", routes.cookies)).toBe("/bg/biskvitki");
    expect(href("bg", routes.unsubscribe)).toBe("/bg/byuletin/otpisvane");
    expect(href("bg", routes.categories)).toBe("/bg/kategorii");
  });

  it("translates every static segment for English, and no slug", () => {
    expect(href("en", routes.brand("lavazza"))).toBe("/en/brands/lavazza");
    expect(href("en", routes.wizardResult)).toBe("/en/which-coffee/result");
    expect(href("en", routes.unsubscribe)).toBe("/en/newsletter/unsubscribe");
    expect(href("en", routes.machineBrand("krups"))).toBe("/en/by-machine/krups");
    // A brand called "rezultat" is a brand, not the wizard's result page.
    expect(href("en", routes.brand("rezultat"))).toBe("/en/brands/rezultat");
  });

  it("keeps a query string and a fragment as they are", () => {
    expect(href("bg", `${routes.search}?q=лаваца`)).toBe("/bg/tarsene?q=лаваца");
    expect(href("bg", "/some-product#order")).toBe("/bg/some-product#order");
  });
});

describe("the reverse mapping the proxy reads", () => {
  it("leaves every Bulgarian URL alone today", () => {
    for (const key of ROUTE_SEGMENTS) {
      expect(resolveLocalisedPath("bg", `/bg/${key}`)).toEqual({ type: "next" });
    }
    expect(resolveLocalisedPath("bg", "/bg")).toEqual({ type: "next" });
    expect(resolveLocalisedPath("bg", "/bg/some-product")).toEqual({ type: "next" });
  });

  it("rewrites a translated URL to its folder", () => {
    expect(resolveLocalisedPath("en", "/en/brands/lavazza")).toEqual({
      type: "rewrite",
      pathname: "/en/marki/lavazza",
    });
    expect(resolveLocalisedPath("en", "/en/which-coffee/result")).toEqual({
      type: "rewrite",
      pathname: "/en/izbor-na-kafe/rezultat",
    });
  });

  it("redirects a spelling the locale does not publish, mixed ones included", () => {
    expect(resolveLocalisedPath("en", "/en/marki/lavazza")).toEqual({
      type: "redirect",
      pathname: "/en/brands/lavazza",
    });
    expect(resolveLocalisedPath("en", "/en/izbor-na-kafe/result")).toEqual({
      type: "redirect",
      pathname: "/en/which-coffee/result",
    });
  });

  it("never invents a rewrite for a segment it does not know", () => {
    expect(resolveLocalisedPath("en", "/en/whatever")).toEqual({ type: "next" });
    expect(canonicalSegments("en", ["brands", "result"])).toEqual(["marki", "result"]);
  });

  it("round-trips every route in every locale", () => {
    for (const locale of LOCALES) {
      for (const key of ROUTE_SEGMENTS) {
        const published = href(locale, `/${key}`);
        const segments = published.split("/").filter(Boolean).slice(1);
        expect(canonicalSegments(locale, segments).join("/")).toBe(key);
      }
    }
  });
});

describe("categories", () => {
  const capsules = { slug: "kapsuli", sourceKey: "kafe-kapsuli", previousSourceKeys: [] };

  it("publishes a curated landing slug by source key", () => {
    expect(categorySlug("bg", capsules)).toBe("kafe-kapsuli");
    expect(categoryHref("bg", capsules)).toBe("/bg/kafe-kapsuli");
    expect(categoryHref("bg", { slug: "nespresso", sourceKey: "nespresso" })).toBe(
      "/bg/nespresso-kapsuli",
    );
    expect(categoryHref("en", capsules)).toBe("/en/coffee-capsules");
  });

  it("keeps the landing slug through a source rename", () => {
    expect(
      categorySlug("bg", {
        slug: "kapsuli",
        sourceKey: "kapsuli-za-kafe-2027",
        previousSourceKeys: ["kafe-kapsuli"],
      }),
    ).toBe("kafe-kapsuli");
  });

  it("falls back to the stored slug for a category the table does not know", () => {
    expect(categorySlug("bg", { slug: "aksesoari", sourceKey: "aksesoari" })).toBe("aksesoari");
    expect(categorySlug("bg", { slug: "aksesoari", sourceKey: null })).toBe("aksesoari");
  });

  it("refuses a stored slug that would collide with a route", () => {
    expect(categorySlug("bg", { slug: "marki", sourceKey: "marki" })).toBe("marki-kategoriya");
    expect(categorySlug("en", { slug: "marki", sourceKey: "marki" })).toBe("marki-category");
    expect(categorySlug("bg", { slug: "brands", sourceKey: null })).toBe("brands-kategoriya");
    expect(categorySlug("bg", { slug: "en", sourceKey: null })).toBe("en-kategoriya");
  });

  it("reserves every first-level route in every locale's spelling", () => {
    for (const slug of ["marki", "brands", "tarsene", "search", "blog", "journal", "byuletin"]) {
      expect(RESERVED_SLUGS.has(slug), slug).toBe(true);
    }
    expect(isReservedSlug("bg")).toBe(true);
    expect(isReservedSlug("kafe-kapsuli")).toBe(false);
  });
});

describe("products", () => {
  it("keep their stored slug, at the first level, in every locale for now", () => {
    expect(productSlug("bg", { slug: "dozeti-illy-classico-18br" })).toBe(
      "dozeti-illy-classico-18br",
    );
    expect(productHref("bg", { slug: "dozeti-illy-classico-18br" })).toBe(
      "/bg/dozeti-illy-classico-18br",
    );
    expect(productHref("bg", { slug: "x" }, "#order")).toBe("/bg/x#order");
    expect(storedProductSlug("en", productSlug("en", { slug: "x" }))).toBe("x");
  });
});

describe("route targets", () => {
  it("resolve in the page's locale", () => {
    expect(targetHref("bg", routes.wizard)).toBe("/bg/izbor-na-kafe");
    expect(targetHref("bg", { product: "alfa" })).toBe("/bg/alfa");
    expect(
      targetHref("bg", { category: { slug: "kafe-na-zarna", sourceKey: "kafe-na-zyrna" } }),
    ).toBe("/bg/kafe-na-zarna");
    expect(
      targetHref("en", { category: { slug: "kafe-na-zarna", sourceKey: "kafe-na-zyrna" } }),
    ).toBe("/en/coffee-beans");
  });
});

describe("switching language", () => {
  it("lands on the same page in the other locale", () => {
    expect(switchLocalePath("/bg", "bg", "en")).toBe("/en");
    expect(switchLocalePath("/bg/marki/lavazza", "bg", "en")).toBe("/en/brands/lavazza");
    expect(switchLocalePath("/en/brands/lavazza", "en", "bg")).toBe("/bg/marki/lavazza");
    expect(switchLocalePath("/bg/izbor-na-kafe/rezultat", "bg", "en")).toBe(
      "/en/which-coffee/result",
    );
  });

  it("translates a curated category slug through its source key", () => {
    expect(switchLocalePath("/bg/kafe-kapsuli", "bg", "en")).toBe("/en/coffee-capsules");
    expect(switchLocalePath("/en/nespresso-capsules", "en", "bg")).toBe("/bg/nespresso-kapsuli");
  });

  it("carries any other slug as it is, for the page to settle", () => {
    expect(switchLocalePath("/bg/some-product", "bg", "en")).toBe("/en/some-product");
  });
});
