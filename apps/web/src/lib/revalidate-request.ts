import {
  checkShopPath,
  isProductSlug,
  productPaths,
  type ShopPathVerdict,
} from "./revalidate-shop";

/**
 * What `POST /api/revalidate` accepts, checked before anything is refreshed.
 *
 * One JSON object, in one of two shapes:
 *
 *  - `{ "scope": "catalog" }`: everything a sync can change — every page
 *    route of the shop, page by page (`revalidateShop`), and the sitemap. What
 *    the sync and the copy scripts send: a price, a name or a text shows on
 *    the product page, on every listing and brand page that carries its card,
 *    on the home page and in the sitemap.
 *  - `{ "paths": [...], "slugs": [...] }`, either or both: those pages only,
 *    and the sitemap. A path is one URL of the shop as it is published
 *    (`/bg/marki/lavazza`); a slug is a product's, refreshed in every shipping
 *    locale (`/bg/<slug>`).
 *
 * Strict, because the answer is a cache operation on the live shop: unknown
 * fields, an unknown scope, a path that is not a page of the shop, or one of
 * the self-timed routes (`dynamicParams = false`, which an on-demand
 * regeneration turns into a cached 404; see `revalidate-shop.ts`) refuse the
 * whole request with the reason, and nothing is refreshed. Bounded: a body of
 * at most 16 KiB, at most 100 paths and 100 slugs. A larger change is the
 * catalog scope.
 */

export const REVALIDATE_LIMITS = { bodyBytes: 16 * 1024, paths: 100, slugs: 100 } as const;

/** Calls allowed in ten minutes. */
export const REVALIDATE_CALLS = 20;

/**
 * The ceiling on calls, `REVALIDATE_CALLS` on every deployment. Off one — a
 * laptop, the end-to-end suite, whose runs against one database add up
 * within the window — `REVALIDATE_RATE_LIMIT` may raise it (never lower it),
 * up to 100,000. `deployment` is `isDeployment()` (`lib/auth.ts`): production
 * or a preview on Vercel, or `NEXT_PUBLIC_ENVIRONMENT=production` elsewhere.
 */
export function revalidateCallLimit(
  env: Readonly<Record<string, string | undefined>>,
  deployment: boolean,
): number {
  if (deployment) return REVALIDATE_CALLS;
  const raised = Number(env.REVALIDATE_RATE_LIMIT);
  return Number.isInteger(raised) && raised > REVALIDATE_CALLS && raised <= 100_000
    ? raised
    : REVALIDATE_CALLS;
}

export type RevalidateTarget =
  { readonly scope: "catalog" } | { readonly scope: null; readonly paths: readonly string[] };

export type RevalidateParse =
  | { readonly ok: true; readonly target: RevalidateTarget }
  | {
      readonly ok: false;
      readonly status: 400 | 413 | 415;
      readonly error: string;
      readonly rejected?: ReadonlyArray<{ readonly value: string; readonly reason: string }>;
    };

const FIELDS = new Set(["scope", "paths", "slugs"]);

const refuse = (
  status: 400 | 413 | 415,
  error: string,
  rejected?: ReadonlyArray<{ value: string; reason: string }>,
): RevalidateParse => ({ ok: false, status, error, ...(rejected ? { rejected } : {}) });

/** A refused value as it is echoed back: never more than a line of it. */
const shown = (value: string) => (value.length > 120 ? `${value.slice(0, 120)}…` : value);

/** The body as text, or null once it passes the limit. Reads no further than that. */
async function readCapped(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function stringList(
  value: unknown,
  max: number,
): { readonly ok: true; readonly list: string[] } | { readonly ok: false; readonly why: string } {
  if (!Array.isArray(value)) return { ok: false, why: "not_a_list" };
  if (value.length === 0) return { ok: false, why: "empty" };
  if (value.length > max) return { ok: false, why: "too_many" };
  if (!value.every((item): item is string => typeof item === "string")) {
    return { ok: false, why: "not_strings" };
  }
  return { ok: true, list: value };
}

export async function readRevalidateRequest(request: Request): Promise<RevalidateParse> {
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(type)) return refuse(415, "content_type_not_json");

  const text = await readCapped(request, REVALIDATE_LIMITS.bodyBytes);
  if (text === null) return refuse(413, "body_too_large");

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return refuse(400, "invalid_json");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return refuse(400, "not_an_object");
  }

  const fields = Object.keys(body);
  const unknown = fields.filter((field) => !FIELDS.has(field));
  if (unknown.length > 0) {
    return refuse(
      400,
      "unknown_field",
      unknown.map((field) => ({ value: shown(field), reason: "unknown_field" })),
    );
  }
  const record = body as Record<string, unknown>;

  if ("scope" in record) {
    if (fields.length > 1) return refuse(400, "scope_with_paths");
    if (record.scope !== "catalog") return refuse(400, "unknown_scope");
    return { ok: true, target: { scope: "catalog" } };
  }
  if (fields.length === 0) return refuse(400, "nothing_to_revalidate");

  const paths: string[] = [];
  const rejected: Array<{ value: string; reason: string }> = [];

  if ("paths" in record) {
    const list = stringList(record.paths, REVALIDATE_LIMITS.paths);
    if (!list.ok) return refuse(400, `paths_${list.why}`);
    for (const path of list.list) {
      const verdict: ShopPathVerdict = checkShopPath(path);
      if (verdict.ok) paths.push(path);
      else rejected.push({ value: shown(path), reason: verdict.reason });
    }
  }

  if ("slugs" in record) {
    const list = stringList(record.slugs, REVALIDATE_LIMITS.slugs);
    if (!list.ok) return refuse(400, `slugs_${list.why}`);
    for (const slug of list.list) {
      if (isProductSlug(slug)) paths.push(...productPaths(slug));
      else rejected.push({ value: shown(slug), reason: "not_a_product_slug" });
    }
  }

  if (rejected.length > 0) return refuse(400, "rejected", rejected);
  return { ok: true, target: { scope: null, paths: [...new Set(paths)] } };
}
