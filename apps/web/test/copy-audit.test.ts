import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type ProductCopy, productCopy } from "../content/product-copy";
import {
  MAX_SOURCE_OVERLAP,
  type ReferenceProduct,
  auditProductCopy,
  loadReferenceSnapshot,
  overlapRatio,
} from "../scripts/copy-audit";

const SOURCE_TEXT =
  "Този бленд представлява внимателно подбрана комбинация от арабика и робуста, изпичана за максимално развитие на аромата и балансиран вкус.";

function product(overrides: Partial<ReferenceProduct> = {}): ReferenceProduct {
  return {
    sourceKey: "/vergnano-espresso/#1000g",
    slug: "kafe-na-zarna-vergnano-espresso-1kg",
    name: "Кафе на зърна Vergnano Espresso 1кг.",
    descriptionText: SOURCE_TEXT,
    ...overrides,
  };
}

function entry(summary: string, body: string[] = []): ProductCopy {
  return { summary, body };
}

const ORIGINAL = entry("Класическият бленд на къщата, с умерена сила.", [
  "Арабика и робуста, изпечени така, че ароматът да се развие докрай.",
]);

describe("auditProductCopy", () => {
  it("passes original copy", () => {
    const audit = auditProductCopy([product()], { [product().slug!]: ORIGINAL });
    expect(audit.findings).toEqual([]);
    expect(audit.compared).toBe(1);
    expect(audit.withoutCopy).toEqual([]);
    expect(audit.unverifiedEntries).toEqual([]);
  });

  it("joins our copy to the source's text by slug, not by source key", () => {
    // The source renamed the URL; the sync followed by rewriting `sourceKey`.
    const renamed = product({ sourceKey: "/caffe-vergnano-espresso-1kg/#1000g" });
    const audit = auditProductCopy([renamed], { [renamed.slug!]: entry(SOURCE_TEXT) });
    expect(audit.compared).toBe(1);
    expect(audit.findings.map((finding) => finding.key)).toContain(renamed.slug);

    // And an entry keyed the old way is not silently accepted as a match.
    const keyedBySourceKey = auditProductCopy([product()], { [product().sourceKey]: ORIGINAL });
    expect(keyedBySourceKey.compared).toBe(0);
    expect(keyedBySourceKey.unverifiedEntries).toEqual([product().sourceKey]);
  });

  it("still fails copy that is the source's description", () => {
    const audit = auditProductCopy([product()], { [product().slug!]: entry(SOURCE_TEXT) });
    const details = audit.findings.map((finding) => finding.detail);
    expect(details.some((detail) => detail.includes("verbatim"))).toBe(true);
    expect(details.some((detail) => detail.includes("phrasing survives"))).toBe(true);
  });

  it("still fails copy that re-orders the source instead of rewriting it", () => {
    const reordered = entry("Бленд за еспресо.", [
      "Внимателно подбрана комбинация от арабика и робуста, изпичана за максимално развитие на аромата и балансиран вкус — това е този бленд.",
    ]);
    expect(
      overlapRatio(SOURCE_TEXT, `${reordered.summary} ${reordered.body.join(" ")}`),
    ).toBeGreaterThan(MAX_SOURCE_OVERLAP);
    const audit = auditProductCopy([product()], { [product().slug!]: reordered });
    expect(audit.findings).toHaveLength(1);
    expect(audit.findings[0]!.detail).toContain("rewrite, do not re-order");
  });

  it("still fails one summary shared by two of our own products", () => {
    const half = product({ slug: "espresso-500g", sourceKey: "/vergnano-espresso/#500g" });
    const audit = auditProductCopy([product(), half], {
      [product().slug!]: ORIGINAL,
      [half.slug!]: entry(ORIGINAL.summary, ["Друго тяло на текста, за по-малката опаковка."]),
    });
    expect(audit.findings).toHaveLength(1);
    expect(audit.findings[0]!.name).toBe("(internal duplicate)");
  });

  it("counts a product with no copy instead of failing on it", () => {
    const arrivals = Array.from({ length: 80 }, (_, index) =>
      product({ slug: `new-product-${index}`, sourceKey: `/new-${index}/#1000g` }),
    );
    const audit = auditProductCopy([product(), ...arrivals], { [product().slug!]: ORIGINAL });

    // Eighty products arrived overnight with no copy. Nothing fails.
    expect(audit.findings).toEqual([]);
    expect(audit.checked).toBe(81);
    expect(audit.compared).toBe(1);
    expect(audit.withoutCopy.map((item) => item.slug)).toEqual(arrivals.map((item) => item.slug));
  });

  it("counts a product that has not been synced yet, which has no slug", () => {
    const unsynced = product({ slug: null, sourceKey: "/brand-new/#250g" });
    const audit = auditProductCopy([product(), unsynced], { [product().slug!]: ORIGINAL });
    expect(audit.findings).toEqual([]);
    expect(audit.withoutCopy).toEqual([unsynced]);
  });

  it("reports an entry the snapshot cannot place, without failing", () => {
    const audit = auditProductCopy([product()], {
      [product().slug!]: ORIGINAL,
      "kafe-na-zarna-mistyped-slug": entry("Друг текст, за продукт, който не е в снимката."),
    });
    expect(audit.findings).toEqual([]);
    expect(audit.unverifiedEntries).toEqual(["kafe-na-zarna-mistyped-slug"]);
  });

  it("fails when the snapshot carries no slugs, rather than pass having compared nothing", () => {
    const { slug: _slug, ...withoutSlug } = product();
    const audit = auditProductCopy([withoutSlug], { [product().slug!]: entry(SOURCE_TEXT) });
    expect(audit.compared).toBe(0);
    expect(audit.findings).toHaveLength(1);
    expect(audit.findings[0]!.detail).toContain("slug");
  });

  it("does not mistake an inherited property name for a copy entry", () => {
    const audit = auditProductCopy([product({ slug: "constructor" }), product()], {
      [product().slug!]: ORIGINAL,
    });
    expect(audit.compared).toBe(1);
    expect(audit.withoutCopy.map((item) => item.slug)).toEqual(["constructor"]);
  });
});

