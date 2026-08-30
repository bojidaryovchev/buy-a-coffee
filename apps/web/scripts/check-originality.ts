#!/usr/bin/env tsx
/**
 * Originality guard.
 *
 * Fails the build if the customer-facing application carries the source site's
 * name, domain or branding, or if it would load images from the source domain
 * at runtime.
 *
 * The crawler is *supposed* to know about the source, so the check is scoped
 * to the storefront and to a small, explicit allowlist of files whose job is
 * to talk about the source (this script itself, the image guard that blocks
 * the domain, and documentation).
 */
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const SCANNED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".css", ".json", ".mjs", ".html"]);

interface Finding {
  readonly file: string;
  readonly line: number;
  readonly label: string;
  readonly excerpt: string;
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

  if (findings.length === 0) {
    console.log("PASS: no source branding, domain or credentials in the storefront.");
    console.log("\nAllowed exceptions:");
    for (const entry of ALLOWLIST) console.log(`  - ${entry.file}: ${entry.reason}`);
    return;
  }

  console.error(`FAIL: ${findings.length} reference(s) to the source site found.\n`);
  for (const finding of findings) {
    console.error(`  ${finding.file}:${finding.line}  [${finding.label}]`);
    console.error(`    ${finding.excerpt}`);
  }
  console.error(
    "\nThe customer-facing app must not carry the source site's branding. " +
      "If a file legitimately needs to name it, add it to ALLOWLIST with a reason.",
  );
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
