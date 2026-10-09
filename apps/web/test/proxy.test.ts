import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, isUntouched, proxy } from "@/proxy";

/*
 * The proxy, called the way Next calls it: a request in, a response out. What
 * it must do is narrow — resolve the bare `/`, send the old URLs home, serve
 * a translated URL from its folder — and what it must never do is as
 * important: move a visitor off the locale in their URL, set a cookie, or
 * touch the admin, the API, the files.
 */

const request = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(new URL(path, "https://buy-a-coffee.com"), { headers });

const location = (response: Response) => {
  const value = response.headers.get("location");
  return value ? new URL(value).pathname + new URL(value).search : null;
};

/** `NextResponse.next()` carries this header; a rewrite or redirect does not. */
const passesThrough = (response: Response) => response.headers.get("x-middleware-next") === "1";

describe("the bare /", () => {
  it("goes to Bulgarian, temporarily, varying on Accept-Language only", () => {
    const response = proxy(request("/"));
    expect(response.status).toBe(307);
    expect(location(response)).toBe("/bg");
    expect(response.headers.get("vary")).toBe("Accept-Language");
  });

  it("asks the browser's languages, and with English off every answer is Bulgarian", () => {
    for (const language of ["en-GB,en;q=0.9", "de-DE", "bg-BG,bg;q=0.9", "*"]) {
      expect(location(proxy(request("/", { "accept-language": language })))).toBe("/bg");
    }
  });

  it("never by geography, and never with a cookie", () => {
    const response = proxy(
      request("/", {
        "x-vercel-ip-country": "US",
        "accept-language": "en-US",
        cookie: "locale=en",
      }),
    );
    expect(location(response)).toBe("/bg");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("keeps the query string", () => {
    expect(location(proxy(request("/?utm_source=x")))).toBe("/bg?utm_source=x");
  });
});

describe("a path under a locale", () => {
  it("is served as asked", () => {
    for (const path of ["/bg", "/bg/marki", "/bg/kafe-kapsuli", "/bg/tarsene?q=лаваца"]) {
      expect(passesThrough(proxy(request(path))), path).toBe(true);
    }
  });

  it("whatever the browser says about its languages", () => {
    expect(passesThrough(proxy(request("/bg/marki", { "accept-language": "en-US" })))).toBe(true);
  });
});

describe("everything else", () => {
  /** A rewrite names its target in this header; the address bar keeps the request's. */
  const rewrittenTo = (response: Response) => {
    const value = response.headers.get("x-middleware-rewrite");
    return value ? new URL(value).pathname : null;
  };

  it("is the global 404, for a locale that is switched off as for no locale at all", () => {
    for (const path of ["/en", "/en/brands", "/nope", "/this-route-does-not-exist", "/de/x"]) {
      expect(rewrittenTo(proxy(request(path))), path).toBe("/_not-found");
    }
  });

  it("but never for a request under a shipping locale, which the route tree answers", () => {
    expect(rewrittenTo(proxy(request("/bg/nope")))).toBeNull();
    expect(passesThrough(proxy(request("/bg/nope")))).toBe(true);
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
  ])("%s answers 308 to %s, query kept", (from, target) => {
    const response = proxy(request(from));
    expect(response.status).toBe(308);
    expect(location(response)).toBe(target);
  });

  it("passes an old category URL on to the route handler that knows the catalog", () => {
    expect(passesThrough(proxy(request("/categories/kapsuli")))).toBe(true);
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

  it.each(untouched)("%s", (path) => {
    expect(isUntouched(path)).toBe(true);
    expect(passesThrough(proxy(request(path)))).toBe(true);
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
