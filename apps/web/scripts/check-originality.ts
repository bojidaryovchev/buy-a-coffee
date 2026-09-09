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
 *   2. Copy. Fails if a product would ship the source's own description text.
 *      This is the quieter failure: nothing looks wrong on the page, the
 *      branding scan passes, and the damage is that two domains publish the
 *      same paragraphs and a search engine picks one. Since both sites sell
 *      the same catalogue, that is a live risk on every sync, not a one-off.
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

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REFERENCE_PRODUCTS = path.resolve(WEB_ROOT, "../../reference/latest/products.json");

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
    file: "e2e/support/source-guard.ts",
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
 * How much verbatim phrasing a rewrite may share with the source it replaces.
 *
 * Measured as the share of the source's five-word sequences that also appear
 * in ours. Some overlap is unavoidable and correct: "бленд от около 70 %
 * арабика и 30 % робуста" is a fact about the coffee, and there is no honest
 * way to state it that avoids the words. Sustained overlap is not — it means
 * sentences were re-ordered rather than rewritten.
 *
 * 35 % sits above the highest legitimate value in the current catalogue (27 %,
 * a product whose description is almost entirely a blend spec) and well below
 * what a light paraphrase scores.
 */
const MAX_SOURCE_OVERLAP = 0.35;

/** Five-word window. Long enough that shared phrasing is deliberate. */
const SHINGLE_SIZE = 5;

interface ReferenceProduct {
  readonly sourceKey: string;
  readonly name: string;
  readonly descriptionText: string | null;
}

interface CopyFinding {
  readonly sourceKey: string;
  readonly name: string;
  readonly detail: string;
}

/** Fold to comparable words: case, punctuation and spacing carry no meaning here. */
function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shingles(text: string): Set<string> {
  const words = normalizeForComparison(text).split(" ").filter(Boolean);
  const result = new Set<string>();
  for (let i = 0; i + SHINGLE_SIZE <= words.length; i += 1) {
    result.add(words.slice(i, i + SHINGLE_SIZE).join(" "));
  }
  return result;
}

/** Share of `source`'s phrasing that reappears in `ours`. */
function overlapRatio(source: string, ours: string): number {
  const from = shingles(source);
  if (from.size === 0) return 0;
  const to = shingles(ours);
  let shared = 0;
  for (const shingle of from) if (to.has(shingle)) shared += 1;
  return shared / from.size;
}

/**
 * Check our copy against the source descriptions the crawler recorded.
 *
 * Deliberately reads the reference artifacts rather than the database: this
 * runs in CI, where there is no catalog to connect to, and the artifacts are
 * the same text the sync would write.
 */
async function checkProductCopy(): Promise<{ findings: CopyFinding[]; checked: number }> {
  let raw: string;
  try {
    raw = await readFile(REFERENCE_PRODUCTS, "utf8");
  } catch {
    console.log("Product copy — skipped: no reference artifacts. Run `pnpm reference:export`.\n");
    return { findings: [], checked: 0 };
  }

  const parsed = JSON.parse(raw) as { products?: ReferenceProduct[] };
  const sourceProducts = parsed.products ?? [];
  const findings: CopyFinding[] = [];

  for (const product of sourceProducts) {
    const ours = productCopy[product.sourceKey];

    if (!ours) {
      findings.push({
        sourceKey: product.sourceKey,
        name: product.name,
        detail: "no entry in content/product-copy.ts — this product ships the source description",
      });
      continue;
    }

    const sourceText = product.descriptionText?.trim();
    if (!sourceText) continue;

    const ourText = `${ours.summary} ${ours.body.join(" ")}`;
    const ratio = overlapRatio(sourceText, ourText);
    if (ratio > MAX_SOURCE_OVERLAP) {
      findings.push({
        sourceKey: product.sourceKey,
        name: product.name,
        detail: `${Math.round(ratio * 100)}% of the source's phrasing survives (limit ${Math.round(
          MAX_SOURCE_OVERLAP * 100,
        )}%) — rewrite, do not re-order`,
      });
    }

    if (normalizeForComparison(ours.summary) === normalizeForComparison(sourceText)) {
      findings.push({
        sourceKey: product.sourceKey,
        name: product.name,
        detail: "summary is the source description verbatim",
      });
    }
  }

  /*
   * Our own copy repeated across two of our own products is the same problem
   * pointed inward — two URLs on this domain competing with identical text.
   * It happens naturally: the source gives one description to a coffee sold in
   * two pack sizes, and the obvious move is to paste the rewrite into both.
   */
  const summaries = new Map<string, string[]>();
  for (const [sourceKey, copy] of Object.entries(productCopy)) {
    const key = normalizeForComparison(copy.summary);
    summaries.set(key, [...(summaries.get(key) ?? []), sourceKey]);
  }
  for (const [, keys] of summaries) {
    if (keys.length < 2) continue;
    findings.push({
      sourceKey: keys.join(", "),
      name: "(internal duplicate)",
      detail: `${keys.length} products share one summary — give each its own`,
    });
  }

  return { findings, checked: sourceProducts.length };
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
  if (copy.checked > 0) {
    console.log(`\nProduct copy — ${copy.checked} products in the reference artifacts`);
    if (copy.findings.length === 0) {
      console.log("  PASS: every product ships our own text, none of it tracking the source.");
    } else {
      console.error(`  FAIL: ${copy.findings.length} product(s) would ship duplicate copy.\n`);
      for (const finding of copy.findings) {
        console.error(`    ${finding.sourceKey}  — ${finding.name}`);
        console.error(`      ${finding.detail}`);
      }
      console.error(
        "\n  Both sites sell the same catalogue, so shared product text is duplicate " +
          "content across two domains. Edit content/product-copy.ts, then run " +
          "`pnpm --filter @catalog/web copy:apply`.",
      );
      process.exitCode = 1;
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
