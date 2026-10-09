#!/usr/bin/env tsx
/**
 * Reference functional coverage check.
 *
 * Reads the crawler's artifacts and verifies that every observed capability of
 * the reference storefront has an implementation here. Fails when something is
 * uncovered and not explicitly, justifiably omitted.
 *
 * The point is to make regressions loud: if a future crawl discovers a new
 * feature, this check fails until someone either builds it or writes down why
 * it is not being built. Silence is the failure mode it exists to prevent.
 *
 * Two things make a claim here believable, and both are checked for every
 * capability of every kind (features, page types, filters, forms):
 *
 *   - each route it names resolves to a page or route handler in `src/app`;
 *   - each other file it names, and each test, exists.
 *
 * An earlier version checked only one file per *feature*. Page types, filters
 * and forms were plain strings nothing verified, and the doc was rewritten on
 * every run, so a moved or deleted file could not fail the check and the
 * committed matrix kept saying PASS. It took the pages moving into the
 * `(site)` route group — and the check being run in CI for the first time — to
 * show six features claiming files that had not existed for a month.
 *
 * Modes:
 *
 *   pnpm reference:coverage         CHECK. Writes nothing. Fails on an unmet or
 *                                   unverifiable claim, and when
 *                                   docs/reference-coverage.md no longer
 *                                   matches what this would generate.
 *   pnpm reference:coverage:write   Regenerates the document (only when every
 *                                   claim holds, so a failing matrix is never
 *                                   committed over a good one).
 *
 * A check that CI runs must not edit tracked files: it would pass on the build
 * machine, discard the edit, and let the committed document drift unseen.
 */
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(WEB_ROOT, "../..");
const ARTIFACT_DIR = path.join(REPO_ROOT, "reference/latest");
const OUTPUT_DOC = path.join(REPO_ROOT, "docs/reference-coverage.md");

interface Implementation {
  /** Prose for the matrix: what implements the capability. */
  readonly implementation: string;
  /** Route patterns under `[lang]`, e.g. `/marki/[slug]`. Each must resolve to a page or route handler. */
  readonly routes?: readonly string[];
  /** Other files that must exist for the claim to be credible, relative to `apps/web`. */
  readonly files?: readonly string[];
  /** Tests that prove it works, relative to `apps/web`. Each must exist. */
  readonly tests: readonly string[];
}

/**
 * Every reference feature id mapped to what implements it.
 * Keys correspond to `features.json` entries produced by the crawler.
 */
