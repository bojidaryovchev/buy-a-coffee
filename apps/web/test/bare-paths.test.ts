import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROUTE_SEGMENTS } from "@/i18n/slugs";

/*
 * A bare path in a link is a bug.
 *
 * Every internal URL is built by `href(locale, …)` (or `categoryHref`,
 * `productHref`, `targetHref`) in `lib/routes.ts`. A link written as a string
 * — `href="/marki"`, `` `/products/${slug}` `` — carries no locale, skips the
 * slug tables, and is a 404 or a redirect the day a slug or a locale changes.
 * This reads the source and fails on one, naming the file and line.
 *
 * Allowed bare: the admin panel and the API, which have no locale by design,
 * fragments and `tel:`/`mailto:` (which do not start with `/`), and the three
 * files whose job is paths — the route table, the slug tables and the legacy
 * map.
 */

const WEB = path.resolve(import.meta.dirname, "..");
const ROOTS = ["src", "content"].map((root) => path.join(WEB, root));
const EXEMPT = [
  "src/lib/routes.ts",
  "src/lib/legacy-routes.ts",
  "src/i18n/slugs/",
  // Its matcher and its exemptions are the list of paths it must not touch.
  "src/proxy.ts",
].map((entry) => entry.split("/").join(path.sep));

/** Paths that are deliberately unprefixed. */
const UNPREFIXED =
  /^\/(admin|api|media|_next|opengraph-image|sitemap\.xml|robots\.txt|llms\.txt)(\/|$|\?)/;

const LEGACY_ROOTS =
  "products|categories|brands|search|wizard|delivery|vending|consumables|journal|contact|privacy|terms|cookies|promotions|newsletter";
const CANONICAL_ROOTS = [...new Set(ROUTE_SEGMENTS.map((key) => key.split("/")[0]))].join("|");

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

/** The source with comments blanked, keeping line numbers. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`])\/\/.*$/gm, (_, before: string) => before);
}

interface Finding {
  readonly where: string;
  readonly text: string;
}

const RULES: ReadonlyArray<{ readonly name: string; readonly pattern: RegExp }> = [
  // href="/x", href={"/x"}, href={`/x`}, href: "/x", href: `/x`
  { name: "a bare href", pattern: /\bhref\s*(?:=\s*\{?|:)\s*(["'`])(\/[^"'`]*)/g },
  // router.push("/x"), redirect("/x"), permanentRedirect(`/x`)
  {
    name: "a bare navigation",
    pattern: /\b(?:push|replace|redirect|permanentRedirect)\(\s*(["'`])(\/[^"'`]*)/g,
  },
  // Any literal that starts like a URL the shop served before locales.
  {
    name: "a pre-locale path",
    pattern: new RegExp(`(["'\`])(\\/(?:${LEGACY_ROOTS})(?:[/?#"'\`$]|$)[^"'\`]*)`, "g"),
  },
  // Any literal that spells a canonical route instead of using `routes`.
  {
    name: "a canonical path outside the route table",
    pattern: new RegExp(`(["'\`])(\\/(?:${CANONICAL_ROOTS})(?:[/?#"'\`$])[^"'\`]*)`, "g"),
  },
];

function scan(): Finding[] {
  const findings: Finding[] = [];
  for (const file of ROOTS.flatMap(files)) {
    const relative = path.relative(WEB, file);
    if (EXEMPT.some((entry) => relative.startsWith(entry))) continue;
    const lines = code(readFileSync(file, "utf8")).split("\n");
    lines.forEach((line, index) => {
      for (const rule of RULES) {
        for (const match of line.matchAll(rule.pattern)) {
          const value = match[2] ?? "";
          // A template-literal type (`/${string}`), not a link.
          if (UNPREFIXED.test(value) || value === "/${string}") continue;
          findings.push({ where: `${relative}:${index + 1}`, text: `${rule.name}: ${value}` });
        }
      }
    });
  }
  return findings;
}

describe("internal links", () => {
  it("are all built through lib/routes.ts", () => {
    const findings = scan().map((finding) => `${finding.where}  ${finding.text}`);
    expect(findings).toEqual([]);
  });

  it("would be caught if one were written bare", () => {
    const sample = [
      `<Link href="/marki">`,
      "<Link href={`/products/${slug}`}>",
      `{ href: "/wizard/machines", label: "x" }`,
      `router.push("/tarsene?q=x")`,
      `const PAGE = "/newsletter/unsubscribe";`,
    ];
    for (const line of sample) {
      const caught = RULES.some((rule) =>
        [...line.matchAll(rule.pattern)].some((match) => !UNPREFIXED.test(match[2] ?? "")),
      );
      expect(caught, line).toBe(true);
    }
    const admin = `<Link href="/admin/zayavki">`;
    expect(
      RULES.some((rule) =>
        [...admin.matchAll(rule.pattern)].some((match) => !UNPREFIXED.test(match[2] ?? "")),
      ),
    ).toBe(false);
  });
});
