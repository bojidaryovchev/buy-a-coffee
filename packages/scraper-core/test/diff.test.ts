import { describe, expect, it } from "vitest";
import {
  type ExistingProduct,
  diffCatalog,
  diffFields,
  productSnapshot,
} from "../src/catalog/diff.ts";
import { type NormalizedProduct, normalizeProduct } from "../src/catalog/normalize.ts";

const OPTIONS = { sourceSite: "kafezona", defaultCurrency: "EUR" } as const;

function product(overrides: Partial<Parameters<typeof normalizeProduct>[0]> = {}): NormalizedProduct {
  return normalizeProduct(
    {
      path: "/lavazza-super-crema/",
      url: "https://www.kafezona.com/lavazza-super-crema/",
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
    semanticHash: p.semanticHash,
    status: "active",
    consecutiveMissingCount: 0,
    snapshot: productSnapshot(p),
    ...overrides,
  };
}

const THRESHOLD = { missingThreshold: 3 } as const;

describe("diffFields", () => {
  it("names only the fields that differ", () => {
    expect(diffFields({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual(["b"]);
  });

  it("treats missing and null as equal", () => {
    expect(diffFields({ a: null }, {})).toEqual([]);
  });

  it("detects added and removed keys", () => {
    expect(diffFields({ a: 1 }, { b: 1 })).toEqual(["a", "b"]);
  });

  it("compares nested structures by value", () => {
    expect(diffFields({ a: { x: 1 } }, { a: { x: 1 } })).toEqual([]);
    expect(diffFields({ a: [1, 2] }, { a: [2, 1] })).toEqual(["a"]);
  });
});

describe("diffCatalog", () => {
  it("creates products that are not yet stored", () => {
    const result = diffCatalog([product()], [], THRESHOLD);
    expect(result.counts.created).toBe(1);
    expect(result.created[0]?.before).toBeNull();
    expect(result.created[0]?.nextStatus).toBe("active");
  });

  it("is idempotent: an identical second sync produces no updates", () => {
    const p = product();
    const result = diffCatalog([p], [stored(p)], THRESHOLD);
    expect(result.counts).toMatchObject({ created: 0, updated: 0, unchanged: 1, removed: 0 });
  });

  it("records a price change as exactly one audited update", () => {
    const before = product();
    const after = product({ priceText: "€31.50" });
    const result = diffCatalog([after], [stored(before)], THRESHOLD);
    expect(result.counts.updated).toBe(1);
    expect(result.updated[0]?.changedFields).toEqual(["currentPrice", "semanticHash"]);
    expect(result.updated[0]?.before?.currentPrice).toBe("30.00");
    expect(result.updated[0]?.after?.currentPrice).toBe("31.50");
  });

  it("detects availability changes", () => {
    const result = diffCatalog(
      [product({ availabilityText: "out_of_stock" })],
      [stored(product())],
      THRESHOLD,
    );
    expect(result.updated[0]?.changedFields).toContain("availability");
  });

  it("does not report a change when only irrelevant whitespace differs", () => {
    const before = product({ descriptionText: "Fine  blend." });
    const after = product({ descriptionText: "Fine blend." });
    // The semantic hash normalises whitespace, so these must be identical.
    expect(after.semanticHash).toBe(before.semanticHash);
    expect(diffCatalog([after], [stored(before)], THRESHOLD).counts.unchanged).toBe(1);
  });

  it("does not report a change when category order differs", () => {
    const a = product({ categoryKeys: ["kapsuli", "nespresso"] });
    const b = product({ categoryKeys: ["nespresso", "kapsuli"] });
    expect(a.semanticHash).toBe(b.semanticHash);
  });

  it("marks a single absence as missing, never removed", () => {
    const p = product();
    const result = diffCatalog([], [stored(p)], THRESHOLD);
    expect(result.counts.marked_missing).toBe(1);
    expect(result.counts.removed).toBe(0);
    expect(result.missing[0]?.nextStatus).toBe("missing");
    expect(result.missing[0]?.nextMissingCount).toBe(1);
  });

  it("removes only once the threshold is reached", () => {
    const p = product();
    const twice = diffCatalog([], [stored(p, { status: "missing", consecutiveMissingCount: 1 })], THRESHOLD);
    expect(twice.counts.removed).toBe(0);
    expect(twice.missing[0]?.nextMissingCount).toBe(2);

    const thrice = diffCatalog([], [stored(p, { status: "missing", consecutiveMissingCount: 2 })], THRESHOLD);
    expect(thrice.counts.removed).toBe(1);
    expect(thrice.removed[0]?.nextStatus).toBe("removed");
    expect(thrice.removed[0]?.nextMissingCount).toBe(3);
  });

  it("honours a configurable threshold", () => {
    const p = product();
    const result = diffCatalog([], [stored(p)], { missingThreshold: 1 });
    expect(result.counts.removed).toBe(1);
  });

  it("clamps a nonsensical threshold to at least one", () => {
    const p = product();
    expect(diffCatalog([], [stored(p)], { missingThreshold: 0 }).counts.removed).toBe(1);
  });

  it("restores a reappearing product and resets its counter", () => {
    const p = product();
    const result = diffCatalog(
      [p],
      [stored(p, { status: "missing", consecutiveMissingCount: 2 })],
      THRESHOLD,
    );
    expect(result.counts.restored).toBe(1);
    expect(result.restored[0]?.nextStatus).toBe("active");
    expect(result.restored[0]?.nextMissingCount).toBe(0);
  });

  it("restores a product that had already been removed", () => {
    const p = product();
    const result = diffCatalog(
      [p],
      [stored(p, { status: "removed", consecutiveMissingCount: 3 })],
      THRESHOLD,
    );
    expect(result.counts.restored).toBe(1);
    expect(result.restored[0]?.nextMissingCount).toBe(0);
  });

  it("does not re-audit a product that is already removed and still absent", () => {
    const p = product();
    const result = diffCatalog(
      [],
      [stored(p, { status: "removed", consecutiveMissingCount: 5 })],
      THRESHOLD,
    );
    expect(result.changes).toHaveLength(0);
  });

  it("keeps the two products that share /borbone-crema-classica/ apart", () => {
    const half = product({
      path: "/borbone-crema-classica/",
      url: "https://www.kafezona.com/borbone-crema-classica/",
      name: "Кафе на зърна Borbone Crema Classica 0.500кг.",
      priceText: "€10.70",
      weightText: "0.500кг.",
    });
    const full = product({
      path: "/borbone-crema-classica/",
      url: "https://www.kafezona.com/borbone-crema-classica/",
      name: "Кафе на зърна Borbone Crema Classica 1кг.",
      priceText: "€20.50",
      weightText: "1 кг.",
    });
    expect(half.sourceKey).not.toBe(full.sourceKey);

    const result = diffCatalog([half, full], [], THRESHOLD);
    expect(result.counts.created).toBe(2);

    // A second sync must be fully idempotent for both variants.
    const second = diffCatalog([half, full], [stored(half), stored(full)], THRESHOLD);
    expect(second.counts).toMatchObject({ created: 0, updated: 0, unchanged: 2 });
  });

  it("handles a mixed run without cross-contamination", () => {
    const keep = product();
    const changing = product({ path: "/illy-classico-500/", url: "https://www.kafezona.com/illy-classico-500/", name: "Illy Classico", priceText: "€9.80" });
    const changed = product({ path: "/illy-classico-500/", url: "https://www.kafezona.com/illy-classico-500/", name: "Illy Classico", priceText: "€10.80" });
    const vanishing = product({ path: "/gone/", url: "https://www.kafezona.com/gone/", name: "Gone" });
    const fresh = product({ path: "/new/", url: "https://www.kafezona.com/new/", name: "New" });

    const result = diffCatalog(
      [keep, changed, fresh],
      [stored(keep), stored(changing), stored(vanishing)],
      THRESHOLD,
    );
    expect(result.counts).toMatchObject({
      created: 1,
      updated: 1,
      unchanged: 1,
      marked_missing: 1,
      removed: 0,
    });
  });

  it("produces one change record per product and nothing more", () => {
    const a = product();
    const b = product({ path: "/b/", url: "https://www.kafezona.com/b/", name: "B" });
    const result = diffCatalog([a], [stored(a), stored(b)], THRESHOLD);
    expect(result.changes).toHaveLength(2);
  });
});
