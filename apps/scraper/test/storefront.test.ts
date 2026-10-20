import { afterEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "@catalog/shared";
import { refreshStorefront, syncChangedShop } from "../src/commands-catalog.ts";

/**
 * After a sync or a copy run, the storefront is asked to redraw the catalog,
 * and only when the run wrote something it shows. Never fatal, and never
 * silent: a missing setting or a refusal is in the log, without the secret.
 */

type SyncShape = Parameters<typeof syncChangedShop>[0];

const NOTHING = {
  created: 0,
  updated: 0,
  unchanged: 205,
  marked_missing: 0,
  removed: 0,
  restored: 0,
  moved: 0,
};
const SIDE = { created: [], renamed: [], markedMissing: [], restored: [], conflicts: [] };

function run(overrides: Partial<Record<keyof typeof NOTHING, number>> = {}, extra = {}): SyncShape {
  return {
    appliedDiff: { counts: { ...NOTHING, ...overrides } },
    taxonomy: { brands: SIDE, categories: SIDE },
    images: { mirrored: 0, skipped: 3, failed: 0 },
    enrichment: { enriched: 0 },
    ...extra,
  } as unknown as SyncShape;
}

function recordingLogger() {
  const lines: Array<{ level: string; message: string; context: unknown }> = [];
  const at =
    (level: string) =>
    (message: string, context?: unknown): void => {
      lines.push({ level, message, context });
    };
  const logger = {
    debug: at("debug"),
    info: at("info"),
    warn: at("warn"),
    error: at("error"),
    child: () => logger,
  } as unknown as Logger;
  return { logger, lines };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("whether a sync changed the shop", () => {
  it("is false for a run that only found everything unchanged", () => {
    expect(syncChangedShop(run())).toBe(false);
  });

  it("is true for any product change, taxonomy change, mirrored photo or page read in", () => {
    for (const change of ["created", "updated", "marked_missing", "removed", "restored", "moved"]) {
      expect(syncChangedShop(run({ [change]: 1 })), change).toBe(true);
    }
    expect(
      syncChangedShop(
        run(
          {},
          {
            taxonomy: {
              brands: { ...SIDE, renamed: [{ from: "a", to: "b", slug: "b" }] },
              categories: SIDE,
            },
          },
        ),
      ),
    ).toBe(true);
    expect(syncChangedShop(run({}, { images: { mirrored: 2, skipped: 0, failed: 0 } }))).toBe(true);
    expect(syncChangedShop(run({}, { enrichment: { enriched: 1 } }))).toBe(true);
  });
});

describe("refreshStorefront", () => {
  it("skips, and says why, without CRON_SECRET", async () => {
    vi.stubEnv("SITE_URL", "https://buy-a-coffee.com");
    vi.stubEnv("CRON_SECRET", "");
    const send = vi.fn();
    vi.stubGlobal("fetch", send);
    const { logger, lines } = recordingLogger();

    const result = await refreshStorefront({ logger }, { scope: "catalog" });
    expect(result).toMatchObject({ ok: false, skipped: "CRON_SECRET is not set" });
    expect(send).not.toHaveBeenCalled();
    expect(lines).toEqual([
      expect.objectContaining({
        level: "info",
        message: "storefront.revalidate.skipped",
        context: expect.objectContaining({ reason: "CRON_SECRET is not set" }),
      }),
    ]);
  });

  it("warns on a refusal, never throws, and never logs the secret", async () => {
    const secret = "k".repeat(40);
    vi.stubEnv("SITE_URL", "https://buy-a-coffee.com");
    vi.stubEnv("CRON_SECRET", secret);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Unauthorized", { status: 401 })),
    );
    const { logger, lines } = recordingLogger();

    const result = await refreshStorefront({ logger }, { scope: "catalog" });
    expect(result).toMatchObject({ ok: false, skipped: null, status: 401, error: "http_401" });
    expect(lines).toEqual([
      expect.objectContaining({ level: "warn", message: "storefront.revalidate.failed" }),
    ]);
    expect(JSON.stringify({ result, lines })).not.toContain(secret);
  });

  it("reports what the storefront refreshed", async () => {
    vi.stubEnv("SITE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://buy-a-coffee.com");
    vi.stubEnv("CRON_SECRET", "k".repeat(40));
    const send = vi.fn(
      async () =>
        new Response(JSON.stringify({ routes: new Array(24).fill("r"), paths: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", send);
    const { logger, lines } = recordingLogger();

    const result = await refreshStorefront({ logger }, { scope: "catalog" });
    expect(result).toEqual({
      ok: true,
      skipped: null,
      status: 200,
      routes: 24,
      paths: 0,
      error: null,
    });
    expect(String((send.mock.calls[0] as unknown[])[0])).toBe(
      "https://buy-a-coffee.com/api/revalidate",
    );
    expect(lines).toEqual([
      expect.objectContaining({ level: "info", message: "storefront.revalidated" }),
    ]);
  });
});
