#!/usr/bin/env tsx
/**
 * Originality guard.
 *
 * Two independent things are checked, because "original" fails in two
 * different ways and catching only one of them is what lets the other ship.
 *
 *   1. Branding. Fails if the customer-facing application carries the source
 *      site's name, domain or credentials, or would load images from the
 *      source domain at runtime.
 *
 *   2. Copy. Fails if the copy we wrote for a product tracks the source's own
 *      description, or repeats across two of our own products. This is the
 *      quieter failure: nothing looks wrong on the page, the branding scan
 *      passes, and the damage is that two domains publish the same paragraphs
 *      and a search engine picks one.
 *
 *      The same standard applies to everything else we wrote by hand — the
 *      category introductions, the Vending and Consumables pages and the
 *      journal articles (`content-audit.ts`): none may share a long run of
 *      words with a text the snapshot holds, and no two may repeat each other.
 *
 *      A product with no copy of its own is *not* a failure. It publishes a
 *      sentence generated from its attributes (`lib/catalog/fallback-copy.ts`)
 *      and never the source's text, and the sync adds such products on its own
 *      schedule — so they are counted here and listed by `pnpm copy:todo`.
 *      `test/fallback-copy.test.ts` is what holds the generated sentence to
 *      the same standard, over every product in the snapshot.
 *
 * The crawler is *supposed* to know about the source, so the branding scan is
 * scoped to the storefront and to a small, explicit allowlist of files whose
 * job is to talk about the source (this script itself, the image guard that
 * blocks the domain, and documentation).
 */
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { productCopy } from "../content/product-copy.ts";
import {
  auditOwnContent,
  ownContentPieces,
  productCopyPieces,
  sourceTexts,
  MAX_INTERNAL_RUN_WORDS,
  MAX_SOURCE_RUN_WORDS,
} from "./content-audit.ts";
import {
  MAX_SOURCE_OVERLAP,
  auditProductCopy,
  loadReferencePages,
  loadReferenceSnapshot,
} from "./copy-audit.ts";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Case-insensitive patterns that must not appear in customer-facing code. */
const FORBIDDEN: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /kafezona\.com/i, label: "source domain" },
  { pattern: /kafezona/i, label: "source brand name" },
  { pattern: /КафеЗона/i, label: "source brand name (Cyrillic)" },
  { pattern: /backend\.airacms\.com/i, label: "source third-party endpoint" },
  { pattern: /kz1_[0-9a-f]+/i, label: "source tenant key" },
];

/**
 * Files allowed to mention the source, with the reason.
 * Anything not listed here must be clean.
 */
const ALLOWLIST: ReadonlyArray<{ file: string; reason: string }> = [
  {
    file: "scripts/check-originality.ts",
    reason: "this check necessarily names what it forbids",
  },
  {
    file: "src/lib/catalog/images.ts",
    reason: "blocks the source domain; the pattern must be named to be blocked",
  },
  {
    file: "scripts/reference-coverage.ts",
    reason: "reads the reference artifacts produced by the crawler",
  },
  {
    file: "e2e/support/source-patterns.ts",
    reason: "the single place the test suite names the source, so specs need not",
  },
  {
    file: "test/format.test.ts",
    reason: "asserts that source-domain image URLs are rejected",
  },
];

const SKIP_DIRECTORIES = new Set([
  "node_modules",
  ".next",
  "test-results",
  "playwright-report",
  "coverage",
  ".turbo",
]);

const SCANNED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".css",
  ".json",
  ".mjs",
  ".html",
]);

interface Finding {
  readonly file: string;
  readonly line: number;
  readonly label: string;
  readonly excerpt: string;
}

/**
 * Check our copy against the source descriptions the crawler recorded.
 *
 * Deliberately reads the reference artifacts rather than the database: this
 * runs in CI, where there is no catalog to connect to, and the artifacts are
 * the same text the sync would write. The join between the two is the
 * storefront slug, which the artifacts carry for exactly this purpose.
 */
async function checkProductCopy() {
  const snapshot = await loadReferenceSnapshot();
  if (!snapshot) {
    console.log("\nProduct copy — skipped: no reference artifacts. Run `pnpm reference:export`.");
    return null;
  }
  return auditProductCopy(snapshot.products, productCopy);
}

/**
 * Check the rest of our hand-written content against the same snapshot.
 *
 * Prints what was and was not compared. The snapshot holds product
 * descriptions and a few pages' meta descriptions; it holds no category
 * description, no brand description and no blog article. Saying so is the point:
 * a pass here means "shares nothing with the text we have", not "shares nothing
 * with the source".
 */
