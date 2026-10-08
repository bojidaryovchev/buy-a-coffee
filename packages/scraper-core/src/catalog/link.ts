import { and, eq, ne, sql } from "drizzle-orm";
import type { Database } from "@catalog/db";
import { orderInquiries, products, sourceSites, syncChanges, syncRuns } from "@catalog/db/schema";
import { canonicalizeUrl } from "@catalog/shared";
import { SOURCE_KEY_SEPARATOR } from "./identity.ts";
import { applyProductMove, countAllProducts } from "./repository.ts";
import { MANUAL_LINK_RUN_KIND } from "./verify.ts";

/**
 * Manual pairing: the escape hatch for a rename the sync cannot recognise.
 *
 * Move detection pairs on name and pack size. When the source renames a URL
 * *and* the product in the same edit, nothing ties the old row to the new
 * listing; the old row goes missing and a twin is created. A person who knows
 * they are the same product says so here, and the row is re-pointed exactly as
 * an automatic move would have re-pointed it — same statement, same audit
 * record (`applyProductMove`).
 *
 * Planning reads; only `applyProductLink` writes. The source is never
 * contacted: the next sync finds the row under its new key and refreshes its
 * content as an ordinary update.
 */

export interface LinkTarget {
  readonly sourceKey: string;
  readonly sourcePath: string;
  readonly sourceUrl: string;
  readonly sourceVariantKey: string | null;
}

export interface LinkProductRef {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly status: "active" | "missing" | "removed";
  readonly sourceKey: string;
}

export interface LinkPlan {
  /**
   *   - `ready`    applying will move the product.
   *   - `noop`     the product already has this key.
   *   - `blocked`  applying is refused; `blockers` says why.
   */
  readonly outcome: "ready" | "noop" | "blocked";
  readonly sourceSiteId: string | null;
  readonly product: LinkProductRef | null;
  readonly to: LinkTarget | null;
  /** A second row already holding the new key — the duplicate a sync created. */
  readonly twin: LinkProductRef | null;
  /** True when applying will delete `twin` first. */
  readonly absorbTwin: boolean;
  readonly blockers: string[];
  readonly warnings: string[];
}

export interface LinkInput {
  /** `source_sites.key` of the catalog the product belongs to. */
  readonly siteKey: string;
  readonly baseUrl: string;
  readonly canonicalHost: string;
  readonly hostAliases: readonly string[];
  /** Our storefront slug. */
  readonly slug: string;
  /** The key the source lists the product under now, e.g. `/lavazza-oro-1/#1000g`. */
  readonly sourceKey: string;
  /** Delete a row that already holds the new key instead of refusing. */
  readonly absorbTwin?: boolean;
}

/**
 * Split a path-shaped source key into its parts.
 *
 * Only `path` and `path#size` keys can be linked by hand: the path is what the
 * row's `source_path` and `source_url` are rebuilt from.
 */
