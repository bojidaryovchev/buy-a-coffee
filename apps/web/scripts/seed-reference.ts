#!/usr/bin/env tsx
/**
 * Seed a database with the committed reference snapshot.
 *
 *   pnpm --filter @catalog/web seed:reference
 *
 * `reference/latest/` holds the real catalog as the last crawl saw it: 110
 * products with their storefront slugs, 15 brands, 8 categories. This loads it
 * through the real schema, publishes our written product copy the way
 * `copy:apply` does, and generates one tiny image per product in the local
 * storage directory so `/media` serves real files. It is what the end-to-end
 * suite and CI run against, because CI can neither crawl the source nor see the
 * real database.
 *
 * Offline and deterministic: it reads files in this repository and writes to
 * the database and the storage directory, and nothing else. Idempotent: a
 * second run changes nothing. Safe by construction: see `reference-seed.ts`
 * for why it refuses any database that is not local or that already holds a
 * synced catalog. It never deletes.
 *
 * Needs `DATABASE_URL` (load `./.env.local` first) and a migrated database. The
 * images go to `STORAGE_LOCAL_DIR`, or `.storage` under `apps/web` — the same
 * place the `/media` route reads from.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "@catalog/db";
import { productCopy } from "../content/product-copy.ts";
import { assertLocalTarget, loadSnapshot, seedReference } from "./reference-seed.ts";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REFERENCE_DIR = path.resolve(WEB_ROOT, "../../reference/latest");

async function main(): Promise<void> {
  assertLocalTarget(process.env.DATABASE_URL);

  const snapshot = await loadSnapshot(REFERENCE_DIR);
  const storageDir = path.resolve(process.env.STORAGE_LOCAL_DIR ?? ".storage");

  const { db, close } = createDatabase({ max: 2, connectTimeoutSeconds: 10 });
  try {
    const summary = await seedReference(db, { snapshot, copy: productCopy, storageDir });
    console.log(
      `${summary.created ? "Seeded" : "Refreshed"} the reference catalog: ` +
        `${summary.products} products, ${summary.brands} brands, ${summary.categories} categories, ` +
        `${summary.images} images.`,
    );
    console.log(
      `  our copy: ${summary.copy.matched} products matched, ${summary.copy.written} written`,
    );
    console.log(`  images:   ${summary.imageFilesWritten} files written under ${storageDir}`);
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
