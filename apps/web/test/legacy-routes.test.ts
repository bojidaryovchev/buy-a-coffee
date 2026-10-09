import { describe, expect, it } from "vitest";
import { getArticle, getMovedArticle, listArticles, listPreviousSlugs } from "@/lib/journal";
import { legacyAnswer } from "@/lib/legacy-routes";

/*
 * Every URL the shop served before it had locales, and where it lives now.
 * The query string is the proxy's to carry (see `proxy.test.ts`); this is the
 * path half.
 */

const to = (pathname: string) => ({ type: "redirect", pathname });

describe("the pre-locale URLs", () => {
  it.each([
    ["/products/dozeti-illy-classico-18br", "/bg/dozeti-illy-classico-18br"],
    ["/categories", "/bg/kategorii"],
    ["/brands", "/bg/marki"],
    ["/brands/lavazza", "/bg/marki/lavazza"],
    ["/search", "/bg/tarsene"],
    ["/promotions", "/bg/promotsii"],
    ["/vending", "/bg/kafe-za-vending-mashini"],
    ["/consumables", "/bg/konsumativi"],
    ["/delivery", "/bg/dostavka-i-plashtane"],
    ["/contact", "/bg/kontakti"],
    ["/privacy", "/bg/poveritelnost"],
    ["/terms", "/bg/obshti-usloviya"],
    ["/cookies", "/bg/biskvitki"],
    ["/journal", "/bg/blog"],
    ["/journal/koya-kapsula-za-koya-kafemashina", "/bg/blog/koya-kapsula-za-koya-kafemashina"],
    ["/wizard", "/bg/izbor-na-kafe"],
    ["/wizard/result", "/bg/izbor-na-kafe/rezultat"],
    ["/wizard/machines", "/bg/za-kafemashina"],
    ["/wizard/machines/krups", "/bg/za-kafemashina/krups"],
    ["/newsletter/unsubscribe", "/bg/byuletin/otpisvane"],
  ])("%s → %s", (from, target) => {
    expect(legacyAnswer(from)).toEqual(to(target));
  });

  /*
   * The slugs come from the journal itself, not from this file: an article
   * retitled tomorrow is covered the day its old slug is listed.
   */
  it("sends an article's old slug straight to where the article is now, in one hop", () => {
    const moved = listPreviousSlugs();
    // The journal has retitled articles; without one this would test nothing.
    expect(moved.length).toBeGreaterThan(0);
    for (const former of moved) {
      const current = getMovedArticle(former)?.slug;
      expect(current, former).toBeTruthy();
      expect(current).not.toBe(former);
      expect(legacyAnswer(`/journal/${former}`), former).toEqual(to(`/bg/blog/${current}`));
      // The target is an article, not another redirect.
      expect(getArticle(current)).not.toBeNull();
      expect(getMovedArticle(current)).toBeNull();
    }
  });

  it("sends an article's current slug to itself", () => {
    for (const { slug } of listArticles()) {
      expect(legacyAnswer(`/journal/${slug}`), slug).toEqual(to(`/bg/blog/${slug}`));
    }
  });

  it("passes on a journal slug it has never heard of, for the article route to refuse", () => {
    expect(legacyAnswer("/journal/no-such-article")).toEqual(to("/bg/blog/no-such-article"));
    expect(legacyAnswer("/journal/toString")).toEqual(to("/bg/blog/toString"));
  });

  it("hands an old category URL to the route handler, which knows the catalog", () => {
    expect(legacyAnswer("/categories/kapsuli")).toEqual({ type: "category", slug: "kapsuli" });
    expect(legacyAnswer("/categories/nespresso")).toEqual({ type: "category", slug: "nespresso" });
  });

  it("leaves anything the shop never served to the 404", () => {
    for (const path of [
      "/",
      "/products",
      "/products/a/b",
      "/categories/a/b",
      "/brands/a/b",
      "/wizard/other",
      "/wizard/machines/krups/piccolo",
      "/newsletter",
      "/search/more",
      "/bg/marki",
      "/admin",
      "/toString",
    ]) {
      expect(legacyAnswer(path), path).toBeNull();
    }
  });
});