const FEATURE_COVERAGE: Record<string, Implementation> = {
  "category-browsing": {
    implementation: "/bg/kategorii, and each category at /bg/<landing slug>",
    routes: ["/kategorii", "/[slug]"],
    tests: ["e2e/catalog.spec.ts"],
  },
  "brand-browsing": {
    implementation: "/bg/marki, /bg/marki/<brand>",
    routes: ["/marki", "/marki/[slug]"],
    tests: ["e2e/catalog.spec.ts"],
  },
  "product-detail": {
    implementation: "/bg/<product slug>",
    routes: ["/[slug]"],
    tests: ["e2e/product.spec.ts"],
  },
  "catalog-filters": {
    implementation: "URL-driven filters on every listing",
    files: ["src/lib/catalog/filters.ts", "src/components/catalog/filter-panel.tsx"],
    tests: ["test/filters.test.ts", "e2e/catalog.spec.ts"],
  },
  promotions: {
    implementation: "/bg/promotsii",
    routes: ["/promotsii"],
    tests: ["e2e/catalog.spec.ts"],
  },
  "quick-order": {
    implementation: "Quick-order form on every product page, stored in order_inquiries",
    files: ["src/components/forms/quick-order-form.tsx"],
    tests: ["e2e/quick-order.spec.ts", "test/forms.test.ts"],
  },
  "newsletter-signup": {
    implementation: "Footer newsletter form, stored in newsletter_subscribers",
    files: ["src/components/forms/newsletter-form.tsx"],
    tests: ["test/forms.test.ts"],
  },
  "related-products": {
    implementation: "Related products on product pages (category, then brand)",
    files: ["src/lib/catalog/queries.ts"],
    tests: ["e2e/product.spec.ts"],
  },
  breadcrumbs: {
    implementation: "Breadcrumbs plus BreadcrumbList structured data",
    files: ["src/components/ui/primitives.tsx"],
    tests: ["e2e/product.spec.ts"],
  },
  blog: {
    implementation: "/bg/blog, and an article page at /bg/blog/<slug>",
    routes: ["/blog", "/blog/[slug]"],
    files: ["content/journal/index.ts"],
    tests: ["e2e/routes.spec.ts", "e2e/sections.spec.ts", "test/journal-content.test.ts"],
  },
  "legal-pages": {
    implementation: "/bg/poveritelnost, /bg/obshti-usloviya, /bg/biskvitki",
    routes: ["/poveritelnost", "/obshti-usloviya", "/biskvitki"],
    files: ["src/content/legal.ts"],
    tests: ["e2e/routes.spec.ts"],
  },
  "phone-contact": {
    implementation: "Phone links in header, footer and /bg/kontakti",
    routes: ["/kontakti"],
    files: ["src/config/site.ts"],
    tests: ["e2e/routes.spec.ts"],
  },
  "vending-zone": {
    implementation:
      "/bg/kafe-za-vending-mashini: our own copy, the vending blends in the catalog, and the category once the source lists products under it",
    routes: ["/kafe-za-vending-mashini"],
    files: ["src/lib/catalog/vending.ts", "src/lib/catalog/business-sections.ts"],
    tests: ["e2e/sections.spec.ts", "test/vending.test.ts", "test/business-section.test.ts"],
  },
  consumables: {
    implementation:
      "/bg/konsumativi: what the section covers and an enquiry form; its category's products once the source lists any",
    routes: ["/konsumativi"],
    files: ["src/lib/catalog/vending.ts", "content/vending.ts"],
    tests: ["e2e/sections.spec.ts", "test/business-section.test.ts"],
  },
  "product-code": {
    implementation:
      "Product code read by the sync's enrichment step, shown in the facts table and in the Product JSON-LD",
    routes: ["/[slug]"],
    files: ["src/components/catalog/facts-table.tsx", "src/lib/seo/json-ld.ts"],
    tests: ["test/product-facts.test.ts", "test/product-page-parts.test.ts"],
  },
  "product-characteristics": {
    implementation:
      "Composition, origin and roast as stated facts in the product page's facts table; the full list is stored",
    routes: ["/[slug]"],
    files: ["src/components/catalog/facts-table.tsx", "src/lib/catalog/product-facts.ts"],
    tests: ["test/product-facts.test.ts"],
  },
  "delivery-threshold": {
    implementation:
      "Announcement bar on every page, the delivery block beside the order form and /delivery, all from `siteConfig.commerce`",
    routes: ["/dostavka-i-plashtane"],
    files: ["src/components/commerce/announcement-bar.tsx", "src/components/commerce/terms.ts"],
    tests: ["test/commerce.test.ts", "test/layout-frame.test.ts"],
  },
  "payment-methods": {
    implementation:
      "Payment methods in the footer, beside the order form and on /delivery, from `siteConfig.commerce`",
    routes: ["/dostavka-i-plashtane"],
    files: ["src/components/layout/site-footer.tsx", "src/components/commerce/terms.ts"],
    tests: ["test/commerce.test.ts"],
  },
  "site-notice": {
    implementation:
      "Announcement bar on every page: the free-delivery threshold and one-step ordering. Not dismissible, because it carries the phone number and hours",
    files: ["src/components/commerce/announcement-bar.tsx"],
    tests: ["test/layout-frame.test.ts"],
  },
};

/**
 * Not a feature id from `features.json`: search is observed as a page type and
 * as a function of the catalog, so it is claimed here and checked with the rest.
 */
const SEARCH: Implementation = {
  implementation: "/bg/tarsene (PostgreSQL full-text + trigram)",
  routes: ["/tarsene"],
  files: ["src/lib/catalog/search.ts"],
  tests: ["e2e/search.spec.ts"],
};

/**
 * Capabilities deliberately not reproduced, each with a reason.
 * An entry here is a decision on the record, not a way to silence the check.
 */
const OMISSIONS: Record<string, string> = {};

