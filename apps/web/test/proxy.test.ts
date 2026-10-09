import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The proxy, called the way Next calls it: a request in, a response out. What
 * it must do is narrow — resolve the bare `/`, send the old URLs home, serve
 * a translated URL from its folder, send a dead catalog link to the 404 Next
 * renders on the server — and what it must never do is as important: move a
 * visitor off the locale in their URL, set a cookie, or touch the admin, the
 * API, the files.
 *
 * The catalog lookup is replaced: what the proxy does with its answer is the
 * subject here, and the lookup itself reads a database.
 */

const catalog = vi.hoisted(() => ({
  slugs: new Set<string>(),
  /** What the lookup answers; `null` is "could not be asked". */
  broken: false,
  asked: [] as string[],
}));

vi.mock("@/lib/catalog/slug-exists", () => ({
  slugExists: async (kind: string, slug: string) => {
    catalog.asked.push(`${kind}:${slug}`);
    return catalog.broken ? null : catalog.slugs.has(`${kind}:${slug}`);
  },
}));

import { catalogLookup, config, isUntouched, proxy } from "@/proxy";

beforeEach(() => {
  catalog.slugs = new Set([
    "first-level:kafe-kapsuli",
    "first-level:kapsuli",
    "first-level:dozeti-illy-classico-18br",
    "brand:lavazza",
    "landing:lavazza-kapsuli",
  ]);
  catalog.broken = false;
  catalog.asked = [];
});

const request = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(new URL(path, "https://buy-a-coffee.com"), { headers });

const location = (response: Response) => {
  const value = response.headers.get("location");
  return value ? new URL(value).pathname + new URL(value).search : null;
};

/** `NextResponse.next()` carries this header; a rewrite or redirect does not. */
const passesThrough = (response: Response) => response.headers.get("x-middleware-next") === "1";

/** A rewrite names its target in this header; the address bar keeps the request's. */
const rewrittenTo = (response: Response) => {
  const value = response.headers.get("x-middleware-rewrite");
  return value ? new URL(value).pathname : null;
};

