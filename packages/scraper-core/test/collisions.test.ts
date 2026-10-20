import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseMoney, silentLogger } from "@catalog/shared";
import {
  type KeyedProducts,
  resolveDuplicateKeys,
  settleKeyCollisions,
} from "../src/catalog/collisions.ts";
import {
  type DiffResult,
  type ExistingProduct,
  diffCatalog,
  productSnapshot,
} from "../src/catalog/diff.ts";
import { discoverCatalog } from "../src/catalog/discover.ts";
import {
  identityToken,
  parseSplitSourceKey,
  resolveProductIdentity,
  splitDiscriminator,
  splitSourceKey,
} from "../src/catalog/identity.ts";
import { parsePathSourceKey } from "../src/catalog/link.ts";
import { type NormalizedProduct, normalizeProduct } from "../src/catalog/normalize.ts";
import { loadConfig } from "../src/config.ts";
import { Fetcher } from "../src/fetch/fetcher.ts";
import { parseFilterInit } from "../src/parsers/filterInit.ts";
import { type FakeProduct, createFakeFetch } from "./helpers/fakeSource.ts";

/**
 * Two products at one address (research 08 §1.4), without a database.
 *
 * The source lists Moreno Espresso Bar (€20.00) and Moreno Super Bar (€25.00),
 * both 1 kg, at `/moreno-super-bar-1/`. The production catalog holds the
 * Espresso Bar under the plain key and has never held the Super Bar. These
 * tests run discovery's de-duplication, the settling against what is stored,
 * and the diff — the three steps a sync takes — on that case, on its edges,
 * and on the real catalog.
 */

const BASE = "https://www.kafezona.com";
const ADDRESS = "/moreno-super-bar-1/";
const PLAIN = "/moreno-super-bar-1/#1000g";
const ESPRESSO_KEY = `${PLAIN}~name:kafenazarnamorenoespressobar1kg`;
const SUPER_KEY = `${PLAIN}~name:kafenazarnamorenosuperbar1kg`;
const THRESHOLD = { missingThreshold: 3 } as const;

type Raw = Parameters<typeof normalizeProduct>[0];

/** A record as the source lists it at the shared address. */
function listed(name: string, overrides: Partial<Raw> = {}): NormalizedProduct {
  return normalizeProduct(
    {
      path: ADDRESS,
      url: `${BASE}${ADDRESS}`,
      name,
      priceText: "€20.00",
      availabilityText: "in_stock",
      weightText: "1 кг.",
      brandKey: "cafe-moreno",
      categoryKeys: ["kafe-na-zyrna"],
      descriptionText: "Неаполитанско еспресо с плътен каймак.",
      imageUrls: [`${BASE}/img/product-img-1577.jpg-800w.jpg`],
      ...overrides,
    },
    { sourceSite: "kafezona", defaultCurrency: "EUR" },
  );
}

const espressoBar = (overrides: Partial<Raw> = {}) =>
  listed("Кафе на зърна Moreno Espresso Bar 1кг.", overrides);
const superBar = (overrides: Partial<Raw> = {}) =>
  listed("Кафе на зърна Moreno Super Bar 1кг.", {
    priceText: "€25.00",
    imageUrls: [`${BASE}/img/product-img-1578.jpg-800w.jpg`],
    ...overrides,
  });

/** A stored row for a product, under the key it was stored with. */
function stored(
  product: NormalizedProduct,
  overrides: Partial<ExistingProduct> = {},
): ExistingProduct {
  return {
    id: `row:${product.sourceKey}`,
    sourceKey: product.sourceKey,
    sourcePath: product.sourcePath,
    semanticHash: product.semanticHash,
    status: "active",
    consecutiveMissingCount: 0,
    sku: null,
    snapshot: productSnapshot(product),
    ...overrides,
  };
}

/** One sync, as far as identity goes: de-duplicate, settle, diff. */
function sync(
  records: readonly NormalizedProduct[],
  existing: readonly ExistingProduct[],
): { keyed: KeyedProducts; diff: DiffResult; rows: ExistingProduct[] } {
  const keyed = settleKeyCollisions(resolveDuplicateKeys(records), existing, silentLogger);
  const diff = diffCatalog(keyed.products, existing, THRESHOLD);
  return { keyed, diff, rows: apply(existing, diff) };
}

/** The stored catalog after a diff is written, as the repository writes it. */
function apply(existing: readonly ExistingProduct[], diff: DiffResult): ExistingProduct[] {
  const byId = new Map(existing.map((row) => [row.id, row]));
  for (const change of diff.changes) {
    if (change.product) {
      const id = change.productId ?? `row:${change.product.sourceKey}`;
      byId.set(id, {
        ...stored(change.product),
        id,
        status: change.nextStatus,
        consecutiveMissingCount: change.nextMissingCount,
        sku: byId.get(id)?.sku ?? null,
      });
    } else if (change.productId) {
      const row = byId.get(change.productId) as ExistingProduct;
      byId.set(change.productId, {
        ...row,
        status: change.nextStatus,
        consecutiveMissingCount: change.nextMissingCount,
      });
    }
  }
  return [...byId.values()];
}

const keysOf = (products: readonly NormalizedProduct[]) => products.map((p) => p.sourceKey);

const changeFor = (diff: DiffResult, productId: string) =>
  diff.changes.find((change) => change.productId === productId);

