"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { imageCutouts } from "@catalog/db/schema";
import { isSignedIn } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * The owner's decisions on packshot cut-outs (DESIGN.md, "Imagery").
 *
 * Each action re-checks the session: a server action is a public endpoint
 * whatever the page that draws its button does (see `admin-actions.ts`). A
 * decision is recorded as the owner's; a rejected cut-out keeps the product on
 * its white well and is never made again by `pnpm images:cutout`. The shop
 * picks a decision up when its pages next refresh (within five minutes).
 */

const SCREEN = "/admin/snimki";
const HASH = /^[0-9a-f]{64}$/;

function hashOf(formData: FormData): string | null {
  const hash = formData.get("hash");
  return typeof hash === "string" && HASH.test(hash) ? hash : null;
}

/** Show this cut-out in the shop. From pending, or back from rejected. */
export async function approveCutout(formData: FormData): Promise<void> {
  if (!(await isSignedIn())) return;
  const hash = hashOf(formData);
  if (!hash) return;
  await db
    .update(imageCutouts)
    .set({ status: "approved", decidedBy: "owner", decidedAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(imageCutouts.sourceContentHash, hash),
        inArray(imageCutouts.status, ["pending", "rejected"]),
        sql`${imageCutouts.objectKey} is not null`,
      ),
    );
  revalidatePath(SCREEN);
}

/** Keep the product on its white well: from pending, or taken down from live. */
export async function rejectCutout(formData: FormData): Promise<void> {
  if (!(await isSignedIn())) return;
  const hash = hashOf(formData);
  if (!hash) return;
  await db
    .update(imageCutouts)
    .set({ status: "rejected", decidedBy: "owner", decidedAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(imageCutouts.sourceContentHash, hash),
        inArray(imageCutouts.status, ["pending", "auto", "approved"]),
      ),
    );
  revalidatePath(SCREEN);
}
