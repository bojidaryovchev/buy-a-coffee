import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCatalogQuery } from "@/lib/catalog/filters";
import {
  isPastLastPage,
  isPastLastPageOf,
  listingPage,
  pageQuery,
  pagedTitle,
} from "@/lib/seo/pagination";

/*
 * A listing's later pages (`lib/seo/pagination.ts`): page two of the clean
 * listing names itself; any filtered, sorted or resized view names page one.
 */

describe("listingPage", () => {
  it("is the page of the clean listing", () => {
    expect(listingPage(parseCatalogQuery({}))).toBe(1);
    expect(listingPage(parseCatalogQuery({ page: "2" }))).toBe(2);
    expect(listingPage(parseCatalogQuery({ page: "7" }))).toBe(7);
  });

  it("is page one for any other arrangement, whatever page it is on", () => {
    for (const raw of [
      { page: "2", sort: "price-asc" },
      { page: "2", brand: "lavazza" },
      { page: "2", pageSize: "48" },
      { page: "2", q: "лаваца" },
    ]) {
      expect(listingPage(parseCatalogQuery(raw)), JSON.stringify(raw)).toBe(1);
    }
  });
});

describe("a later page's address and title", () => {
  it("adds the page to the address and to the title, and nothing for page one", () => {
    expect(pageQuery(1)).toBe("");
    expect(pageQuery(3)).toBe("?page=3");
    expect(pagedTitle("Кафе капсули", 1)).toBe("Кафе капсули");
    expect(pagedTitle("Кафе капсули", 2)).toBe("Кафе капсули — страница 2");
  });
});

/* An indexable listing must not multiply into empty pages: `?page=99` of a
   two-page listing was a 200, and once clean later pages are indexable it
   would have been an indexable empty page. The pages call `notFound()`. */
describe("a page past the last", () => {
  it("is past the last only beyond the listing's own page count", () => {
    expect(isPastLastPage({ page: 1, pageCount: 1 })).toBe(false);
    expect(isPastLastPage({ page: 2, pageCount: 2 })).toBe(false);
    expect(isPastLastPage({ page: 3, pageCount: 2 })).toBe(true);
    expect(isPastLastPage({ page: 99, pageCount: 2 })).toBe(true);
  });

  it("is never page one, even of an empty listing", () => {
    // `listProducts` counts at least one page.
    expect(isPastLastPage({ page: 1, pageCount: 1 })).toBe(false);
  });

  /* Found on the Milestone 1 preview: a vending page whose section has no
     listing of its own answered `?page=99` with an indexable copy of page one. */
  it("is every later page of a section that has no listing of its own", () => {
    expect(isPastLastPageOf(1, null)).toBe(false);
    expect(isPastLastPageOf(2, null)).toBe(true);
    expect(isPastLastPageOf(99, undefined)).toBe(true);
    expect(isPastLastPageOf(2, { page: 2, pageCount: 2 })).toBe(false);
    expect(isPastLastPageOf(3, { page: 3, pageCount: 2 })).toBe(true);
  });

  it("is what every paginated listing checks before it renders", () => {
    const root = path.resolve(import.meta.dirname, "../src/app/(site)/[lang]");
    for (const file of [
      "[slug]/_components/category-page.tsx",
      "marki/[slug]/page.tsx",
      "promotsii/page.tsx",
      "kafe-za-vending-mashini/page.tsx",
      "konsumativi/page.tsx",
      "tarsene/page.tsx",
    ]) {
      const source = readFileSync(path.join(root, file), "utf8");
      expect(source, file).toMatch(
        /if \((?:\w+ && )?isPastLastPage(?:Of\(query\.page, )?\(?[\w.?]+\)\) notFound\(\);/,
      );
    }
  });
});
