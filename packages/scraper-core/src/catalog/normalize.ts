import {
  type Money,
  type NormalizedWeight,
  htmlToText,
  moneyHashToken,
  normalizeLabel,
  normalizeRichTextForHash,
  parseMoney,
  semanticHash,
} from "@catalog/shared";
import { z } from "zod";
import { type ProductIdentity, normalizeSourceSlug, resolveProductIdentity } from "./identity.ts";

export type Availability = "in_stock" | "out_of_stock" | "preorder" | "unknown";

/** Canonical product model. Everything downstream reads this shape. */
export interface NormalizedProduct {
  readonly sourceSite: string;
  readonly sourceKey: string;
  readonly sourceUrl: string;
  readonly sourcePath: string;
  readonly sourceVariantKey: string | null;
  readonly identityStrategy: ProductIdentity["strategy"];
  /** True when another product shares this source URL. Set during discovery. */
  readonly hasUrlCollision: boolean;

  readonly name: string;
  readonly slug: string | null;

  readonly currentPrice: Money | null;
  readonly oldPrice: Money | null;
  readonly currency: string | null;

  readonly availability: Availability;

  readonly brandKey: string | null;
  readonly brandName: string | null;
  readonly categoryKeys: string[];

  readonly descriptionHtml: string | null;
  readonly descriptionText: string | null;

  readonly weight: NormalizedWeight | null;
  readonly weightText: string | null;
  readonly sku: string | null;
  readonly gtin: string | null;

  readonly attributes: Record<string, string>;
  readonly sourceImageUrls: string[];
  readonly sourceData: Record<string, unknown>;

  readonly semanticHash: string;
}

/**
 * Availability vocabulary observed on the source plus the obvious English
 * equivalents. Unrecognised text becomes `unknown` rather than a guess:
 * showing "in stock" for something we did not understand is the expensive
 * mistake.
 */
const AVAILABILITY_RULES: ReadonlyArray<readonly [RegExp, Availability]> = [
  [/^\s*(?:in[_\s-]?stock|instock)\s*$/i, "in_stock"],
  [/^\s*(?:out[_\s-]?of[_\s-]?stock|outofstock)\s*$/i, "out_of_stock"],
  [/^\s*(?:pre[_\s-]?order|preorder)\s*$/i, "preorder"],
  [/в\s*наличност/iu, "in_stock"],
  [/на\s*склад/iu, "in_stock"],
  [/(?:изчерпан|няма\s*наличност|не\s*е\s*налич)/iu, "out_of_stock"],
  [/(?:предварителна\s*поръчка|по\s*заявка)/iu, "preorder"],
  [/\bavailable\b/i, "in_stock"],
  [/\b(?:sold\s*out|unavailable)\b/i, "out_of_stock"],
];

export function parseAvailability(raw: string | null | undefined): Availability {
  if (!raw) return "unknown";
  const text = normalizeLabel(raw);
  if (!text) return "unknown";
  for (const [pattern, value] of AVAILABILITY_RULES) {
    if (pattern.test(text)) return value;
  }
  return "unknown";
}

/** Yes/no style attribute values seen on the source. */
export function parseBooleanAttribute(raw: string | null | undefined): boolean | null {
  if (!raw) return null;
  const text = normalizeLabel(raw).toLowerCase();
  if (["yes", "true", "1", "да"].includes(text)) return true;
  if (["no", "false", "0", "не"].includes(text)) return false;
  return null;
}

/** Raw record as produced by any catalog source parser. */
export interface RawProductRecord {
  readonly path: string;
  readonly url: string;
  readonly name: string;
  readonly priceText?: string | null;
  readonly oldPriceText?: string | null;
  readonly availabilityText?: string | null;
  readonly weightText?: string | null;
  readonly brandKey?: string | null;
  readonly brandName?: string | null;
  readonly categoryKeys?: readonly string[];
  readonly descriptionHtml?: string | null;
  readonly descriptionText?: string | null;
  readonly imageUrls?: readonly string[];
  readonly sku?: string | null;
  readonly gtin?: string | null;
  readonly sourceId?: string | null;
  readonly attributes?: Readonly<Record<string, string | null | undefined>>;
  readonly sourceData?: Record<string, unknown>;
}

export interface NormalizeOptions {
  readonly sourceSite: string;
  readonly defaultCurrency?: string;
  /** Resolves a source-relative image path to an absolute URL. */
  readonly resolveUrl?: (value: string) => string | null;
}

/**
 * Fields that participate in the semantic hash.
 *
 * Deliberately excludes anything volatile: no timestamps, no generated ids, no
 * run counters, no collection ordering that is not meaningful. Getting this
 * wrong makes every sync report every product as changed, which both floods
 * the audit trail and destroys the value of change alerts.
 */