/** A page type with no storefront equivalent, and why. */
interface NotApplicable {
  readonly notApplicable: string;
}

/** Page types the storefront must have an equivalent for. */
const PAGE_TYPE_COVERAGE: Record<string, Implementation | NotApplicable> = {
  home: {
    implementation: "/bg (the bare / resolves to it)",
    routes: ["/"],
    tests: ["e2e/routes.spec.ts"],
  },
  category: {
    // The reference's `vending-zona` is one of its five category pages; ours is
    // a section of its own, because it also serves business buyers.
    implementation:
      "/bg/<category landing slug>, and /bg/kafe-za-vending-mashini for the reference's vending category",
    routes: ["/[slug]", "/kafe-za-vending-mashini"],
    tests: ["e2e/routes.spec.ts", "e2e/sections.spec.ts"],
  },
  subcategory: {
    implementation: "/bg/<category landing slug>",
    routes: ["/[slug]"],
    tests: ["e2e/routes.spec.ts"],
  },
  product: {
    implementation: "/bg/<product slug>",
    routes: ["/[slug]"],
    tests: ["e2e/routes.spec.ts"],
  },
  brand: {
    implementation: "/bg/marki/<brand>",
    routes: ["/marki/[slug]"],
    tests: ["e2e/routes.spec.ts"],
  },
  brand_index: { implementation: "/bg/marki", routes: ["/marki"], tests: ["e2e/routes.spec.ts"] },
  promotion: {
    implementation: "/bg/promotsii",
    routes: ["/promotsii"],
    tests: ["e2e/routes.spec.ts"],
  },
  search: SEARCH,
  blog_index: { implementation: "/bg/blog", routes: ["/blog"], tests: ["e2e/routes.spec.ts"] },
  blog_article: {
    implementation: "/bg/blog/<slug>",
    routes: ["/blog/[slug]"],
    tests: ["e2e/sections.spec.ts"],
  },
  legal: {
    implementation: "/bg/poveritelnost, /bg/obshti-usloviya, /bg/biskvitki",
    routes: ["/poveritelnost", "/obshti-usloviya", "/biskvitki"],
    tests: ["e2e/routes.spec.ts"],
  },
  contact: { implementation: "/bg/kontakti", routes: ["/kontakti"], tests: ["e2e/routes.spec.ts"] },
  // Not storefront pages.
  soft_404: { notApplicable: "the source's not-found shell; our 404 is a real 404" },
  asset: { notApplicable: "static assets" },
  other: { notApplicable: "unclassified" },
};

/**
 * Routes this storefront has that the reference does not. They are not
 * reference capabilities, so they are not rows in the matrix — but they are
 * claimed in the document, and held to the same standard: the route and its
 * test must exist.
 */
const ADDITIONS: ReadonlyArray<{ readonly name: string } & Implementation> = [
  {
    name: "Delivery and payment terms",
    implementation: "/bg/dostavka-i-plashtane, from `siteConfig.commerce`",
    routes: ["/dostavka-i-plashtane"],
    tests: ["e2e/sections.spec.ts"],
  },
  {
    name: "Consumables for business buyers",
    implementation: "/bg/konsumativi",
    routes: ["/konsumativi"],
    tests: ["e2e/sections.spec.ts"],
  },
  {
    name: "Journal articles",
    implementation: "/bg/blog/<slug>, from `content/journal/`",
    routes: ["/blog/[slug]"],
    tests: ["e2e/sections.spec.ts"],
  },
  {
    name: "Recommendation wizard and machine finder",
    implementation: "/bg/izbor-na-kafe, /bg/izbor-na-kafe/rezultat, /bg/za-kafemashina",
    routes: ["/izbor-na-kafe", "/izbor-na-kafe/rezultat", "/za-kafemashina"],
    tests: ["e2e/wizard.spec.ts", "test/recommend.test.ts"],
  },
];

const FILTER_COVERAGE: Record<string, Implementation> = {
  brand: filter("brand search parameter, multi-value"),
  strength: filter("strength search parameter, multi-value"),
  decaf: filter("decaf search parameter"),
  aromas: filter("aromas search parameter"),
  category: filter("category search parameter, multi-value"),
};

