import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { silentLogger } from "@catalog/shared";
import { type ExistingProduct, diffCatalog, productSnapshot } from "../src/catalog/diff.ts";
import {
  MAX_CONSECUTIVE_READ_FAILURES,
  ProductPageReader,
  interpretProductPage,
  lookupDiscoveredSkus,
  planSkuLookup,
} from "../src/catalog/enrich.ts";
import { type NormalizedProduct, normalizeProduct } from "../src/catalog/normalize.ts";
import type { ProductMoveColumns } from "../src/catalog/repository.ts";
import { loadConfig } from "../src/config.ts";
import { Fetcher } from "../src/fetch/fetcher.ts";

/**
 * The product code as a second identity, without a database.
 *
 * The source is the real product-page fixtures, served by a `fetch` stand-in
 * through the real `Fetcher`. Nothing here touches the network.
 */

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/kafezona",
);
const fixture = (name: string): string => readFileSync(path.join(FIXTURES, name), "utf8");

const BASE = "https://www.kafezona.com";
const THRESHOLD = { missingThreshold: 3 } as const;

type Raw = Parameters<typeof normalizeProduct>[0];

function product(pathname: string, overrides: Partial<Raw> = {}): NormalizedProduct {
  return normalizeProduct(
    {
      path: pathname,
      url: `${BASE}${pathname}`,
      name: "Amann Cascada 0.500кг.",
      priceText: "€14.00",
      availabilityText: "in_stock",
      weightText: "0.500кг.",
      brandKey: "amann",
      categoryKeys: ["kafe-na-zyrna"],
      descriptionText: "A washed Guatemalan.",
      imageUrls: [`${BASE}/img/product-img-72.jpg-800w.jpg`],
      ...overrides,
    },
    { sourceSite: "kafezona", defaultCurrency: "EUR" },
  );
}

/** A stored row, with the code an earlier read of its page left on it. */
function stored(p: NormalizedProduct, sku: string | null): ExistingProduct {
  return {
    id: `id-${p.sourceKey}`,
    sourceKey: p.sourceKey,
    sourcePath: p.sourcePath,
    semanticHash: p.semanticHash,
    status: "active",
    consecutiveMissingCount: 0,
    sku,
    snapshot: productSnapshot(p),
  };
}

/** Serve `pages` (path -> HTML or status) and count what is asked for. */
function source(pages: Record<string, string | number>, budget = 20) {
  const requests: string[] = [];
  const fetchImpl = (async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(typeof input === "object" && "url" in input ? input.url : input));
    const pathname = decodeURIComponent(url.pathname);
    requests.push(pathname);
    const page = pages[pathname];
    if (typeof page === "string") {
      return new Response(page, { status: 200, headers: { "content-type": "text/html" } });
    }
    return new Response("gone", { status: page ?? 404 });
  }) as unknown as typeof fetch;

  const config = loadConfig(
    { minDelayMs: 0, maxRetries: 0, respectRobotsTxt: false, timeoutMs: 2_000 },
    {},
  );
  const fetcher = new Fetcher({ config, fetchImpl, logger: silentLogger });
  const reader = new ProductPageReader({ fetcher, config, budget });
  return { requests, reader, config, fetcher };
}

describe("interpretProductPage", () => {
  it("reads the code and the stated facts from a product page", () => {
    expect(interpretProductPage(fixture("product-amann-cascada.html"))).toMatchObject({
      sku: "00072",
      arabicaPercent: 100,
      origin: "Finca Flor del Rosario, San Cristóbal Verapaz, Гватемала",
      roast: null,
    });
    const rosso = interpretProductPage(fixture("product-eurocaf-rosso-fuoco.html"));
    expect(rosso).toMatchObject({ sku: "00001", arabicaPercent: null, roast: "средно тъмно" });
    expect(rosso?.characteristics[0]).toEqual({
      label: expect.any(String),
      value: expect.any(String),
    });
  });

  it("leaves what the page does not state as null", () => {
    expect(interpretProductPage(fixture("product-foodness.html"))).toMatchObject({
      sku: "00182",
      arabicaPercent: null,
      origin: null,
      roast: null,
    });
  });

  it.each(["home.html", "not-found-404.html", "soft-404.html", "category-kapsuli.html"])(
    "does not take %s for a product page",
    (name) => {
      expect(interpretProductPage(fixture(name))).toBeNull();
    },
  );
});

