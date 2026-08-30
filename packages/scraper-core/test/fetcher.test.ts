import { describe, expect, it, vi } from "vitest";
import { Fetcher, isRetryableStatus } from "../src/fetch/fetcher.ts";
import { isPathAllowed, isUrlAllowed, parseRobotsTxt, selectGroup } from "../src/fetch/robots.ts";
import { loadConfig } from "../src/config.ts";

// The schema enforces a floor on retry delays so nobody can configure a
// hammering crawler; tests use the smallest values it permits.
const config = loadConfig(
  { minDelayMs: 0, maxRetries: 2, retryBaseDelayMs: 50, retryMaxDelayMs: 100, respectRobotsTxt: false },
  {},
);

function response(body: string, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { "content-type": "text/html; charset=utf-8", ...(init.headers ?? {}) },
  });
}

describe("parseRobotsTxt", () => {
  it("parses the source site's real robots.txt", () => {
    const robots = parseRobotsTxt(
      ["User-agent: *", "Allow: /", "Disallow: /cdn-cgi/l/email-protection", "", "Sitemap: https://www.kafezona.com/sitemap.xml"].join("\n"),
    );
    expect(robots.sitemaps).toEqual(["https://www.kafezona.com/sitemap.xml"]);
    expect(robots.groups).toHaveLength(1);
    expect(isUrlAllowed(robots, "AnyBot", "https://www.kafezona.com/kapsuli/")).toBe(true);
    expect(isUrlAllowed(robots, "AnyBot", "https://www.kafezona.com/cdn-cgi/l/email-protection#ab")).toBe(false);
  });

  it("ignores comments and blank lines", () => {
    const robots = parseRobotsTxt("# comment\n\nUser-agent: *\nDisallow: /private/ # trailing");
    expect(isPathAllowed(selectGroup(robots, "bot"), "/private/x")).toBe(false);
  });

  it("groups consecutive user-agent lines together", () => {
    const robots = parseRobotsTxt("User-agent: a\nUser-agent: b\nDisallow: /x/");
    expect(robots.groups).toHaveLength(1);
    expect(robots.groups[0]?.agents).toEqual(["a", "b"]);
  });

  it("prefers the most specific matching agent", () => {
    const robots = parseRobotsTxt(
      "User-agent: *\nDisallow: /\n\nUser-agent: CatalogSync\nAllow: /\nDisallow: /admin/",
    );
    expect(isUrlAllowed(robots, "CatalogSync/1.0", "https://x.test/page/")).toBe(true);
    expect(isUrlAllowed(robots, "CatalogSync/1.0", "https://x.test/admin/")).toBe(false);
    expect(isUrlAllowed(robots, "OtherBot", "https://x.test/page/")).toBe(false);
  });

  it("treats an empty Disallow as allow-all", () => {
    const robots = parseRobotsTxt("User-agent: *\nDisallow:");
    expect(isPathAllowed(selectGroup(robots, "bot"), "/anything")).toBe(true);
  });

  it("applies longest-match with Allow winning ties", () => {
    const robots = parseRobotsTxt("User-agent: *\nDisallow: /a/\nAllow: /a/b/");
    const group = selectGroup(robots, "bot");
    expect(isPathAllowed(group, "/a/x")).toBe(false);
    expect(isPathAllowed(group, "/a/b/x")).toBe(true);
  });

  it("supports wildcard and end-anchor patterns", () => {
    const robots = parseRobotsTxt("User-agent: *\nDisallow: /*.pdf$");
    const group = selectGroup(robots, "bot");
    expect(isPathAllowed(group, "/docs/a.pdf")).toBe(false);
    expect(isPathAllowed(group, "/docs/a.pdf?x=1")).toBe(true);
  });

  it("reads crawl-delay", () => {
    expect(parseRobotsTxt("User-agent: *\nCrawl-delay: 2.5").groups[0]?.crawlDelaySeconds).toBe(2.5);
  });

  it("allows everything when robots.txt is empty or unparseable", () => {
    expect(isUrlAllowed(parseRobotsTxt(""), "bot", "https://x.test/a")).toBe(true);
    expect(isUrlAllowed(parseRobotsTxt("total nonsense"), "bot", "https://x.test/a")).toBe(true);
  });
});

describe("isRetryableStatus", () => {
  it("retries only transient statuses", () => {
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(408)).toBe(true);
    expect(isRetryableStatus(404)).toBe(false);
    expect(isRetryableStatus(403)).toBe(false);
  });
});