describe("split source keys", () => {
  it("carry the plain key, the tie-breaker and the discriminator", () => {
    expect(
      splitSourceKey(PLAIN, splitDiscriminator("name", "Кафе на зърна Moreno Super Bar 1кг.")),
    ).toBe(SUPER_KEY);
    expect(parseSplitSourceKey(SUPER_KEY)).toEqual({
      plainKey: PLAIN,
      tiebreaker: "name",
      discriminator: "name:kafenazarnamorenosuperbar1kg",
    });
  });

  it("give a key with no pack size an empty one, so the path still reads as the path", () => {
    const key = splitSourceKey("/rema-caffe-intenso/", "code:00072");
    expect(key).toBe("/rema-caffe-intenso/#~code:00072");
    expect(parseSplitSourceKey(key)).toEqual({
      plainKey: "/rema-caffe-intenso/",
      tiebreaker: "code",
      discriminator: "code:00072",
    });
  });

  it("are told from every other key", () => {
    for (const key of [PLAIN, "/x/", "id:1182", "/a~b/#1000g", "/a~b/", `${PLAIN}~size:2`]) {
      expect(parseSplitSourceKey(key)).toBeNull();
    }
  });

  it("are built and matched by one normaliser, deaf to case, spacing and punctuation", () => {
    for (const spelling of [
      "Кафе на зърна Moreno Super Bar 1кг.",
      "Кафе на зърна Moreno Super Bar 1кг",
      "Кафе на зърна Moreno Super Bar 1 кг.",
      "КАФЕ НА ЗЪРНА  Moreno Super-Bar 1 кг",
    ]) {
      expect(identityToken(spelling)).toBe("kafenazarnamorenosuperbar1kg");
    }
    expect(identityToken("Кафе на зърна Moreno Espresso Bar 1кг.")).not.toBe(
      identityToken("Кафе на зърна Moreno Super Bar 1кг."),
    );
  });

  it("keep the mark between two digits: 7,5 is not 75, and 2,50 г is not 250 г", () => {
    expect(identityToken("Lungo 7,5")).toBe("lungo7p5");
    expect(identityToken("Lungo 7.5")).toBe("lungo7p5");
    expect(identityToken("Lungo 75")).toBe("lungo75");
    expect(identityToken("Какао 2,50г")).not.toBe(identityToken("Какао 250г"));
    // Still deaf to the space between a number and its unit, and to a
    // thousands separator.
    expect(identityToken("Кафе 1кг.")).toBe(identityToken("Кафе 1 кг."));
    expect(identityToken("Кафе 1 000 г")).toBe(identityToken("Кафе 1000 г"));
    // And the Super Bar's key is the one it had.
    expect(splitDiscriminator("name", "Кафе на зърна Moreno Super Bar 1кг.")).toBe(
      "name:kafenazarnamorenosuperbar1kg",
    );
  });

  it("can be linked by hand, unchanged, with the pack size alone as the variant", () => {
    expect(parsePathSourceKey(SUPER_KEY)).toEqual({
      sourceKey: SUPER_KEY,
      sourcePath: ADDRESS,
      sourceVariantKey: "1000g",
    });
    expect(parsePathSourceKey("/rema-caffe-intenso/#~code:00072")).toEqual({
      sourceKey: "/rema-caffe-intenso/#~code:00072",
      sourcePath: "/rema-caffe-intenso/",
      sourceVariantKey: null,
    });
  });
});

