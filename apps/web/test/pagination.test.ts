import { describe, expect, it } from "vitest";
import { parseCatalogQuery } from "@/lib/catalog/filters";
import { listingPage, pageQuery, pagedTitle } from "@/lib/seo/pagination";

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
