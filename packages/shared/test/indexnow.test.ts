import { describe, expect, it } from "vitest";
import {
  INDEXNOW_BATCH,
  INDEXNOW_ENDPOINT,
  indexNowKeyLocation,
  isIndexNowKey,
  submitIndexNow,
} from "../src/indexnow";

/*
 * IndexNow submissions, with `fetch` replaced: nothing here reaches a search
 * engine. What is checked is the request the protocol expects, and that the
 * function stays silent where it should — no key, no URLs, other hosts.
 */

const SITE = "https://buy-a-coffee.com";
const KEY = "0123456789abcdef0123456789abcdef";

function recorder(status = 202) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(null, { status });
  }) as typeof fetch;
  return { calls, fetch: fake };
}

describe("the key", () => {
  it("is 8 to 128 letters, digits and dashes", () => {
    expect(isIndexNowKey(KEY)).toBe(true);
    expect(isIndexNowKey("abc-1234")).toBe(true);
    expect(isIndexNowKey("short")).toBe(false);
    expect(isIndexNowKey("has space 123")).toBe(false);
    expect(isIndexNowKey("a".repeat(129))).toBe(false);
    expect(isIndexNowKey(undefined)).toBe(false);
  });

  it("is published at the site's root as <key>.txt", () => {
    expect(indexNowKeyLocation(`${SITE}/bg`, KEY)).toBe(`${SITE}/${KEY}.txt`);
  });
});

describe("submitIndexNow", () => {
  it("sends nothing without a key, or with one the protocol would refuse", async () => {
    const { calls, fetch } = recorder();
    const urls = [`${SITE}/bg/kafe-kapsuli`];
    expect(await submitIndexNow({ siteUrl: SITE, key: undefined, urls, fetch })).toMatchObject({
      skipped: "no-key",
      submitted: 0,
    });
    expect(await submitIndexNow({ siteUrl: SITE, key: "", urls, fetch })).toMatchObject({
      skipped: "no-key",
    });
    expect(await submitIndexNow({ siteUrl: SITE, key: "bad key!", urls, fetch })).toMatchObject({
      skipped: "invalid-key",
      ok: false,
    });
    expect(calls).toEqual([]);
  });

  it("posts the host, the key, where the key lives and the URLs", async () => {
    const { calls, fetch } = recorder(200);
    const result = await submitIndexNow({
      siteUrl: SITE,
      key: KEY,
      urls: [`${SITE}/bg/kafe-kapsuli`, `${SITE}/bg/lavazza-super-crema-kafe-na-zarna-1-kg`],
      fetch,
    });
    expect(result).toEqual({ skipped: null, submitted: 2, foreign: 0, statuses: [200], ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(INDEXNOW_ENDPOINT);
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      host: "buy-a-coffee.com",
      key: KEY,
      keyLocation: `${SITE}/${KEY}.txt`,
      urlList: [`${SITE}/bg/kafe-kapsuli`, `${SITE}/bg/lavazza-super-crema-kafe-na-zarna-1-kg`],
    });
  });

  it("drops duplicates and every URL that is not on the site's host", async () => {
    const { calls, fetch } = recorder();
    const result = await submitIndexNow({
      siteUrl: SITE,
      key: KEY,
      urls: [
        `${SITE}/bg/a`,
        `${SITE}/bg/a`,
        "https://preview-abc.vercel.app/bg/a",
        "http://buy-a-coffee.com/bg/b",
        "not a url",
      ],
      fetch,
    });
    expect(result).toMatchObject({ submitted: 1, foreign: 3, ok: true });
    expect(JSON.parse(String(calls[0]!.init.body)).urlList).toEqual([`${SITE}/bg/a`]);
  });

  it("sends nothing when no URL is left", async () => {
    const { calls, fetch } = recorder();
    const result = await submitIndexNow({
      siteUrl: SITE,
      key: KEY,
      urls: ["https://elsewhere.example/x"],
      fetch,
    });
    expect(result).toMatchObject({ skipped: "no-urls", submitted: 0, foreign: 1, ok: true });
    expect(calls).toEqual([]);
  });

  it("splits a long list into the protocol's batches", async () => {
    const { calls, fetch } = recorder();
    const urls = Array.from({ length: INDEXNOW_BATCH + 5 }, (_, i) => `${SITE}/bg/p-${i}`);
    const result = await submitIndexNow({ siteUrl: SITE, key: KEY, urls, fetch });
    expect(calls).toHaveLength(2);
    expect(JSON.parse(String(calls[1]!.init.body)).urlList).toHaveLength(5);
    expect(result.submitted).toBe(INDEXNOW_BATCH + 5);
  });

  it("reports a refusal instead of throwing", async () => {
    const { fetch } = recorder(403);
    const result = await submitIndexNow({
      siteUrl: SITE,
      key: KEY,
      urls: [`${SITE}/bg/a`],
      fetch,
    });
    expect(result).toMatchObject({ ok: false, statuses: [403], submitted: 1 });
  });
});