describe("resolveDuplicateKeys: records that share a key", () => {
  it("keeps two different products at one address and size, each under a key of its own", () => {
    const { products, duplicateKeys, keyCollisions } = resolveDuplicateKeys([
      espressoBar(),
      superBar(),
    ]);

    expect(keysOf(products)).toEqual([ESPRESSO_KEY, SUPER_KEY]);
    expect(products.map((p) => p.currentPrice?.amount)).toEqual(["20.00", "25.00"]);
    expect(duplicateKeys).toEqual([PLAIN]);
    expect(keyCollisions).toEqual([
      {
        sourceKey: PLAIN,
        tiebreaker: "name",
        products: [
          {
            sourceKey: ESPRESSO_KEY,
            name: "Кафе на зърна Moreno Espresso Bar 1кг.",
            price: "20.00",
          },
          { sourceKey: SUPER_KEY, name: "Кафе на зърна Moreno Super Bar 1кг.", price: "25.00" },
        ],
        dropped: [],
        unresolved: [],
      },
    ]);
  });

  it("gives the same keys, in the same order, whichever way round the source lists them", () => {
    const forward = resolveDuplicateKeys([espressoBar(), superBar()]);
    const backward = resolveDuplicateKeys([superBar(), espressoBar()]);
    expect(backward).toEqual(forward);
  });

  it("tells two products apart by the product code when the listing states one for each", () => {
    const { products, keyCollisions } = resolveDuplicateKeys([
      espressoBar({ sku: "00072" }),
      // Same name, so only the code can tell these two apart.
      espressoBar({ sku: "00073", priceText: "€21.00" }),
    ]);
    expect(keysOf(products)).toEqual([`${PLAIN}~code:00072`, `${PLAIN}~code:00073`]);
    expect(keyCollisions[0]?.tiebreaker).toBe("code");
    expect(keyCollisions[0]?.unresolved).toEqual([]);
  });

  it("prefers the code to the name, and falls back to the name when a code is missing", () => {
    const coded = resolveDuplicateKeys([espressoBar({ sku: "00072" }), superBar({ sku: "00073" })]);
    expect(keysOf(coded.products)).toEqual([`${PLAIN}~code:00072`, `${PLAIN}~code:00073`]);

    const partly = resolveDuplicateKeys([espressoBar({ sku: "00072" }), superBar()]);
    expect(keysOf(partly.products)).toEqual([ESPRESSO_KEY, SUPER_KEY]);
    expect(partly.keyCollisions[0]?.tiebreaker).toBe("name");
  });

  it("keeps two products whose names differ only in a decimal comma, and pairs them again", () => {
    for (const [one, other] of [
      ["Кафе на зърна Moreno Intenso 7,5 1кг.", "Кафе на зърна Moreno Intenso 75 1кг."],
      ["Кафе на зърна Moreno Dolce 2,50г 1кг.", "Кафе на зърна Moreno Dolce 250г 1кг."],
    ] as const) {
      const first = listed(one);
      const second = listed(other, { priceText: "€21.00" });
      const { products, keyCollisions } = resolveDuplicateKeys([first, second]);
      expect(products).toHaveLength(2);
      expect(new Set(keysOf(products)).size).toBe(2);
      expect(keyCollisions[0]).toMatchObject({ tiebreaker: "name", dropped: [], unresolved: [] });

      // Stored, they pair with their own rows on every run after, either way round.
      const rows = products.map((product) => stored(product));
      for (const order of [
        [first, second],
        [second, first],
      ]) {
        const { keyed, diff } = sync(order, rows);
        expect(keysOf(keyed.products).sort()).toEqual(keysOf(products).sort());
        expect(diff.counts).toMatchObject({ unchanged: 2, created: 0, marked_missing: 0 });
      }
    }
  });

  it("still collapses the same product typed twice, silently", () => {
    const { products, duplicateKeys, keyCollisions } = resolveDuplicateKeys([
      espressoBar(),
      espressoBar(),
    ]);
    expect(keysOf(products)).toEqual([PLAIN]);
    expect(duplicateKeys).toEqual([PLAIN]);
    expect(keyCollisions).toEqual([]);
  });

  it("keeps the first of two records nothing tells apart, as before, and says so — in either order", () => {
    const twenty = espressoBar();
    const twentyOne = espressoBar({ priceText: "€21.00" });

    for (const [first, second] of [
      [twenty, twentyOne],
      [twentyOne, twenty],
    ] as const) {
      const { products, keyCollisions } = resolveDuplicateKeys([first, second]);
      // The current behaviour, exactly: the plain key, the first record.
      expect(products).toEqual([first]);
      expect(keyCollisions).toHaveLength(1);
      expect(keyCollisions[0]).toMatchObject({
        sourceKey: PLAIN,
        tiebreaker: null,
        unresolved: ["indistinguishable"],
        dropped: [{ price: second.currentPrice?.amount, keptAs: PLAIN }],
      });
      expect(keyCollisions[0]?.dropped[0]?.differsIn).toContain("currentPrice");
    }
  });

  it("merges without an alarm two records that differ only where the offer does not", () => {
    // The HTML fallback meets a product listed in two categories this way.
    const { products, keyCollisions } = resolveDuplicateKeys([
      espressoBar(),
      espressoBar({ categoryKeys: ["vending-zona"] }),
    ]);
    expect(keysOf(products)).toEqual([PLAIN]);
    expect(keyCollisions[0]).toMatchObject({ tiebreaker: null, unresolved: [] });
    expect(keyCollisions[0]?.dropped[0]?.differsIn).toEqual(["categoryKeys"]);
  });

  it("splits the products it can tell apart and reports the pair it cannot", () => {
    const { products, keyCollisions } = resolveDuplicateKeys([
      espressoBar(),
      superBar(),
      espressoBar({ priceText: "€21.00" }),
    ]);
    expect(keysOf(products)).toEqual([ESPRESSO_KEY, SUPER_KEY]);
    expect(products[0]?.currentPrice?.amount).toBe("20.00");
    expect(keyCollisions[0]).toMatchObject({
      tiebreaker: "name",
      unresolved: ["indistinguishable"],
      dropped: [{ price: "21.00", keptAs: ESPRESSO_KEY }],
    });
  });

  it("never splits the source's own identifier", () => {
    const { products, keyCollisions } = resolveDuplicateKeys([
      espressoBar({ sourceId: "1182" }),
      superBar({ sourceId: "1182" }),
    ]);
    expect(keysOf(products)).toEqual(["id:1182"]);
    expect(keyCollisions[0]?.unresolved).toEqual(["indistinguishable"]);
  });

  it("passes every key with one record through untouched, in the source's order", () => {
    const others = [
      listed("Кафе на зърна Moreno Extra Bar 1кг.", { path: "/moreno-extra-bar/" }),
      listed("Кафе на зърна Moreno Vending 1кг.", { path: "/moreno-vending/" }),
    ];
    const { products } = resolveDuplicateKeys([others[0]!, espressoBar(), superBar(), others[1]!]);
    expect(products[0]).toBe(others[0]);
    expect(products[3]).toBe(others[1]);
    expect(keysOf(products)).toEqual([
      "/moreno-extra-bar/#1000g",
      ESPRESSO_KEY,
      SUPER_KEY,
      "/moreno-vending/#1000g",
    ]);
  });
});

