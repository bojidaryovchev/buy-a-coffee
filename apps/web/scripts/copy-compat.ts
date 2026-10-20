#!/usr/bin/env tsx
/**
 * Which product descriptions promise the wrong machines.
 *
 *   pnpm copy:compat              the database in DATABASE_URL, the copy file and the snapshot
 *   pnpm copy:compat -- --all     every finding, not the first twenty of each
 *
 * The compatibility rules (`@catalog/shared/compatibility-copy`) stop a wrong
 * promise — „машини Dolce Gusto“, which includes NEO; „домашни машини
 * Nespresso“, which includes Vertuo; Caffitaly in a K-fee; a Cafissimo without
 * Tchibo's word — from reaching a product page from now on. They do not reach
 * back: machine copy written before them stays until the product's facts
 * change. This reads what is there, and says where it came from:
 *
 *  - **the database**: every product's own copy (`description_text_override`
 *    and `description_html_override`), by `copy_origin` — `ai` is the
 *    copywriter's, `edited` the owner's correction of it, `hand` the file's;
 *  - **`content/product-copy.ts`**, the hand-written file, whose test fails on
 *    any finding — listed so a database that lags behind the file shows up;
 *  - **the generated sentence** every product without copy publishes, built
 *    from the reference snapshot's facts;
 *  - **the supplier's descriptions** in the snapshot. Never published by us,
 *    but what the copywriter reads: a wrong promise there is one the model is
 *    shown.
 *
 * Read-only by construction: one `read only` transaction holding one SELECT,
 * so even a mistaken edit to this file cannot write. It never prints the
 * database address. Exits 0 whenever it could read what it was asked to — a
 * finding is a to-do for the owner („Поискай нов текст“ in the admin for
 * machine copy, the copy file for hand copy), not a failed command.
 *
 * Scripts do not load `.env` files: export DATABASE_URL first. Without it the
 * database is skipped and the rest is still read.
 */
import { createDatabase } from "@catalog/db";
import { productCopy } from "../content/product-copy.ts";
import {
  type CompatAudit,
  type StoredCopy,
  auditStoredCopy,
  auditTexts,
  describeFinding,
} from "./copy-compat-lib.ts";
import { generatedSentenceFor, loadReferenceSnapshot } from "./copy-audit.ts";

const SHOWN = 20;

function parseArgs(argv: readonly string[]): { all: boolean } {
  const args = { all: false };
  for (const arg of argv) {
    if (arg === "--all") args.all = true;
    // pnpm forwards a bare `--` on some versions; it means nothing here.
    else if (arg === "--") continue;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

async function readDatabase(): Promise<readonly StoredCopy[] | string> {
  if (!process.env.DATABASE_URL) return "DATABASE_URL is not set — the database was not read";
  const { sql, close } = createDatabase({ max: 1, connectTimeoutSeconds: 5 });
  try {
    const rows = await sql.begin(
      "read only",
      (tx) => tx<StoredCopy[]>`
        select slug, status, copy_origin as origin,
               description_text_override as summary, description_html_override as html
        from products
        where description_text_override is not null or description_html_override is not null
        order by slug
      `,
    );
    return [...rows];
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return `the database could not be read (${reason.split("\n")[0]})`;
  } finally {
    await close().catch(() => {});
  }
}

function report(title: string, audit: CompatAudit, all: boolean): void {
  console.log(`\n${title}: ${audit.checked} checked, ${audit.findings.length} flagged`);
  for (const [origin, counts] of [...audit.byOrigin].sort()) {
    console.log(`  ${origin.padEnd(10)} ${counts.checked} checked, ${counts.flagged} flagged`);
  }
  if (audit.byRule.size > 0) {
    const rules = [...audit.byRule].map(([rule, count]) => `${rule} ${count}`).join(", ");
    console.log(`  by rule: ${rules}`);
  }
  const shown = all ? audit.findings : audit.findings.slice(0, SHOWN);
  for (const finding of shown) console.log(describeFinding(finding));
  if (shown.length < audit.findings.length) {
    console.log(`  … and ${audit.findings.length - shown.length} more (--all lists them)`);
  }
}

async function main(): Promise<void> {
  const { all } = parseArgs(process.argv.slice(2));
  console.log("Compatibility promises in product copy (read-only)");

  const stored = await readDatabase();
  if (typeof stored === "string") console.log(`\nDatabase: ${stored}.`);
  else report("Database, every product with copy of its own", auditStoredCopy(stored), all);

  report(
    "content/product-copy.ts",
    auditTexts(
      Object.entries(productCopy).map(([slug, copy]) => ({
        slug,
        origin: "file",
        fields: [copy.summary, ...copy.body],
      })),
    ),
    all,
  );

  const snapshot = await loadReferenceSnapshot();
  if (!snapshot) {
    console.log("\nReference snapshot: not found — generated and supplier text not read.");
    return;
  }
  const key = (product: { slug?: string | null; sourceKey: string }) =>
    product.slug ?? product.sourceKey;
  report(
    "Generated sentence (what a product without copy publishes), from the snapshot",
    auditTexts(
      snapshot.products.flatMap((product) => {
        const sentence = generatedSentenceFor(product, snapshot.brandNames);
        return sentence ? [{ slug: key(product), origin: "generated", fields: [sentence] }] : [];
      }),
    ),
    all,
  );
  report(
    "Supplier descriptions in the snapshot (never published; what the copywriter reads)",
    auditTexts(
      snapshot.products.flatMap((product) =>
        product.descriptionText?.trim()
          ? [{ slug: key(product), origin: "source", fields: [product.descriptionText] }]
          : [],
      ),
    ),
    all,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