describe("the bare /", () => {
  it("goes to Bulgarian, temporarily, varying on Accept-Language only", async () => {
    const response = await proxy(request("/"));
    expect(response.status).toBe(307);
    expect(location(response)).toBe("/bg");
    expect(response.headers.get("vary")).toBe("Accept-Language");
  });

  it("asks the browser's languages, and with English off every answer is Bulgarian", async () => {
    for (const language of ["en-GB,en;q=0.9", "de-DE", "bg-BG,bg;q=0.9", "*"]) {
      expect(location(await proxy(request("/", { "accept-language": language })))).toBe("/bg");
    }
  });

  it("never by geography, and never with a cookie", async () => {
    const response = await proxy(
      request("/", {
        "x-vercel-ip-country": "US",
        "accept-language": "en-US",
        cookie: "locale=en",
      }),
    );
    expect(location(response)).toBe("/bg");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("keeps the query string", async () => {
    expect(location(await proxy(request("/?utm_source=x")))).toBe("/bg?utm_source=x");
  });
});

describe("a path under a locale", () => {
  it("is served as asked", async () => {
    for (const path of ["/bg", "/bg/marki", "/bg/kafe-kapsuli", "/bg/tarsene?q=лаваца"]) {
      expect(passesThrough(await proxy(request(path))), path).toBe(true);
    }
  });

  it("whatever the browser says about its languages", async () => {
    expect(passesThrough(await proxy(request("/bg/marki", { "accept-language": "en-US" })))).toBe(
      true,
    );
  });
});

describe("a catalog slug that names nothing", () => {
  it("is sent to the 404 Next renders on the server", async () => {
    for (const path of ["/bg/no-such-product", "/bg/marki/no-such-brand"]) {
      expect(rewrittenTo(await proxy(request(path))), path).toBe("/_not-found");
    }
  });

  it("while one the catalog holds reaches its page", async () => {
    for (const path of [
      "/bg/kafe-kapsuli",
      // A stored slug: the page redirects it to the landing slug.
      "/bg/kapsuli",
      "/bg/dozeti-illy-classico-18br",
      "/bg/marki/lavazza?sort=price-asc",
    ]) {
      expect(passesThrough(await proxy(request(path))), path).toBe(true);
    }
  });

  it("goes for a landing listing with nothing to list, and not for one that lists something", async () => {
    // Static folders both; only the catalog knows which has products today.
    expect(rewrittenTo(await proxy(request("/bg/bezkofeinovo-kafe")))).toBe("/_not-found");
    expect(passesThrough(await proxy(request("/bg/lavazza-kapsuli")))).toBe(true);
    expect(catalog.asked).toEqual(["landing:bezkofeinovo-kafe", "landing:lavazza-kapsuli"]);
  });

  it("is never decided by a lookup that failed: the page's own 404 is still there", async () => {
    catalog.broken = true;
    expect(passesThrough(await proxy(request("/bg/no-such-product")))).toBe(true);
    expect(passesThrough(await proxy(request("/bg/marki/no-such-brand")))).toBe(true);
    expect(passesThrough(await proxy(request("/bg/bezkofeinovo-kafe")))).toBe(true);
  });

  it("asks only about the kinds of URL the catalog decides", async () => {
    for (const path of [
      "/bg",
      "/bg/marki",
      "/bg/tarsene",
      "/bg/blog/anything",
      "/bg/za-kafemashina/krups",
      "/bg/izbor-na-kafe/rezultat",
      "/bg/a/b/c",
      "/sitemap.xml",
      "/products/x",
    ]) {
      await proxy(request(path));
    }
    expect(catalog.asked).toEqual([]);

    expect(catalogLookup(["kafe-kapsuli"])).toEqual({ kind: "first-level", slug: "kafe-kapsuli" });
    expect(catalogLookup(["marki", "lavazza"])).toEqual({ kind: "brand", slug: "lavazza" });
    expect(catalogLookup(["nay-evtino-na-chasha"])).toEqual({
      kind: "landing",
      slug: "nay-evtino-na-chasha",
    });
    expect(catalogLookup(["marki"])).toBeNull();
    expect(catalogLookup(["blog", "x"])).toBeNull();
    expect(catalogLookup([])).toBeNull();
  });
});

describe("the pre-locale URLs", () => {
  it.each([
    ["/products/dozeti-illy-classico-18br", "/bg/dozeti-illy-classico-18br"],
    ["/brands/lavazza?sort=price-asc", "/bg/marki/lavazza?sort=price-asc"],
    [
      "/search?q=%D0%BB%D0%B0%D0%B2%D0%B0%D1%86%D0%B0",
      "/bg/tarsene?q=%D0%BB%D0%B0%D0%B2%D0%B0%D1%86%D0%B0",
    ],
    ["/categories?x=1", "/bg/kategorii?x=1"],
    [
      "/wizard/result?brew=capsule&system=dolce-gusto",
      "/bg/izbor-na-kafe/rezultat?brew=capsule&system=dolce-gusto",
    ],
    ["/newsletter/unsubscribe?token=abc", "/bg/byuletin/otpisvane?token=abc"],
  ])("%s answers 308 to %s, query kept", async (from, target) => {
    const response = await proxy(request(from));
    expect(response.status).toBe(308);
    expect(location(response)).toBe(target);
  });

  it("answers an old journal address with the article's current one, in one hop", async () => {
    const { getMovedArticle, listPreviousSlugs } = await import("@/lib/journal");
    const [former] = listPreviousSlugs();
    expect(former).toBeTruthy();
    const response = await proxy(request(`/journal/${former}?utm_source=mail`));
    expect(response.status).toBe(308);
    expect(location(response)).toBe(`/bg/blog/${getMovedArticle(former)?.slug}?utm_source=mail`);
  });

  it("passes an old category URL on to the route handler that knows the catalog", async () => {
    expect(passesThrough(await proxy(request("/categories/kapsuli")))).toBe(true);
  });
});

describe("everything else", () => {
  it("is the global 404, for a locale that is switched off as for no locale at all", async () => {
    for (const path of ["/en", "/en/brands", "/nope", "/this-route-does-not-exist", "/de/x"]) {
      expect(rewrittenTo(await proxy(request(path))), path).toBe("/_not-found");
    }
  });
});

describe("what it never touches", () => {
  const untouched = [
    "/admin",
    "/admin/zayavki",
    "/api/search/suggest",
    "/media/catalog/a.jpg",
    "/sitemap.xml",
    "/robots.txt",
    "/llms.txt",
    "/opengraph-image",
    "/manifest.webmanifest",
    "/favicon.ico",
    "/icon.png",
    "/_next/static/chunk.js",
    "/_vercel/insights/script.js",
    "/_not-found",
  ];

  it.each(untouched)("%s", async (path) => {
    expect(isUntouched(path)).toBe(true);
    expect(passesThrough(await proxy(request(path)))).toBe(true);
  });

  it("is kept from running there at all by the matcher", () => {
    const [source] = config.matcher;
    const matcher = new RegExp(`^${source}$`);
    for (const path of untouched) expect(matcher.test(path), path).toBe(false);
    for (const path of ["/", "/bg", "/bg/marki", "/products/x", "/administrator", "/apiary"]) {
      expect(matcher.test(path), path).toBe(true);
    }
  });
});
