import { describe, expect, it, vi } from "vitest";

/**
 * Which sitemap the function hands out (`lib/seo/sitemap-copy.ts`): a fresh
 * draw, one at most a minute old, or the copy kept from the last good draw
 * while the database cannot be read. The store and the clock are stand-ins;
 * `e2e/sitemap-outage.spec.ts` holds the real cache to the same.
 */

vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/seo/sitemap", () => ({ sitemapEntries: async () => [] }));

const { REUSE_MS, createSitemapCopies } = await import("@/lib/seo/sitemap-copy");
type Store = Parameters<typeof createSitemapCopies>[0];
type Drawn = { xml: string; drawnAt: number };

function setup(changedAt = 0) {
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
    return `<urlset>${state.draws}</urlset>`;
  });
  const current = createSitemapCopies(store, draw, () => clock);
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
    expect(copy).toMatchObject({ xml: "<urlset>1</urlset>", source: "drawn" });
    expect(state.kept).toEqual({ xml: "<urlset>1</urlset>", drawnAt: copy.drawnAt });
  });

  it("is the same draw again for a minute, then drawn afresh", async () => {
    const { current, state, tick } = setup();
    await current();
    tick(REUSE_MS - 1);
    expect(await current()).toMatchObject({ xml: "<urlset>1</urlset>", source: "recent" });
    expect(state.draws).toBe(1);
    tick(1);
    expect(await current()).toMatchObject({ xml: "<urlset>2</urlset>", source: "drawn" });
  });

  it("is drawn afresh once the sitemap is declared changed, however recent the last draw", async () => {
    const { current, state, tick, now } = setup();
    await current();
    tick(1_000);
    state.changedAt = now();
    expect(await current()).toMatchObject({ xml: "<urlset>2</urlset>", source: "drawn" });
    tick(1_000);
    expect(await current()).toMatchObject({ xml: "<urlset>2</urlset>", source: "recent" });
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
      async () => `<urlset>${(draws += 1)}</urlset>`,
    );
    expect(await unreadable()).toMatchObject({ xml: "<urlset>1</urlset>", source: "drawn" });
    expect(await unreadable()).toMatchObject({ xml: "<urlset>2</urlset>", source: "drawn" });
  });

  it("is one draw for requests that arrive while it is under way", async () => {
    const { current, state } = setup();
    const copies = await Promise.all([current(), current(), current()]);
    expect(state.draws).toBe(1);
    expect(copies.map((copy) => copy.source)).toEqual(["drawn", "drawn", "drawn"]);
    expect(new Set(copies.map((copy) => copy.xml)).size).toBe(1);
  });

  it("is the kept copy when the draw fails, however old, with the reason", async () => {
    const { current, state, tick, now } = setup();
    const good = await current();
    tick(30 * 24 * 3600 * 1000);
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
    await expect(current()).rejects.toThrow("connect ECONNREFUSED");
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
