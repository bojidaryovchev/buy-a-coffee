import { describe, expect, it, vi } from "vitest";

/**
 * Which sitemap the function hands out (`lib/seo/sitemap-copy.ts`): a fresh
 * draw, one at most a minute old, or the copy kept from the last good draw
 * while the database cannot be read. The store and the clock are stand-ins;
 * `e2e/sitemap-outage.spec.ts` holds the real cache to the same.
 */

/** Every `unstable_cache` the module creates: its key parts and options. */
const created = vi.hoisted(() => [] as Array<[readonly string[], { tags?: string[] }]>);
vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown, keyParts: readonly string[], options: { tags?: string[] }) => {
    created.push([keyParts, options]);
    return fn;
  },
}));
vi.mock("@/lib/seo/sitemap", () => ({ sitemapEntries: async () => [] }));

const {
  DRAW_TIMEOUT_MS,
  MAX_KEPT_AGE_MS,
  REUSE_MS,
  SitemapUnavailable,
  createSitemapCopies,
  firstLocOrigin,
  nextDataCacheStore,
} = await import("@/lib/seo/sitemap-copy");
const { SITEMAP_SITE, SITEMAP_TAG } = await import("@/lib/seo/sitemap-cache");

const ORIGIN = "https://buy-a-coffee.com";
const sitemap = (n: number | string, origin = ORIGIN) =>
  `<urlset><url><loc>${origin}/bg</loc></url><!-- ${n} --></urlset>`;
type Store = Parameters<typeof createSitemapCopies>[0];
type Drawn = { xml: string; drawnAt: number };

function setup(changedAt = 0, options: { drawTimeoutMs?: number } = {}) {
  let clock = 1_000_000;
  const state = { changedAt, kept: null as Drawn | null, draws: 0, failing: false };
  const store: Store = {
    changedAt: async () => state.changedAt,
    readKept: async () => state.kept,
    keep: async (drawn) => {
      state.kept = drawn;
    },
  };
  const draw = vi.fn(async () => {
    state.draws += 1;
    if (state.failing) throw new Error("connect ECONNREFUSED");
    return sitemap(state.draws);
  });
  const current = createSitemapCopies(store, draw, {
    now: () => clock,
    origin: ORIGIN,
    ...options,
  });
  return {
    current,
    state,
    draw,
    tick: (ms: number) => (clock += ms),
    now: () => clock,
  };
}

