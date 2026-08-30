import { z } from "zod";

/**
 * Parser for the source site's own structured catalog blob.
 *
 * `/search/` ships an inline script of the form:
 *
 *     window.FILTER_INIT = {
 *       brands:     [ {...}, ... ],
 *       categories: [ {...}, ... ],
 *       products:   [ {...}, ... ]
 *     };
 *
 * The object literal uses unquoted keys, so it is not valid JSON as a whole,
 * but each value *is* a valid JSON array. We locate each array by balanced
 * bracket scanning and `JSON.parse` it individually.
 *
 * `eval` is never used. This is third-party script content and must be treated
 * as hostile input, no matter how friendly it looks today.
 */

export const filterInitProductSchema = z.object({
  h1: z.string(),
  url: z.string(),
  price: z.string().default(""),
  old_price: z.string().default(""),
  availability: z.string().default(""),
  weight: z.string().default(""),
  intensity: z.string().default(""),
  brewStrength: z.string().default(""),
  decaf: z.string().default(""),
  aromas: z.string().default(""),
  brandSlug: z.string().default(""),
  categorySlug: z.string().default(""),
  imageUrl: z.string().default(""),
  description: z.string().default(""),
});

export const filterInitBrandSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String).optional(),
  h1: z.string(),
  slug: z.string(),
  count: z.coerce.number().int().nonnegative().optional(),
});

export interface FilterInitCategory {
  id?: string | undefined;
  h1: string;
  slug: string;
  count?: number | undefined;
  children: FilterInitCategory[];
}

/**
 * Recursive schema. `z.lazy` needs the explicit annotation because the type
 * refers to itself, and the input/output types differ (`children` is optional
 * on the way in and always present on the way out).
 */
export const filterInitCategorySchema: z.ZodType<
  FilterInitCategory,
  z.ZodTypeDef,
  unknown
> = z.lazy(() =>
  z.object({
    id: z.union([z.string(), z.number()]).transform(String).optional(),
    h1: z.string(),
    slug: z.string(),
    count: z.coerce.number().int().nonnegative().optional(),
    children: z.array(filterInitCategorySchema).default([]),
  }),
);

export type FilterInitProduct = z.infer<typeof filterInitProductSchema>;
export type FilterInitBrand = z.infer<typeof filterInitBrandSchema>;

export interface FilterInit {
  readonly products: FilterInitProduct[];
  readonly brands: FilterInitBrand[];
  readonly categories: FilterInitCategory[];
  /** Records the source rejected by validation, for observability. */
  readonly invalidRecords: Array<{ key: string; index: number; issue: string }>;
}

/**
 * Extract the balanced `[...]` array that follows `key:` inside `source`.
 * String literals and escapes are respected so brackets inside text cannot
 * terminate the scan early.
 */
export function extractJsonArrayAfterKey(source: string, key: string): string | null {
  const keyPattern = new RegExp(`(?:^|[{,\\s])${key}\\s*:\\s*\\[`, "m");
  const match = keyPattern.exec(source);
  if (!match) return null;

  const start = source.indexOf("[", match.index);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let i = start; i < source.length; i += 1) {
    const char = source[i] as string;

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        inString = false;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      continue;
    }
    if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

function parseArray<TSchema extends z.ZodTypeAny>(
  source: string,
  key: string,
  schema: TSchema,
  invalid: FilterInit["invalidRecords"],
): Array<z.infer<TSchema>> {
  const raw = extractJsonArrayAfterKey(source, key);
  if (raw === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    invalid.push({ key, index: -1, issue: "array is not valid JSON" });
    return [];
  }
  if (!Array.isArray(parsed)) {
    invalid.push({ key, index: -1, issue: "value is not an array" });
    return [];
  }

  const out: Array<z.infer<TSchema>> = [];
  parsed.forEach((record, index) => {
    const result = schema.safeParse(record);
    if (result.success) out.push(result.data);
    else invalid.push({ key, index, issue: result.error.issues[0]?.message ?? "invalid" });
  });
  return out;
}

/** True when the page carries a FILTER_INIT blob at all. */
export function hasFilterInit(html: string): boolean {
  return /window\.FILTER_INIT\s*=/.test(html);
}

/**
 * Parse the blob. Returns null when the page has no catalog products, which is
 * the signal for the caller to fall back to the HTML listing parser.
 */
export function parseFilterInit(html: string): FilterInit | null {
  if (!hasFilterInit(html)) return null;

  const assignment = html.indexOf("window.FILTER_INIT");
  const source = html.slice(assignment);

  const invalidRecords: FilterInit["invalidRecords"] = [];
  const products = parseArray(source, "products", filterInitProductSchema, invalidRecords);
  const brands = parseArray(source, "brands", filterInitBrandSchema, invalidRecords);
  const categories = parseArray(source, "categories", filterInitCategorySchema, invalidRecords);

  if (products.length === 0 && brands.length === 0 && categories.length === 0) return null;

  return { products, brands, categories, invalidRecords };
}

/** Flatten the category tree into records that carry their parent slug. */
export function flattenCategories(
  categories: readonly FilterInitCategory[],
  parentSlug: string | null = null,
  depth = 0,
): Array<{ category: FilterInitCategory; parentSlug: string | null; depth: number; position: number }> {
  const out: Array<{
    category: FilterInitCategory;
    parentSlug: string | null;
    depth: number;
    position: number;
  }> = [];
  categories.forEach((category, position) => {
    out.push({ category, parentSlug, depth, position });
    if (category.children?.length) {
      out.push(...flattenCategories(category.children, category.slug, depth + 1));
    }
  });
  return out;
}
