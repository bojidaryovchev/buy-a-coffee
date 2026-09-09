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
 * Safe to run repeatedly: it is a plain idempotent update keyed on
 * `source_key`, and running it twice changes nothing the second time.
 *
 *   pnpm --filter @catalog/web copy:apply
 *   pnpm --filter @catalog/web copy:apply -- --dry-run
 *
 * A product present in the database but missing from the copy file is
 * reported, not failed on: the sync adds products continuously, and a new one
 * legitimately has no copy written for it yet. It will still ship the source
 * description until someone writes one, which is what the originality report
 * at the end is for.
 */
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "@catalog/db";
import { products } from "@catalog/db/schema";
import { productCopy } from "../content/product-copy.ts";

const DRY_RUN = process.argv.includes("--dry-run");

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
  const { db, close } = createDatabase();

  try {
    const rows = await db
      .select({
        id: products.id,
        sourceKey: products.sourceKey,
        name: products.name,
        descriptionText: products.descriptionText,
        currentOverride: products.descriptionTextOverride,
      })
      .from(products)
      .where(eq(products.status, "active"));

    const bySourceKey = new Map(rows.map((row) => [row.sourceKey, row]));

    let written = 0;
    let unchanged = 0;
    const orphaned: string[] = [];

    for (const [sourceKey, copy] of Object.entries(productCopy)) {
      const row = bySourceKey.get(sourceKey);
      if (!row) {
        orphaned.push(sourceKey);
        continue;
      }

      const html = toHtml(copy.body);
      if (row.currentOverride === copy.summary) {
        unchanged += 1;
        continue;
      }

      if (!DRY_RUN) {
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

    const withoutCopy = rows.filter((row) => !(row.sourceKey in productCopy));

    console.log(`${DRY_RUN ? "[dry-run] " : ""}Product copy applied.`);
    console.log(`  written:    ${written}`);
    console.log(`  unchanged:  ${unchanged}`);
    console.log(`  in catalog: ${rows.length}`);

    if (orphaned.length > 0) {
      console.log(
        `\n  ${orphaned.length} copy entr${orphaned.length === 1 ? "y has" : "ies have"} no matching product.`,
      );
      console.log("  The source key changed or the product was removed:");
      for (const key of orphaned) console.log(`    ${key}`);
    }

    if (withoutCopy.length > 0) {
      console.log(
        `\n  ⚠ ${withoutCopy.length} active product${withoutCopy.length === 1 ? "" : "s"} still ship the source description.`,
      );
      console.log("  Add an entry to content/product-copy.ts for each:");
      for (const row of withoutCopy) console.log(`    ${row.sourceKey}  — ${row.name}`);
      console.log("\n  `pnpm check:originality` fails while any remain.");
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
    console.log(`\n  products publishing our copy: ${count} / ${rows.length}`);
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
