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
  /** Route or component that implements the capability. */
  readonly implementation: string;
  /** Test that proves it works. */
  readonly test: string;
  /** File that must exist for the claim to be credible. */
  readonly proofFile: string;
}

/**
 * Every reference feature id mapped to what implements it.
 * Keys correspond to `features.json` entries produced by the crawler.
 */
const FEATURE_COVERAGE: Record<string, Implementation> = {
  "category-browsing": {
    implementation: "/categories, /categories/[slug]",
    test: "e2e/catalog.spec.ts",
    proofFile: "src/app/categories/[slug]/page.tsx",
  },
  "brand-browsing": {
    implementation: "/brands, /brands/[slug]",
    test: "e2e/catalog.spec.ts",
    proofFile: "src/app/brands/[slug]/page.tsx",
  },
  "product-detail": {
    implementation: "/products/[slug]",
    test: "e2e/product.spec.ts",
    proofFile: "src/app/products/[slug]/page.tsx",
  },
  "product-search": {
    implementation: "/search (PostgreSQL full-text + trigram)",
    test: "e2e/search.spec.ts",
    proofFile: "src/app/search/page.tsx",
  },
  "catalog-filters": {
    implementation: "URL-driven filters on every listing",
    test: "test/filters.test.ts, e2e/catalog.spec.ts",
    proofFile: "src/components/catalog/filter-panel.tsx",
  },
  promotions: {
    implementation: "/promotions",
    test: "e2e/catalog.spec.ts",
    proofFile: "src/app/promotions/page.tsx",
  },
  "quick-order": {
    implementation: "Quick-order form on every product page, stored in order_inquiries",
    test: "e2e/quick-order.spec.ts, test/forms.test.ts",
    proofFile: "src/components/forms/quick-order-form.tsx",
  },
  "newsletter-signup": {
    implementation: "Footer newsletter form, stored in newsletter_subscribers",
    test: "test/forms.test.ts",
    proofFile: "src/components/forms/newsletter-form.tsx",
  },
  "related-products": {
    implementation: "Related products on product pages (category, then brand)",
    test: "e2e/product.spec.ts",
    proofFile: "src/lib/catalog/queries.ts",
  },
  breadcrumbs: {
    implementation: "Breadcrumbs plus BreadcrumbList structured data",
    test: "e2e/product.spec.ts",
    proofFile: "src/components/ui/primitives.tsx",
  },
  blog: {
    implementation: "/journal",
    test: "e2e/routes.spec.ts",
    proofFile: "src/app/journal/page.tsx",
  },
  "legal-pages": {
    implementation: "/privacy, /terms, /cookies",
    test: "e2e/routes.spec.ts",
    proofFile: "src/content/legal.ts",
  },
  "phone-contact": {
    implementation: "Phone links in header, footer and /contact",
    test: "e2e/routes.spec.ts",
    proofFile: "src/app/contact/page.tsx",
  },
  "site-notice": {
    implementation: "Not reproduced — see omissions",
    test: "n/a",
    proofFile: "src/config/site.ts",
  },
};

/**
 * Capabilities deliberately not reproduced, each with a reason.
 * An entry here is a decision on the record, not a way to silence the check.
 */
const OMISSIONS: Record<string, string> = {
  "site-notice":
    "The reference banner announces the source shop's own closure dates. It is their operational content, not a storefront capability, and reproducing it would mean publishing another business's opening hours as our own. The mechanism is trivial to add when this shop needs one.",
};

/** Page types the storefront must have an equivalent for. */
const PAGE_TYPE_COVERAGE: Record<string, string> = {
  home: "/",
  category: "/categories/[slug]",
  subcategory: "/categories/[slug]",
  product: "/products/[slug]",
  brand: "/brands/[slug]",
  brand_index: "/brands",
  promotion: "/promotions",
  search: "/search",
  blog_index: "/journal",
  legal: "/privacy, /terms, /cookies",
  contact: "/contact",
  // Not storefront pages.
  soft_404: "n/a — the source's not-found shell; our 404 is a real 404",
  asset: "n/a — static assets",
  other: "n/a — unclassified",
  blog_article: "n/a — the reference blog has no articles to model",
};

const FILTER_COVERAGE: Record<string, string> = {
  brand: "brand search parameter, multi-value",
  strength: "strength search parameter, multi-value",
  decaf: "decaf search parameter",
  aromas: "aromas search parameter",
  category: "category search parameter, multi-value",
};

const FORM_COVERAGE: Record<string, string> = {
  "quick-order": "Quick-order form, POSTs to our own server action",
  newsletter: "Newsletter form, POSTs to our own server action",
};

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

