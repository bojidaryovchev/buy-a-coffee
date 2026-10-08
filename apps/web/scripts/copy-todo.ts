#!/usr/bin/env tsx
/**
 * Which products still need copy written.
 *
 * A product with no entry in `content/product-copy.ts` is not broken — it
 * publishes one generated factual sentence and no long description — but it
 * is unfinished, and the sync creates such products without telling anyone.
 * This lists them, with the slug to key the new entry by and the sentence the
 * page is showing in the meantime.
 *
 *   pnpm copy:todo
 *
 * It reads the database when one is reachable, because the database is the
 * truth about what is published: a product counts as done when its override
 * column is filled, which is after `copy:apply`, not merely after the entry
 * is typed. With no database (`DATABASE_URL` unset, or nothing answering) it
 * falls back to the reference artifacts and compares them with the copy file,
 * which is the best available answer in CI or on a fresh clone.
 *
 * Always exits 0 when it could produce a list. An unfinished catalog is a
 * to-do list, not a failed build — `check:originality` is what fails, and
 * only on copy that is actually wrong.
 */
import { asc, eq, sql } from "drizzle-orm";
import { createDatabase } from "@catalog/db";
import { brands, categories, productCategories, products } from "@catalog/db/schema";
import { productCopy } from "../content/product-copy.ts";
import { composeFallbackCopy } from "../src/lib/catalog/fallback-copy.ts";
import { generatedSentenceFor, loadReferenceSnapshot } from "./copy-audit.ts";

interface TodoItem {
  /** Null only in the reference fallback, for a product not synced yet. */
  readonly slug: string | null;
  readonly name: string;
  readonly generated: string | null;
  /** Set when the entry exists in the file but has not been applied. */
  readonly note?: string;
}

interface TodoList {
  readonly source: string;
  readonly total: number;
  readonly items: readonly TodoItem[];
}

/** Null when there is no database to ask. */
async function fromDatabase(): Promise<TodoList | null> {
  if (!process.env.DATABASE_URL) return null;

  // A short connect timeout: an unreachable database should cost seconds
  // before the fallback, not the default quarter of a minute.
  const { db, close } = createDatabase({ max: 1, connectTimeoutSeconds: 5 });
  try {
    const [counted] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(products)
      .where(eq(products.status, "active"));

    const rows = await db
      .select({
        slug: products.slug,
        name: products.name,
        brandName: brands.name,
        weightValue: products.weightValue,
        weightUnit: products.weightUnit,
        attributes: products.attributes,
        // The same slug-and-source-key set the storefront resolves a brewing
        // system from; see `fallbackCopyColumns` in `lib/catalog/queries.ts`.
        categoryKeys: sql<string[]>`array(
          select distinct category_key
          from ${productCategories} pc
          join ${categories} c on c.id = pc.category_id
          cross join lateral unnest(array[c.slug, c.source_key]) as category_key
          where pc.product_id = ${products.id} and category_key is not null
        )`,
      })
      .from(products)
      .leftJoin(brands, eq(products.brandId, brands.id))
      .where(
        sql`${products.status} = 'active' and nullif(btrim(${products.descriptionTextOverride}), '') is null`,
      )
      .orderBy(asc(products.slug));

    return {
      source: "database",
      total: counted?.count ?? 0,
      items: rows.map((row) => ({
        slug: row.slug,
        name: row.name,
        generated: composeFallbackCopy({
          brandName: row.brandName,
          categoryKeys: row.categoryKeys,
          packValue: row.weightValue,
          packUnit: row.weightUnit,
          attributes: row.attributes ?? {},
        }),
        ...(Object.hasOwn(productCopy, row.slug)
          ? { note: "entry exists in content/product-copy.ts — run `pnpm copy:apply`" }
          : {}),
      })),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.log(`Database not reachable (${reason.split("\n")[0]}).\n`);
    return null;
  } finally {
    await close().catch(() => {});
  }
}

async function fromReference(): Promise<TodoList | null> {
  const snapshot = await loadReferenceSnapshot();
  if (!snapshot) return null;

  const items = snapshot.products
    .filter((product) => !product.slug || !Object.hasOwn(productCopy, product.slug))
    .map((product) => ({
      slug: product.slug ?? null,
      name: product.name,
      generated: generatedSentenceFor(product, snapshot.brandNames),
      ...(product.slug ? {} : { note: "not synced yet — it has no slug to key an entry by" }),
    }))
    .sort((a, b) => (a.slug ?? a.name).localeCompare(b.slug ?? b.name));

  return {
    source: "reference artifacts — no database, so this is the copy file against the last crawl",
    total: snapshot.products.length,
    items,
  };
}

async function main(): Promise<void> {
  const list = (await fromDatabase()) ?? (await fromReference());

  if (!list) {
    console.error(
      "Nothing to read: no database is reachable and there are no reference artifacts.\n" +
        "Set DATABASE_URL, or run `pnpm reference:export`.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Copy to write — source: ${list.source}\n`);

  if (list.items.length === 0) {
    console.log(`  All ${list.total} products publish copy of their own. Nothing to do.`);
    return;
  }

  console.log(
    `  ${list.items.length} of ${list.total} product${list.total === 1 ? "" : "s"} still rel${
      list.items.length === 1 ? "ies" : "y"
    } on the generated sentence:\n`,
  );
  for (const item of list.items) {
    console.log(`  ${item.slug ?? "(no slug)"}`);
    console.log(`    ${item.name}`);
    console.log(`    now showing: ${item.generated ?? "(nothing — no describable attribute)"}`);
    if (item.note) console.log(`    note: ${item.note}`);
  }
  console.log("\n  Add an entry per slug to content/product-copy.ts, then run `pnpm copy:apply`.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