/* --- The real files ------------------------------------------------------ *
 *
 * The copy file is keyed by slug and the snapshot carries the slug, and those
 * two facts are only useful while they agree. These read the committed files.
 */

const SNAPSHOT_DIR = path.resolve(import.meta.dirname, "../../../reference/latest");
const read = (name: string) => readFileSync(path.join(SNAPSHOT_DIR, name), "utf8");
/*
 * Through the loader the check itself uses, which places each product at the
 * slug it has on the storefront today: the snapshot was exported before the
 * products moved to the shop's own slugs, and the copy is keyed by the new ones.
 */
const snapshot = (await loadReferenceSnapshot(SNAPSHOT_DIR)) as {
  products: readonly ReferenceProduct[];
};

describe("content/product-copy.ts against the reference snapshot", () => {
  it("is keyed by slug: every entry is a product in the snapshot", () => {
    const slugs = new Set(snapshot.products.map((item) => item.slug));
    const strangers = Object.keys(productCopy).filter((key) => !slugs.has(key));
    expect(strangers).toEqual([]);
  });

  it("uses no source key as a key", () => {
    // A source key is a path with an optional `#size`; a slug is neither.
    const pathLike = Object.keys(productCopy).filter((key) => /[/#\s]/u.test(key));
    expect(pathLike).toEqual([]);
    for (const key of Object.keys(productCopy)) expect(key).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
  });

  it("gives every snapshot product a unique slug", () => {
    const slugs = snapshot.products.map((item) => item.slug);
    expect(slugs.every((slug) => typeof slug === "string" && slug.length > 0)).toBe(true);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("passes the audit as committed", () => {
    const audit = auditProductCopy(snapshot.products, productCopy);
    expect(audit.findings).toEqual([]);
    expect(audit.unverifiedEntries).toEqual([]);
    expect(audit.compared).toBe(Object.keys(productCopy).length);
  });
});

describe("reference/latest/manifest.json", () => {
  /*
   * Nothing else verifies the manifest, and an unverified checksum is only a
   * claim. `products.json` is the one artifact this app edits a consumer of,
   * so this is where a hand-edit that forgot the manifest gets caught.
   *
   * Line endings are folded first: the exporter writes LF, and a checkout
   * with `core.autocrlf` must not turn that into a failure about nothing.
   */
  it("records the size and SHA-256 of products.json as it is on disk", () => {
    const manifest = JSON.parse(read("manifest.json")) as {
      counts: Record<string, number>;
      files: Array<{ name: string; bytes: number; sha256: string }>;
    };
    const recorded = manifest.files.find((file) => file.name === "products.json");
    const content = read("products.json").replace(/\r\n/g, "\n");

    expect(recorded).toBeDefined();
    expect(recorded!.bytes).toBe(Buffer.byteLength(content, "utf8"));
    expect(recorded!.sha256).toBe(createHash("sha256").update(content, "utf8").digest("hex"));
    expect(manifest.counts.products).toBe(snapshot.products.length);
  });

  it("keeps products.json in the exporter's deterministic format", () => {
    // Recursively sorted keys, two-space indent, one trailing newline.
    const sortKeys = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(sortKeys);
      if (value === null || typeof value !== "object") return value;
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, inner]) => [key, sortKeys(inner)]),
      );
    };
    const content = read("products.json").replace(/\r\n/g, "\n");
    expect(`${JSON.stringify(sortKeys(JSON.parse(content)), null, 2)}\n`).toBe(content);
  });
});
