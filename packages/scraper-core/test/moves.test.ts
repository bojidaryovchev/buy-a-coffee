import { describe, expect, it } from "vitest";
import { evaluateCircuitBreaker } from "../src/catalog/circuitBreaker.ts";
import { type ExistingProduct, diffCatalog, productSnapshot } from "../src/catalog/diff.ts";
import { pairMoves } from "../src/catalog/moves.ts";
import { type NormalizedProduct, normalizeProduct } from "../src/catalog/normalize.ts";
import { loadConfig } from "../src/config.ts";
import {
  fixtureAsDiscovered,
  fixtureAsExisting,
  loadCatalogFixture,
} from "./helpers/catalogFixture.ts";

const OPTIONS = { sourceSite: "kafezona", defaultCurrency: "EUR" } as const;
const THRESHOLD = { missingThreshold: 3 } as const;

type Raw = Parameters<typeof normalizeProduct>[0];

function product(path: string, overrides: Partial<Raw> = {}): NormalizedProduct {
  return normalizeProduct(
    {
      path,
      url: `https://www.kafezona.com${path}`,
      name: "Кафе на зърна Lavazza Super Crema 1кг.",
      priceText: "€30.00",
      availabilityText: "in_stock",
      weightText: "1 кг.",
      brandKey: "lavazza",
      categoryKeys: ["kafe-na-zyrna"],
      descriptionText: "Fine blend.",
      imageUrls: ["https://www.kafezona.com/img/product-img-1182.jpg-800w.jpg"],
      ...overrides,
    },
    OPTIONS,
  );
}

function stored(p: NormalizedProduct, overrides: Partial<ExistingProduct> = {}): ExistingProduct {
  return {
    id: `id-${p.sourceKey}`,
    sourceKey: p.sourceKey,
    sourcePath: p.sourcePath,
    semanticHash: p.semanticHash,
    status: "active",
    consecutiveMissingCount: 0,
    snapshot: productSnapshot(p),
    ...overrides,
  };
}

/** A product code, set without letting it take over the source key. */
function withSku(p: NormalizedProduct, sku: string): NormalizedProduct {
  return { ...p, sku };
}