describe("settleKeyCollisions: the stored catalog decides who keeps the plain key", () => {
  /** Production today: the Espresso Bar under the plain key, no Super Bar. */
  const production = () => [stored(espressoBar())];

  it("keeps the Espresso Bar's key, row, name and price, in either order, run after run", () => {
    for (const order of [
      [espressoBar(), superBar()],
      [superBar(), espressoBar()],
    ]) {
      let rows = production();
      const espressoRow = rows[0] as ExistingProduct;

      for (const runNumber of [1, 2, 3]) {
        // Each run may list the two either way round.
        const records = runNumber === 2 ? [...order].reverse() : order;
        const { keyed, diff, rows: after } = sync(records, rows);

        expect(keysOf(keyed.products).sort()).toEqual([PLAIN, SUPER_KEY]);
        const espresso = changeFor(diff, espressoRow.id);
        expect(espresso?.changeType).toBe("unchanged");
        expect(espresso?.sourceKey).toBe(PLAIN);
        expect(espresso?.after).toMatchObject({
          name: "Кафе на зърна Moreno Espresso Bar 1кг.",
          currentPrice: "20.00",
        });
        expect(diff.missing).toEqual([]);
        expect(diff.removed).toEqual([]);
        expect(diff.moved).toEqual([]);
        expect(diff.updated).toEqual([]);

        const superChange = diff.changes.find((change) => change.sourceKey === SUPER_KEY);
        expect(superChange?.changeType).toBe(runNumber === 1 ? "created" : "unchanged");
        expect(superChange?.after).toMatchObject({
          name: "Кафе на зърна Moreno Super Bar 1кг.",
          currentPrice: "25.00",
        });
        expect(keyed.keyCollisions[0]?.unresolved).toEqual([]);
        rows = after;
      }
      expect(rows).toHaveLength(2);
    }
  });

  it("leaves both under their split keys when nothing is stored", () => {
    const { keyed, diff } = sync([superBar(), espressoBar()], []);
    expect(keysOf(keyed.products)).toEqual([ESPRESSO_KEY, SUPER_KEY]);
    expect(diff.counts.created).toBe(2);
    expect(keyed.keyCollisions[0]?.unresolved).toEqual([]);
  });

  it("does not hand the stored row to a record with its code but another name", () => {
    // At a shared address a code alone is not the product: the name must agree.
    const holder = stored(espressoBar(), { sku: "00072" });
    const { keyed, diff } = sync(
      [
        listed("Кафе на зърна Moreno Classic Bar 1кг.", { sku: "00072" }),
        superBar({ sku: "00073" }),
      ],
      [holder],
    );
    expect(keysOf(keyed.products)).toEqual([`${PLAIN}~code:00072`, `${PLAIN}~code:00073`]);
    // The row keeps what it is, and goes the way of a product no longer listed.
    expect(changeFor(diff, holder.id)).toMatchObject({
      changeType: "marked_missing",
      after: { name: "Кафе на зърна Moreno Espresso Bar 1кг.", currentPrice: "20.00" },
    });
    expect([...diff.updated, ...diff.moved]).toEqual([]);
    expect(diff.created.map((change) => change.sourceKey).sort()).toEqual([
      `${PLAIN}~code:00072`,
      `${PLAIN}~code:00073`,
    ]);
    expect(keyed.keyCollisions[0]?.unresolved).toEqual(["unmatched"]);
  });

  it("N10b today: a listing that gives the Super Bar the Espresso Bar's stored code swaps nothing", () => {
    // Production now: the Espresso Bar alone, holding the code its page prints.
    const holder = stored(espressoBar(), { sku: "00417" });
    const { keyed, diff } = sync(
      [espressoBar({ sku: "00418" }), superBar({ sku: "00417" })],
      [holder],
    );
    // The Espresso Bar's row is neither renamed nor repriced nor moved.
    expect(changeFor(diff, holder.id)).toMatchObject({
      changeType: "marked_missing",
      after: { name: "Кафе на зърна Moreno Espresso Bar 1кг.", currentPrice: "20.00" },
    });
    expect([...diff.updated, ...diff.moved, ...diff.restored]).toEqual([]);
    // The Super Bar is created, under a key of its own, at its own price.
    expect(
      diff.created.find((change) => change.sourceKey === `${PLAIN}~code:00417`)?.after,
    ).toMatchObject({
      name: "Кафе на зърна Moreno Super Bar 1кг.",
      currentPrice: "25.00",
    });
    // And the address is raised for a person: a stored product vanished there.
    expect(keyed.keyCollisions[0]?.unresolved).toEqual(["unmatched"]);
  });

  it("does not guess when the stored product is not among the records, and says so", () => {
    // The source renamed the Espresso Bar in the run that also added the Super Bar.
    const holder = stored(espressoBar());
    const renamed = espressoBar({ name: "Кафе на зърна Moreno Espresso Bar Classic 1кг." });
    const { keyed, diff } = sync([renamed, superBar()], [holder]);

    expect(keysOf(keyed.products)).not.toContain(PLAIN);
    expect(keyed.keyCollisions[0]?.unresolved).toEqual(["unmatched"]);
    // Nobody takes the stored row: it goes missing, and nothing is renamed into it.
    expect(changeFor(diff, holder.id)?.changeType).toBe("marked_missing");
    expect(diff.updated).toEqual([]);
    expect(diff.counts.created).toBe(2);
  });

  it("gives the plain key to nobody when two records could each be the stored one", () => {
    const holder = stored(espressoBar());
    const { keyed } = sync(
      [espressoBar({ sku: "00072" }), espressoBar({ sku: "00073", priceText: "€21.00" })],
      [holder],
    );
    expect(keysOf(keyed.products)).toEqual([`${PLAIN}~code:00072`, `${PLAIN}~code:00073`]);
    expect(keyed.keyCollisions[0]?.unresolved).toEqual(["unmatched"]);
  });

  describe("after the split", () => {
    /** Both stored: the Espresso Bar under the plain key, the Super Bar under its own. */
    const split = () => sync([espressoBar(), superBar()], production()).rows;

    it("keeps the Super Bar out of the Espresso Bar's row when it is left alone at the address", () => {
      // The source moves the Espresso Bar to an address of its own.
      const rows = split();
      const moved = espressoBar({
        path: "/moreno-espresso-bar/",
        url: `${BASE}/moreno-espresso-bar/`,
      });
      const { keyed, diff } = sync([superBar(), moved], rows);

      expect(keysOf(keyed.products)).toEqual([SUPER_KEY, "/moreno-espresso-bar/#1000g"]);
      expect(diff.changes.find((c) => c.sourceKey === SUPER_KEY)?.changeType).toBe("unchanged");
      // The Espresso Bar's row follows it to its new address, by move detection.
      expect(diff.moved).toHaveLength(1);
      expect(diff.moved[0]?.productId).toBe(`row:${PLAIN}`);
      expect(diff.updated).toEqual([]);
    });

    it("keeps the Espresso Bar on the plain key when it is the one left", () => {
      const rows = split();
      const { keyed, diff } = sync([espressoBar()], rows);
      expect(keysOf(keyed.products)).toEqual([PLAIN]);
      expect(changeFor(diff, `row:${PLAIN}`)?.changeType).toBe("unchanged");
      expect(diff.missing.map((c) => c.sourceKey)).toEqual([SUPER_KEY]);
    });

    it("gives a lone product it cannot place a key of its own, never the Espresso Bar's row", () => {
      const rows = split();
      const stranger = listed("Кафе на зърна Moreno Gold Bar 1кг.", { priceText: "€30.00" });
      const { keyed, diff } = sync([stranger], rows);

      const strangerKey = `${PLAIN}~name:kafenazarnamorenogoldbar1kg`;
      expect(keysOf(keyed.products)).toEqual([strangerKey]);
      // The rows: the Espresso Bar's is neither renamed nor repriced; it and
      // the Super Bar's go missing, and the stranger is a product of its own.
      expect(changeFor(diff, `row:${PLAIN}`)).toMatchObject({
        changeType: "marked_missing",
        after: { name: "Кафе на зърна Moreno Espresso Bar 1кг.", currentPrice: "20.00" },
      });
      expect(changeFor(diff, `row:${SUPER_KEY}`)?.changeType).toBe("marked_missing");
      expect(diff.created.map((change) => change.sourceKey)).toEqual([strangerKey]);
      expect(diff.updated).toEqual([]);
      expect(diff.restored).toEqual([]);
      expect(keyed.keyCollisions).toEqual([
        {
          sourceKey: PLAIN,
          tiebreaker: "name",
          products: [
            { sourceKey: strangerKey, name: "Кафе на зърна Moreno Gold Bar 1кг.", price: "30.00" },
          ],
          dropped: [],
          unresolved: ["unmatched"],
        },
      ]);
    });
  });

  /*
   * The hostile review's scenarios (m2/t05, H1, L5), each as the rows come out
   * of it. All start from the split: the Espresso Bar stored under the plain
   * key, the Super Bar under its own.
   */
  describe("cosmetic edits, absences and codes at the shared address", () => {
    const split = () => sync([espressoBar(), superBar()], production()).rows;
    const ESPRESSO_ROW = `row:${PLAIN}`;
    const SUPER_ROW = `row:${SUPER_KEY}`;

    it("S1: the source drops the Espresso Bar's trailing dot — the same row, renamed in place", () => {
      for (const name of [
        "Кафе на зърна Moreno Espresso Bar 1кг",
        "Кафе на зърна Moreno Espresso Bar 1 кг.",
      ]) {
        const { keyed, diff, rows } = sync([espressoBar({ name }), superBar()], split());
        expect(keysOf(keyed.products)).toEqual([PLAIN, SUPER_KEY]);
        expect(changeFor(diff, ESPRESSO_ROW)).toMatchObject({
          changeType: "updated",
          changedFields: ["name", "semanticHash"],
          after: { name, currentPrice: "20.00" },
        });
        expect(changeFor(diff, SUPER_ROW)?.changeType).toBe("unchanged");
        expect([...diff.created, ...diff.missing, ...diff.removed]).toEqual([]);
        expect(keyed.keyCollisions[0]?.unresolved).toEqual([]);

        // S3: and the run after it changes nothing.
        const again = sync([espressoBar({ name }), superBar()], rows);
        expect(again.diff.counts).toMatchObject({ unchanged: 2, created: 0, marked_missing: 0 });
      }
    });

    it("S2b: the Espresso Bar absent for a run while the Super Bar loses its dot — no row swaps", () => {
      const name = "Кафе на зърна Moreno Super Bar 1кг";
      const { keyed, diff } = sync([superBar({ name })], split());
      expect(keysOf(keyed.products)).toEqual([SUPER_KEY]);
      expect(changeFor(diff, SUPER_ROW)).toMatchObject({
        changeType: "updated",
        after: { name, currentPrice: "25.00" },
      });
      // The Espresso Bar's row is only missing: not renamed, not repriced.
      expect(changeFor(diff, ESPRESSO_ROW)).toMatchObject({
        changeType: "marked_missing",
        after: { name: "Кафе на зърна Moreno Espresso Bar 1кг.", currentPrice: "20.00" },
      });
      expect(diff.created).toEqual([]);
      expect(keyed.keyCollisions[0]?.unresolved).toEqual([]);
    });

    it("S2c: the Espresso Bar comes back — its own row is restored, nothing is created", () => {
      const name = "Кафе на зърна Moreno Super Bar 1кг";
      const absent = sync([superBar({ name })], split()).rows;
      const { keyed, diff } = sync([espressoBar(), superBar({ name })], absent);
      expect(keysOf(keyed.products)).toEqual([PLAIN, SUPER_KEY]);
      expect(changeFor(diff, ESPRESSO_ROW)).toMatchObject({
        changeType: "restored",
        after: { name: "Кафе на зърна Moreno Espresso Bar 1кг.", currentPrice: "20.00" },
      });
      expect(changeFor(diff, SUPER_ROW)?.changeType).toBe("unchanged");
      expect([...diff.created, ...diff.missing]).toEqual([]);
    });

    it("S2: the Espresso Bar removed, then the Super Bar renamed — the removed row stays removed", () => {
      let rows = split();
      for (let run = 0; run < 3; run += 1) rows = sync([superBar()], rows).rows;
      expect(rows.find((row) => row.id === ESPRESSO_ROW)?.status).toBe("removed");

      const crema = superBar({ name: "Кафе на зърна Moreno Super Bar Crema 1кг." });
      const { keyed, diff } = sync([crema], rows);
      const cremaKey = `${PLAIN}~name:kafenazarnamorenosuperbarcrema1kg`;
      expect(keysOf(keyed.products)).toEqual([cremaKey]);
      expect(diff.restored).toEqual([]);
      expect(diff.updated).toEqual([]);
      expect(changeFor(diff, ESPRESSO_ROW)).toBeUndefined();
      expect(changeFor(diff, SUPER_ROW)?.changeType).toBe("marked_missing");
      expect(diff.created.map((change) => change.sourceKey)).toEqual([cremaKey]);
      // A stored product vanished as a new one arrived: a person decides.
      expect(keyed.keyCollisions[0]?.unresolved).toEqual(["unmatched"]);
    });

    it("S5 (L5): the listing starts stating codes — both keep their keys, and nothing is raised", () => {
      const { keyed, diff } = sync(
        [espressoBar({ sku: "00072" }), superBar({ sku: "00073" })],
        split(),
      );
      expect(keysOf(keyed.products)).toEqual([PLAIN, SUPER_KEY]);
      expect(diff.moved).toEqual([]);
      expect([...diff.created, ...diff.missing]).toEqual([]);
      expect(keyed.keyCollisions[0]?.unresolved).toEqual([]);
    });

    it("N10b after the split: the Super Bar given the Espresso Bar's code takes no row", () => {
      // The Espresso Bar's row holds the code its page printed while it was alone.
      const rows = split().map((row) => (row.sourceKey === PLAIN ? { ...row, sku: "00072" } : row));
      const { keyed, diff } = sync(
        [espressoBar({ sku: "00071" }), superBar({ sku: "00072" })],
        rows,
      );
      // The Super Bar's record has the Espresso Bar's code, but not its name:
      // it pairs with the Super Bar's own row, by name, and nothing else.
      expect(keysOf(keyed.products)).toEqual([`${PLAIN}~code:00071`, SUPER_KEY]);
      expect(changeFor(diff, SUPER_ROW)).toMatchObject({
        changeType: "updated",
        after: { name: "Кафе на зърна Moreno Super Bar 1кг.", currentPrice: "25.00" },
      });
      // The Espresso Bar's row keeps its name and its €20, and is not moved:
      // the code its row holds contradicts the one the listing now gives it,
      // so it goes the way of a product no longer listed, and the record is
      // created under its own key — a duplicate a person links, not a swap.
      expect(changeFor(diff, ESPRESSO_ROW)).toMatchObject({
        changeType: "marked_missing",
        after: { name: "Кафе на зърна Moreno Espresso Bar 1кг.", currentPrice: "20.00" },
      });
      expect(diff.moved).toEqual([]);
      expect(diff.created.map((change) => change.sourceKey)).toEqual([`${PLAIN}~code:00071`]);
      // Raised: a stored product vanished at the address as a new one arrived.
      expect(keyed.keyCollisions[0]?.unresolved).toEqual(["unmatched"]);
    });

    it("S6: one name in two scripts cannot tell two products apart — the first is kept, and raised", () => {
      const { keyed, diff } = sync(
        [
          espressoBar({ name: "Кафе на зърна Moreno Super Bar 1кг." }),
          superBar({ name: "Кафе на зърна Moreno Супер Бар 1кг." }),
        ],
        production(),
      );
      expect(keysOf(keyed.products)).toEqual([PLAIN]);
      expect(keyed.keyCollisions[0]?.unresolved).toEqual(["indistinguishable"]);
      // As before the fix for exactly this case, and alarmed twice over: the
      // rename is named by `identity_changed` as well.
      expect(changeFor(diff, ESPRESSO_ROW)?.changeType).toBe("updated");
    });
  });
});