function filter(implementation: string): Implementation {
  return {
    implementation,
    files: ["src/lib/catalog/filters.ts"],
    tests: ["test/filters.test.ts"],
  };
}

const FORM_COVERAGE: Record<string, Implementation> = {
  "quick-order": {
    implementation: "Quick-order form, POSTs to our own server action",
    files: ["src/components/forms/quick-order-form.tsx"],
    tests: ["test/forms.test.ts"],
  },
  newsletter: {
    implementation: "Newsletter form, POSTs to our own server action",
    files: ["src/components/forms/newsletter-form.tsx"],
    tests: ["test/forms.test.ts"],
  },
};

/* --- Verifying a claim --------------------------------------------------- */

/**
 * Where a route pattern lives. Shop pages sit under `(site)/[lang]/`, whose
 * folder names are the canonical (Bulgarian) segments — so a pattern here is
 * the public path minus its locale: `/marki/[slug]` is `/bg/marki/<brand>`.
 * The app root is accepted too, for route handlers outside the locale tree.
 * Anything else must be a claim about a file that exists.
 */
function routeCandidates(route: string): string[] {
  const segments = route === "/" ? [] : route.replace(/^\/+/, "").split("/");
  const base = segments.join("/");
  const suffixes = ["page.tsx", "page.ts", "route.ts"];
  const roots = ["src/app/(site)/[lang]", "src/app"];
  return roots.flatMap((root) => suffixes.map((suffix) => path.posix.join(root, base, suffix)));
}

/** Every problem with a claim, each naming the path that is wrong. */
function verifyClaim(claim: Implementation): string[] {
  const problems: string[] = [];
  for (const route of claim.routes ?? []) {
    const candidates = routeCandidates(route);
    if (!candidates.some((candidate) => existsSync(path.join(WEB_ROOT, candidate)))) {
      problems.push(`route ${route} has no page: looked for ${candidates[0]}`);
    }
  }
  for (const file of claim.files ?? []) {
    if (!existsSync(path.join(WEB_ROOT, file))) problems.push(`file ${file} does not exist`);
  }
  for (const test of claim.tests) {
    if (!existsSync(path.join(WEB_ROOT, test))) problems.push(`test ${test} does not exist`);
  }
  return problems;
}

interface Row {
  readonly area: string;
  readonly reference: string;
  readonly evidence: string;
  readonly implementation: string;
  readonly test: string;
  readonly status: "PASS" | "OMITTED" | "MISSING";
}

async function readJson<T>(name: string): Promise<T | null> {
  const file = path.join(ARTIFACT_DIR, name);
  if (!existsSync(file)) return null;
  return JSON.parse(await readFile(file, "utf8")) as T;
}

const testColumn = (claim: Implementation): string => claim.tests.join(", ");

/** Add a row for `claim`, recording each problem with a path as a failure. */
function judge(
  rows: Row[],
  failures: string[],
  row: Omit<Row, "implementation" | "test" | "status">,
  claim: Implementation | undefined,
  missingMessage: string,
): void {
  if (!claim) {
    failures.push(missingMessage);
    rows.push({ ...row, implementation: "—", test: "—", status: "MISSING" });
    return;
  }
  const problems = verifyClaim(claim);
  for (const problem of problems) failures.push(`${row.area} "${row.reference}": ${problem}.`);
  rows.push({
    ...row,
    implementation: claim.implementation,
    test: testColumn(claim),
    status: problems.length > 0 ? "MISSING" : "PASS",
  });
}