describe("Fetcher", () => {
  it("returns a parsed successful response", async () => {
    const fetchImpl = vi.fn(async () => response("<html><title>ok</title></html>"));
    const fetcher = new Fetcher({ config, fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await fetcher.get("https://www.kafezona.com/x/");
    expect(result.outcome).toBe("ok");
    expect(result.statusCode).toBe(200);
    expect(result.contentHash).toHaveLength(64);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries transient failures and then succeeds", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return calls < 3 ? response("", { status: 503 }) : response("<html>ok</html>");
    });
    const fetcher = new Fetcher({ config, fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await fetcher.get("https://www.kafezona.com/x/");
    expect(result.outcome).toBe("ok");
    expect(result.attempts).toBe(3);
  });

  it("does not retry a 404", async () => {
    const fetchImpl = vi.fn(async () => response("", { status: 404 }));
    const fetcher = new Fetcher({ config, fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await fetcher.get("https://www.kafezona.com/x/");
    expect(result.outcome).toBe("http_error");
    expect(result.statusCode).toBe(404);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("gives up after the configured attempts", async () => {
    const fetchImpl = vi.fn(async () => response("", { status: 500 }));
    const fetcher = new Fetcher({ config, fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await fetcher.get("https://www.kafezona.com/x/");
    expect(result.outcome).toBe("http_error");
    expect(fetchImpl).toHaveBeenCalledTimes(config.maxRetries + 1);
  });

  it("rejects a body larger than the configured limit", async () => {
    const small = loadConfig({ maxBodyBytes: 1024, minDelayMs: 0, respectRobotsTxt: false }, {});
    const fetchImpl = vi.fn(async () => response("x".repeat(5000)));
    const fetcher = new Fetcher({ config: small, fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await fetcher.get("https://www.kafezona.com/x/");
    expect(result.outcome).toBe("too_large");
  });

  it("rejects an oversized body declared via content-length without reading it", async () => {
    const small = loadConfig({ maxBodyBytes: 1024, minDelayMs: 0, respectRobotsTxt: false }, {});
    const fetchImpl = vi.fn(async () => response("ok", { headers: { "content-length": "999999" } }));
    const fetcher = new Fetcher({ config: small, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect((await fetcher.get("https://www.kafezona.com/x/")).outcome).toBe("too_large");
  });

  it("reports a network failure rather than throwing", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("network down");
    });
    const fetcher = new Fetcher({ config, fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await fetcher.get("https://www.kafezona.com/x/");
    expect(result.outcome).toBe("network_error");
    expect(result.error?.message).toContain("network down");
  });

  it("hashes two responses of the same page identically despite rotating tokens", async () => {
    // Cloudflare re-keys `data-cfemail` on every response. Without stripping it,
    // every page would look changed on every crawl.
    const page = (token: string) =>
      `<html><body><span data-cfemail="${token}">x</span></body></html>`;
    let call = 0;
    const fetchImpl = vi.fn(async () => response(page(call++ === 0 ? "aaaa" : "bbbb")));
    const fetcher = new Fetcher({ config, fetchImpl: fetchImpl as unknown as typeof fetch });
    const first = await fetcher.get("https://www.kafezona.com/x/");
    const second = await fetcher.get("https://www.kafezona.com/x/");
    expect(first.contentHash).toBe(second.contentHash);
  });

  describe("soft-404 detection", () => {
    const SHELL = "<html><head><title>Shop</title></head><body>shell</body></html>";

    it("calibrates from an impossible path and flags matching pages", async () => {
      const fetchImpl = vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/real-page/")) return response("<html><title>Real</title>real</html>");
        return response(SHELL); // everything else answers with the shell
      });
      const fetcher = new Fetcher({ config, fetchImpl: fetchImpl as unknown as typeof fetch });

      const calibration = await fetcher.calibrateSoft404();
      expect(calibration.shellHash).not.toBeNull();
      expect(calibration.shellTitle).toBe("Shop");

      const missing = await fetcher.get("https://www.kafezona.com/products/stale-url/");
      expect(missing.outcome).toBe("soft_404");
      expect(missing.statusCode).toBe(200);

      const real = await fetcher.get("https://www.kafezona.com/real-page/");
      expect(real.outcome).toBe("ok");
    });

    it("never treats the home page as a soft 404", async () => {
      const fetchImpl = vi.fn(async () => response(SHELL));
      const fetcher = new Fetcher({ config, fetchImpl: fetchImpl as unknown as typeof fetch });
      await fetcher.calibrateSoft404();
      expect((await fetcher.get("https://www.kafezona.com/")).outcome).toBe("ok");
    });

    it("does nothing when the site returns a real 404", async () => {
      const fetchImpl = vi.fn(async () => response("nope", { status: 404 }));
      const fetcher = new Fetcher({ config, fetchImpl: fetchImpl as unknown as typeof fetch });
      const calibration = await fetcher.calibrateSoft404();
      expect(calibration.shellHash).toBeNull();
    });
  });

  it("blocks a disallowed URL when robots are respected", async () => {
    const strict = loadConfig({ minDelayMs: 0, respectRobotsTxt: true }, {});
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/robots.txt")) return response("User-agent: *\nDisallow: /secret/");
      return response("<html>ok</html>");
    });
    const fetcher = new Fetcher({ config: strict, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect((await fetcher.get("https://www.kafezona.com/secret/x/")).outcome).toBe("blocked_by_robots");
    expect((await fetcher.get("https://www.kafezona.com/public/")).outcome).toBe("ok");
  });

  it("spaces requests by the configured minimum delay", async () => {
    const paced = loadConfig({ minDelayMs: 40, respectRobotsTxt: false }, {});
    const fetchImpl = vi.fn(async () => response("<html>ok</html>"));
    const fetcher = new Fetcher({ config: paced, fetchImpl: fetchImpl as unknown as typeof fetch });
    const started = Date.now();
    await Promise.all([
      fetcher.get("https://www.kafezona.com/a/"),
      fetcher.get("https://www.kafezona.com/b/"),
      fetcher.get("https://www.kafezona.com/c/"),
    ]);
    // Three requests at 40ms spacing cannot finish in under ~80ms.
    expect(Date.now() - started).toBeGreaterThanOrEqual(70);
  });

  it("tracks request statistics", async () => {
    const fetchImpl = vi.fn(async () => response("<html>ok</html>"));
    const fetcher = new Fetcher({ config, fetchImpl: fetchImpl as unknown as typeof fetch });
    await fetcher.get("https://www.kafezona.com/a/");
    expect(fetcher.getStats().requests).toBe(1);
    expect(fetcher.getStats().bytes).toBeGreaterThan(0);
  });
});