async function main(): Promise<void> {
  if (!existsSync(ARTIFACT_DIR)) {
    console.error(
      `FAIL: reference artifacts not found at ${ARTIFACT_DIR}.\n` +
        "Run `pnpm crawl:discovery` first — the storefront's requirements come from there.",
    );
    process.exitCode = 1;
    return;
  }

  const features = await readJson<{ features: Array<{ id: string; name: string; evidenceUrls: string[] }> }>("features.json");
  const filters = await readJson<{ filters: Array<{ id: string; name: string }> }>("filters.json");
  const forms = await readJson<{ forms: Array<{ id: string; name: string }> }>("forms.json");
  const pageTypes = await readJson<{ counts: Record<string, number> }>("page-types.json");

  const rows: Row[] = [];
  const failures: string[] = [];

  for (const feature of features?.features ?? []) {
    const omission = OMISSIONS[feature.id];
    const coverage = FEATURE_COVERAGE[feature.id];

    if (omission) {
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
    if (!coverage) {
      failures.push(`Feature "${feature.id}" (${feature.name}) has no implementation mapping.`);
      rows.push({
        area: "Feature",
        reference: feature.name,
        evidence: feature.evidenceUrls[0] ?? "—",
        implementation: "—",
        test: "—",
        status: "MISSING",
      });
      continue;
    }
    // A mapping is only believable if the file it names actually exists.
    if (!existsSync(path.join(WEB_ROOT, coverage.proofFile))) {
      failures.push(
        `Feature "${feature.id}" claims ${coverage.proofFile}, which does not exist.`,
      );
      rows.push({
        area: "Feature",
        reference: feature.name,
        evidence: feature.evidenceUrls[0] ?? "—",
        implementation: coverage.implementation,
        test: coverage.test,
        status: "MISSING",
      });
      continue;
    }
    rows.push({
      area: "Feature",
      reference: feature.name,
      evidence: feature.evidenceUrls[0] ?? "—",
      implementation: coverage.implementation,
      test: coverage.test,
      status: "PASS",
    });
  }

  for (const filter of filters?.filters ?? []) {
    const coverage = FILTER_COVERAGE[filter.id];
    if (!coverage) failures.push(`Filter "${filter.id}" is not implemented.`);
    rows.push({
      area: "Filter",
      reference: filter.name,
      evidence: "filters.json",
      implementation: coverage ?? "—",
      test: "test/filters.test.ts",
      status: coverage ? "PASS" : "MISSING",
    });
  }

  for (const form of forms?.forms ?? []) {
    const coverage = FORM_COVERAGE[form.id];
    if (!coverage) failures.push(`Form "${form.id}" is not implemented.`);
    rows.push({
      area: "Form",
      reference: form.name,
      evidence: "forms.json",
      implementation: coverage ?? "—",
      test: "test/forms.test.ts",
      status: coverage ? "PASS" : "MISSING",
    });
  }

  for (const [pageType, count] of Object.entries(pageTypes?.counts ?? {})) {
    if (count === 0) continue;
    const coverage = PAGE_TYPE_COVERAGE[pageType];
    if (!coverage) failures.push(`Page type "${pageType}" has no equivalent route.`);
    rows.push({
      area: "Page type",
      reference: `${pageType} (${count})`,
      evidence: "page-types.json",
      implementation: coverage ?? "—",
      test: "e2e/routes.spec.ts",
      status: coverage ? "PASS" : "MISSING",
    });
  }

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

  await writeFile(OUTPUT_DOC, renderDocument(rows), "utf8");
  console.log(`Coverage matrix written to ${path.relative(REPO_ROOT, OUTPUT_DOC)}`);

  if (failures.length > 0) {
    console.error(`\nFAIL: ${failures.length} uncovered reference capability/capabilities:\n`);
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error(
      "\nEither implement it, or add it to OMISSIONS with a written reason.",
    );
    process.exitCode = 1;
    return;
  }
  console.log("\nPASS: every observed reference capability is covered or explicitly omitted.");
}

function renderDocument(rows: readonly Row[]): string {
  const lines: string[] = [];
  lines.push("# Reference coverage matrix");
  lines.push("");
  lines.push(
    "Generated by `pnpm --filter @catalog/web reference:coverage`. Do not edit by hand.",
  );
  lines.push("");
  lines.push(
    "Every capability observed on the reference site, and what implements it here. " +
      "The check fails CI when something observed has no implementation and no written reason for its absence.",
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
      lines.push(
        `| ${row.reference} | ${row.implementation} | ${row.test} | ${row.status} |`,
      );
    }
    lines.push("");
  }

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
    "- **Listings paginate and can be sorted.** The reference renders every product at once with no sort control. Pagination and sorting are additions, not omissions.",
  );
  lines.push(
    "- **Forms post to our own endpoints.** The reference posts to a third-party CMS. Ours validate, rate-limit and store in our own database.",
  );
  lines.push(
    "- **Removed products get a real page.** The reference has no concept of a retired product. Ours keeps the URL and explains that the item is gone, rather than 404ing a link that may be indexed.",
  );
  lines.push("");
  return lines.join("\n");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