async function main(): Promise<void> {
  const write = process.argv.includes("--write");

  if (!existsSync(ARTIFACT_DIR)) {
    console.error(
      `FAIL: reference artifacts not found at ${ARTIFACT_DIR}.\n` +
        "Run `pnpm crawl:discovery` first — the storefront's requirements come from there.",
    );
    process.exitCode = 1;
    return;
  }

  const features = await readJson<{
    features: Array<{ id: string; name: string; evidenceUrls: string[] }>;
  }>("features.json");
  const filters = await readJson<{ filters: Array<{ id: string; name: string }> }>("filters.json");
  const forms = await readJson<{ forms: Array<{ id: string; name: string }> }>("forms.json");
  const pageTypes = await readJson<{ counts: Record<string, number> }>("page-types.json");

  const rows: Row[] = [];
  const failures: string[] = [];

  for (const feature of features?.features ?? []) {
    if (OMISSIONS[feature.id]) {
      rows.push({
        area: "Feature",
        reference: feature.name,
        evidence: feature.evidenceUrls[0] ?? "—",
        implementation: "Intentionally not reproduced",
        test: "n/a",
        status: "OMITTED",
      });
      continue;
    }
    judge(
      rows,
      failures,
      { area: "Feature", reference: feature.name, evidence: feature.evidenceUrls[0] ?? "—" },
      FEATURE_COVERAGE[feature.id],
      `Feature "${feature.id}" (${feature.name}) has no implementation mapping.`,
    );
  }

  for (const entry of filters?.filters ?? []) {
    judge(
      rows,
      failures,
      { area: "Filter", reference: entry.name, evidence: "filters.json" },
      FILTER_COVERAGE[entry.id],
      `Filter "${entry.id}" is not implemented.`,
    );
  }

  for (const form of forms?.forms ?? []) {
    judge(
      rows,
      failures,
      { area: "Form", reference: form.name, evidence: "forms.json" },
      FORM_COVERAGE[form.id],
      `Form "${form.id}" is not implemented.`,
    );
  }

  for (const [pageType, count] of Object.entries(pageTypes?.counts ?? {})) {
    if (count === 0) continue;
    const coverage = PAGE_TYPE_COVERAGE[pageType];
    const reference = `${pageType} (${count})`;
    if (coverage && "notApplicable" in coverage) {
      rows.push({
        area: "Page type",
        reference,
        evidence: "page-types.json",
        implementation: `n/a — ${coverage.notApplicable}`,
        test: "n/a",
        status: "PASS",
      });
      continue;
    }
    judge(
      rows,
      failures,
      { area: "Page type", reference, evidence: "page-types.json" },
      coverage,
      `Page type "${pageType}" has no equivalent route.`,
    );
  }

  // Routes of our own are held to the same standard even though no reference
  // row asks for them. They are not in the tally: that counts the reference.
  for (const addition of ADDITIONS) {
    for (const problem of verifyClaim(addition)) {
      failures.push(`Addition "${addition.name}": ${problem}.`);
    }
  }

  // Search is a capability of the catalog rather than a feature id; verify it
  // even when no page type of the snapshot happens to name it.
  for (const problem of verifyClaim(SEARCH)) failures.push(`Search: ${problem}.`);

  const tally = (area: string) => {
    const subset = rows.filter((row) => row.area === area);
    const covered = subset.filter((row) => row.status !== "MISSING").length;
    return `${covered}/${subset.length}`;
  };

  console.log("Reference functional coverage\n");
  console.log(`  Features:   ${tally("Feature")}`);
  console.log(`  Filters:    ${tally("Filter")}`);
  console.log(`  Forms:      ${tally("Form")}`);
  console.log(`  Page types: ${tally("Page type")}`);
  console.log(`  Runtime source-domain dependency: NONE (see check:originality)\n`);

  if (failures.length > 0) {
    console.error(`FAIL: ${failures.length} unmet or unverifiable claim(s):\n`);
    for (const failure of [...new Set(failures)]) console.error(`  - ${failure}`);
    console.error(
      "\nEither implement it, fix the path in scripts/reference-coverage.ts, " +
        "or add it to OMISSIONS with a written reason.",
    );
    process.exitCode = 1;
    return;
  }

  const document = renderDocument(rows);
  const relativeDoc = path.relative(REPO_ROOT, OUTPUT_DOC);

  if (write) {
    await writeFile(OUTPUT_DOC, document, "utf8");
    console.log(`Coverage matrix written to ${relativeDoc}`);
  } else {
    const committed = existsSync(OUTPUT_DOC)
      ? (await readFile(OUTPUT_DOC, "utf8")).replace(/\r\n/g, "\n")
      : null;
    if (committed !== document) {
      console.error(
        `FAIL: ${relativeDoc} is ${committed === null ? "missing" : "out of date"}.\n` +
          "It is generated from this script and the reference artifacts. Run " +
          "`pnpm reference:coverage:write` and commit the result.",
      );
      process.exitCode = 1;
      return;
    }
  }
  console.log("PASS: every observed reference capability is covered or explicitly omitted,");
  console.log("      every file, route and test it names exists, and the matrix is current.");
}

