import { describe, expect, it, vi } from "vitest";
import { requestRevalidation, revalidationSiteUrl } from "../src/revalidate.ts";

/**
 * The client the sync and the copy scripts use to ask the storefront to
 * redraw the catalog. Optional and never fatal: it skips without its settings,
 * reports a refusal or a network failure instead of throwing, and never lets
 * the secret out of the request header.
 */

const SECRET = "c".repeat(40);
const SITE = "https://buy-a-coffee.com";

const answer = (status: number, body: unknown) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("requestRevalidation", () => {
  it("sends nothing without a site, an https site or the secret, and says which", async () => {
    const send = vi.fn();
    const ask = (siteUrl: string | undefined, secret: string | undefined) =>
      requestRevalidation({ siteUrl, secret, body: { scope: "catalog" }, fetch: send });

    expect(await ask(undefined, SECRET)).toMatchObject({ ok: false, skipped: "no-site-url" });
    expect(await ask("  ", SECRET)).toMatchObject({ ok: false, skipped: "no-site-url" });
    expect(await ask("buy-a-coffee", SECRET)).toMatchObject({ skipped: "bad-site-url" });
    expect(await ask("http://buy-a-coffee.com", SECRET)).toMatchObject({
      skipped: "insecure-site-url",
    });
    expect(await ask(SITE, undefined)).toMatchObject({ ok: false, skipped: "no-secret" });
    expect(await ask(SITE, " ")).toMatchObject({ skipped: "no-secret" });
    expect(send).not.toHaveBeenCalled();
  });

  it("posts the body to /api/revalidate with the bearer token, following no redirect", async () => {
    const send = vi.fn(async () =>
      answer(200, { scope: "catalog", routes: ["/a", "/b"], paths: [], sitemap: "/sitemap.xml" }),
    );
    const result = await requestRevalidation({
      siteUrl: `${SITE}/bg/some/page?x=1`,
      secret: SECRET,
      body: { scope: "catalog" },
      fetch: send,
    });
    expect(result).toEqual({
      skipped: null,
      ok: true,
      status: 200,
      routes: 2,
      paths: 0,
      error: null,
    });
    const [url, init] = send.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe(`${SITE}/api/revalidate`);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${SECRET}`);
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual({ scope: "catalog" });
  });

  it("talks plain http to this machine only", async () => {
    const send = vi.fn(async () => answer(200, { routes: [], paths: ["/bg"] }));
    const result = await requestRevalidation({
      siteUrl: "http://127.0.0.1:8778",
      secret: SECRET,
      body: { slugs: ["lavazza-crema"] },
      fetch: send,
    });
    expect(result).toMatchObject({ ok: true, paths: 1 });
  });

  it("reports a refusal, a redirect, a timeout and a network failure without throwing", async () => {
    const ask = (send: typeof fetch) =>
      requestRevalidation({
        siteUrl: SITE,
        secret: SECRET,
        body: { scope: "catalog" },
        fetch: send,
      });

    expect(await ask(async () => answer(400, { error: "unknown_scope" }))).toMatchObject({
      ok: false,
      status: 400,
      error: "unknown_scope",
    });
    expect(await ask(async () => new Response("Unauthorized", { status: 401 }))).toMatchObject({
      ok: false,
      status: 401,
      error: "http_401",
    });
    expect(
      await ask(async () => new Response(null, { status: 308, headers: { location: "/x" } })),
    ).toMatchObject({ ok: false, status: 308, error: "http_308" });
    expect(
      await ask(async () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      }),
    ).toMatchObject({ ok: false, status: null, error: "timeout" });
    expect(
      await ask(async () => {
        throw new TypeError("fetch failed");
      }),
    ).toMatchObject({ ok: false, status: null, error: "fetch failed" });
  });

  it("never returns the secret, whatever happens", async () => {
    const outcomes = await Promise.all([
      requestRevalidation({
        siteUrl: SITE,
        secret: SECRET,
        body: { scope: "catalog" },
        fetch: async () => answer(500, { error: "revalidate_failed" }),
      }),
      requestRevalidation({
        siteUrl: SITE,
        secret: SECRET,
        body: { scope: "catalog" },
        fetch: async () => {
          throw new Error("boom");
        },
      }),
    ]);
    for (const outcome of outcomes) expect(JSON.stringify(outcome)).not.toContain(SECRET);
  });
});

describe("revalidationSiteUrl", () => {
  it("reads SITE_URL, then NEXT_PUBLIC_SITE_URL", () => {
    expect(
      revalidationSiteUrl({ SITE_URL: " https://a.example ", NEXT_PUBLIC_SITE_URL: "x" }),
    ).toBe("https://a.example");
    expect(revalidationSiteUrl({ NEXT_PUBLIC_SITE_URL: "https://b.example" })).toBe(
      "https://b.example",
    );
    expect(revalidationSiteUrl({ SITE_URL: "" })).toBeUndefined();
  });
});