describe("move detection", () => {
  it("re-points a renamed product instead of creating a twin", () => {
    const before = product("/amann-cascada/");
    const after = product("/amann-cascada-500/");

    const result = diffCatalog([after], [stored(before)], THRESHOLD);

    expect(result.counts).toMatchObject({ moved: 1, created: 0, marked_missing: 0, removed: 0 });
    const [move] = result.moved;
    expect(move?.productId).toBe(`id-${before.sourceKey}`);
    expect(move?.sourceKey).toBe("/amann-cascada-500/#1000g");
    expect(move?.movedFrom).toEqual({
      sourceKey: "/amann-cascada/#1000g",
      matchedBy: "fingerprint",
      decidedBy: null,
    });
    // Nothing but the key changed, and the audit record says so.
    expect(move?.changedFields).toEqual(["sourceKey"]);
    expect(move?.before?.sourceKey).toBe("/amann-cascada/#1000g");
    expect(move?.after?.sourceKey).toBe("/amann-cascada-500/#1000g");
    expect(move?.product).toBe(after);
    expect(result.unresolvedMoves).toEqual([]);
  });

  it("pairs strictly one-to-one", () => {
    // Two rows we hold, one listing at the source, and nothing to tell which
    // of the two it continues.
    const first = product("/first/");
    const second = product("/second/");
    const listing = product("/third/");

    const result = diffCatalog([listing], [stored(first), stored(second)], THRESHOLD);

    expect(result.counts).toMatchObject({ moved: 0, created: 1, marked_missing: 2 });
    expect(result.unresolvedMoves).toEqual([
      {
        matchedBy: "fingerprint",
        reason: "tie",
        fingerprint: "lavazza | кафе на зърна lavazza super crema 1кг. | 1000g",
        existingKeys: ["/first/#1000g", "/second/#1000g"],
        discoveredKeys: ["/third/#1000g"],
      },
    ]);
  });

  it("never uses one product in two pairs", () => {
    const olds = [product("/a/"), product("/b/"), product("/c/")];
    const news = [product("/a-1/"), product("/b-1/"), product("/d/")];

    const { pairs } = pairMoves(
      olds.map((p) => stored(p)),
      news,
    );

    expect(new Set(pairs.map((pair) => pair.existing.id)).size).toBe(pairs.length);
    expect(new Set(pairs.map((pair) => pair.product.sourceKey)).size).toBe(pairs.length);
    expect(pairs.map((pair) => [pair.existing.sourceKey, pair.product.sourceKey]).sort()).toEqual([
      ["/a/#1000g", "/a-1/#1000g"],
      ["/b/#1000g", "/b-1/#1000g"],
    ]);
  });

  it("prefers an exact key match to any fingerprint", () => {
    const kept = product("/kept/");
    const renamedTwin = product("/kept-1/");

    // `/kept/` is still listed, so it is not a candidate for a move at all.
    const result = diffCatalog([kept, renamedTwin], [stored(kept)], THRESHOLD);

    expect(result.counts).toMatchObject({ unchanged: 1, created: 1, moved: 0 });
  });

  describe("ties", () => {
    // The real case: two different Lavazza products share brand, name and
    // pack size, and both URLs were renamed in the same edit.
    const NAME = "Кафе на зърна Lavazza Crema E Aroma 1кг.";
    const aroma = (path: string, overrides: Partial<Raw> = {}) =>
      product(path, {
        name: NAME,
        priceText: "€25.55",
        imageUrls: ["https://www.kafezona.com/img/product-img-1174.jpg-800w.jpg"],
        descriptionText: "Blend one.",
        ...overrides,
      });
    const expert = (path: string, overrides: Partial<Raw> = {}) =>
      product(path, {
        name: NAME,
        priceText: "€25.05",
        imageUrls: ["https://www.kafezona.com/img/product-img-1183.jpg-800w.jpg"],
        descriptionText: "Blend two.",
        ...overrides,
      });

    const pairsOf = (olds: NormalizedProduct[], news: NormalizedProduct[]) => {
      const result = diffCatalog(
        news,
        olds.map((p) => stored(p)),
        THRESHOLD,
      );
      return {
        result,
        pairs: Object.fromEntries(
          result.moved.map((move) => [move.movedFrom?.sourceKey, move.sourceKey]),
        ),
        decidedBy: [...new Set(result.moved.map((move) => move.movedFrom?.decidedBy))],
      };
    };

    it("breaks a tie on the path stem, longest prefix first", () => {
      // `/lavazza-crema-aroma` is a prefix of both new paths; the more
      // specific old path claims the one it is closest to.
      const { pairs, decidedBy, result } = pairsOf(
        [aroma("/lavazza-crema-aroma/"), expert("/lavazza-crema-aroma-expert/")],
        [expert("/lavazza-crema-aroma-expert-1/"), aroma("/lavazza-crema-aroma-1/")],
      );

      expect(pairs).toEqual({
        "/lavazza-crema-aroma/#1000g": "/lavazza-crema-aroma-1/#1000g",
        "/lavazza-crema-aroma-expert/#1000g": "/lavazza-crema-aroma-expert-1/#1000g",
      });
      expect(decidedBy).toEqual(["path_stem"]);
      expect(result.unresolvedMoves).toEqual([]);
    });

    it("falls back to price when the paths say nothing", () => {
      const { pairs, decidedBy } = pairsOf(
        [aroma("/lavazza-crema-aroma/"), expert("/lavazza-crema-aroma-expert/")],
        [
          expert("/espresso-two/", { imageUrls: ["https://www.kafezona.com/img/new-2.jpg"] }),
          aroma("/espresso-one/", { imageUrls: ["https://www.kafezona.com/img/new-1.jpg"] }),
        ],
      );

      expect(pairs).toEqual({
        "/lavazza-crema-aroma/#1000g": "/espresso-one/#1000g",
        "/lavazza-crema-aroma-expert/#1000g": "/espresso-two/#1000g",
      });
      expect(decidedBy).toEqual(["price"]);
    });

    it("falls back to the image set, then to the description", () => {
      const samePrice = { priceText: "€26.00" };
      const byImage = pairsOf(
        [aroma("/lavazza-crema-aroma/"), expert("/lavazza-crema-aroma-expert/")],
        [expert("/espresso-two/", samePrice), aroma("/espresso-one/", samePrice)],
      );
      expect(byImage.decidedBy).toEqual(["images"]);
      expect(byImage.pairs["/lavazza-crema-aroma/#1000g"]).toBe("/espresso-one/#1000g");

      const newImage = { ...samePrice, imageUrls: ["https://www.kafezona.com/img/shared.jpg"] };
      const byDescription = pairsOf(
        [aroma("/lavazza-crema-aroma/"), expert("/lavazza-crema-aroma-expert/")],
        [expert("/espresso-two/", newImage), aroma("/espresso-one/", newImage)],
      );
      expect(byDescription.decidedBy).toEqual(["description"]);
      expect(byDescription.pairs["/lavazza-crema-aroma-expert/#1000g"]).toBe(
        "/espresso-two/#1000g",
      );
    });

    it("leaves a tie that cannot be broken unpaired, and reports it", () => {
      // Identical in every signal, at unrelated paths: any pairing is a guess.
      const identical = { priceText: "€25.55", imageUrls: [], descriptionText: "Same." };
      const { result } = pairsOf(
        [
          aroma("/lavazza-crema-aroma/", identical),
          expert("/lavazza-crema-aroma-expert/", identical),
        ],
        [aroma("/espresso-one/", identical), expert("/espresso-two/", identical)],
      );

      expect(result.counts).toMatchObject({ moved: 0, created: 2, marked_missing: 2 });
      expect(result.unresolvedMoves).toHaveLength(1);
      expect(result.unresolvedMoves[0]).toMatchObject({
        reason: "tie",
        matchedBy: "fingerprint",
        existingKeys: ["/lavazza-crema-aroma-expert/#1000g", "/lavazza-crema-aroma/#1000g"],
        discoveredKeys: ["/espresso-one/#1000g", "/espresso-two/#1000g"],
      });
    });

    it("does not break a tie on a signal both candidates share", () => {
      // Same suffix length on both new paths: the stem cannot tell them apart.
      const identical = { priceText: "€25.55", imageUrls: [], descriptionText: "Same." };
      const { result } = pairsOf(
        [aroma("/lavazza/", identical), expert("/illy/", identical)],
        [aroma("/lavazza-1/", identical), expert("/lavazza-2/", identical)],
      );
      expect(result.counts.moved).toBe(0);
      expect(result.unresolvedMoves[0]?.reason).toBe("tie");
    });

    it("refuses to pair when two signals name different partners", () => {
      // The path says aroma -> aroma-1; the price says aroma -> expert-1.
      const { result } = pairsOf(
        [aroma("/lavazza-crema-aroma/"), expert("/lavazza-crema-aroma-expert/")],
        [
          aroma("/lavazza-crema-aroma-1/", { priceText: "€25.05" }),
          expert("/lavazza-crema-aroma-expert-1/", { priceText: "€25.55" }),
        ],
      );

      expect(result.counts).toMatchObject({ moved: 0, created: 2, marked_missing: 2 });
      expect(result.unresolvedMoves[0]?.reason).toBe("conflicting_evidence");
    });

    it("does not pair what is left over by elimination", () => {
      // One twin is identified by its price. The other shares nothing with the
      // remaining listing beyond the fingerprint, and stays unpaired.
      const { pairs, result } = pairsOf(
        [aroma("/lavazza-crema-aroma/"), expert("/lavazza-crema-aroma-expert/")],
        [
          aroma("/espresso-one/"),
          expert("/espresso-two/", {
            priceText: "€29.00",
            imageUrls: ["https://www.kafezona.com/img/other.jpg"],
            descriptionText: "Rewritten.",
          }),
        ],
      );

      expect(pairs).toEqual({ "/lavazza-crema-aroma/#1000g": "/espresso-one/#1000g" });
      expect(result.unresolvedMoves).toHaveLength(1);
      expect(result.unresolvedMoves[0]).toMatchObject({
        existingKeys: ["/lavazza-crema-aroma-expert/#1000g"],
        discoveredKeys: ["/espresso-two/#1000g"],
      });
    });
  });

  it("records a price change that arrives with the rename", () => {
    const before = product("/vergnano-antica-bottega/", { priceText: "€24.70" });
    const after = product("/vergnano-antica-bottega-1/", { priceText: "€27.65" });

    const result = diffCatalog([after], [stored(before)], THRESHOLD);

    expect(result.counts).toMatchObject({ moved: 1, updated: 0, created: 0 });
    const [move] = result.moved;
    expect(move?.changedFields).toEqual(["currentPrice", "semanticHash", "sourceKey"]);
    expect(move?.before).toMatchObject({ currentPrice: "24.70" });
    expect(move?.after).toMatchObject({ currentPrice: "27.65" });
  });

  it("follows one URL serving two pack sizes when it splits into two URLs", () => {
    const base = {
      url: "https://www.kafezona.com/borbone-crema-classica/",
      brandKey: "borbone",
    };
    const oldKilo = product("/borbone-crema-classica/", {
      ...base,
      name: "Кафе на зърна Borbone Crema Classica 1кг.",
      priceText: "€20.50",
      weightText: "1 кг.",
    });
    const oldHalf = product("/borbone-crema-classica/", {
      ...base,
      name: "Кафе на зърна Borbone Crema Classica 0.500кг.",
      priceText: "€10.70",
      weightText: "0.500кг.",
    });
    const newKilo = product("/borbone-crema-classica-1/", {
      brandKey: "borbone",
      name: "Кафе на зърна Borbone Crema Classica 1кг.",
      priceText: "€20.50",
      weightText: "1 кг.",
    });
    const newHalf = product("/borbone-crema-classica-500/", {
      brandKey: "borbone",
      name: "Кафе на зърна Borbone Crema Classica 0.500кг.",
      priceText: "€10.70",
      weightText: "0.500кг.",
    });

    const result = diffCatalog([newHalf, newKilo], [stored(oldKilo), stored(oldHalf)], THRESHOLD);

    expect(result.counts).toMatchObject({ moved: 2, created: 0, marked_missing: 0 });
    expect(
      Object.fromEntries(result.moved.map((move) => [move.movedFrom?.sourceKey, move.sourceKey])),
    ).toEqual({
      "/borbone-crema-classica/#1000g": "/borbone-crema-classica-1/#1000g",
      "/borbone-crema-classica/#500g": "/borbone-crema-classica-500/#500g",
    });
  });

  it("still marks a product that is genuinely gone as missing", () => {
    const gone = product("/julius-meinl-clasico/", { name: "Julius Meinl Clasico 1кг." });
    const staying = product("/staying/", { name: "Staying 1кг." });

    const result = diffCatalog([staying], [stored(gone), stored(staying)], THRESHOLD);

    expect(result.counts).toMatchObject({ moved: 0, marked_missing: 1, unchanged: 1 });
    expect(result.missing[0]?.sourceKey).toBe("/julius-meinl-clasico/#1000g");
  });

  it("still creates a product that is genuinely new", () => {
    const existing = product("/existing/", { name: "Existing 1кг." });
    const fresh = product("/fresh/", { name: "Fresh 1кг." });

    const result = diffCatalog([existing, fresh], [stored(existing)], THRESHOLD);

    expect(result.counts).toMatchObject({ moved: 0, created: 1, unchanged: 1 });
    expect(result.created[0]?.movedFrom).toBeNull();
  });

  it("does not pair across a name change or a different pack size", () => {
    const before = product("/rema-caffe-intenso/", { name: "Дозети Rema Caffe Intenso" });
    const renamed = product("/rema-caffe-intenso-100/", {
      name: "Дозети Rema Caffe Intenso 100бр.",
    });
    const resized = product("/rema-caffe-intenso-50/", {
      name: "Дозети Rema Caffe Intenso",
      weightText: "0.500кг.",
    });

    const result = diffCatalog([renamed, resized], [stored(before)], THRESHOLD);

    // This is the case `catalog:link` exists for.
    expect(result.counts).toMatchObject({ moved: 0, created: 2, marked_missing: 1 });
  });

  describe("brand", () => {
    it("pairs a product whose brand was filled in, when the path agrees", () => {
      const before = product("/kimbo-aroma-gold/", { brandKey: null });
      const after = product("/kimbo-aroma-gold-1/", {
        brandKey: "kimbo",
        imageUrls: ["https://www.kafezona.com/img/product-img-1512.jpg-800w.jpg"],
        priceText: "€31.00",
      });

      const [move] = diffCatalog([after], [stored(before)], THRESHOLD).moved;

      expect(move?.movedFrom).toMatchObject({ matchedBy: "name_and_pack", decidedBy: "path_stem" });
      expect(move?.changedFields).toContain("brandKey");
    });

    it("pairs a product whose brand slug was respelled, when the price agrees", () => {
      const before = product("/biancaffe-arabica/", { brandKey: "biancafe" });
      const after = product("/espresso-arabica/", {
        brandKey: "biancaffe",
        imageUrls: ["https://www.kafezona.com/img/other.jpg"],
      });

      const [move] = diffCatalog([after], [stored(before)], THRESHOLD).moved;

      expect(move?.movedFrom).toMatchObject({ matchedBy: "name_and_pack", decidedBy: "price" });
    });

    it("leaves a brand mismatch with nothing else in common unpaired, and reports it", () => {
      const before = product("/house-blend/", { brandKey: "lavazza" });
      const after = product("/espresso-range/", {
        brandKey: "illy",
        priceText: "€41.00",
        imageUrls: ["https://www.kafezona.com/img/other.jpg"],
        descriptionText: "Another roaster entirely.",
      });

      const result = diffCatalog([after], [stored(before)], THRESHOLD);

      expect(result.counts).toMatchObject({ moved: 0, created: 1, marked_missing: 1 });
      expect(result.unresolvedMoves).toEqual([
        {
          matchedBy: "name_and_pack",
          reason: "uncorroborated",
          fingerprint: "кафе на зърна lavazza super crema 1кг. | 1000g",
          existingKeys: ["/house-blend/#1000g"],
          discoveredKeys: ["/espresso-range/#1000g"],
        },
      ]);
    });

    it("prefers the candidate with the same brand to one without", () => {
      const sameBrand = product("/a/");
      const noBrand = product("/b/", { brandKey: null });
      const listing = product("/b-1/");

      const result = diffCatalog([listing], [stored(sameBrand), stored(noBrand)], THRESHOLD);

      // The path points at `/b/`, but an equal brand is the stronger pass and
      // is settled first.
      expect(result.moved[0]?.movedFrom?.sourceKey).toBe("/a/#1000g");
      expect(result.counts.marked_missing).toBe(1);
    });
  });

  describe("product code", () => {
    it("pairs on an equal product code even when the name changed", () => {
      const before = withSku(
        product("/julius-meinl-clasico/", { name: "Julius Meinl Clasico 1кг." }),
        "JM-100",
      );
      const after = withSku(
        product("/julius-meinl-classico-1/", { name: "Julius Meinl Espresso Classico 1кг." }),
        "JM-100",
      );

      const result = diffCatalog([after], [stored(before)], THRESHOLD);

      expect(result.moved[0]?.movedFrom).toMatchObject({ matchedBy: "sku", decidedBy: null });
      expect(result.moved[0]?.changedFields).toContain("name");
    });

    it("prefers the product code to the fingerprint", () => {
      const before = withSku(product("/a/"), "A-1");
      const sameName = withSku(product("/a-1/"), "B-2");
      const sameCode = withSku(product("/elsewhere/", { name: "Renamed 1кг." }), "A-1");

      const result = diffCatalog([sameName, sameCode], [stored(before)], THRESHOLD);

      expect(result.moved).toHaveLength(1);
      expect(result.moved[0]?.sourceKey).toBe("/elsewhere/#1000g");
      expect(result.counts.created).toBe(1);
    });

    it("never pairs two different product codes, whatever else matches", () => {
      const before = withSku(product("/a/"), "A-1");
      const after = withSku(product("/a-1/"), "B-2");

      const result = diffCatalog([after], [stored(before)], THRESHOLD);

      expect(result.counts).toMatchObject({ moved: 0, created: 1, marked_missing: 1 });
      expect(result.unresolvedMoves).toEqual([]);
    });

    it("falls back to the fingerprint while only one side has a code", () => {
      const before = product("/a/");
      const after = withSku(product("/a-1/"), "A-1");

      const result = diffCatalog([after], [stored(before)], THRESHOLD);

      expect(result.moved[0]?.movedFrom?.matchedBy).toBe("fingerprint");
    });
  });

  describe("absent products", () => {
    it("restores a missing product that turns up at a new URL", () => {
      const before = product("/a/");
      const after = product("/a-1/");

      const result = diffCatalog(
        [after],
        [stored(before, { status: "missing", consecutiveMissingCount: 2 })],
        THRESHOLD,
      );

      const [move] = result.moved;
      expect(move?.nextStatus).toBe("active");
      expect(move?.nextMissingCount).toBe(0);
      expect(move?.changedFields).toEqual(["sourceKey", "status"]);
      expect(move?.before?.status).toBe("missing");
      expect(move?.after?.status).toBe("active");
    });

    it("lets a removed row reclaim its product when nothing live wants it", () => {
      const before = product("/a/");
      const after = product("/a-1/");

      const result = diffCatalog(
        [after],
        [stored(before, { status: "removed", consecutiveMissingCount: 3 })],
        THRESHOLD,
      );

      expect(result.counts).toMatchObject({ moved: 1, created: 0 });
    });

    it("gives a live row precedence over a removed one", () => {
      const removed = product("/a/");
      const live = product("/b/");
      const listing = product("/c/");

      const result = diffCatalog(
        [listing],
        [
          stored(removed, { id: "removed-row", status: "removed", consecutiveMissingCount: 3 }),
          stored(live, { id: "live-row" }),
        ],
        THRESHOLD,
      );

      expect(result.moved[0]?.productId).toBe("live-row");
      expect(result.unresolvedMoves).toEqual([]);
    });
  });

  it("falls back to the source key for the path when none is stored", () => {
    const olds = [product("/lavazza-crema-aroma/"), product("/lavazza-crema-aroma-expert/")];
    const news = [product("/lavazza-crema-aroma-expert-1/"), product("/lavazza-crema-aroma-1/")];

    const { pairs } = pairMoves(
      olds.map((p) => {
        const { sourcePath: _dropped, ...rest } = stored(p);
        return rest;
      }),
      news,
    );

    expect(pairs.map((pair) => pair.decidedBy)).toEqual(["path_stem", "path_stem"]);
  });
});

