import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Database } from "@catalog/db";
import {
  brands,
  categories,
  productCategories,
  productImages,
  products,
  syncChanges,
  syncRuns,
} from "@catalog/db/schema";
import { normalizeLabel } from "@catalog/shared";

/**
 * Catalog invariants.
 *
 * What must be true of the catalog after any sync, checked against the
 * database rather than against what the sync believes it did. Read-only.
 *
 *   1. No product is listed twice. Two listed rows sharing brand, name and
 *      pack size are one product the sync failed to recognise across a rename
 *      — unless the source itself lists both, which it does for one real pair.
 *   2. Every row that was moved to a new source key still has the slug and the
 *      hand-written copy it had before the move.
 *   3. No listed product has a price of zero or less. A null price is allowed
 *      and means "price on request"; it is counted, not failed.
 *   4. Every listed product has at least one active image.
 *   5. No two active brands, and no two active categories, carry the same
 *      source id: that is one brand or category on two rows.
 *   6. No active brand or category is both renamed and empty. A row that was
 *      moved to a new key and then holds no active product has lost its
 *      products to a twin.
 */

/** `metadata.kind` on the `sync_runs` row that `catalog:link` writes. */
export const MANUAL_LINK_RUN_KIND = "manual_link";

export interface VerifyProductRef {
  readonly slug: string;
  readonly name: string;
  readonly sourceKey: string;
  readonly status: "active" | "missing" | "removed";
}

export interface DuplicateGroup {
  readonly brand: string | null;
  readonly name: string;
  readonly pack: string | null;
  readonly products: VerifyProductRef[];
}

export interface MovedProductViolation {
  /** The key the product was moved to. */
  readonly sourceKey: string;
  readonly problem: "row_deleted" | "slug_changed" | "text_override_lost" | "html_override_lost";
  readonly expectedSlug: string | null;
  readonly actualSlug: string | null;
}

export interface TaxonomyRef {
  readonly kind: "brand" | "category";
  readonly slug: string;
  readonly name: string;
  readonly sourceKey: string;
}

export interface SharedSourceIdGroup {
  readonly kind: "brand" | "category";
  readonly sourceId: string;
  readonly rows: TaxonomyRef[];
}

export interface CatalogVerifyReport {
  readonly ok: boolean;
  readonly violationCount: number;
  readonly activeProducts: number;
  readonly movedProducts: number;
  readonly activeBrands: number;
  readonly activeCategories: number;
  readonly violations: {
    readonly duplicates: DuplicateGroup[];
    readonly moved: MovedProductViolation[];
    readonly invalidPrices: Array<VerifyProductRef & { readonly price: string }>;
    readonly withoutActiveImage: VerifyProductRef[];
    readonly sharedSourceIds: SharedSourceIdGroup[];
    readonly renamedAndEmpty: Array<TaxonomyRef & { readonly previousSourceKeys: string[] }>;
  };
  readonly notices: {
    /** Listed with no price at all: shown as "price on request". */
    readonly priceOnRequest: VerifyProductRef[];
    /** Same brand, name and pack size, but the source lists each one itself. */
    readonly sourceListedTwins: DuplicateGroup[];
  };
}

function packOf(row: {
  sourceData: unknown;
  weightValue: string | null;
  weightUnit: string | null;
  weight: string | null;
}): string | null {
  const canonical = (row.sourceData as Record<string, unknown> | null)?.weightCanonical;
  if (typeof canonical === "string" && canonical !== "") return canonical;
  if (row.weightValue !== null && row.weightUnit !== null) {
    // `numeric` comes back padded (`1000.0000`); the canonical form is not.
    return `${row.weightValue.replace(/\.?0+$/, "")}${row.weightUnit}`;
  }
  return row.weight ? normalizeLabel(row.weight).toLowerCase() : null;
}

