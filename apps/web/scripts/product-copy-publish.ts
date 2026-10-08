/**
 * Writing our product copy into the override columns.
 *
 * Shared by `copy:apply` and `seed:reference`, so that the seed publishes copy
 * by exactly the rule the real command does and the two cannot drift. This
 * file has no entry point and opens no connection of its own.
 *
 * It touches the two override columns and nothing else — in particular never
 * `description_text` or `description_html`, which belong to the sync and record
 * what the source published.
 */
import { eq } from "drizzle-orm";
import type { Database } from "@catalog/db";
import { products } from "@catalog/db/schema";
import type { ProductCopy } from "../content/product-copy.ts";

/**
 * Escape before wrapping in `<p>`.
 *
 * The copy file holds plain text, and it is a text file a human edits — an
 * ampersand or an angle bracket typed into a sentence must not become markup
 * on the way to the database. The sanitiser on the render path would catch
 * malformed output, but relying on it would mean deliberately storing broken
 * HTML and hoping something downstream fixes it.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function toHtml(paragraphs: readonly string[]): string {
  return paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n");
}

export interface CopyPublishRow {
  readonly id: string;
  readonly slug: string;
  readonly status: string;
  readonly currentText: string | null;
  readonly currentHtml: string | null;
}

export interface CopyPublishResult {
  readonly matched: number;
  readonly written: number;
  readonly unchanged: number;
  /** Entries no product answers to. */
  readonly orphaned: readonly string[];
}

/**
 * Apply `copy` to `rows`, matched by slug.
 *
 * Every row, whatever its status: a removed product keeps its URL and still
 * renders a page, so it should keep wearing our copy. A plain idempotent
 * update — running it twice changes nothing the second time.
 */
export async function publishProductCopy(
  db: Database,
  rows: readonly CopyPublishRow[],
  copy: Readonly<Record<string, ProductCopy>>,
  options: { readonly dryRun?: boolean } = {},
): Promise<CopyPublishResult> {
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  let matched = 0;
  let written = 0;
  let unchanged = 0;
  const orphaned: string[] = [];

  for (const [slug, entry] of Object.entries(copy)) {
    const row = bySlug.get(slug);
    if (!row) {
      orphaned.push(slug);
      continue;
    }
    matched += 1;

    const html = toHtml(entry.body);
    // Both columns are compared: an edit to the body alone leaves the
    // summary identical and still has to be written.
    if (row.currentText === entry.summary && row.currentHtml === html) {
      unchanged += 1;
      continue;
    }

    if (!options.dryRun) {
      await db
        .update(products)
        .set({
          descriptionTextOverride: entry.summary,
          descriptionHtmlOverride: html,
          // Deliberately not touching `lastChangedAt`: that column tracks
          // when the *source* changed, and the sync's diff reads it. Our
          // editorial changes are not source changes.
        })
        .where(eq(products.id, row.id));
    }
    written += 1;
  }

  return { matched, written, unchanged, orphaned };
}