describe("ProductPageReader", () => {
  it("requests a page once, however often it is asked for", async () => {
    const { reader, requests } = source({ "/a/": fixture("product-amann-cascada.html") });
    const first = await reader.read(`${BASE}/a/`);
    const second = await reader.read(`${BASE}/a/`);

    expect(first).toMatchObject({ ok: true, facts: { sku: "00072" } });
    expect(second).toBe(first);
    expect(requests).toEqual(["/a/"]);
    expect(reader.requests).toBe(1);
    expect(reader.hasRead(`${BASE}/a/`)).toBe(true);
  });

  it("stops at its budget and requests nothing further", async () => {
    const page = fixture("product-amann-cascada.html");
    const { reader, requests } = source({ "/a/": page, "/b/": page, "/c/": page }, 2);

    expect(await reader.read(`${BASE}/a/`)).toMatchObject({ ok: true });
    expect(await reader.read(`${BASE}/b/`)).toMatchObject({ ok: true });
    expect(reader.remaining).toBe(0);
    expect(await reader.read(`${BASE}/c/`)).toBeNull();
    // What it already holds is still answered.
    expect(await reader.read(`${BASE}/a/`)).toMatchObject({ ok: true });
    expect(requests).toEqual(["/a/", "/b/"]);
  });

  it("returns a failure as data: a 404, an error status, a page that is not a product", async () => {
    const { reader } = source({ "/server-error/": 500, "/not-a-product/": fixture("home.html") });

    expect(await reader.read(`${BASE}/gone/`)).toMatchObject({
      ok: false,
      failure: { stage: "enrich_fetch", outcome: "http_error", statusCode: 404 },
    });
    expect(await reader.read(`${BASE}/server-error/`)).toMatchObject({
      ok: false,
      failure: { stage: "enrich_fetch", outcome: "http_error", statusCode: 500 },
    });
    expect(await reader.read(`${BASE}/not-a-product/`)).toMatchObject({
      ok: false,
      failure: { stage: "enrich_parse", outcome: "not_a_product_page" },
    });
    expect(reader.failures.map((failure) => failure.url)).toEqual([
      `${BASE}/gone/`,
      `${BASE}/server-error/`,
      `${BASE}/not-a-product/`,
    ]);
  });

  it("never requests a page on another host", async () => {
    const { reader, requests } = source({});
    expect(await reader.read("https://elsewhere.example/a/")).toMatchObject({
      ok: false,
      failure: { outcome: "off_site" },
    });
    expect(requests).toEqual([]);
    expect(reader.requests).toBe(0);
  });

  it("stops asking after a run of failures, whatever budget is left", async () => {
    const { reader, requests } = source({ "/fine/": fixture("product-amann-cascada.html") }, 50);
    for (let index = 0; index < MAX_CONSECUTIVE_READ_FAILURES; index += 1) {
      expect(await reader.read(`${BASE}/gone-${index}/`)).toMatchObject({ ok: false });
    }

    expect(reader.halted).toBe(true);
    expect(reader.remaining).toBe(0);
    expect(await reader.read(`${BASE}/fine/`)).toBeNull();
    expect(requests).toHaveLength(MAX_CONSECUTIVE_READ_FAILURES);
  });

  it("does not halt on failures that are not consecutive", async () => {
    const { reader } = source({ "/fine/": fixture("product-amann-cascada.html") }, 50);
    for (let index = 0; index < MAX_CONSECUTIVE_READ_FAILURES - 1; index += 1) {
      await reader.read(`${BASE}/gone-${index}/`);
    }
    await reader.read(`${BASE}/fine/`);
    await reader.read(`${BASE}/gone-again/`);
    expect(reader.halted).toBe(false);
  });
});

describe("planSkuLookup", () => {
  const vanished = stored(product("/amann-cascada/"), "00072");

  it("selects the products that match no stored key", () => {
    const kept = product("/kept/", { name: "Kept 1кг.", weightText: "1 кг." });
    const appeared = product("/amann-cascada-500/");

    const plan = planSkuLookup([kept, appeared], [stored(kept, "00001"), vanished], {
      maxCandidates: 10,
    });

    expect(plan.skipped).toBeNull();
    expect(plan.candidates).toEqual([appeared]);
  });

  it("skips the lookup entirely when there are more candidates than the cap", () => {
    const appeared = [1, 2, 3].map((n) => product(`/new-${n}/`, { name: `New ${n} 1кг.` }));

    const plan = planSkuLookup(appeared, [vanished], { maxCandidates: 2 });

    // Not the first two: none.
    expect(plan).toEqual({ candidates: [], candidateCount: 3, skipped: "over_cap" });
  });

  it("skips when no vanished row has a code to pair with", () => {
    const appeared = product("/amann-cascada-500/");
    // The stored row is gone from the listing but was never enriched...
    expect(
      planSkuLookup([appeared], [stored(product("/old/"), null)], { maxCandidates: 10 }),
    ).toMatchObject({
      skipped: "nothing_to_pair_with",
    });
    // ...or has a code but is still listed, so it is not looking for a partner.
    const kept = product("/kept/");
    expect(
      planSkuLookup([kept, appeared], [stored(kept, "00001")], { maxCandidates: 10 }),
    ).toMatchObject({ skipped: "nothing_to_pair_with" });
    // A first sync is the same case: nothing is stored at all.
    expect(planSkuLookup([appeared], [], { maxCandidates: 10 }).skipped).toBe(
      "nothing_to_pair_with",
    );
  });

  it("skips when nothing is unmatched, and when it is switched off", () => {
    const kept = product("/kept/");
    expect(
      planSkuLookup([kept], [stored(kept, "00001"), vanished], { maxCandidates: 10 }).skipped,
    ).toBe("no_candidates");
    expect(
      planSkuLookup([product("/amann-cascada-500/")], [vanished], { maxCandidates: 0 }).skipped,
    ).toBe("disabled");
  });

  it("never looks up a page that two pack sizes share", () => {
    const shared = { ...product("/borbone/"), hasUrlCollision: true };
    expect(planSkuLookup([shared], [vanished], { maxCandidates: 10 }).skipped).toBe(
      "no_candidates",
    );
  });
});

