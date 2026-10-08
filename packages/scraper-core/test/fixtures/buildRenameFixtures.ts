/**
 * Builds the two catalog snapshots the rename regression test compares.
 *
 *   tsx buildRenameFixtures.ts search <saved /search/ page> <out.json> <observed date>
 *   tsx buildRenameFixtures.ts reference <reference run directory> <out.json> <observed date>
 *
 * `search` runs a saved copy of the source's catalog page through the real
 * discovery path — `parseFilterInit`, normalisation, validation,
 * de-duplication — with only the network replaced. `reference` reads the
 * `products.json`, `brands.json` and `categories.json` of a `reference/<run>/`
 * export, which is the same normalised data one step later.
 *
 * Only the fields move detection and taxonomy matching read are kept. The saved page itself must
 * never be committed: besides the catalog it carries the source's third-party
 * account identifiers.
 */
import { readFile, writeFile } from "node:fs/promises";
import { loadConfig } from "../../src/config.ts";
import { discoverCatalog } from "../../src/catalog/discover.ts";
import { Fetcher } from "../../src/fetch/fetcher.ts";
import path from "node:path";
import type {
  CatalogFixture,
  CatalogFixtureEntity,
  CatalogFixtureProduct,
} from "../helpers/catalogFixture.ts";

const [mode, input, output, observedOn] = process.argv.slice(2);
if ((mode !== "search" && mode !== "reference") || !input || !output || !observedOn) {
  throw new Error("usage: buildRenameFixtures.ts <search|reference> <input> <out.json> <date>");
}

let products: CatalogFixtureProduct[];
let brands: CatalogFixtureEntity[];
let categories: CatalogFixtureEntity[];

if (mode === "search") {
  const html = await readFile(input, "utf8");
  const config = loadConfig({ minDelayMs: 0, maxRetries: 0, respectRobotsTxt: false }, {});
  const fetchImpl = (async (request: string | URL | Request): Promise<Response> => {
    const url = new URL(String(request instanceof Request ? request.url : request));
    return decodeURIComponent(url.pathname) === "/search/"
      ? new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })
      : new Response("not found", { status: 404 });
  }) as typeof fetch;

  const catalog = await discoverCatalog({ config, fetcher: new Fetcher({ config, fetchImpl }) });
  if (catalog.source !== "filter_init" || catalog.invalidRecords.length > 0) {
    throw new Error(`unexpected discovery result: ${catalog.source}`);
  }
  brands = catalog.brands.map((brand) => ({
    sourceKey: brand.sourceKey,
    sourceId: brand.sourceId,
    name: brand.name,
  }));
  categories = catalog.categories.map((category) => ({
    sourceKey: category.sourceKey,
    sourceId: category.sourceId,
    name: category.name,
    parentKey: category.parentKey,
  }));
  products = catalog.products.map((product) => ({
    sourceKey: product.sourceKey,
    sourcePath: product.sourcePath,
    name: product.name,
    brandKey: product.brandKey,
    pack: product.weight?.canonical ?? null,
    price: product.currentPrice?.amount ?? null,
    sku: product.sku,
    imageUrls: product.sourceImageUrls,
    description: product.descriptionText,
    semanticHash: product.semanticHash,
  }));
} else {
  const read = async (name: string): Promise<Array<Record<string, unknown>>> => {
    const file = JSON.parse(await readFile(path.join(input, `${name}.json`), "utf8")) as Record<
      string,
      Array<Record<string, unknown>>
    >;
    return file[name] ?? [];
  };
  const reference = { products: await read("products") };
  brands = (await read("brands")).map((brand) => ({
    sourceKey: brand.sourceKey as string,
    sourceId: (brand.sourceId as string | null) ?? null,
    name: brand.name as string,
  }));
  categories = (await read("categories")).map((category) => ({
    sourceKey: category.sourceKey as string,
    sourceId: (category.sourceId as string | null) ?? null,
    name: category.name as string,
    parentKey: (category.parentKey as string | null) ?? null,
  }));
  products = reference.products.map((product) => ({
    sourceKey: product.sourceKey as string,
    sourcePath: product.sourcePath as string,
    name: product.name as string,
    brandKey: (product.brandKey as string | null) ?? null,
    pack: (product.weightCanonical as string | null) ?? null,
    price: (product.currentPrice as string | null) ?? null,
    sku: (product.sku as string | null) ?? null,
    imageUrls: (product.sourceImageUrls as string[]) ?? [],
    description: (product.descriptionText as string | null) ?? null,
    semanticHash: product.semanticHash as string,
  }));
}

const bySourceKey = (a: { sourceKey: string }, b: { sourceKey: string }): number =>
  a.sourceKey < b.sourceKey ? -1 : 1;

const fixture: CatalogFixture = {
  description:
    "Normalised catalog snapshot, reduced to the fields move detection and taxonomy matching read. Built by buildRenameFixtures.ts.",
  observedOn,
  brands: brands.sort(bySourceKey),
  categories: categories.sort(bySourceKey),
  products: products.sort((a, b) => (a.sourceKey < b.sourceKey ? -1 : 1)),
};

await writeFile(output, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
process.stdout.write(`${output}: ${products.length} products\n`);