async function checkWrittenContent(): Promise<void> {
  const snapshot = await loadReferenceSnapshot();
  if (!snapshot) {
    console.log(
      "\nWritten content — skipped: no reference artifacts. Run `pnpm reference:export`.",
    );
    return;
  }
  const pages = await loadReferencePages();
  const sources = sourceTexts(snapshot.products, pages);
  const pieces = ownContentPieces();
  const audit = auditOwnContent([...pieces, ...productCopyPieces()], sources);

  const count = (kind: string) => pieces.filter((piece) => piece.kind === kind).length;
  const productSources = sources.filter((source) => source.id.startsWith("product:")).length;
  console.log(
    `\nWritten content — ${pieces.length} pieces: ${count("category")} category introductions, ` +
      `${count("business")} business pages (Vending, Consumables), ${count("journal")} journal articles`,
  );
  console.log(
    `  compared with ${sources.length} source texts the snapshot holds: ` +
      `${productSources} product descriptions, ${sources.length - productSources} page meta descriptions.`,
  );
  const pageKinds = [
    ...new Set(
      sources
        .filter((source) => source.id.startsWith("page:"))
        .map((source) => source.id.split(":")[1]),
    ),
  ].sort();
  console.log(`  Page meta descriptions come from: ${pageKinds.join(", ") || "no page"}.`);
  console.log(
    "  NOT compared with: the body text of category, brand and blog pages (the snapshot " +
      "records their meta descriptions only), or the source's page titles.",
  );
  console.log(
    "  A pass therefore means these share nothing with the text we have, not that they " +
      "share nothing with the body of the source's category or blog pages.",
  );

  if (audit.findings.length === 0) {
    console.log(
      `  PASS: longest run shared with a source text is ${audit.maxSourceRun} words (limit ${
        MAX_SOURCE_RUN_WORDS - 1
      }), highest source overlap ${Math.round(audit.maxSourceOverlap * 100)}% (limit ${Math.round(
        MAX_SOURCE_OVERLAP * 100,
      )}%).`,
    );
    console.log(
      `  PASS: no two of our pieces repeat each other — longest shared run ${
        audit.maxInternalRun
      } words (limit ${MAX_INTERNAL_RUN_WORDS}), highest overlap ${Math.round(
        audit.maxInternalOverlap * 100,
      )}% (limit ${Math.round(MAX_SOURCE_OVERLAP * 100)}%), checked also against ${
        Object.keys(productCopy).length
      } product copy entries.`,
    );
    return;
  }

  console.error(`  FAIL: ${audit.findings.length} problem(s) with the content we wrote.\n`);
  for (const finding of audit.findings) {
    console.error(`    ${finding.piece}  vs  ${finding.against}`);
    console.error(`      ${finding.detail}`);
  }
  console.error(
    "\n  Rewrite the passage in our own words: content/category-copy.ts, content/vending.ts " +
      "or content/journal/.",
  );
  process.exitCode = 1;
}

async function* walk(directory: string): AsyncGenerator<string> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      yield* walk(path.join(directory, entry.name));
      continue;
    }
    yield path.join(directory, entry.name);
  }
}

async function main(): Promise<void> {
  const allowed = new Set(ALLOWLIST.map((entry) => path.normalize(entry.file)));
  const findings: Finding[] = [];
  let scanned = 0;

  for await (const absolute of walk(WEB_ROOT)) {
    const relative = path.relative(WEB_ROOT, absolute);
    if (allowed.has(path.normalize(relative))) continue;
    if (!SCANNED_EXTENSIONS.has(path.extname(absolute))) continue;

    const info = await stat(absolute);
    // Skip anything implausibly large; source files are not megabytes.
    if (info.size > 2_000_000) continue;

    scanned += 1;
    const content = await readFile(absolute, "utf8");
    const lines = content.split("\n");

    for (const { pattern, label } of FORBIDDEN) {
      if (!pattern.test(content)) continue;
      lines.forEach((line, index) => {
        if (pattern.test(line)) {
          findings.push({
            file: relative,
            line: index + 1,
            label,
            excerpt: line.trim().slice(0, 120),
          });
        }
      });
    }
  }

  console.log(`Originality check — scanned ${scanned} files in apps/web\n`);

  console.log("Branding");
  if (findings.length === 0) {
    console.log("  PASS: no source branding, domain or credentials in the storefront.");
    console.log("  Allowed exceptions:");
    for (const entry of ALLOWLIST) console.log(`    - ${entry.file}: ${entry.reason}`);
  } else {
    console.error(`  FAIL: ${findings.length} reference(s) to the source site found.\n`);
    for (const finding of findings) {
      console.error(`    ${finding.file}:${finding.line}  [${finding.label}]`);
      console.error(`      ${finding.excerpt}`);
    }
    console.error(
      "\n  The customer-facing app must not carry the source site's branding. " +
        "If a file legitimately needs to name it, add it to ALLOWLIST with a reason.",
    );
    process.exitCode = 1;
  }

  const copy = await checkProductCopy();
  if (copy && copy.checked > 0) {
    console.log(`\nProduct copy — ${copy.checked} products in the reference artifacts`);
    console.log(`  ${copy.compared} have copy of their own, compared against the source's text.`);

    if (copy.findings.length === 0) {
      console.log("  PASS: none of our copy tracks the source, and no summary is used twice.");
    } else {
      console.error(`  FAIL: ${copy.findings.length} problem(s) with the copy we publish.\n`);
      for (const finding of copy.findings) {
        console.error(`    ${finding.key}  — ${finding.name}`);
        console.error(`      ${finding.detail}`);
      }
      console.error(
        "\n  Both sites sell the same catalogue, so shared product text is duplicate " +
          "content across two domains. Edit content/product-copy.ts, then run " +
          "`pnpm --filter @catalog/web copy:apply`.",
      );
      process.exitCode = 1;
    }

    /*
     * Reported, never failed on. These products publish the generated
     * sentence, so nothing of the source's is on their pages; what they lack
     * is copy worth reading, and that is a to-do list rather than a defect.
     */
    if (copy.withoutCopy.length > 0) {
      console.log(
        `\n  ${copy.withoutCopy.length} product(s) have no copy of their own yet and publish ` +
          "the generated sentence.",
      );
      console.log("  Not a failure. `pnpm copy:todo` lists them.");
    }

    if (copy.unverifiedEntries.length > 0) {
      console.log(
        `\n  ${copy.unverifiedEntries.length} entr${
          copy.unverifiedEntries.length === 1 ? "y" : "ies"
        } in content/product-copy.ts could not be compared: no product in the snapshot has that slug.`,
      );
      console.log("  Either the slug is mistyped or the snapshot predates the product:");
      for (const slug of copy.unverifiedEntries) console.log(`    ${slug}`);
    }
  }

  await checkWrittenContent();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