/**
 * The real rename.
 *
 * "Before" is the catalog as we hold it, mirrored on 21 August 2026. "After"
 * is what the source published on 8 October 2026, by which time it had renamed
 * nearly every product URL. Without move detection this diff reads as 88
 * products gone and 165 new ones.
 */
describe("move detection: the August to October rename", () => {
  const before = loadCatalogFixture("source-catalog-2026-08-21.json").products;
  const after = loadCatalogFixture("source-catalog-2026-10-08.json").products;
  const existing = before.map(fixtureAsExisting);
  const discovered = after.map(fixtureAsDiscovered);
  const diff = diffCatalog(discovered, existing, THRESHOLD);

  const identity = (p: { brandKey: string | null; name: string; pack: string | null }) =>
    JSON.stringify([p.brandKey, p.name.toLowerCase(), p.pack]);
  const nameAndPack = (p: { name: string; pack: string | null }) =>
    JSON.stringify([p.name.toLowerCase(), p.pack]);
  const repeated = (keys: string[]) =>
    [...new Set(keys.filter((key, index) => keys.indexOf(key) !== index))].sort();

  it("starts from 110 products and meets 187", () => {
    expect(before).toHaveLength(110);
    expect(after).toHaveLength(187);
    const beforeKeys = new Set(before.map((p) => p.sourceKey));
    expect(after.filter((p) => beforeKeys.has(p.sourceKey))).toHaveLength(22);
  });

  it("classifies every product exactly once", () => {
    expect(diff.counts).toEqual({
      moved: 86,
      created: 79,
      updated: 5,
      unchanged: 17,
      marked_missing: 2,
      removed: 0,
      restored: 0,
    });
    expect(diff.unresolvedMoves).toEqual([]);
    // Every listed product is accounted for, and so is every stored one.
    expect(diff.changes.filter((change) => change.product !== null)).toHaveLength(187);
    expect(
      new Set(diff.changes.map((change) => change.productId).filter((id) => id !== null)).size,
    ).toBe(110);
  });

  it("pairs on the evidence it says it does", () => {
    const tally = new Map<string, number>();
    for (const move of diff.moved) {
      const key = `${move.movedFrom?.matchedBy}/${move.movedFrom?.decidedBy ?? "-"}`;
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }
    expect(Object.fromEntries(tally)).toEqual({
      // Brand, name and pack size equal, and no other candidate.
      "fingerprint/-": 69,
      // The Lavazza twins.
      "fingerprint/path_stem": 2,
      // Brand filled in or respelled by the source; the path corroborates.
      "name_and_pack/path_stem": 15,
    });
  });

  it("tells the two Lavazza Crema E Aroma products apart", () => {
    const moves = Object.fromEntries(
      diff.moved.map((move) => [move.movedFrom?.sourceKey, move.sourceKey]),
    );
    expect(moves["/lavazza-crema-aroma/#1000g"]).toBe("/lavazza-crema-aroma-1/#1000g");
    expect(moves["/lavazza-crema-aroma-expert/#1000g"]).toBe(
      "/lavazza-crema-aroma-expert-1/#1000g",
    );
  });

  it("pairs one-to-one", () => {
    expect(new Set(diff.moved.map((move) => move.productId)).size).toBe(86);
    expect(new Set(diff.moved.map((move) => move.sourceKey)).size).toBe(86);
  });

  it("never pairs products whose name or pack size differs", () => {
    const beforeByKey = new Map(before.map((p) => [p.sourceKey, p]));
    const afterByKey = new Map(after.map((p) => [p.sourceKey, p]));
    for (const move of diff.moved) {
      const from = beforeByKey.get(move.movedFrom?.sourceKey ?? "");
      const to = afterByKey.get(move.sourceKey);
      expect(from && nameAndPack(from)).toBe(to && nameAndPack(to));
    }
  });

  it("records what else changed on a moved product", () => {
    const also = new Map<string, number>();
    for (const move of diff.moved) {
      for (const field of move.changedFields) also.set(field, (also.get(field) ?? 0) + 1);
    }
    expect(Object.fromEntries(also)).toEqual({
      sourceKey: 86,
      semanticHash: 29,
      brandKey: 15,
      imageUrls: 5,
      currentPrice: 2,
      descriptionText: 1,
    });
  });

  it("leaves only the two products whose names changed with their URLs", () => {
    expect(diff.missing.map((change) => change.sourceKey).sort()).toEqual([
      "/julius-meinl-clasico/#1000g",
      "/rema-caffe-intenso/",
    ]);
    // Both are still sold, under a new name: the `catalog:link` cases.
    const created = new Set(diff.created.map((change) => change.sourceKey));
    expect(created.has("/julius-meinl-classico-1/#1000g")).toBe(true);
    expect(created.has("/rema-caffe-intenso-100/#100pc")).toBe(true);
  });

  it("does not look like a mass removal to the circuit breaker", () => {
    const config = loadConfig({}, {});
    const decision = evaluateCircuitBreaker(
      {
        discoveredCount: discovered.length,
        activeCount: existing.length,
        baselineDiscoveredCount: existing.length,
        disappearingCount: diff.missing.length + diff.removed.length,
        parserConfidence: 1,
        failedEntryPages: 0,
        catalogSource: "filter_init",
      },
      {
        maxDisappearedRatio: config.breakerMaxDisappearedRatio,
        minDiscoveredRatio: config.breakerMinDiscoveredRatio,
        minAbsoluteProducts: config.breakerMinAbsoluteProducts,
        minParserConfidence: config.breakerMinParserConfidence,
      },
    );
    expect(decision.tripped).toBe(false);
    expect(decision.detail.disappearedRatio).toBeCloseTo(2 / 110);
  });

  it("produces no duplicates", () => {
    // What is listed once the diff is applied: every product the source
    // publishes, each on exactly one row.
    const afterByKey = new Map(after.map((p) => [p.sourceKey, p]));
    const active = diff.changes
      .filter((change) => change.nextStatus === "active")
      .map((change) => afterByKey.get(change.sourceKey) as (typeof after)[number]);
    expect(active).toHaveLength(187);

    // The one repeated identity is the Lavazza pair, which was two products
    // before the rename and is two products after it.
    const twins = ['["lavazza","кафе на зърна lavazza crema e aroma 1кг.","1000g"]'];
    expect(repeated(before.map(identity))).toEqual(twins);
    expect(repeated(active.map(identity))).toEqual(twins);
    expect(repeated(active.map(nameAndPack))).toHaveLength(1);

    // And no stored row was left behind beside a new twin of itself.
    const createdIdentities = new Set(
      diff.created.map((change) =>
        nameAndPack(afterByKey.get(change.sourceKey) as (typeof after)[number]),
      ),
    );
    const beforeByKey = new Map(before.map((p) => [p.sourceKey, p]));
    const orphaned = diff.missing.filter((change) =>
      createdIdentities.has(
        nameAndPack(beforeByKey.get(change.sourceKey) as (typeof before)[number]),
      ),
    );
    expect(orphaned).toEqual([]);
  });

  it("is a no-op the second time", () => {
    // Stored state after applying: the moved rows now answer to the new keys.
    const second = diffCatalog(discovered, after.map(fixtureAsExisting), THRESHOLD);
    expect(second.counts).toMatchObject({ moved: 0, created: 0, updated: 0, unchanged: 187 });
  });

  it("is pure: same inputs, same answer, inputs untouched", () => {
    const snapshot = JSON.stringify(existing);
    const again = diffCatalog(discovered, existing, THRESHOLD);
    expect(again.counts).toEqual(diff.counts);
    expect(again.moved.map((move) => [move.movedFrom?.sourceKey, move.sourceKey])).toEqual(
      diff.moved.map((move) => [move.movedFrom?.sourceKey, move.sourceKey]),
    );
    expect(JSON.stringify(existing)).toBe(snapshot);

    // Order of the stored rows must not change who is paired with whom.
    const reversed = diffCatalog(discovered, [...existing].reverse(), THRESHOLD);
    expect(
      Object.fromEntries(reversed.moved.map((move) => [move.movedFrom?.sourceKey, move.sourceKey])),
    ).toEqual(
      Object.fromEntries(diff.moved.map((move) => [move.movedFrom?.sourceKey, move.sourceKey])),
    );
  });
});
