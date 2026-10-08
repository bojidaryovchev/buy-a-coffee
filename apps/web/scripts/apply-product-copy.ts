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
 */
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "@catalog/db";
import { products } from "@catalog/db/schema";
import { productCopy } from "../content/product-copy.ts";

/**
 * Escape before wrapping in `<p>`.
 *
 * The copy file holds plain text, and it is a text file a human edits — an
 * ampersand or an angle bracket typed into a sentence must not become markup
 * on the way to the database. The sanitiser on the render path would catch
 * malformed output, but relying on it would mean deliberately storing broken
 * HTML and hoping something downstream fixes it.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toHtml(paragraphs: readonly string[]): string {
  return paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n");
}

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

    const bySlug = new Map(rows.map((row) => [row.slug, row]));

    let matched = 0;
    let written = 0;
    let unchanged = 0;
    const orphaned: string[] = [];

    for (const [slug, copy] of Object.entries(productCopy)) {
      const row = bySlug.get(slug);
      if (!row) {
        orphaned.push(slug);
        continue;
      }
      matched += 1;

      const html = toHtml(copy.body);
      // Both columns are compared: an edit to the body alone leaves the
      // summary identical and still has to be written.
      if (row.currentText === copy.summary && row.currentHtml === html) {
        unchanged += 1;
        continue;
      }

      if (!dryRun) {
        await db
          .update(products)
          .set({
            descriptionTextOverride: copy.summary,
            descriptionHtmlOverride: html,
            // Deliberately not touching `lastChangedAt`: that column tracks
            // when the *source* changed, and the sync's diff reads it. Our
            // editorial changes are not source changes.
          })
          .where(eq(products.id, row.id));
      }
      written += 1;
    }

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
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
