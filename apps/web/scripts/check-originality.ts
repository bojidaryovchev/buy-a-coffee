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
import { auditProductCopy, loadReferenceSnapshot } from "./copy-audit.ts";

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
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