export async function verifyCatalog(db: Database): Promise<CatalogVerifyReport> {
  // Removed rows are history, not catalog. `missing` rows still count: a
  // product marked missing beside an identical active one is the signature of
  // a rename the sync did not pair.
  const listed = await db
    .select({
      id: products.id,
      sourceSiteId: products.sourceSiteId,
      slug: products.slug,
      name: products.name,
      sourceKey: products.sourceKey,
      status: products.status,
      brandId: products.brandId,
      brandName: brands.name,
      currentPrice: products.currentPrice,
      retailPriceOverride: products.retailPriceOverride,
      weight: products.weight,
      weightValue: products.weightValue,
      weightUnit: products.weightUnit,
      sourceData: products.sourceData,
      latestSyncRunId: products.latestSyncRunId,
    })
    .from(products)
    .leftJoin(brands, eq(brands.id, products.brandId))
    .where(ne(products.status, "removed"))
    .orderBy(products.slug);

  const ref = (row: (typeof listed)[number]): VerifyProductRef => ({
    slug: row.slug,
    name: row.name,
    sourceKey: row.sourceKey,
    status: row.status,
  });
  const active = listed.filter((row) => row.status === "active");

  // --- 1. Duplicates --------------------------------------------------------
  // The newest real sync per site: the run whose listing says what the source
  // currently publishes. A manual link is not a reading of the source.
  const runs = await db
    .select({ id: syncRuns.id, sourceSiteId: syncRuns.sourceSiteId })
    .from(syncRuns)
    .where(
      and(
        eq(syncRuns.dryRun, false),
        inArray(syncRuns.status, ["succeeded", "partial"]),
        sql`coalesce(${syncRuns.metadata}->>'kind', '') <> ${MANUAL_LINK_RUN_KIND}`,
      ),
    )
    .orderBy(desc(syncRuns.startedAt));
  const latestRunBySite = new Map<string, string>();
  for (const run of runs) {
    if (!latestRunBySite.has(run.sourceSiteId)) latestRunBySite.set(run.sourceSiteId, run.id);
  }

  const groups = new Map<string, typeof listed>();
  for (const row of listed) {
    const key = JSON.stringify([
      row.sourceSiteId,
      row.brandId,
      normalizeLabel(row.name).toLowerCase(),
      packOf(row),
    ]);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  const duplicates: DuplicateGroup[] = [];
  const sourceListedTwins: DuplicateGroup[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const first = group[0] as (typeof listed)[number];
    const described: DuplicateGroup = {
      brand: first.brandName,
      name: first.name,
      pack: packOf(first),
      products: group.map(ref),
    };
    const latestRun = latestRunBySite.get(first.sourceSiteId);
    const sourceListsEach =
      latestRun !== undefined &&
      group.every((row) => row.status === "active" && row.latestSyncRunId === latestRun);
    (sourceListsEach ? sourceListedTwins : duplicates).push(described);
  }

  // --- 2. Moved products kept what they had ----------------------------------
  const moves = await db
    .select({
      sourceKey: syncChanges.sourceKey,
      after: syncChanges.after,
      productId: syncChanges.productId,
      slug: products.slug,
      descriptionTextOverride: products.descriptionTextOverride,
      descriptionHtmlOverride: products.descriptionHtmlOverride,
    })
    .from(syncChanges)
    .leftJoin(products, eq(products.id, syncChanges.productId))
    .where(eq(syncChanges.changeType, "moved"))
    .orderBy(syncChanges.createdAt);

  const moved: MovedProductViolation[] = [];
  const movedIds = new Set<string>();
  for (const move of moves) {
    const preserved = (move.after?.preserved ?? {}) as {
      slug?: string;
      descriptionTextOverride?: boolean;
      descriptionHtmlOverride?: boolean;
    };
    const expectedSlug = preserved.slug ?? null;
    const violation = (problem: MovedProductViolation["problem"]): MovedProductViolation => ({
      sourceKey: move.sourceKey,
      problem,
      expectedSlug,
      actualSlug: move.slug,
    });

    if (move.productId === null || move.slug === null) {
      moved.push(violation("row_deleted"));
      continue;
    }
    movedIds.add(move.productId);
    if (expectedSlug !== null && expectedSlug !== move.slug) moved.push(violation("slug_changed"));
    if (preserved.descriptionTextOverride && !move.descriptionTextOverride?.trim()) {
      moved.push(violation("text_override_lost"));
    }
    if (preserved.descriptionHtmlOverride && !move.descriptionHtmlOverride?.trim()) {
      moved.push(violation("html_override_lost"));
    }
  }

  // --- 3. Prices -------------------------------------------------------------
  const invalidPrices: CatalogVerifyReport["violations"]["invalidPrices"] = [];
  const priceOnRequest: VerifyProductRef[] = [];
  for (const row of active) {
    const shown = row.retailPriceOverride ?? row.currentPrice;
    if (shown === null) {
      priceOnRequest.push(ref(row));
      continue;
    }
    // Both are `numeric(12,2)`, i.e. exact decimal strings: positive means
    // "no minus sign and some digit that is not zero". No floats involved.
    for (const price of [row.currentPrice, row.retailPriceOverride]) {
      if (price !== null && (price.startsWith("-") || !/[1-9]/.test(price))) {
        invalidPrices.push({ ...ref(row), price });
      }
    }
  }

  // --- 4. Images -------------------------------------------------------------
  const withImage = new Set(
    (
      await db
        .selectDistinct({ productId: productImages.productId })
        .from(productImages)
        .where(eq(productImages.status, "active"))
    ).map((row) => row.productId),
  );
  const withoutActiveImage = active.filter((row) => !withImage.has(row.id)).map(ref);

  // --- 5 and 6. Brands and categories ---------------------------------------
  const activeIds = new Set(active.map((row) => row.id));
  const brandRows = await db
    .select({
      id: brands.id,
      sourceSiteId: brands.sourceSiteId,
      slug: brands.slug,
      name: brands.name,
      sourceKey: brands.sourceKey,
      sourceId: brands.sourceId,
      previousSourceKeys: brands.previousSourceKeys,
    })
    .from(brands)
    .where(eq(brands.status, "active"))
    .orderBy(brands.slug);
  const categoryRows = await db
    .select({
      id: categories.id,
      sourceSiteId: categories.sourceSiteId,
      slug: categories.slug,
      name: categories.name,
      sourceKey: categories.sourceKey,
      sourceId: categories.sourceId,
      parentId: categories.parentId,
      previousSourceKeys: categories.previousSourceKeys,
    })
    .from(categories)
    .where(eq(categories.status, "active"))
    .orderBy(categories.slug);

  const sharedSourceIds: SharedSourceIdGroup[] = [];
  const collectShared = (
    kind: TaxonomyRef["kind"],
    rows: ReadonlyArray<(typeof brandRows)[number]>,
  ): void => {
    const bySourceId = new Map<string, TaxonomyRef[]>();
    for (const row of rows) {
      if (row.sourceId === null) continue;
      const key = JSON.stringify([row.sourceSiteId, row.sourceId]);
      const entry: TaxonomyRef = { kind, slug: row.slug, name: row.name, sourceKey: row.sourceKey };
      const group = bySourceId.get(key);
      if (group) group.push(entry);
      else bySourceId.set(key, [entry]);
    }
    for (const [key, group] of bySourceId) {
      if (group.length < 2) continue;
      sharedSourceIds.push({
        kind,
        sourceId: (JSON.parse(key) as string[])[1] as string,
        rows: group,
      });
    }
  };
  collectShared("brand", brandRows);
  collectShared("category", categoryRows);

  const productsPerBrand = new Map<string, number>();
  for (const row of active) {
    if (row.brandId)
      productsPerBrand.set(row.brandId, (productsPerBrand.get(row.brandId) ?? 0) + 1);
  }

  // A parent category holds its products through its children, so a category
  // counts as empty only when its whole subtree is.
  const productsPerCategory = new Map<string, number>();
  for (const link of await db
    .select({ productId: productCategories.productId, categoryId: productCategories.categoryId })
    .from(productCategories)) {
    if (!activeIds.has(link.productId)) continue;
    productsPerCategory.set(link.categoryId, (productsPerCategory.get(link.categoryId) ?? 0) + 1);
  }
  const childrenOf = new Map<string, string[]>();
  for (const row of categoryRows) {
    if (!row.parentId) continue;
    const children = childrenOf.get(row.parentId);
    if (children) children.push(row.id);
    else childrenOf.set(row.parentId, [row.id]);
  }
  const subtreeProducts = (id: string, seen = new Set<string>()): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    return (childrenOf.get(id) ?? []).reduce(
      (total, child) => total + subtreeProducts(child, seen),
      productsPerCategory.get(id) ?? 0,
    );
  };

  const renamedAndEmpty: CatalogVerifyReport["violations"]["renamedAndEmpty"] = [];
  for (const row of brandRows) {
    if (row.previousSourceKeys.length > 0 && (productsPerBrand.get(row.id) ?? 0) === 0) {
      renamedAndEmpty.push({
        kind: "brand",
        slug: row.slug,
        name: row.name,
        sourceKey: row.sourceKey,
        previousSourceKeys: row.previousSourceKeys,
      });
    }
  }
  for (const row of categoryRows) {
    if (row.previousSourceKeys.length > 0 && subtreeProducts(row.id) === 0) {
      renamedAndEmpty.push({
        kind: "category",
        slug: row.slug,
        name: row.name,
        sourceKey: row.sourceKey,
        previousSourceKeys: row.previousSourceKeys,
      });
    }
  }

  const violationCount =
    duplicates.length +
    moved.length +
    invalidPrices.length +
    withoutActiveImage.length +
    sharedSourceIds.length +
    renamedAndEmpty.length;

  return {
    ok: violationCount === 0,
    violationCount,
    activeProducts: active.length,
    movedProducts: movedIds.size,
    activeBrands: brandRows.length,
    activeCategories: categoryRows.length,
    violations: {
      duplicates,
      moved,
      invalidPrices,
      withoutActiveImage,
      sharedSourceIds,
      renamedAndEmpty,
    },
    notices: { priceOnRequest, sourceListedTwins },
  };
}

