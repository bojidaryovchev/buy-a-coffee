/**
 * Loading the committed reference snapshot into a database.
 *
 * The library behind `seed:reference` (`seed-reference.ts` is only its command
 * line). It is separate so that a test can run it against a private database
 * without executing an entry point.
 *
 * What it is for: the end-to-end suite is written against the real catalog —
 * a `kapsuli` category, a `lavazza` brand, product photographs, brewing
 * systems with products in them — and CI can neither crawl the source nor
 * reach the real database. `reference/latest/` is the one offline copy of that
 * catalog (110 products, 15 brands, 8 categories), already committed. This
 * loads it through the real schema, so the storefront sees what it would see
 * after a sync.
 *
 * What it must never do is damage a real catalog, and it makes that impossible
 * in two independent ways:
 *
 *  1. **Where.** It refuses any database that is not on this machine, and any
 *     process that looks like a deployment. A seed has no business anywhere
 *     else, so there is no flag to override this.
 *  2. **What is already there.** Everything it writes belongs to one source
 *     site, `reference-snapshot`, and it refuses a database in which any other
 *     source site holds products, brands or categories. That is the reason it
 *     refuses rather than sitting beside a synced catalog: the storefront
 *     lists every source site's products together, so the two would double
 *     every listing and `copy:apply` (which matches by slug alone) would meet
 *     two products for one slug.
 *
 * It only ever inserts or updates rows of its own site, never deletes, and
 * writes nothing derived from the source site: no source host (every URL is on
 * the reserved `.invalid` domain), no image bytes (each image is generated
 * here, a few hundred bytes of PNG).
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { Database } from "@catalog/db";
import {
  brands,
  categories,
  productCategories,
  productImages,
  products,
  sourceSites,
} from "@catalog/db/schema";
import { packServings, parseWeight } from "@catalog/shared";
import type { ProductCopy } from "../content/product-copy.ts";
import { publishProductCopy } from "./product-copy-publish.ts";

/** The one source site every seeded row belongs to. */
export const REFERENCE_SOURCE_KEY = "reference-snapshot";
const REFERENCE_HOST = "reference.invalid";
/** A fixed instant, so two runs write identical rows. */
const MIRRORED_AT = new Date("2026-01-01T00:00:00.000Z");

/* --- Snapshot shapes: only what is read ---------------------------------- */

export interface SnapshotBrand {
  readonly sourceKey: string;
  readonly sourceId?: string | null;
  readonly rawSlug: string;
  readonly name: string;
  readonly productCount?: number;
}

export interface SnapshotCategory {
  readonly sourceKey: string;
  readonly sourceId?: string | null;
  readonly rawSlug: string;
  readonly name: string;
  readonly parentKey: string | null;
  readonly position: number;
  readonly productCount?: number;
}

export interface SnapshotProduct {
  readonly sourceKey: string;
  readonly sourcePath: string;
  readonly sourceVariantKey?: string | null;
  readonly slug: string | null;
  readonly name: string;
  readonly brandKey: string | null;
  readonly categoryKeys: readonly string[];
  readonly currentPrice: string | null;
  readonly oldPrice: string | null;
  readonly currency: string | null;
  readonly availability: "in_stock" | "out_of_stock" | "unknown" | "preorder";
  readonly descriptionText: string | null;
  readonly weight: string | null;
  readonly attributes: Readonly<Record<string, string>>;
  readonly sku: string | null;
  readonly gtin: string | null;
  readonly hasUrlCollision: boolean;
  readonly identityStrategy: string;
  readonly semanticHash: string;
  /** Only its length is used: the URLs themselves are never stored. */
  readonly sourceImageUrls: readonly string[];
}

export interface ReferenceSnapshotData {
  readonly products: readonly SnapshotProduct[];
  readonly brands: readonly SnapshotBrand[];
  readonly categories: readonly SnapshotCategory[];
}

/** Read the three artifacts of a snapshot directory; each must hold something. */
export async function loadSnapshot(directory: string): Promise<ReferenceSnapshotData> {
  const read = async <T>(file: string, key: string): Promise<T[]> => {
    const parsed = JSON.parse(await readFile(path.join(directory, file), "utf8")) as Record<
      string,
      T[] | undefined
    >;
    const list = parsed[key];
    if (!Array.isArray(list) || list.length === 0) {
      throw new Error(`${file} holds no "${key}" — is the snapshot committed?`);
    }
    return list;
  };
  return {
    products: await read<SnapshotProduct>("products.json", "products"),
    brands: await read<SnapshotBrand>("brands.json", "brands"),
    categories: await read<SnapshotCategory>("categories.json", "categories"),
  };
}