export function parsePathSourceKey(
  sourceKey: string,
): { sourceKey: string; sourcePath: string; sourceVariantKey: string | null } | null {
  const trimmed = sourceKey.trim();
  if (!trimmed.startsWith("/")) return null;

  const separator = trimmed.indexOf(SOURCE_KEY_SEPARATOR);
  const rawPath = separator === -1 ? trimmed : trimmed.slice(0, separator);
  const variant = separator === -1 ? null : trimmed.slice(separator + 1);
  if (variant !== null && !/^[^\s#/]+$/.test(variant)) return null;
  if (rawPath === "/" || rawPath.includes("//")) return null;

  // Same canonical form `resolveProductIdentity` produces.
  const sourcePath = rawPath.endsWith("/") ? rawPath : `${rawPath}/`;
  return {
    sourceKey: variant === null ? sourcePath : `${sourcePath}${SOURCE_KEY_SEPARATOR}${variant}`,
    sourcePath,
    sourceVariantKey: variant,
  };
}

export async function planProductLink(db: Database, input: LinkInput): Promise<LinkPlan> {
  const blocked = (blocker: string, partial: Partial<LinkPlan> = {}): LinkPlan => ({
    outcome: "blocked",
    sourceSiteId: null,
    product: null,
    to: null,
    twin: null,
    absorbTwin: false,
    warnings: [],
    ...partial,
    blockers: [blocker],
  });

  const parsed = parsePathSourceKey(input.sourceKey);
  if (!parsed) {
    return blocked(
      `"${input.sourceKey}" is not a path-shaped source key. Expected "/product-path/#1000g" or "/product-path/".`,
    );
  }
  const sourceUrl = canonicalizeUrl(parsed.sourcePath, {
    base: input.baseUrl,
    canonicalHost: input.canonicalHost,
    hostAliases: [...input.hostAliases],
  })?.href;
  if (!sourceUrl) return blocked(`Cannot build a source URL for "${parsed.sourcePath}".`);
  const to: LinkTarget = { ...parsed, sourceUrl };

  const [site] = await db
    .select({ id: sourceSites.id })
    .from(sourceSites)
    .where(eq(sourceSites.key, input.siteKey));
  if (!site) return blocked(`No source site "${input.siteKey}" in this database.`, { to });

  const columns = {
    id: products.id,
    slug: products.slug,
    name: products.name,
    status: products.status,
    sourceKey: products.sourceKey,
    consecutiveMissingCount: products.consecutiveMissingCount,
    descriptionTextOverride: products.descriptionTextOverride,
    descriptionHtmlOverride: products.descriptionHtmlOverride,
    retailPriceOverride: products.retailPriceOverride,
    retailOldPriceOverride: products.retailOldPriceOverride,
  };
  const ref = (row: LinkProductRef): LinkProductRef => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    sourceKey: row.sourceKey,
  });

  const [row] = await db
    .select(columns)
    .from(products)
    .where(and(eq(products.sourceSiteId, site.id), eq(products.slug, input.slug)));
  if (!row) {
    return blocked(`No product with slug "${input.slug}".`, { sourceSiteId: site.id, to });
  }
  const product = ref(row);
  const base = { sourceSiteId: site.id, product, to };

  if (row.sourceKey === to.sourceKey) {
    return {
      ...base,
      outcome: "noop",
      twin: null,
      absorbTwin: false,
      blockers: [],
      warnings: [],
    };
  }

  const warnings: string[] = [];
  if (row.status === "active" && row.consecutiveMissingCount === 0) {
    warnings.push(
      `"${row.slug}" was present at ${row.sourceKey} in the last sync. If the source still lists that key, the next sync will create it again as a new product.`,
    );
  }

  const [twinRow] = await db
    .select(columns)
    .from(products)
    .where(
      and(
        eq(products.sourceSiteId, site.id),
        eq(products.sourceKey, to.sourceKey),
        ne(products.id, row.id),
      ),
    );
  if (!twinRow) {
    return { ...base, outcome: "ready", twin: null, absorbTwin: false, blockers: [], warnings };
  }

  const twin = ref(twinRow);
  if (!input.absorbTwin) {
    return {
      ...base,
      outcome: "blocked",
      twin,
      absorbTwin: false,
      warnings,
      blockers: [
        `${to.sourceKey} already belongs to another row, "${twin.slug}" — the duplicate a sync created before this link was made. Re-run with --absorb-twin to delete that row and keep "${product.slug}".`,
      ],
    };
  }

  // Absorbing deletes a row. Refuse if it holds anything a person put there.
  const blockers: string[] = [];
  if (twinRow.descriptionTextOverride !== null || twinRow.descriptionHtmlOverride !== null) {
    blockers.push(
      `"${twin.slug}" has hand-written description overrides, which deleting it would lose.`,
    );
  }
  if (twinRow.retailPriceOverride !== null || twinRow.retailOldPriceOverride !== null) {
    blockers.push(`"${twin.slug}" has a retail price override, which deleting it would lose.`);
  }
  const [inquiries] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orderInquiries)
    .where(eq(orderInquiries.productId, twin.id));
  if ((inquiries?.count ?? 0) > 0) {
    blockers.push(
      `"${twin.slug}" is referenced by ${inquiries?.count} order enquiry(ies), which would lose their product.`,
    );
  }
  warnings.push(
    `"${twin.slug}" will be deleted, with its image rows. Its storefront URL stops resolving.`,
  );

  return {
    ...base,
    outcome: blockers.length > 0 ? "blocked" : "ready",
    twin,
    absorbTwin: true,
    blockers,
    warnings,
  };
}