const MOVED_PROBLEMS: Readonly<Record<MovedProductViolation["problem"], string>> = {
  row_deleted: "the product row no longer exists",
  slug_changed: "its slug changed",
  text_override_lost: "its summary override is gone",
  html_override_lost: "its body-copy override is gone",
};

/** Plain-text report for a terminal or a CI log. */
export function formatCatalogVerifyReport(report: CatalogVerifyReport): string {
  const lines: string[] = [];
  const check = (failed: number, passText: string, failText: string): void => {
    lines.push(failed === 0 ? `  ok    ${passText}` : `  FAIL  ${failed} ${failText}`);
  };
  const describeGroup = (group: DuplicateGroup): void => {
    lines.push(
      `        ${group.brand ?? "(no brand)"} | ${group.name} | ${group.pack ?? "(no pack size)"}`,
    );
    for (const product of group.products) {
      lines.push(`          - ${product.slug}  [${product.status}]  ${product.sourceKey}`);
    }
  };

  const { violations, notices } = report;
  lines.push(
    report.ok
      ? "catalog:verify passed"
      : `catalog:verify FAILED: ${report.violationCount} violation(s)`,
    `  ${report.activeProducts} active products, ${report.movedProducts} moved to a new source key`,
    `  ${report.activeBrands} active brands, ${report.activeCategories} active categories`,
    "",
  );

  check(
    violations.duplicates.length,
    "no product is listed twice",
    "group(s) of products share brand + name + pack size",
  );
  violations.duplicates.forEach(describeGroup);

  check(
    violations.moved.length,
    "every moved product kept its slug and its description overrides",
    "problem(s) with moved products",
  );
  for (const move of violations.moved) {
    const slugs =
      move.problem === "slug_changed" ? ` (was ${move.expectedSlug}, is ${move.actualSlug})` : "";
    lines.push(`          - ${move.sourceKey}: ${MOVED_PROBLEMS[move.problem]}${slugs}`);
  }

  check(
    violations.invalidPrices.length,
    "every active product has a positive price or none at all",
    "active product(s) priced at zero or less",
  );
  for (const product of violations.invalidPrices) {
    lines.push(`          - ${product.slug}: ${product.price}`);
  }

  check(
    violations.withoutActiveImage.length,
    "every active product has an active image",
    "active product(s) without an active image",
  );
  for (const product of violations.withoutActiveImage) lines.push(`          - ${product.slug}`);

  check(
    violations.sharedSourceIds.length,
    "no two active brands or categories share a source id",
    "source id(s) carried by more than one active brand or category",
  );
  for (const group of violations.sharedSourceIds) {
    lines.push(`        ${group.kind} source id ${group.sourceId}`);
    for (const row of group.rows) lines.push(`          - ${row.slug}  ${row.sourceKey}`);
  }

  check(
    violations.renamedAndEmpty.length,
    "no renamed brand or category is left without products",
    "renamed brand(s) or categor(ies) with no active product",
  );
  for (const row of violations.renamedAndEmpty) {
    lines.push(
      `          - ${row.kind} ${row.slug}  ${row.sourceKey}  (was ${row.previousSourceKeys.join(", ")})`,
    );
  }

  lines.push("", `  note  ${notices.priceOnRequest.length} active product(s) are price-on-request`);
  for (const product of notices.priceOnRequest) lines.push(`          - ${product.slug}`);

  if (notices.sourceListedTwins.length > 0) {
    lines.push(
      `  note  ${notices.sourceListedTwins.length} group(s) share brand + name + pack size but are listed separately by the source`,
    );
    notices.sourceListedTwins.forEach(describeGroup);
  }

  return lines.join("\n");
}