describe("the pre-diff lookup feeding move detection", () => {
  /** What we hold: read once, long ago, under the old URL, name and brand. */
  const before = product("/amann-cascada/", {
    name: "Amann Cascada 0.500кг.",
    brandKey: "amann",
  });
  /** What the source lists now: new URL, new name, re-filed under another brand. */
  const after = product("/amann-cascada-500/", {
    name: "Кафе на зърна Cascada Guatemala 0.500кг.",
    brandKey: "amann-kaffee",
  });

  it("cannot pair a rename that also changed the name without the code", () => {
    const result = diffCatalog([after], [stored(before, "00072")], THRESHOLD);
    expect(result.counts).toMatchObject({ moved: 0, created: 1, marked_missing: 1 });
  });

  it("reads the candidate's code from its page and pairs it in the first pass", async () => {
    const { reader, requests } = source({
      "/amann-cascada-500/": fixture("product-amann-cascada.html"),
    });
    const existing = [stored(before, "00072")];

    const lookup = await lookupDiscoveredSkus({
      discovered: [after],
      existing,
      reader,
      maxCandidates: 10,
    });

    expect(requests).toEqual(["/amann-cascada-500/"]);
    expect(lookup).toMatchObject({ candidateCount: 1, looked: 1, found: 1, skipped: null });
    expect([...lookup.skus]).toEqual([[after.sourceKey, "00072"]]);

    // The diff is handed the result as data and does no I/O of its own.
    const result = diffCatalog([after], existing, { ...THRESHOLD, discoveredSkus: lookup.skus });

    expect(result.counts).toMatchObject({ moved: 1, created: 0, marked_missing: 0 });
    const [move] = result.moved;
    expect(move?.productId).toBe(existing[0]?.id);
    expect(move?.movedFrom).toEqual({
      sourceKey: "/amann-cascada/#500g",
      matchedBy: "sku",
      decidedBy: null,
    });
    // The name and the brand changed in the same edit, and the audit says so.
    expect(move?.changedFields).toEqual(expect.arrayContaining(["brandKey", "name", "sourceKey"]));
    // The code is evidence, never a field of the listing: not "changed".
    expect(move?.changedFields).not.toContain("sku");
    expect(requests).toHaveLength(1);
  });

  it("keeps identity on path and pack size on both sides of a code-paired move", async () => {
    const { reader } = source({ "/amann-cascada-500/": fixture("product-amann-cascada.html") });
    const existing = [stored(before, "00072")];
    const lookup = await lookupDiscoveredSkus({
      discovered: [after],
      existing,
      reader,
      maxCandidates: 10,
    });
    const result = diffCatalog([after], existing, { ...THRESHOLD, discoveredSkus: lookup.skus });

    const [move] = result.moved;
    expect(move?.sourceKey).toBe("/amann-cascada-500/#500g");
    expect(move?.product?.sourceKey).toBe("/amann-cascada-500/#500g");
    expect(move?.product?.identityStrategy).toBe("path_and_size");
    // The lookup did not write the code onto the discovered product either.
    expect(move?.product?.sku).toBeNull();
    for (const change of result.changes) {
      expect(change.sourceKey.startsWith("sku:")).toBe(false);
      expect(String(change.after?.sourceKey ?? "/").startsWith("sku:")).toBe(false);
    }
  });

  it("refuses the pairing when the page states a different code", async () => {
    // Same name, brand and pack size at a new URL: a textbook fingerprint
    // match. But our row is 00011 and this page says 00072.
    const sameName = product("/amann-cascada-500/");
    const { reader } = source({ "/amann-cascada-500/": fixture("product-amann-cascada.html") });
    const existing = [stored(before, "00011")];

    // Without the lookup the fingerprint pairs them.
    expect(diffCatalog([sameName], existing, THRESHOLD).counts.moved).toBe(1);

    const lookup = await lookupDiscoveredSkus({
      discovered: [sameName],
      existing,
      reader,
      maxCandidates: 10,
    });
    const result = diffCatalog([sameName], existing, {
      ...THRESHOLD,
      discoveredSkus: lookup.skus,
    });

    expect(result.counts).toMatchObject({ moved: 0, created: 1, marked_missing: 1 });
    expect(result.unresolvedMoves).toEqual([]);
  });

  it("makes no request at all when the candidates exceed the cap", async () => {
    const pages = Object.fromEntries(
      [1, 2, 3].map((n) => [`/renamed-${n}/`, fixture("product-amann-cascada.html")]),
    );
    const { reader, requests } = source(pages);
    const olds = [1, 2, 3].map((n) =>
      stored(product(`/old-${n}/`, { name: `Coffee ${n} 1кг.`, weightText: "1 кг." }), `0000${n}`),
    );
    const news = [1, 2, 3].map((n) =>
      product(`/renamed-${n}/`, { name: `Coffee ${n} 1кг.`, weightText: "1 кг." }),
    );

    const lookup = await lookupDiscoveredSkus({
      discovered: news,
      existing: olds,
      reader,
      maxCandidates: 2,
    });

    expect(lookup).toMatchObject({ looked: 0, found: 0, skipped: "over_cap", candidateCount: 3 });
    expect(lookup.skus.size).toBe(0);
    expect(requests).toEqual([]);
    // ...and the name-based passes still pair every one of them.
    const result = diffCatalog(news, olds, { ...THRESHOLD, discoveredSkus: lookup.skus });
    expect(result.counts).toMatchObject({ moved: 3, created: 0 });
    expect(result.moved.every((move) => move.movedFrom?.matchedBy === "fingerprint")).toBe(true);
  });

  it("is bounded by the reader's remaining budget as well as by the cap", async () => {
    const page = fixture("product-amann-cascada.html");
    const { reader, requests } = source({ "/a-new/": page, "/b-new/": page }, 1);
    const olds = [stored(product("/a/", { name: "A 1кг." }), "00072")];
    const news = [product("/a-new/", { name: "A2 1кг." }), product("/b-new/", { name: "B2 1кг." })];

    const lookup = await lookupDiscoveredSkus({
      discovered: news,
      existing: olds,
      reader,
      maxCandidates: 10,
    });

    // Two candidates, one request left: over what can be afforded, so none.
    expect(lookup.skipped).toBe("over_cap");
    expect(requests).toEqual([]);
  });

  it("carries on when a candidate's page fails: that product is simply not paired by code", async () => {
    const { reader } = source({});
    const existing = [stored(before, "00072")];

    const lookup = await lookupDiscoveredSkus({
      discovered: [after],
      existing,
      reader,
      maxCandidates: 10,
    });

    expect(lookup).toMatchObject({ looked: 1, found: 0, skipped: null });
    expect(reader.failures).toHaveLength(1);
    const result = diffCatalog([after], existing, { ...THRESHOLD, discoveredSkus: lookup.skus });
    expect(result.counts).toMatchObject({ moved: 0, created: 1, marked_missing: 1 });
  });
});

describe("column ownership", () => {
  it("does not let the listing-driven write touch what enrichment stores", () => {
    // Compile-time proof, checked by `tsc`: each of these is an error.
    // @ts-expect-error the product code belongs to enrichment
    const sku: ProductMoveColumns = { sku: null };
    // @ts-expect-error so do the facts read from the product page
    const facts: ProductMoveColumns = { arabicaPercent: null };
    // @ts-expect-error and the characteristics list
    const list: ProductMoveColumns = { characteristics: [] };
    // @ts-expect-error and the enrichment clock
    const clock: ProductMoveColumns = { enrichedAt: null };
    expect([sku, facts, list, clock]).toHaveLength(4);

    // What the listing does own is still writable.
    const owned: ProductMoveColumns = { name: "x", attributes: {}, semanticHash: "h" };
    expect(Object.keys(owned)).toEqual(["name", "attributes", "semanticHash"]);
  });

  it("keeps the product code out of the snapshot the diff compares", () => {
    const listed = { ...product("/a/"), sku: "00072" };
    expect(productSnapshot(listed)).not.toHaveProperty("sku");
  });
});