export interface LinkResult {
  readonly syncRunId: string;
  readonly previousSourceKey: string;
  readonly slug: string;
  readonly absorbedTwinSlug: string | null;
}

/**
 * Carry out a `ready` plan, atomically.
 *
 * The audit trail hangs off a `sync_runs` row, so the link gets one of its
 * own, marked `metadata.kind = "manual_link"` so that nothing mistakes it for
 * a reading of the source.
 */
export async function applyProductLink(db: Database, plan: LinkPlan): Promise<LinkResult> {
  const { product, to, twin, sourceSiteId } = plan;
  if (plan.outcome !== "ready" || !product || !to || !sourceSiteId) {
    throw new Error(`Cannot apply a link plan that is ${plan.outcome}`);
  }

  const productsBefore = await countAllProducts(db, sourceSiteId);

  return db.transaction(async (tx) => {
    const [run] = await tx
      .insert(syncRuns)
      .values({
        sourceSiteId,
        status: "succeeded",
        dryRun: false,
        completedAt: sql`now()`,
        durationMs: 0,
        productsBefore,
        productsAfter: productsBefore - (plan.absorbTwin && twin ? 1 : 0),
        movedCount: 1,
        metadata: {
          kind: MANUAL_LINK_RUN_KIND,
          slug: product.slug,
          from: product.sourceKey,
          to: to.sourceKey,
          absorbedTwin: plan.absorbTwin && twin ? twin.slug : null,
        },
      })
      .returning({ id: syncRuns.id });
    if (!run) throw new Error("Failed to create the run record for this link");

    if (plan.absorbTwin && twin) {
      // The twin must go first: it holds the unique key the product moves to.
      await tx.delete(products).where(eq(products.id, twin.id));
      await tx.insert(syncChanges).values({
        syncRunId: run.id,
        productId: null,
        sourceKey: twin.sourceKey,
        changeType: "removed",
        changedFields: ["status"],
        before: {
          slug: twin.slug,
          name: twin.name,
          sourceKey: twin.sourceKey,
          status: twin.status,
        },
        after: { absorbedInto: product.slug },
      });
    }

    const moved = await applyProductMove(tx, {
      syncRunId: run.id,
      productId: product.id,
      to,
      changedFields: ["sourceKey"],
      before: { name: product.name },
      after: { name: product.name, move: { matchedBy: "manual", decidedBy: null } },
    });

    return {
      syncRunId: run.id,
      previousSourceKey: moved.previousSourceKey,
      slug: moved.slug,
      absorbedTwinSlug: plan.absorbTwin && twin ? twin.slug : null,
    };
  });
}

/** Plain-text plan for a terminal. */
export function formatLinkPlan(plan: LinkPlan, options: { readonly applied: boolean }): string {
  const lines: string[] = [];
  if (plan.product && plan.to) {
    lines.push(
      `catalog:link ${plan.product.slug}`,
      `  product  ${plan.product.name}  [${plan.product.status}]`,
      `  from     ${plan.product.sourceKey}`,
      `  to       ${plan.to.sourceKey}`,
      `           ${plan.to.sourceUrl}`,
    );
    if (plan.twin) {
      lines.push(`  twin     ${plan.twin.slug}  [${plan.twin.status}]  ${plan.twin.name}`);
    }
  }
  for (const warning of plan.warnings) lines.push(`  warning  ${warning}`);
  for (const blocker of plan.blockers) lines.push(`  refused  ${blocker}`);

  if (plan.outcome === "noop") lines.push("", "Nothing to do: the product already has this key.");
  else if (plan.outcome === "blocked") lines.push("", "Not linked.");
  else if (options.applied) lines.push("", "Linked. Its id, slug, copy and images are unchanged.");
  else lines.push("", "Plan only; nothing was written. Re-run with --apply to link.");

  return lines.join("\n");
}