describe("the same product typed twice, spelt two ways (M4)", () => {
  const ADDRESS_GOLD = "/excelsior-gold/";
  const doses = (name: string, overrides: Partial<Raw> = {}) =>
    normalizeProduct(
      {
        path: ADDRESS_GOLD,
        url: `${BASE}${ADDRESS_GOLD}`,
        name,
        priceText: "€51.00",
        availabilityText: "in_stock",
        weightText: "150 бр.",
        brandKey: "excelsior",
        categoryKeys: ["kafe-dozi"],
        imageUrls: [`${BASE}/img/product-img-900.jpg-800w.jpg`],
        ...overrides,
      },
      { sourceSite: "kafezona", defaultCurrency: "EUR" },
    );
  const tight = doses("Дозети Excelsior Porto Rico 150бр.");
  const spaced = doses("Дозети Excelsior Porto Rico 150 бр.");

  it("collapses into the one product, under the plain key, without an alarm — in either order", () => {
    for (const records of [
      [tight, spaced],
      [spaced, tight],
    ]) {
      const { keyed, diff } = sync(records, [stored(tight)]);
      expect(keysOf(keyed.products)).toEqual(["/excelsior-gold/#150pc"]);
      expect(keyed.keyCollisions[0]).toMatchObject({
        tiebreaker: null,
        unresolved: [],
        dropped: [{ differsIn: ["name"] }],
      });
      expect([...diff.created, ...diff.missing]).toEqual([]);
    }
  });

  it("raises the pair when they also differ in what the shop shows", () => {
    for (const other of [
      doses("Дозети Excelsior Porto Rico 150 бр.", {
        imageUrls: [`${BASE}/img/product-img-901.jpg-800w.jpg`],
      }),
      doses("Дозети Excelsior Porto Rico 150 бр.", { descriptionText: "Друг текст." }),
      doses("Дозети Excelsior Porto Rico 150 бр.", { availabilityText: "out_of_stock" }),
    ]) {
      const { keyed } = sync([tight, other], [stored(tight)]);
      expect(keysOf(keyed.products)).toEqual(["/excelsior-gold/#150pc"]);
      expect(keyed.keyCollisions[0]?.unresolved).toEqual(["indistinguishable"]);
    }
  });
});

