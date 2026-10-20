#!/usr/bin/env tsx
/**
 * Publish our own product copy.
 *
 * Reads `content/product-copy.ts` and writes it into the two override columns.
 * It touches nothing else — in particular it never writes `description_text`
 * or `description_html`, which belong to the sync and record what the source
 * published. Keeping those intact is what lets `check:originality` compare the
 * two and prove we are not republishing the source's text.
 *
 * Entries are matched to products by `slug`. The slug is the storefront's own
 * identifier, allocated once and frozen, so an entry keeps finding its product
 * when the source renames a URL and the sync rewrites `source_key` to follow
 * it. Matching on `source_key`, as this script used to, would have orphaned
 * every entry at the first such rename.
 *
 * Safe to run repeatedly: it is a plain idempotent update, and running it
 * twice changes nothing the second time.
 *
 *   pnpm --filter @catalog/web copy:apply
 *   pnpm --filter @catalog/web copy:apply -- --dry-run
 *
 * A product present in the database but missing from the copy file is
 * reported, not failed on: the sync adds products continuously, and a new one
 * legitimately has no copy written for it yet. Until someone writes it, that
 * product publishes a sentence generated from its attributes
 * (`lib/catalog/fallback-copy.ts`) — never the source's description.
 *
 * After a run that wrote something, the storefront is asked to redraw the
 * catalog (`POST /api/revalidate`): the text shows on the product page and on
 * every card of it, and the sitemap dates the page by it. That needs
 * `SITE_URL` (or `NEXT_PUBLIC_SITE_URL`) and the storefront's `REVALIDATE_SECRET` in
 * the shell; without them it says so and the pages catch up on their own, in
 * five minutes, and the sitemap within about an hour. It never fails the run.
 */
import { sql } from "drizzle-orm";
import { createDatabase } from "@catalog/db";
import { products } from "@catalog/db/schema";
import {
  requestRevalidation,
  revalidationSiteUrl,
  type StorefrontRevalidationResult,
} from "@catalog/shared/revalidate";
import { productCopy } from "../content/product-copy.ts";
import { publishProductCopy } from "./product-copy-publish.ts";

async function main(): Promise<void> {
  // Read inside `main` so that `pnpm copy:apply -- --dry-run` and
  // `pnpm copy:apply --dry-run` both work, however pnpm forwards the `--`.
  const dryRun = process.argv.includes("--dry-run");
  const { db, close } = createDatabase();

  try {
    /*
     * Every product, whatever its status. A removed product keeps its URL and
     * still renders a page, so it should keep wearing our copy; filtering to
     * active rows here would report its entry as orphaned for no reason.
     */
    const rows = await db
      .select({
        id: products.id,
        slug: products.slug,
        name: products.name,
        status: products.status,
        currentText: products.descriptionTextOverride,
        currentHtml: products.descriptionHtmlOverride,
      })
      .from(products);

    const { matched, written, unchanged, orphaned } = await publishProductCopy(
      db,
      rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        status: row.status,
        currentText: row.currentText,
        currentHtml: row.currentHtml,
      })),
      productCopy,
      { dryRun },
    );

    const active = rows.filter((row) => row.status === "active");
    const withoutCopy = active.filter((row) => !Object.hasOwn(productCopy, row.slug));

    console.log(`${dryRun ? "[dry-run] " : ""}Product copy applied.`);
    console.log(`  entries:    ${Object.keys(productCopy).length}`);
    console.log(`  matched:    ${matched}`);
    console.log(`  orphaned:   ${orphaned.length}`);
    console.log(`  ${dryRun ? "to write:  " : "written:   "} ${written}`);
    console.log(`  unchanged:  ${unchanged}`);
    console.log(`  in catalog: ${active.length} active`);

    if (orphaned.length > 0) {
      console.log(
        `\n  ${orphaned.length} copy entr${orphaned.length === 1 ? "y has" : "ies have"} no matching product.`,
      );
      console.log("  No product has that slug — check the key for a typo:");
      for (const slug of orphaned) console.log(`    ${slug}`);
    }

    if (withoutCopy.length > 0) {
      console.log(
        `\n  ${withoutCopy.length} active product${withoutCopy.length === 1 ? " has" : "s have"} no copy of ${withoutCopy.length === 1 ? "its" : "their"} own yet.`,
      );
      console.log("  They publish the generated sentence. `pnpm copy:todo` lists them.");
    }

    // Cheap confirmation that the write landed where it was meant to, rather
    // than trusting the update count.
    const [publishing] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(products)
      .where(
        sql`${products.status} = 'active' and ${products.descriptionTextOverride} is not null`,
      );
    const count = publishing?.count ?? 0;
    console.log(`\n  products publishing our copy: ${count} / ${active.length}`);

    if (!dryRun && written > 0) {
      const outcome = await requestRevalidation({
        siteUrl: revalidationSiteUrl(process.env),
        secret: process.env.REVALIDATE_SECRET,
        body: { scope: "catalog" },
      });
      console.log(`  storefront: ${describeRefresh(outcome)}`);
    }
  } finally {
    await close();
  }
}

const CATCH_UP = "pages catch up within 5 minutes, the sitemap within about an hour";

function describeRefresh(outcome: StorefrontRevalidationResult): string {
  if (outcome.skipped === "no-secret")
    return `not asked to refresh (REVALIDATE_SECRET is not set); ${CATCH_UP}`;
  if (outcome.skipped === "bad-secret")
    return `not asked to refresh (REVALIDATE_SECRET is not one token: a line break pasted into it?); ${CATCH_UP}`;
  if (outcome.skipped)
    return `not asked to refresh (SITE_URL is missing or not https); ${CATCH_UP}`;
  if (outcome.ok) return `asked to refresh ${outcome.routes} page routes and the sitemap`;
  return `refresh failed (${outcome.error ?? `status ${outcome.status}`}); ${CATCH_UP}`;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
