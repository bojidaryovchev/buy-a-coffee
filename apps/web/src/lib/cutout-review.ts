import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { imageCutouts, productImages, products } from "@catalog/db/schema";
import type { CutoutShape } from "@catalog/db/schema";
import { resolveImageUrl } from "@/lib/catalog/images";
import { db } from "@/lib/db";

/**
 * What the admin's "Снимки" screen reads: the packshot cut-outs.
 *
 * `pnpm images:cutout` (after every sync) cuts each product photo out and
 * records it in `image_cutouts`; a cut-out the two models agreed on is live by
 * itself (`auto`), anything else waits here (`pending`). See
 * `apps/scraper/src/commands-cutout.ts` and DESIGN.md, "Imagery".
 */

export type CutoutStatus = (typeof imageCutouts.$inferSelect)["status"];

export interface CutoutRow {
  readonly hash: string;
  readonly status: CutoutStatus;
  /** The cut-out, renderable; null for a row that failed. */
  readonly cutoutUrl: string | null;
  /** The photo it was cut from. */
  readonly originalUrl: string | null;
  readonly agreement: number | null;
  readonly shape: CutoutShape | null;
  readonly lastError: string | null;
  readonly attempts: number;
  readonly decidedBy: string | null;
  readonly updatedAt: Date;
  /** Products showing this photo, for the owner to recognise and open. */
  readonly products: ReadonlyArray<{ readonly name: string; readonly slug: string }>;
}

export type CutoutCounts = Readonly<Record<CutoutStatus | "uncut", number>>;

/** Rows per list: the screen shows what needs a look, not the whole catalog. */
const LIST_LIMIT = 60;

async function rows(statuses: readonly CutoutStatus[], limit = LIST_LIMIT): Promise<CutoutRow[]> {
  const found = await db
    .select({
      hash: imageCutouts.sourceContentHash,
      status: imageCutouts.status,
      objectKey: imageCutouts.objectKey,
      agreement: imageCutouts.agreement,
      shape: imageCutouts.shape,
      lastError: imageCutouts.lastError,
      attempts: imageCutouts.attempts,
      decidedBy: imageCutouts.decidedBy,
      updatedAt: imageCutouts.updatedAt,
      original: sql<string | null>`min(${productImages.objectKey})`,
      products: sql<Array<{ name: string; slug: string }>>`
        coalesce(
          json_agg(distinct jsonb_build_object('name', ${products.name}, 'slug', ${products.slug}))
            filter (where ${products.id} is not null),
          '[]'
        )`,
    })
    .from(imageCutouts)
    .leftJoin(
      productImages,
      and(
        eq(productImages.sourceContentHash, imageCutouts.sourceContentHash),
        eq(productImages.status, "active"),
      ),
    )
    .leftJoin(products, eq(products.id, productImages.productId))
    .where(inArray(imageCutouts.status, [...statuses]))
    .groupBy(imageCutouts.sourceContentHash)
    .orderBy(desc(imageCutouts.updatedAt))
    .limit(limit);

  return found.map((row) => ({
    hash: row.hash,
    status: row.status,
    cutoutUrl: row.objectKey ? resolveImageUrl(row.objectKey) : null,
    originalUrl: row.original ? resolveImageUrl(row.original) : null,
    agreement: row.agreement === null ? null : Number(row.agreement),
    shape: row.shape,
    lastError: row.lastError,
    attempts: row.attempts,
    decidedBy: row.decidedBy,
    updatedAt: row.updatedAt,
    products: row.products,
  }));
}

export async function loadCutoutReview(): Promise<{
  counts: CutoutCounts;
  pending: CutoutRow[];
  failed: CutoutRow[];
  live: CutoutRow[];
  rejected: CutoutRow[];
}> {
  const [byStatus, uncut, pending, failed, live, rejected] = await Promise.all([
    db
      .select({ status: imageCutouts.status, count: sql<number>`count(*)`.mapWith(Number) })
      .from(imageCutouts)
      .groupBy(imageCutouts.status),
    db
      .select({
        count: sql<number>`count(distinct ${productImages.sourceContentHash})`.mapWith(Number),
      })
      .from(productImages)
      .leftJoin(imageCutouts, eq(imageCutouts.sourceContentHash, productImages.sourceContentHash))
      .where(
        and(
          eq(productImages.status, "active"),
          sql`${productImages.sourceContentHash} is not null`,
          sql`${imageCutouts.sourceContentHash} is null`,
        ),
      ),
    rows(["pending"], 200),
    rows(["failed"]),
    rows(["auto", "approved"]),
    rows(["rejected"]),
  ]);

  const counts = { auto: 0, pending: 0, approved: 0, rejected: 0, failed: 0, uncut: 0 };
  for (const row of byStatus) counts[row.status] = row.count;
  counts.uncut = uncut[0]?.count ?? 0;
  return { counts, pending, failed, live, rejected };
}
