"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { products } from "@catalog/db/schema";
import { packServings, productKind } from "@catalog/shared";
import { isSignedIn } from "@/lib/auth";
import { readResearch } from "@/lib/copy-review";
import { db } from "@/lib/db";

/**
 * The owner's decisions on the catalog copywriter's work.
 *
 * Each action re-checks the session: a server action is a public endpoint
 * whatever the page that draws its button does (see `admin-actions.ts`).
 * None of them touches copy a person wrote in `content/product-copy.ts`
 * (`copy_origin = 'hand'`): that text is changed in the file.
 */

const SCREEN = "/admin/tekstove";
const MACHINE_OR_EDITED = inArray(products.copyOrigin, ["ai", "edited"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function productId(formData: FormData): string | null {
  const id = formData.get("id");
  return typeof id === "string" && UUID.test(id) ? id : null;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Save the owner's correction of a machine text. From then on it is
 * `edited`: a person's words, which the copywriter never rewrites.
 */
export async function saveEditedCopy(formData: FormData): Promise<void> {
  if (!(await isSignedIn())) return;
  const id = productId(formData);
  const summary = String(formData.get("summary") ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const paragraphs = String(formData.get("body") ?? "")
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (!id || summary.length < 20 || summary.length > 300) return;
  if (paragraphs.length === 0 || paragraphs.length > 6) return;
  if (paragraphs.some((paragraph) => paragraph.length > 1500)) return;

  await db
    .update(products)
    .set({
      descriptionTextOverride: summary,
      descriptionHtmlOverride: paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n"),
      copyOrigin: "edited",
      copyWrittenAt: sql`now()`,
      copyAttempts: 0,
      copyLastError: null,
    })
    .where(and(eq(products.id, id), MACHINE_OR_EDITED));
  revalidatePath(SCREEN);
}

/**
 * Drop a machine (or edited) text so the next run writes a new one. Until
 * then the product shows its generated one-sentence description.
 */
export async function requestNewCopy(formData: FormData): Promise<void> {
  if (!(await isSignedIn())) return;
  const id = productId(formData);
  if (!id) return;
  await db
    .update(products)
    .set({
      descriptionTextOverride: null,
      descriptionHtmlOverride: null,
      copyOrigin: null,
      copySourceHash: null,
      copyModel: null,
      copyWrittenAt: null,
      copyAttempts: 0,
      copyLastError: null,
    })
    .where(and(eq(products.id, id), MACHINE_OR_EDITED));
  revalidatePath(SCREEN);
}

/** Let the copywriter try a product it gave up on. */
export async function retryProduct(formData: FormData): Promise<void> {
  if (!(await isSignedIn())) return;
  const id = productId(formData);
  if (!id) return;
  await db
    .update(products)
    .set({ copyAttempts: 0, copyLastError: null })
    .where(eq(products.id, id));
  revalidatePath(SCREEN);
}

/**
 * Apply a researched pack size the copywriter held back (not confident
 * enough to apply alone). Writes the same columns an automatic correction
 * does, so the sync keeps it from then on.
 */
export async function applyResearchedPack(formData: FormData): Promise<void> {
  if (!(await isSignedIn())) return;
  const id = productId(formData);
  if (!id) return;
  const [row] = await db
    .select({ name: products.name, research: products.factsResearch })
    .from(products)
    .where(eq(products.id, id));
  const research = row ? readResearch(row.research) : null;
  const pack = research?.pack;
  if (!row || !pack || !["g", "ml", "pc"].includes(pack.unit)) return;
  // Whole units, as an automatic correction stores them.
  const rounded = Math.round(pack.value);
  if (!(rounded > 0)) return;

  const value = String(rounded);
  const servings = packServings(value, pack.unit, productKind(row.name));
  await db
    .update(products)
    .set({
      packOverrideValue: value,
      packOverrideUnit: pack.unit,
      weightValue: value,
      weightUnit: pack.unit,
      servings: servings?.exact ?? null,
      servingsEstimated: servings?.estimated ?? null,
      factsResearch: sql`${products.factsResearch} || jsonb_build_object('applied', true, 'heldBack', null, 'decidedBy', 'owner')`,
    })
    .where(eq(products.id, id));
  revalidatePath(SCREEN);
}

/**
 * Hand the pack size back to the supplier. The pack columns keep the
 * researched figure until the next sync rewrites them from the listing.
 *
 * The size turned down is remembered (`rejected`), so research that finds it
 * again never applies it on its own: the owner's word outranks the web's.
 */
export async function clearPackOverride(formData: FormData): Promise<void> {
  if (!(await isSignedIn())) return;
  const id = productId(formData);
  if (!id) return;
  const [row] = await db
    .select({
      value: products.packOverrideValue,
      unit: products.packOverrideUnit,
      research: products.factsResearch,
    })
    .from(products)
    .where(eq(products.id, id));
  if (!row) return;
  const record = (row.research ?? {}) as Record<string, unknown>;
  const rejected = Array.isArray(record.rejected) ? [...record.rejected] : [];
  if (row.value !== null && row.unit !== null) {
    rejected.push({ value: Math.round(Number(row.value)), unit: row.unit });
  }
  await db
    .update(products)
    .set({
      packOverrideValue: null,
      packOverrideUnit: null,
      factsResearch: {
        ...record,
        applied: false,
        heldBack: null,
        decidedBy: "owner",
        rejected,
      },
    })
    .where(eq(products.id, id));
  revalidatePath(SCREEN);
}