/* --- Guards -------------------------------------------------------------- */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Throws unless `databaseUrl` is a database on this machine and the process is
 * not a deployment. Pure, so it can be tested without a server.
 */
export function assertLocalTarget(
  databaseUrl: string | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set. Load .env.local first (see the seed's header).");
  }
  if (env.VERCEL || env.NODE_ENV === "production") {
    throw new Error(
      "Refusing to seed: this looks like a deployment (VERCEL or NODE_ENV=production is set). " +
        "The reference seed is for local and CI databases only.",
    );
  }
  let host: string;
  try {
    host = new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    throw new Error("Refusing to seed: DATABASE_URL is not a valid URL.");
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Refusing to seed database host "${host}": the reference seed only runs against ` +
        "localhost. There is deliberately no override.",
    );
  }
}

/**
 * Throws when any source site other than ours holds catalog rows.
 *
 * Returns how many of our own rows are already there, so the caller can say
 * whether this run created the catalog or refreshed it.
 */
export async function assertNoForeignCatalog(db: Database): Promise<{ existingProducts: number }> {
  const rows = await db.execute<{
    key: string;
    products: number;
    brands: number;
    categories: number;
  }>(sql`
    select s.key,
           (select count(*)::int from products p where p.source_site_id = s.id) as products,
           (select count(*)::int from brands b where b.source_site_id = s.id) as brands,
           (select count(*)::int from categories c where c.source_site_id = s.id) as categories
    from source_sites s
    where s.key <> ${REFERENCE_SOURCE_KEY}
  `);
  const foreign = [...rows].filter((row) => row.products + row.brands + row.categories > 0);
  if (foreign.length > 0) {
    const named = foreign
      .map(
        (row) =>
          `"${row.key}" (${row.products} products, ${row.brands} brands, ${row.categories} categories)`,
      )
      .join(", ");
    throw new Error(
      `Refusing to seed: this database already holds a catalog from ${named}. ` +
        "The reference snapshot would sit beside it, doubling every listing. " +
        "Use an empty database (create one and run `pnpm db:migrate`).",
    );
  }

  const [own] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(products)
    .innerJoin(sourceSites, eq(products.sourceSiteId, sourceSites.id))
    .where(eq(sourceSites.key, REFERENCE_SOURCE_KEY));
  return { existingProducts: own?.count ?? 0 };
}

/* --- Deterministic identity ---------------------------------------------- */

/** A UUID derived from a name, so the same snapshot yields the same ids anywhere. */
export function deterministicId(...parts: readonly string[]): string {
  const hex = createHash("sha256")
    .update(["reference-seed", ...parts].join("\u0000"))
    .digest("hex");
  // Shaped as a version-5 UUID; the content is a truncated SHA-256.
  const variant = ((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}

/** The storefront slug of a brand: lower case, hyphenated, no stray spaces. */
export function brandSlug(brand: Pick<SnapshotBrand, "rawSlug" | "name">): string {
  const slug = brand.rawSlug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || brand.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/* --- Images -------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

export const PLACEHOLDER_PNG_SIZE = 32;

/**
 * A small, valid PNG: a white ground with a coloured block, as a packshot is
 * photographed on white. The colour comes from `seed`, so each product's image
 * is its own file with its own content hash — and the bytes are the same on
 * every run.
 */
export function placeholderPng(seed: string): Buffer {
  const digest = createHash("sha256").update(seed).digest();
  const [r, g, b] = [
    60 + ((digest[0] as number) % 130),
    60 + ((digest[1] as number) % 130),
    60 + ((digest[2] as number) % 130),
  ];
  const size = PLACEHOLDER_PNG_SIZE;
  const rows: Buffer[] = [];
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 3, 0xff); // filter byte 0, then white pixels
    row[0] = 0;
    if (y >= 6 && y < size - 4) {
      for (let x = 10; x < size - 10; x += 1) {
        row[1 + x * 3] = r;
        row[2 + x * 3] = g;
        row[3 + x * 3] = b;
      }
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** The key the sync's `buildImageKey` would give these bytes. */
export function imageKeyFor(bytes: Uint8Array): { key: string; hash: string } {
  const hash = createHash("sha256").update(bytes).digest("hex");
  return { key: `catalog/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}.png`, hash };
}

/* --- The load ------------------------------------------------------------ */

export interface SeedSummary {
  readonly created: boolean;
  readonly brands: number;
  readonly categories: number;
  readonly products: number;
  readonly images: number;
  readonly imageFilesWritten: number;
  readonly copy: { readonly matched: number; readonly written: number };
}

export interface SeedOptions {
  readonly snapshot: ReferenceSnapshotData;
  readonly copy: Readonly<Record<string, ProductCopy>>;
  /** Where the local storage driver (and the `/media` route) read from. */
  readonly storageDir: string;
}

export async function seedReference(db: Database, options: SeedOptions): Promise<SeedSummary> {
  const { snapshot, storageDir } = options;
  const { existingProducts } = await assertNoForeignCatalog(db);

  const [site] = await db
    .insert(sourceSites)
    .values({
      id: deterministicId("site", REFERENCE_SOURCE_KEY),
      key: REFERENCE_SOURCE_KEY,
      name: "Reference snapshot (offline)",
      baseUrl: `https://${REFERENCE_HOST}/`,
      canonicalHost: REFERENCE_HOST,
    })
    .onConflictDoUpdate({ target: sourceSites.key, set: { updatedAt: sql`now()` } })
    .returning({ id: sourceSites.id });
  if (!site) throw new Error("failed to create the reference source site");
  const siteId = site.id;

  const brandIds = new Map<string, string>();
  for (const brand of snapshot.brands) {
    const id = deterministicId("brand", brand.sourceKey);
    const values = {
      sourceId: brand.sourceId ?? null,
      sourceUrl: `https://${REFERENCE_HOST}/${brandSlug(brand)}/`,
      name: brand.name,
      sourceProductCount: brand.productCount ?? null,
      status: "active" as const,
    };
    await db
      .insert(brands)
      .values({
        id,
        sourceSiteId: siteId,
        sourceKey: brand.sourceKey,
        slug: brandSlug(brand),
        ...values,
      })
      .onConflictDoUpdate({ target: [brands.sourceSiteId, brands.sourceKey], set: values });
    brandIds.set(brand.sourceKey, id);
  }

  const categoryIds = new Map<string, string>();
  for (const category of snapshot.categories) {
    const id = deterministicId("category", category.sourceKey);
    const values = {
      sourceId: category.sourceId ?? null,
      sourceUrl: `https://${REFERENCE_HOST}/${category.rawSlug}/`,
      name: category.name,
      position: category.position,
      sourceProductCount: category.productCount ?? null,
      status: "active" as const,
    };
    await db
      .insert(categories)
      .values({
        id,
        sourceSiteId: siteId,
        sourceKey: category.sourceKey,
        slug: category.rawSlug,
        ...values,
      })
      .onConflictDoUpdate({ target: [categories.sourceSiteId, categories.sourceKey], set: values });
    categoryIds.set(category.sourceKey, id);
  }
  // Parents are linked once every category has an id.
  for (const category of snapshot.categories) {
    if (!category.parentKey) continue;
    const parentId = categoryIds.get(category.parentKey);
    if (!parentId)
      throw new Error(
        `category "${category.sourceKey}" has unknown parent "${category.parentKey}"`,
      );
    await db
      .update(categories)
      .set({ parentId })
      .where(eq(categories.id, categoryIds.get(category.sourceKey) as string));
  }

  let images = 0;
  let imageFilesWritten = 0;
  const productIds = new Map<string, string>();
  for (const product of snapshot.products) {
    if (!product.slug)
      throw new Error(`product "${product.sourceKey}" has no slug in the snapshot`);
    const id = deterministicId("product", product.sourceKey);
    const weight = parseWeight(product.weight);
    const servings = packServings(weight?.value ?? null, weight?.unit ?? null);
    const values = {
      sourceUrl: `https://${REFERENCE_HOST}${product.sourcePath}`,
      sourcePath: product.sourcePath,
      sourceVariantKey: product.sourceVariantKey ?? null,
      hasUrlCollision: product.hasUrlCollision,
      name: product.name,
      currentPrice: product.currentPrice,
      oldPrice: product.oldPrice,
      currency: product.currency,
      availability: product.availability,
      brandId: product.brandKey ? (brandIds.get(product.brandKey) ?? null) : null,
      descriptionText: product.descriptionText,
      weight: product.weight,
      weightValue: weight?.value ?? null,
      weightUnit: weight?.unit ?? null,
      servings: servings?.exact ?? null,
      servingsEstimated: servings?.estimated ?? null,
      sku: product.sku,
      gtin: product.gtin,
      attributes: { ...product.attributes },
      sourceData: {
        seededFrom: "reference-snapshot",
        brandKey: product.brandKey,
        categoryKeys: product.categoryKeys,
        weightCanonical: weight?.canonical ?? null,
        // Deliberately empty: the snapshot's image addresses are not stored.
        imageUrls: [],
        identityStrategy: product.identityStrategy,
      },
      semanticHash: product.semanticHash,
      status: "active" as const,
      consecutiveMissingCount: 0,
    };
    await db
      .insert(products)
      .values({
        id,
        sourceSiteId: siteId,
        sourceKey: product.sourceKey,
        slug: product.slug,
        ...values,
      })
      .onConflictDoUpdate({ target: [products.sourceSiteId, products.sourceKey], set: values });
    productIds.set(product.sourceKey, id);

    const categoryRowIds = product.categoryKeys.map((key) => {
      const categoryId = categoryIds.get(key);
      if (!categoryId) throw new Error(`product "${product.slug}" is in unknown category "${key}"`);
      return categoryId;
    });
    await db.delete(productCategories).where(eq(productCategories.productId, id));
    if (categoryRowIds.length > 0) {
      await db.insert(productCategories).values(
        categoryRowIds.map((categoryId, index) => ({
          productId: id,
          categoryId,
          isPrimary: index === 0,
        })),
      );
    }

    // One generated image per image the source had, so the page shapes match.
    const wanted: string[] = [];
    for (let ordinal = 0; ordinal < product.sourceImageUrls.length; ordinal += 1) {
      const bytes = placeholderPng(`${product.slug}/${ordinal}`);
      const { key, hash } = imageKeyFor(bytes);
      const target = path.join(storageDir, key);
      const present = await stat(target).then(
        (info) => info.isFile() && info.size === bytes.length,
        () => false,
      );
      if (!present) {
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, bytes);
        imageFilesWritten += 1;
      }

      const sourceUrl = `https://${REFERENCE_HOST}/images/${product.slug}-${ordinal + 1}.png`;
      wanted.push(sourceUrl);
      const imageValues = {
        sourceContentHash: hash,
        objectKey: key,
        publicUrl: null,
        mimeType: "image/png",
        width: PLACEHOLDER_PNG_SIZE,
        height: PLACEHOLDER_PNG_SIZE,
        byteSize: bytes.length,
        ordinal,
        isPrimary: ordinal === 0,
        alt: product.name,
        status: "active" as const,
        lastError: null,
      };
      await db
        .insert(productImages)
        .values({
          id: deterministicId("image", product.sourceKey, String(ordinal)),
          productId: id,
          sourceUrl,
          mirroredAt: MIRRORED_AT,
          ...imageValues,
        })
        .onConflictDoUpdate({
          target: [productImages.productId, productImages.sourceUrl],
          set: imageValues,
        });
      images += 1;
    }
    // A shrunk snapshot must not leave images behind that no longer exist.
    const stale = await db
      .select({ id: productImages.id, sourceUrl: productImages.sourceUrl })
      .from(productImages)
      .where(eq(productImages.productId, id));
    const staleIds = stale.filter((row) => !wanted.includes(row.sourceUrl)).map((row) => row.id);
    if (staleIds.length > 0) {
      await db.delete(productImages).where(inArray(productImages.id, staleIds));
    }
  }

  // Our written copy, by the same rule `copy:apply` uses.
  const seeded = await db
    .select({
      id: products.id,
      slug: products.slug,
      status: products.status,
      currentText: products.descriptionTextOverride,
      currentHtml: products.descriptionHtmlOverride,
    })
    .from(products)
    .where(and(eq(products.sourceSiteId, siteId), ne(products.status, "removed")));
  const published = await publishProductCopy(db, seeded, options.copy);

  return {
    created: existingProducts === 0,
    brands: snapshot.brands.length,
    categories: snapshot.categories.length,
    products: snapshot.products.length,
    images,
    imageFilesWritten,
    copy: { matched: published.matched, written: published.written },
  };
}