// --- The real catalog -------------------------------------------------------------

const REPOSITORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

interface ReferenceProduct {
  readonly sourceKey: string;
  readonly sourcePath: string;
  readonly sourceUrl: string;
  readonly sourceVariantKey: string | null;
  readonly identityStrategy: NormalizedProduct["identityStrategy"];
  readonly hasUrlCollision: boolean;
  readonly name: string;
  readonly slug: string | null;
  readonly currentPrice: string | null;
  readonly oldPrice: string | null;
  readonly currency: string | null;
  readonly availability: NormalizedProduct["availability"];
  readonly brandKey: string | null;
  readonly categoryKeys: string[];
  readonly descriptionText: string | null;
  readonly weight: string | null;
  readonly weightCanonical: string | null;
  readonly sku: string | null;
  readonly gtin: string | null;
  readonly attributes: Record<string, string>;
  readonly sourceImageUrls: string[];
  readonly semanticHash: string;
}

/** The reference snapshot of the source's catalog, as the current sync keyed it. */
const reference = (
  JSON.parse(readFileSync(path.join(REPOSITORY, "reference/latest/products.json"), "utf8")) as {
    products: ReferenceProduct[];
  }
).products;

function fromReference(record: ReferenceProduct): NormalizedProduct {
  return {
    sourceSite: "kafezona",
    sourceKey: record.sourceKey,
    sourceUrl: record.sourceUrl,
    sourcePath: record.sourcePath,
    sourceVariantKey: record.sourceVariantKey,
    identityStrategy: record.identityStrategy,
    hasUrlCollision: record.hasUrlCollision,
    name: record.name,
    slug: record.slug,
    currentPrice: parseMoney(record.currentPrice, { defaultCurrency: "EUR" }),
    oldPrice: parseMoney(record.oldPrice, { defaultCurrency: "EUR" }),
    currency: record.currency,
    availability: record.availability,
    brandKey: record.brandKey,
    brandName: null,
    categoryKeys: record.categoryKeys,
    descriptionHtml: null,
    descriptionText: record.descriptionText,
    weight: record.weightCanonical
      ? { raw: record.weight ?? "", value: "0", unit: "g", canonical: record.weightCanonical }
      : null,
    weightText: record.weight,
    packFieldText: record.weight,
    packSizeConflict: null,
    sku: record.sku,
    gtin: record.gtin,
    attributes: record.attributes,
    sourceImageUrls: record.sourceImageUrls,
    sourceData: {},
    semanticHash: record.semanticHash,
  } as NormalizedProduct;
}