export function buildSemanticFields(product: NormalizedProduct): Record<string, unknown> {
  return {
    name: normalizeLabel(product.name).toLowerCase(),
    price: moneyHashToken(product.currentPrice),
    oldPrice: moneyHashToken(product.oldPrice),
    currency: product.currency ?? "",
    availability: product.availability,
    brand: product.brandKey ?? "",
    // Sorted: category order carries no meaning and varies between sources.
    categories: [...product.categoryKeys].sort(),
    description: normalizeRichTextForHash(product.descriptionHtml ?? product.descriptionText),
    weight: product.weight?.canonical ?? "",
    sku: product.sku ?? "",
    gtin: product.gtin ?? "",
    attributes: Object.fromEntries(
      Object.entries(product.attributes)
        .map(([key, value]): [string, string] => [
          key.toLowerCase(),
          normalizeLabel(value).toLowerCase(),
        ])
        .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0)),
    ),
    // Sorted: the source's image ordering is not stable and the set is what
    // matters for "did the imagery change?".
    images: [...product.sourceImageUrls].sort(),
  };
}

export function normalizeProduct(
  raw: RawProductRecord,
  options: NormalizeOptions,
): NormalizedProduct {
  const identity = resolveProductIdentity({
    path: raw.path,
    weightText: raw.weightText ?? null,
    sourceId: raw.sourceId ?? null,
    sku: raw.sku ?? null,
  });

  const currentPrice = parseMoney(raw.priceText ?? null, {
    ...(options.defaultCurrency ? { defaultCurrency: options.defaultCurrency } : {}),
  });
  const oldPrice = parseMoney(raw.oldPriceText ?? null, {
    ...(options.defaultCurrency ? { defaultCurrency: options.defaultCurrency } : {}),
  });

  const resolve = options.resolveUrl ?? ((value: string) => value);
  const sourceImageUrls = [
    ...new Set(
      (raw.imageUrls ?? [])
        .map((value) => resolve(value))
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    ),
  ];

  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw.attributes ?? {})) {
    const normalizedValue = normalizeLabel(value ?? "");
    if (normalizedValue) attributes[key] = normalizedValue;
  }

  const descriptionHtml = raw.descriptionHtml?.trim() ? raw.descriptionHtml : null;
  const descriptionText =
    raw.descriptionText?.trim() ??
    (descriptionHtml ? htmlToText(descriptionHtml) : null) ??
    null;

  const product: NormalizedProduct = {
    sourceSite: options.sourceSite,
    sourceKey: identity.sourceKey,
    sourceUrl: raw.url,
    sourcePath: identity.path,
    sourceVariantKey: identity.variantKey,
    identityStrategy: identity.strategy,
    hasUrlCollision: false,

    name: normalizeLabel(raw.name),
    slug: null,

    currentPrice,
    oldPrice,
    currency: currentPrice?.currency ?? oldPrice?.currency ?? options.defaultCurrency ?? null,

    availability: parseAvailability(raw.availabilityText ?? null),

    brandKey: normalizeSourceSlug(raw.brandKey),
    brandName: raw.brandName ? normalizeLabel(raw.brandName) || null : null,
    categoryKeys: [
      ...new Set(
        (raw.categoryKeys ?? [])
          .map((key) => normalizeSourceSlug(key))
          .filter((key): key is string => key !== null),
      ),
    ],

    descriptionHtml,
    descriptionText: descriptionText ? normalizeLabel(descriptionText) : null,

    weight: identity.weight,
    weightText: raw.weightText ? normalizeLabel(raw.weightText) : null,
    sku: raw.sku ? normalizeLabel(raw.sku) : null,
    gtin: raw.gtin ? normalizeLabel(raw.gtin) : null,

    attributes,
    sourceImageUrls,
    sourceData: raw.sourceData ?? {},

    semanticHash: "",
  };

  return { ...product, semanticHash: semanticHash(buildSemanticFields(product)) };
}

/**
 * Validation gate before anything is persisted. A record that fails here is
 * recorded as a parser error rather than written as corrupt catalog.
 */
export const normalizedProductSchema = z.object({
  sourceKey: z.string().min(1),
  sourceUrl: z.string().url(),
  sourcePath: z.string().startsWith("/"),
  name: z.string().min(1, "product name is empty"),
  availability: z.enum(["in_stock", "out_of_stock", "preorder", "unknown"]),
  semanticHash: z.string().length(64),
  sourceImageUrls: z.array(z.string()),
  categoryKeys: z.array(z.string()),
});

export type ProductValidationResult =
  | { readonly ok: true; readonly product: NormalizedProduct }
  | { readonly ok: false; readonly issues: string[] };

export function validateNormalizedProduct(product: NormalizedProduct): ProductValidationResult {
  const result = normalizedProductSchema.safeParse(product);
  if (result.success) return { ok: true, product };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
  };
}
