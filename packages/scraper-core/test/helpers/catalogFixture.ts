import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseMoney } from "@catalog/shared";
import { type ExistingProduct, productSnapshot } from "../../src/catalog/diff.ts";
import type { NormalizedProduct } from "../../src/catalog/normalize.ts";

/**
 * Real catalog snapshots, reduced to the fields move detection reads.
 *
 * The same record can be loaded as either side of a diff: as what the source
 * published (`NormalizedProduct`) or as what we already store
 * (`ExistingProduct`). Fields the fixtures do not carry get the same neutral
 * value on both sides, so they never show up as a change.
 */

export interface CatalogFixtureProduct {
  readonly sourceKey: string;
  readonly sourcePath: string;
  readonly name: string;
  readonly brandKey: string | null;
  /** Canonical pack size, e.g. `1000g`. */
  readonly pack: string | null;
  readonly price: string | null;
  readonly sku: string | null;
  readonly imageUrls: string[];
  readonly description: string | null;
  readonly semanticHash: string;
}

/** A brand or a category: the same few fields identify either. */
export interface CatalogFixtureEntity {
  readonly sourceKey: string;
  /** The source's own numeric id. */
  readonly sourceId: string | null;
  readonly name: string;
  /** Categories only. */
  readonly parentKey?: string | null;
}

export interface CatalogFixture {
  readonly description: string;
  readonly observedOn: string;
  readonly brands: CatalogFixtureEntity[];
  readonly categories: CatalogFixtureEntity[];
  readonly products: CatalogFixtureProduct[];
}

const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");

export function loadCatalogFixture(name: string): CatalogFixture {
  return JSON.parse(readFileSync(path.join(FIXTURE_DIR, name), "utf8")) as CatalogFixture;
}

export function fixtureAsDiscovered(record: CatalogFixtureProduct): NormalizedProduct {
  const separator = record.sourceKey.indexOf("#");
  return {
    sourceSite: "kafezona",
    sourceKey: record.sourceKey,
    sourceUrl: new URL(record.sourcePath, "https://www.kafezona.com/").href,
    sourcePath: record.sourcePath,
    sourceVariantKey: separator === -1 ? null : record.sourceKey.slice(separator + 1),
    identityStrategy: separator === -1 ? "path" : "path_and_size",
    hasUrlCollision: false,
    name: record.name,
    slug: null,
    currentPrice: parseMoney(record.price, { defaultCurrency: "EUR" }),
    oldPrice: null,
    currency: "EUR",
    availability: "in_stock",
    brandKey: record.brandKey,
    brandName: null,
    categoryKeys: [],
    descriptionHtml: null,
    descriptionText: record.description,
    // Only the canonical form takes part in identity and in the diff.
    weight: record.pack
      ? { raw: record.pack, value: "0", unit: "g", canonical: record.pack }
      : null,
    weightText: record.pack,
    sku: record.sku,
    gtin: null,
    attributes: {},
    sourceImageUrls: record.imageUrls,
    sourceData: {},
    semanticHash: record.semanticHash,
  } as NormalizedProduct;
}

export function fixtureAsExisting(record: CatalogFixtureProduct): ExistingProduct {
  return {
    id: `id:${record.sourceKey}`,
    sourceKey: record.sourceKey,
    sourcePath: record.sourcePath,
    semanticHash: record.semanticHash,
    status: "active",
    consecutiveMissingCount: 0,
    snapshot: productSnapshot(fixtureAsDiscovered(record)),
  };
}