describe("the real catalog: nobody else's key moves", () => {
  const catalog = reference.map(fromReference);
  const espresso = catalog.find((product) => product.sourceKey === PLAIN) as NormalizedProduct;

  it("is the catalog the research describes", () => {
    expect(catalog).toHaveLength(207);
    expect(espresso.name).toBe("Кафе на зърна Moreno Espresso Bar 1кг.");
    expect(espresso.slug).toBe("moreno-espresso-bar-kafe-na-zarna-1-kg");
    expect(new Set(keysOf(catalog)).size).toBe(207);
  });

  it("keys every product but the pair exactly as the current sync did, byte for byte", () => {
    const at = catalog.indexOf(espresso);
    for (const records of [
      [...catalog.slice(0, at), superBar(), ...catalog.slice(at)],
      [...catalog, superBar()],
    ]) {
      const { products, keyCollisions } = resolveDuplicateKeys(records);
      const others = products.filter((product) => product.sourcePath !== ADDRESS);
      expect(keysOf(others)).toEqual(keysOf(catalog.filter((p) => p !== espresso)));
      // The very same objects: nothing about them was rebuilt.
      for (const product of others) expect(catalog).toContain(product);
      expect(keyCollisions.map((collision) => collision.sourceKey)).toEqual([PLAIN]);
    }
  });

  it("settled against the catalog as stored, keeps all 207 keys and adds only the Super Bar", () => {
    const existing = catalog.map((product) => stored(product));
    for (const records of [
      [...catalog, superBar()],
      [superBar(), ...catalog.slice().reverse()],
    ]) {
      const { keyed, diff } = sync(records, existing);
      expect(keysOf(keyed.products).sort()).toEqual([...keysOf(catalog), SUPER_KEY].sort());
      expect(diff.counts).toEqual({
        created: 1,
        updated: 0,
        unchanged: 207,
        marked_missing: 0,
        removed: 0,
        restored: 0,
        moved: 0,
      });
      expect(diff.created[0]?.sourceKey).toBe(SUPER_KEY);
    }
  });
});

