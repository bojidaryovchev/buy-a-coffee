import { describe, expect, it } from "vitest";
import {
  canonicalizeUrl,
  decodedPath,
  isSameOrigin,
  looksLikeFilePath,
  normalizePathname,
} from "../src/url.ts";

const OPTS = {
  base: "https://www.kafezona.com/",
  canonicalHost: "www.kafezona.com",
  hostAliases: ["kafezona.com"],
} as const;

const href = (input: string, extra: Record<string, unknown> = {}): string | null =>
  canonicalizeUrl(input, { ...OPTS, ...extra })?.href ?? null;

describe("normalizePathname", () => {
  it("adds exactly one trailing slash to directory paths", () => {
    expect(normalizePathname("/lavazza")).toBe("/lavazza/");
    expect(normalizePathname("/lavazza/")).toBe("/lavazza/");
    expect(normalizePathname("/lavazza//")).toBe("/lavazza/");
  });

  it("keeps the root path as a single slash", () => {
    expect(normalizePathname("/")).toBe("/");
    expect(normalizePathname("")).toBe("/");
  });

  it("collapses duplicate slashes", () => {
    expect(normalizePathname("/a//b///c")).toBe("/a/b/c/");
  });

  it("does not add a trailing slash to file paths", () => {
    expect(normalizePathname("/img/product-img-1182.jpg-800w.jpg")).toBe(
      "/img/product-img-1182.jpg-800w.jpg",
    );
    expect(normalizePathname("/sitemap.xml")).toBe("/sitemap.xml");
  });
});

describe("looksLikeFilePath", () => {
  it("recognises extensions", () => {
    expect(looksLikeFilePath("/a/b.jpg")).toBe(true);
    expect(looksLikeFilePath("/a/b.webp")).toBe(true);
    expect(looksLikeFilePath("/a/b/")).toBe(false);
    expect(looksLikeFilePath("/")).toBe(false);
  });
});

describe("canonicalizeUrl", () => {
  it("resolves relative links against the base", () => {
    expect(href("/kapsuli/")).toBe("https://www.kafezona.com/kapsuli/");
    expect(href("kapsuli/")).toBe("https://www.kafezona.com/kapsuli/");
  });

  it("forces https because http 301-redirects on the live site", () => {
    expect(href("http://www.kafezona.com/lavazza/")).toBe("https://www.kafezona.com/lavazza/");
  });

  it("rewrites the apex host to www because the apex returns 522", () => {
    expect(href("https://kafezona.com/lavazza/")).toBe("https://www.kafezona.com/lavazza/");
  });

  it("adds the trailing slash the site redirects to", () => {
    expect(href("https://www.kafezona.com/lavazza")).toBe("https://www.kafezona.com/lavazza/");
  });

  it("preserves path case, because /LAVAZZA/ is a different (missing) page", () => {
    expect(href("/LAVAZZA/")).toBe("https://www.kafezona.com/LAVAZZA/");
  });

  it("percent-encodes literal spaces found in the site's own markup", () => {
    expect(href("/raztvorimo kafe/")).toBe("https://www.kafezona.com/raztvorimo%20kafe/");
    expect(href("/ vergnano/")).toBe("https://www.kafezona.com/%20vergnano/");
  });

  it("treats encoded and literal spaces as the same URL", () => {
    expect(href("/raztvorimo%20kafe/")).toBe(href("/raztvorimo kafe/"));
  });

  it("drops fragments", () => {
    expect(href("/lavazza/#reviews")).toBe("https://www.kafezona.com/lavazza/");
  });

  it("strips tracking parameters", () => {
    expect(href("/lavazza/?utm_source=x&fbclid=y&gclid=z")).toBe(
      "https://www.kafezona.com/lavazza/",
    );
    expect(href("/lavazza/?utm_anything_new=1")).toBe("https://www.kafezona.com/lavazza/");
  });

  it("keeps meaningful parameters and sorts them deterministically", () => {
    expect(href("/search/?q=lavazza")).toBe("https://www.kafezona.com/search/?q=lavazza");
    const a = href("/kapsuli/?strength=strong&brand=lavazza");
    const b = href("/kapsuli/?brand=lavazza&strength=strong");
    expect(a).toBe(b);
  });

  it("sorts comma-separated multi-value filters so order cannot fork the crawl", () => {
    const a = href("/kapsuli/?brand=molini,lavazza");
    const b = href("/kapsuli/?brand=lavazza,molini");
    expect(a).toBe(b);
    expect(a).toContain("brand=lavazza%2Cmolini");
  });

  it("drops unknown parameters to prevent an unbounded query space", () => {
    expect(href("/kapsuli/?whatever=1&q=x")).toBe("https://www.kafezona.com/kapsuli/?q=x");
  });

  it("can keep unknown parameters when explicitly asked", () => {
    expect(href("/kapsuli/?whatever=1", { unknownParams: "keep" })).toBe(
      "https://www.kafezona.com/kapsuli/?whatever=1",
    );
  });

  it("drops empty parameter values", () => {
    expect(href("/search/?q=")).toBe("https://www.kafezona.com/search/");
  });

  it("rejects non-crawlable schemes", () => {
    expect(href("mailto:a@b.com")).toBeNull();
    expect(href("tel:0887 695 267")).toBeNull();
    expect(href("javascript:void(0)")).toBeNull();
    expect(href("data:text/html,x")).toBeNull();
  });

  it("rejects fragment-only and empty links", () => {
    expect(href("#")).toBeNull();
    expect(href("")).toBeNull();
    expect(href("   ")).toBeNull();
  });

  it("returns null for malformed input rather than throwing", () => {
    expect(canonicalizeUrl("http://", { canonicalHost: "x" })).toBeNull();
    expect(canonicalizeUrl("::::", {})).toBeNull();
  });

  it("strips credentials and default ports", () => {
    expect(href("https://user:pass@www.kafezona.com:443/x/")).toBe(
      "https://www.kafezona.com/x/",
    );
  });

  it("keeps external hosts intact so they can be recorded", () => {
    expect(href("https://fonts.googleapis.com/css2?family=Roboto")).toBe(
      "https://fonts.googleapis.com/css2",
    );
  });
});

describe("isSameOrigin", () => {
  it("accepts the canonical host only", () => {
    expect(isSameOrigin(canonicalizeUrl("/x/", OPTS), "www.kafezona.com")).toBe(true);
    expect(
      isSameOrigin(canonicalizeUrl("https://fonts.googleapis.com/x", OPTS), "www.kafezona.com"),
    ).toBe(false);
    expect(isSameOrigin(null, "www.kafezona.com")).toBe(false);
  });

  it("treats the apex as same-origin once rewritten", () => {
    expect(
      isSameOrigin(canonicalizeUrl("https://kafezona.com/x/", OPTS), "www.kafezona.com"),
    ).toBe(true);
  });
});

describe("decodedPath", () => {
  it("decodes percent-encoding for human-readable keys", () => {
    const url = canonicalizeUrl("/raztvorimo kafe/", OPTS);
    expect(url).not.toBeNull();
    expect(decodedPath(url!)).toBe("/raztvorimo kafe/");
  });

  it("survives invalid percent sequences", () => {
    const url = canonicalizeUrl("/a%ZZb/", OPTS);
    expect(url).not.toBeNull();
    expect(decodedPath(url!)).toBe("/a%ZZb/");
  });
});