function renderDocument(rows: readonly Row[]): string {
  const lines: string[] = [];
  lines.push("# Reference coverage matrix");
  lines.push("");
  lines.push(
    "Generated by `pnpm reference:coverage:write`. Do not edit by hand. `pnpm reference:coverage` checks it and writes nothing.",
  );
  lines.push("");
  lines.push(
    "Every capability observed on the reference site, and what implements it here. " +
      "The check fails CI when something observed has no implementation and no written reason for its absence, " +
      "when a route, file or test named below does not exist, and when this document no longer matches what the check generates.",
  );
  lines.push("");

  for (const area of ["Feature", "Page type", "Filter", "Form"]) {
    const subset = rows.filter((row) => row.area === area);
    if (subset.length === 0) continue;
    lines.push(`## ${area}s`);
    lines.push("");
    lines.push("| Reference capability | Our implementation | Test | Status |");
    lines.push("| --- | --- | --- | --- |");
    for (const row of subset) {
      lines.push(`| ${row.reference} | ${row.implementation} | ${row.test} | ${row.status} |`);
    }
    lines.push("");
  }

  lines.push("## Routes with no counterpart in the reference");
  lines.push("");
  lines.push(
    "These are not reference capabilities, so they are not rows above. They are listed so that the matrix is not mistaken for the whole route table, and the check holds them to the same standard: the route and its test must exist.",
  );
  lines.push("");
  lines.push("| Capability | Our implementation | Test |");
  lines.push("| --- | --- | --- |");
  for (const addition of ADDITIONS) {
    lines.push(`| ${addition.name} | ${addition.implementation} | ${testColumn(addition)} |`);
  }
  lines.push("");

  if (Object.keys(OMISSIONS).length > 0) {
    lines.push("## Intentional omissions");
    lines.push("");
    for (const [id, reason] of Object.entries(OMISSIONS)) {
      lines.push(`### \`${id}\``);
      lines.push("");
      lines.push(reason);
      lines.push("");
    }
  }

  lines.push("## Deliberate differences from the reference");
  lines.push("");
  lines.push(
    "- **Filtering and search run on the server.** The reference filters a fully-rendered list in the browser and searches an embedded copy of the catalog. Ours query PostgreSQL, so filtered views are server-rendered, shareable and crawlable, and the whole catalog is not shipped to every visitor.",
  );
  lines.push(
    "- **Search matches across both alphabets, and suggests as you type.** The reference matches the query string literally against an embedded catalog, so a Latin query never reaches a Cyrillic name and there is no type-ahead. Ours folds both the catalog and the query to one canonical form before comparing — `rema` finds „Рема“ and „рема“ finds “Rema” — and `/api/search/suggest` returns products with their images while the visitor is still typing.",
  );
  lines.push(
    "- **Listings paginate and can be sorted.** The reference renders every product at once with no sort control. Pagination and sorting are additions, not omissions.",
  );
  lines.push(
    "- **Forms post to our own endpoints.** The reference posts to a third-party CMS. Ours validate, rate-limit and store in our own database.",
  );
  lines.push(
    "- **Removed products get a real page.** The reference has no concept of a retired product. Ours keeps the URL and explains that the item is gone, rather than 404ing a link that may be indexed.",
  );
  lines.push(
    '- **A recommendation wizard, and machine compatibility pages.** The reference has neither. `/bg/izbor-na-kafe` asks four questions and ranks the compatible catalog against the answers; `/bg/za-kafemashina` answers "which capsule fits my machine" from our own editorial data, including for machines we cannot supply. Neither is derived from the source, so neither can be checked against it — they are covered by `test/recommend.test.ts` and `e2e/wizard.spec.ts` instead.',
  );
  lines.push(
    "- **Price per cup.** Derived from pack size and price, shown alongside the pack price. The reference shows pack price only, which reverses the true ordering: 100 capsules at EUR 33.25 is cheaper per cup than 16 at EUR 5.60.",
  );
  lines.push("");
  return lines.join("\n");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
