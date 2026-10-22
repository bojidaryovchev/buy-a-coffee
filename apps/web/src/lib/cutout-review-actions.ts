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
 * its white well and is not made again by `pnpm images:cutout` unless it is
 * redone by name. The shop picks a decision up when its pages next refresh
 * (within five minutes).
 *
 * A decision names the cut-out the owner was looking at, not only the photo:
 * a redo can put a new cut-out on the same row while the screen still shows
 * the old one, and a click on the old one must not decide the new.
 */

const SCREEN = "/admin/snimki";
const HASH = /^[0-9a-f]{64}$/;
const KEY = /^cutouts\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}\.png$/;

function decided(formData: FormData): { hash: string; key: string } | null {
  const hash = formData.get("hash");
  const key = formData.get("key");
  return typeof hash === "string" && HASH.test(hash) && typeof key === "string" && KEY.test(key)
    ? { hash, key }
    : null;
}

/** Show this cut-out in the shop. From pending, or back from rejected. */
export async function approveCutout(formData: FormData): Promise<void> {
  if (!(await isSignedIn())) return;
  const cutout = decided(formData);
  if (!cutout) return;
  await db
    .update(imageCutouts)
    .set({ status: "approved", decidedBy: "owner", decidedAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(imageCutouts.sourceContentHash, cutout.hash),
        eq(imageCutouts.objectKey, cutout.key),
        inArray(imageCutouts.status, ["pending", "rejected"]),
      ),
    );
  revalidatePath(SCREEN);
}

/** Keep the product on its white well: from pending, or taken down from live. */
export async function rejectCutout(formData: FormData): Promise<void> {
  if (!(await isSignedIn())) return;
  const cutout = decided(formData);
  if (!cutout) return;
  await db
    .update(imageCutouts)
    .set({ status: "rejected", decidedBy: "owner", decidedAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(imageCutouts.sourceContentHash, cutout.hash),
        eq(imageCutouts.objectKey, cutout.key),
        inArray(imageCutouts.status, ["pending", "auto", "approved"]),
      ),
    );
  revalidatePath(SCREEN);
}