describe("discovery over the source's own catalog blob", () => {
  const FIXTURES = path.join(REPOSITORY, "fixtures/kafezona");
  const init = parseFilterInit(
    readFileSync(path.join(FIXTURES, "search-filter-init.html"), "utf8"),
  );
  if (!init) throw new Error("the fixture carries no FILTER_INIT");

  const blob = init.products as FakeProduct[];
  const moreno: FakeProduct[] = [
    {
      ...(blob[0] as FakeProduct),
      h1: "Кафе на зърна Moreno Espresso Bar 1кг.",
      url: ADDRESS,
      price: "€20.00",
      weight: "1 кг.",
      imageUrl: "/img/product-img-1577.jpg-800w.jpg",
    },
    {
      ...(blob[0] as FakeProduct),
      h1: "Кафе на зърна Moreno Super Bar 1кг.",
      url: ADDRESS,
      price: "€25.00",
      weight: "1 кг.",
      imageUrl: "/img/product-img-1578.jpg-800w.jpg",
    },
  ];

  async function discover(products: readonly FakeProduct[]) {
    const config = loadConfig(
      {
        baseUrl: "https://fake.test/",
        canonicalHost: "fake.test",
        hostAliases: [],
        minDelayMs: 0,
        maxRetries: 0,
        respectRobotsTxt: false,
      },
      {},
    );
    const { fetchImpl } = createFakeFetch({
      products,
      brands: init!.brands.map((brand) => ({
        id: brand.id ?? "",
        h1: brand.h1,
        slug: brand.slug,
        count: brand.count ?? 0,
      })),
      categories: init!.categories.map((category) => ({
        id: category.id ?? "",
        h1: category.h1,
        slug: category.slug,
        count: category.count ?? 0,
        children: category.children,
      })),
    });
    const fetcher = new Fetcher({ config, fetchImpl, logger: silentLogger });
    return discoverCatalog({ config, fetcher, logger: silentLogger });
  }

  it("keeps both Moreno products, flags their shared page, and keys the rest as before", async () => {
    const plain = await discover(blob);
    for (const records of [
      [...blob, ...moreno],
      [moreno[1] as FakeProduct, ...blob, moreno[0] as FakeProduct],
    ]) {
      const result = await discover(records);
      expect(result.rawRecordCount).toBe(blob.length + 2);
      expect(result.products).toHaveLength(plain.products.length + 2);

      const pair = result.products.filter((product) => product.sourcePath === ADDRESS);
      expect(keysOf(pair)).toEqual([ESPRESSO_KEY, SUPER_KEY]);
      expect(pair.every((product) => product.hasUrlCollision)).toBe(true);
      expect(result.duplicateKeys).toContain(PLAIN);
      expect(result.keyCollisions.map((collision) => collision.sourceKey)).toContain(PLAIN);

      // Every other product: the key the identity rule alone gives it.
      const others = result.products.filter((product) => product.sourcePath !== ADDRESS);
      expect(keysOf(others)).toEqual(keysOf(plain.products));
      for (const product of others) {
        expect(product.sourceKey).toBe(
          resolveProductIdentity({ path: product.sourcePath, weightText: product.packFieldText })
            .sourceKey,
        );
      }
    }
  });
});