describe("the sitemap handed out", () => {
  it("is a fresh draw, kept as the last good one", async () => {
    const { current, state } = setup();
    const copy = await current();
    expect(copy).toMatchObject({ xml: sitemap(1), source: "drawn" });
    expect(state.kept).toEqual({ xml: sitemap(1), drawnAt: copy.drawnAt });
  });

  it("is the same draw again for a minute, then drawn afresh", async () => {
    const { current, state, tick } = setup();
    await current();
    tick(REUSE_MS - 1);
    expect(await current()).toMatchObject({ xml: sitemap(1), source: "recent" });
    expect(state.draws).toBe(1);
    tick(1);
    expect(await current()).toMatchObject({ xml: sitemap(2), source: "drawn" });
  });

  it("is drawn afresh once the sitemap is declared changed, however recent the last draw", async () => {
    const { current, state, tick, now } = setup();
    await current();
    tick(1_000);
    state.changedAt = now();
    expect(await current()).toMatchObject({ xml: sitemap(2), source: "drawn" });
    tick(1_000);
    expect(await current()).toMatchObject({ xml: sitemap(2), source: "recent" });
  });

  it("is drawn, not reused, when the change mark cannot be read", async () => {
    let draws = 0;
    const unreadable = createSitemapCopies(
      {
        changedAt: async () => {
          throw new Error("cache down");
        },
        readKept: async () => null,
        keep: async () => undefined,
      },
      async () => sitemap((draws += 1)),
    );
    expect(await unreadable()).toMatchObject({ xml: sitemap(1), source: "drawn" });
    expect(await unreadable()).toMatchObject({ xml: sitemap(2), source: "drawn" });
  });

  it("is one draw for requests that arrive while it is under way", async () => {
    const { current, state } = setup();
    const copies = await Promise.all([current(), current(), current()]);
    expect(state.draws).toBe(1);
    expect(copies.map((copy) => copy.source)).toEqual(["drawn", "drawn", "drawn"]);
    expect(new Set(copies.map((copy) => copy.xml)).size).toBe(1);
  });

  it("is the kept copy when the draw fails, days later, with the reason", async () => {
    const { current, state, tick, now } = setup();
    const good = await current();
    tick(3 * 24 * 3600 * 1000);
    state.changedAt = now();
    state.failing = true;
    const copy = await current();
    expect(copy).toMatchObject({
      xml: good.xml,
      drawnAt: good.drawnAt,
      source: "kept",
      failure: "connect ECONNREFUSED",
    });
    // Still the last good one: a failed draw keeps nothing.
    expect(state.kept).toEqual({ xml: good.xml, drawnAt: good.drawnAt });
  });

  it("fails when the draw fails and nothing was ever kept", async () => {
    const { current, state } = setup();
    state.failing = true;
    const failure = await current().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SitemapUnavailable);
    expect(failure).toMatchObject({
      kept: "none",
      keptDrawnAt: null,
      failure: "connect ECONNREFUSED",
    });
  });

  it("is the kept copy within a week, and refused past it, so the CDN's own answers", async () => {
    const { current, state, tick, now } = setup();
    const good = await current();
    state.failing = true;

    tick(MAX_KEPT_AGE_MS - (now() - good.drawnAt));
    state.changedAt = now();
    expect(await current()).toMatchObject({ source: "kept", drawnAt: good.drawnAt });

    tick(1);
    state.changedAt = now();
    const failure = await current().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SitemapUnavailable);
    expect(failure).toMatchObject({ kept: "too_old", keptDrawnAt: good.drawnAt });
    expect(MAX_KEPT_AGE_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("is never another site's kept copy, from a data cache the team shares", async () => {
    const { current, state } = setup();
    state.kept = { xml: sitemap("theirs", "https://another-shop.example"), drawnAt: 999_000 };
    state.failing = true;
    const failure = await current().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SitemapUnavailable);
    expect(failure).toMatchObject({ kept: "foreign", keptDrawnAt: 999_000 });

    // Nor a copy with no address to tell by.
    state.kept = { xml: "<urlset></urlset>", drawnAt: 999_000 };
    await expect(current()).rejects.toMatchObject({ kept: "foreign" });
  });

  it("gives up on a draw that does not answer, and the kept copy stands in at once", async () => {
    // A good draw, the copy kept from it.
    const { current } = setup(0, { drawTimeoutMs: 30 });
    const good = await current();
    // Then a database that never answers.
    const hung = createSitemapCopies(
      {
        changedAt: async () => Number.POSITIVE_INFINITY,
        readKept: async () => good,
        keep: async () => undefined,
      },
      () => new Promise<string>(() => undefined),
      { drawTimeoutMs: 30, origin: ORIGIN, now: () => good.drawnAt + 1_000 },
    );
    const started = Date.now();
    const copy = await hung();
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(copy).toMatchObject({
      source: "kept",
      xml: good.xml,
      failure: "the draw took longer than 30 ms",
    });
    // The next request does not queue behind the hung one: it draws again, and times out again.
    await expect(hung()).resolves.toMatchObject({ source: "kept" });
    expect(DRAW_TIMEOUT_MS).toBe(5_000);
  });

  it("reads the origin off the first address", () => {
    expect(firstLocOrigin(sitemap(1))).toBe(ORIGIN);
    expect(firstLocOrigin("<urlset><url><loc>not a url</loc></url></urlset>")).toBeNull();
    expect(firstLocOrigin("")).toBeNull();
  });

  it("is still handed out when keeping it fails", async () => {
    const copies = createSitemapCopies(
      {
        changedAt: async () => 0,
        readKept: async () => null,
        keep: async () => {
          throw new Error("cache full");
        },
      },
      async () => "<urlset/>",
    );
    expect(await copies()).toMatchObject({ xml: "<urlset/>", source: "drawn" });
  });
});

describe("the copies in the data cache", () => {
  it("are kept under keys and a tag that name the site, for a cache a Vercel team shares", async () => {
    // The kept copy's entry is made per call; reading one makes it.
    expect(await nextDataCacheStore.readKept()).toBeNull();
    expect(created.length).toBeGreaterThanOrEqual(2);
    for (const [keyParts] of created) {
      expect(keyParts[0]).toBe("sitemap.xml");
      expect(keyParts).toContain(SITEMAP_SITE);
    }
    const [mark, kept] = [
      created.find(([keyParts]) => keyParts.includes("changed-at")),
      created.find(([keyParts]) => keyParts.includes("kept-copy")),
    ];
    // The "changed since" mark under the site's tag; the kept copy under none.
    expect(mark?.[1].tags).toEqual([SITEMAP_TAG]);
    expect(SITEMAP_TAG).toBe(`${SITEMAP_SITE}:sitemap`);
    expect(kept?.[1].tags).toBeUndefined();
  });
});
