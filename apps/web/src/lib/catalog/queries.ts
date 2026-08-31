import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, ne, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  brands,
  categories,
  productCategories,
  productImages,
  products,
} from "@catalog/db/schema";
import { packServings, pricePerServing } from "@catalog/shared";
import { db } from "@/lib/db";
import { resolveImageUrl } from "./images";
import { discountPercent, toPriceView } from "./format";
import type { CatalogQuery } from "./filters";
import {
  BREWING_SYSTEMS,
  type BrewingSystem,
  type BrewingSystemId,
} from "@/lib/recommend/systems";
import type { RecommendationCandidate } from "@/lib/recommend/score";
import { AROMAS_LABELS, DECAF_LABELS, STRENGTH_LABELS, STRENGTH_ORDER } from "./attributes";
import {
  brandNameMatch,
  categoryNameMatch,
  searchMatch,
  searchMatchProductsOnly,
  searchRank,
  suggestionRank,
} from "./search";
import type {
  BrandView,
  CatalogFacets,
  CategoryView,
  ProductCardView,
  ProductDetailView,
  ProductListResult,
  SearchSuggestions,
} from "./types";

/**
 * Catalog reads.
 *
 * Rules that hold everywhere in this file:
 *
 *  - Only `status = 'active'` products are ever listed. `missing` products are
 *    hidden while the sync is unsure about them; `removed` products are gone.
 *    A page that showed either would be advertising something unbuyable.
 *  - The displayed price is `retail_price_override ?? current_price`, so a
 *    manually pinned price wins without the source value ever being lost.
 *  - Every query is parameterised through Drizzle. No string interpolation of
 *    user input reaches SQL.
 *  - Listings load their products, images and facets in a bounded number of
 *    round trips. There is no per-product query anywhere.
 */

/** The price the customer sees. */
const retailPrice = sql<string | null>`coalesce(${products.retailPriceOverride}, ${products.currentPrice})`;
const retailOldPrice = sql<string | null>`coalesce(${products.retailOldPriceOverride}, ${products.oldPrice})`;


/** Self-join alias for resolving a category's parent. */
const parentCategories = alias(categories, "parent_categories");

/** Products that may appear anywhere on the storefront. */
const isVisible = eq(products.status, "active");

const productColumns = {
  id: products.id,
  slug: products.slug,
  name: products.name,
  price: retailPrice,
  oldPrice: retailOldPrice,
  currency: products.currency,
  availability: products.availability,
  weight: products.weight,
  attributes: products.attributes,
  descriptionText: products.descriptionText,
  brandSlug: brands.slug,
  brandName: brands.name,
  lastChangedAt: products.lastChangedAt,
} as const;

type ProductRow = {
  id: string;
  slug: string;
  name: string;
  price: string | null;
  oldPrice: string | null;
  currency: string | null;
  availability: string;
  weight: string | null;
  attributes: Record<string, string>;
  descriptionText: string | null;
  brandSlug: string | null;
  brandName: string | null;
  lastChangedAt: Date | null;
};

function toCard(
  row: ProductRow,
  image: { url: string; alt: string | null; width: number | null; height: number | null } | undefined,
  options: { readonly resolveUrl?: boolean } = {},
): ProductCardView {
  const price = toPriceView(row.price, row.currency);
  const oldPrice = toPriceView(row.oldPrice, row.currency);
  /*
   * `discountPercent` compares exact minor units. Comparing the decimal
   * strings directly would be a real bug: "9.00" > "10.00" is true
   * lexicographically, which would advertise a fake saving.
   */
  const discount = discountPercent(row.price, row.oldPrice);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    price,
    // An old price is only shown when it is genuinely a reduction.
    oldPrice: discount === null ? null : oldPrice,
    discountPercent: discount,
    availability: row.availability as ProductCardView["availability"],
    weight: row.weight,
    intensity: row.attributes?.intensity ?? null,
    brand: row.brandSlug && row.brandName ? { slug: row.brandSlug, name: row.brandName } : null,
    image: image
      ? {
          url: options.resolveUrl === false ? image.url : resolveImageUrl(image.url),
          alt: image.alt ?? row.name,
          width: image.width,
          height: image.height,
        }
      : null,
    shortDescription: row.descriptionText,
  };
}

/** Load the primary image for many products in one query. */
async function loadPrimaryImages(productIds: readonly string[]) {
  if (productIds.length === 0) return new Map<string, { url: string; alt: string | null; width: number | null; height: number | null }>();

  const rows = await db
    .select({
      productId: productImages.productId,
      publicUrl: productImages.publicUrl,
      objectKey: productImages.objectKey,
      alt: productImages.alt,
      width: productImages.width,
      height: productImages.height,
      ordinal: productImages.ordinal,
    })
    .from(productImages)
    .where(
      and(
        inArray(productImages.productId, [...productIds]),
        eq(productImages.status, "active"),
        isNotNull(productImages.objectKey),
      ),
    )
    .orderBy(asc(productImages.ordinal));

  const map = new Map<string, { url: string; alt: string | null; width: number | null; height: number | null }>();
  for (const row of rows) {
    if (map.has(row.productId)) continue; // first by ordinal wins
    const url = row.publicUrl ?? row.objectKey;
    if (!url) continue;
    map.set(row.productId, { url, alt: row.alt, width: row.width, height: row.height });
  }
  return map;
}

/** Conditions shared by every listing query. */
function buildFilterConditions(query: CatalogQuery, extra: SQL[] = []): SQL[] {
  const conditions: SQL[] = [isVisible, ...extra];

  if (query.brand.length > 0) {
    conditions.push(inArray(brands.slug, [...query.brand]));
  }
  if (query.strength.length > 0) {
    conditions.push(
      sql`lower(${products.attributes}->>'strength') = any(${sql.param(query.strength)}::text[])`,
    );
  }
  if (query.decaf) {
    conditions.push(sql`lower(${products.attributes}->>'decaf') = ${query.decaf}`);
  }
  if (query.aromas) {
    conditions.push(sql`lower(${products.attributes}->>'aromas') = ${query.aromas}`);
  }
  if (query.category.length > 0) {
    conditions.push(
      sql`exists (
        select 1 from ${productCategories} pc
        join ${categories} c on c.id = pc.category_id
        where pc.product_id = ${products.id} and c.slug = any(${sql.param(query.category)}::text[])
      )`,
    );
  }
  if (query.q) {
    conditions.push(searchMatch(query.q));
  }
  return conditions;
}

function buildOrderBy(query: CatalogQuery): SQL[] {
  switch (query.sort) {
    case "name-asc":
      return [asc(products.name)];
    case "name-desc":
      return [desc(products.name)];
    case "price-asc":
      // Products without a price sort last rather than first.
      return [sql`${retailPrice} asc nulls last`, asc(products.name)];
    case "price-desc":
      return [sql`${retailPrice} desc nulls last`, asc(products.name)];
    case "newest":
      return [desc(products.firstSeenAt), asc(products.name)];
    case "relevance":
    default:
      if (query.q) {
        return [...searchRank(query.q), asc(products.name)];
      }
      // With no query there is no relevance signal; in-stock first, then name.
      return [sql`(${products.availability} = 'in_stock') desc`, asc(products.name)];
  }
}

export interface ListProductsOptions {
  readonly query: CatalogQuery;
  /** Restrict to one category (and its children). */
  readonly categorySlug?: string;
  /** Restrict to one brand. */
  readonly brandSlug?: string;
  /** Only products with a reduced price. */
  readonly promotionsOnly?: boolean;
  readonly includeFacets?: boolean;
}

export async function listProducts(options: ListProductsOptions): Promise<ProductListResult> {
  const { query } = options;
  const extra: SQL[] = [];

  if (options.categorySlug) {
    // Include descendants so a parent category lists its children's products.
    extra.push(
      sql`exists (
        select 1 from ${productCategories} pc
        join ${categories} c on c.id = pc.category_id
        left join ${categories} parent on parent.id = c.parent_id
        where pc.product_id = ${products.id}
          and (c.slug = ${options.categorySlug} or parent.slug = ${options.categorySlug})
      )`,
    );
  }
  if (options.brandSlug) {
    extra.push(eq(brands.slug, options.brandSlug));
  }
  if (options.promotionsOnly) {
    extra.push(sql`${retailOldPrice} is not null and ${retailOldPrice} > ${retailPrice}`);
  }

  const conditions = buildFilterConditions(query, extra);
  const where = and(...conditions);
  const offset = (query.page - 1) * query.pageSize;

  const [rows, totalResult, facets] = await Promise.all([
    db
      .select(productColumns)
      .from(products)
      .leftJoin(brands, eq(products.brandId, brands.id))
      .where(where)
      .orderBy(...buildOrderBy(query))
      .limit(query.pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(products)
      .leftJoin(brands, eq(products.brandId, brands.id))
      .where(where),
    options.includeFacets === false
      ? Promise.resolve(emptyFacets())
      : loadFacets(extra, query),
  ]);

  const typed = rows as unknown as ProductRow[];
  const images = await loadPrimaryImages(typed.map((row) => row.id));
  const total = totalResult[0]?.count ?? 0;

  return {
    items: typed.map((row) => toCard(row, images.get(row.id))),
    total,
    page: query.page,
    pageSize: query.pageSize,
    pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
    facets,
  };
}

function emptyFacets(): CatalogFacets {
  return { brands: [], strengths: [], decaf: [], aromas: [], categories: [] };
}

/**
 * Facet counts for the current scope.
 *
 * Counted against the scope (category/brand/promotions) but *not* against the
 * currently selected filters, so a visitor can always see and reach the other
 * options instead of the list collapsing to what they already chose.
 */
async function loadFacets(extra: SQL[], query: CatalogQuery): Promise<CatalogFacets> {
  const scope = and(isVisible, ...extra);
  /*
   * The brand clause is left out here: the attribute and category facet
   * queries do not join `brands`, and a facet count must be counted over the
   * same rows for every facet or the numbers disagree with each other.
   */
  const scopeWithSearch = query.q ? and(scope, searchMatchProductsOnly(query.q)) : scope;

  const [brandRows, attributeRows, categoryRows] = await Promise.all([
    db
      .select({
        value: brands.slug,
        label: brands.name,
        count: sql<number>`count(*)::int`,
      })
      .from(products)
      .innerJoin(brands, eq(products.brandId, brands.id))
      .where(scopeWithSearch)
      .groupBy(brands.slug, brands.name)
      .orderBy(desc(sql`count(*)`), asc(brands.name)),
    db
      .select({
        strength: sql<string | null>`lower(${products.attributes}->>'strength')`,
        decaf: sql<string | null>`lower(${products.attributes}->>'decaf')`,
        aromas: sql<string | null>`lower(${products.attributes}->>'aromas')`,
        count: sql<number>`count(*)::int`,
      })
      .from(products)
      .leftJoin(brands, eq(products.brandId, brands.id))
      .where(scopeWithSearch)
      .groupBy(
        sql`lower(${products.attributes}->>'strength')`,
        sql`lower(${products.attributes}->>'decaf')`,
        sql`lower(${products.attributes}->>'aromas')`,
      ),
    db
      .select({
        value: categories.slug,
        label: categories.name,
        count: sql<number>`count(distinct ${products.id})::int`,
      })
      .from(products)
      .innerJoin(productCategories, eq(productCategories.productId, products.id))
      .innerJoin(categories, eq(categories.id, productCategories.categoryId))
      .leftJoin(brands, eq(products.brandId, brands.id))
      .where(scopeWithSearch)
      .groupBy(categories.slug, categories.name)
      .orderBy(desc(sql`count(distinct ${products.id})`), asc(categories.name)),
  ]);

  const tally = (key: "strength" | "decaf" | "aromas") => {
    const counts = new Map<string, number>();
    for (const row of attributeRows) {
      const value = row[key];
      if (!value) continue;
      counts.set(value, (counts.get(value) ?? 0) + row.count);
    }
    return counts;
  };

  const strengthCounts = tally("strength");
  const decafCounts = tally("decaf");
  const aromaCounts = tally("aromas");

  const orderedStrengths = STRENGTH_ORDER.filter((value) => strengthCounts.has(value));

  return {
    brands: brandRows.map((row) => ({ value: row.value, label: row.label, count: row.count })),
    strengths: orderedStrengths.map((value) => ({
      value,
      label: STRENGTH_LABELS[value] ?? value,
      count: strengthCounts.get(value) ?? 0,
    })),
    decaf: ["yes", "no"]
      .filter((value) => decafCounts.has(value))
      .map((value) => ({
        value,
        label: DECAF_LABELS[value] ?? value,
        count: decafCounts.get(value) ?? 0,
      })),
    aromas: ["yes", "no"]
      .filter((value) => aromaCounts.has(value))
      .map((value) => ({
        value,
        label: AROMAS_LABELS[value] ?? value,
        count: aromaCounts.get(value) ?? 0,
      })),
    categories: categoryRows.map((row) => ({ value: row.value, label: row.label, count: row.count })),
  };
}

/** How many of each kind of suggestion the dropdown shows. */
const SUGGESTION_PRODUCT_LIMIT = 6;
const SUGGESTION_LINK_LIMIT = 3;
/** Below this, a term matches too much of the catalog to be a useful hint. */
export const MIN_SUGGESTION_TERM_LENGTH = 2;

/**
 * Products in a category *or any of its children*.
 *
 * On this source, products hang off the subcategory: „Капсули" has 57 products
 * underneath it and not one attached directly. Counting only direct links
 * would suggest the category with a count of zero — or, with an inner join,
 * not suggest it at all.
 *
 * The outer reference is written as bare `categories.id` rather than through
 * the schema object: Drizzle renders a column unqualified in a select list, so
 * `${categories.id}` there would resolve against `c2` inside this subquery.
 */
const categorySuggestionCount = sql<number>`(
  select count(distinct p.id)::int
  from ${products} p
  join ${productCategories} pc on pc.product_id = p.id
  join ${categories} c2 on c2.id = pc.category_id
  where p.status = 'active'
    and (c2.id = categories.id or c2.parent_id = categories.id)
)`;

/**
 * Typeahead suggestions.
 *
 * Matched with the same predicate as the results page, so every suggestion is
 * something `/search?q=` would also return — a dropdown that offers a product
 * the results page then cannot find is worse than no dropdown.
 *
 * Four small queries plus the image lookup, all bounded and all indexed. The
 * counts are deliberately included: "виж всички 34 резултата" is often the row
 * a visitor actually wants.
 */
export async function suggestCatalog(term: string): Promise<SearchSuggestions> {
  const trimmed = term.trim();
  if (trimmed.length < MIN_SUGGESTION_TERM_LENGTH) {
    return { term: trimmed, products: [], brands: [], categories: [], total: 0 };
  }

  const match = and(isVisible, searchMatch(trimmed));

  const [rows, totalResult, brandRows, categoryRows] = await Promise.all([
    db
      .select(productColumns)
      .from(products)
      .leftJoin(brands, eq(products.brandId, brands.id))
      .where(match)
      .orderBy(...suggestionRank(trimmed), asc(products.name))
      .limit(SUGGESTION_PRODUCT_LIMIT),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(products)
      .leftJoin(brands, eq(products.brandId, brands.id))
      .where(match),
    db
      .select({
        slug: brands.slug,
        name: brands.name,
        productCount: sql<number>`count(${products.id})::int`,
      })
      .from(brands)
      .innerJoin(products, and(eq(products.brandId, brands.id), isVisible))
      .where(and(eq(brands.status, "active"), brandNameMatch(trimmed)))
      .groupBy(brands.slug, brands.name)
      .orderBy(desc(sql`count(${products.id})`), asc(brands.name))
      .limit(SUGGESTION_LINK_LIMIT),
    db
      .select({
        slug: categories.slug,
        name: categories.name,
        productCount: categorySuggestionCount,
      })
      .from(categories)
      .where(and(eq(categories.status, "active"), categoryNameMatch(trimmed)))
      .orderBy(desc(categorySuggestionCount), asc(categories.name))
      // Widened, then narrowed in code: empty categories are dropped below, and
      // a `LIMIT` here could spend the whole budget on them.
      .limit(SUGGESTION_LINK_LIMIT * 3),
  ]);

  const typed = rows as unknown as ProductRow[];
  const images = await loadPrimaryImages(typed.map((row) => row.id));

  return {
    term: trimmed,
    products: typed.map((row) => {
      const card = toCard(row, images.get(row.id));
      return {
        slug: card.slug,
        name: card.name,
        brandName: card.brand?.name ?? null,
        weight: card.weight,
        price: card.price,
        image: card.image,
      };
    }),
    brands: brandRows,
    categories: categoryRows
      .filter((row) => row.productCount > 0)
      .slice(0, SUGGESTION_LINK_LIMIT),
    total: totalResult[0]?.count ?? 0,
  };
}

/**
 * Load one product by its storefront slug.
 *
 * Deliberately does *not* filter on status: the caller decides what to do with
 * a removed product. Returning 404 for a URL that search engines have already
 * indexed loses the page silently, so the product page renders a proper
 * "no longer available" state instead.
 */
export async function getProductBySlug(slug: string): Promise<ProductDetailView | null> {
  const [row] = await db
    .select({
      ...productColumns,
      status: products.status,
      descriptionHtml: products.descriptionHtml,
      sku: products.sku,
      gtin: products.gtin,
    })
    .from(products)
    .leftJoin(brands, eq(products.brandId, brands.id))
    .where(eq(products.slug, slug))
    .limit(1);

  if (!row) return null;
  const typed = row as unknown as ProductRow & {
    status: string;
    descriptionHtml: string | null;
    sku: string | null;
    gtin: string | null;
  };

  const [imageRows, categoryRows] = await Promise.all([
    db
      .select({
        publicUrl: productImages.publicUrl,
        objectKey: productImages.objectKey,
        alt: productImages.alt,
        width: productImages.width,
        height: productImages.height,
      })
      .from(productImages)
      .where(and(eq(productImages.productId, typed.id), eq(productImages.status, "active")))
      .orderBy(asc(productImages.ordinal)),
    db
      .select({
        slug: categories.slug,
        name: categories.name,
        isPrimary: productCategories.isPrimary,
        // A real aliased join, not a select-list subquery, so the column
        // reference is properly table-qualified.
        parentSlug: parentCategories.slug,
      })
      .from(productCategories)
      .innerJoin(categories, eq(categories.id, productCategories.categoryId))
      .leftJoin(parentCategories, eq(parentCategories.id, categories.parentId))
      .where(eq(productCategories.productId, typed.id))
      .orderBy(desc(productCategories.isPrimary)),
  ]);

  const images = imageRows
    .map((image) => {
      const url = image.publicUrl ?? image.objectKey;
      return url
        ? {
            url: resolveImageUrl(url),
            alt: image.alt ?? typed.name,
            width: image.width,
            height: image.height,
          }
        : null;
    })
    .filter((image): image is NonNullable<typeof image> => image !== null);

  // `images` already carry resolved URLs, so resolution is disabled here.
  const card = toCard(
    typed,
    images[0]
      ? { url: images[0].url, alt: images[0].alt, width: images[0].width, height: images[0].height }
      : undefined,
    { resolveUrl: false },
  );

  return {
    ...card,
    image: images[0] ?? null,
    status: typed.status as ProductDetailView["status"],
    descriptionHtml: typed.descriptionHtml,
    descriptionText: typed.descriptionText,
    sku: typed.sku,
    gtin: typed.gtin,
    attributes: typed.attributes ?? {},
    images,
    categories: categoryRows.map((row) => ({
      slug: row.slug,
      name: row.name,
      isPrimary: row.isPrimary,
      parentSlug: row.parentSlug,
    })),
    updatedAt: typed.lastChangedAt,
  };
}

/**
 * Related products.
 *
 * The source publishes no explicit relationships, so this is a documented,
 * deterministic rule rather than an invented one: same category first, then
 * same brand, never the product itself, ordered by closeness of price so the
 * suggestions are plausible alternatives rather than random stock.
 */
export async function getRelatedProducts(
  product: ProductDetailView,
  limit = 6,
): Promise<readonly ProductCardView[]> {
  const categorySlugs = product.categories.map((category) => category.slug);
  const brandSlug = product.brand?.slug ?? null;

  /*
   * Candidates are gathered with explicit joins and scored here rather than in
   * a SQL expression. Two reasons: a correlated subquery in a select list is
   * exactly the construct that silently mis-resolves its column references,
   * and the scoring rule is easier to reason about — and to change — as code.
   */
  const [sameCategory, sameBrand] = await Promise.all([
    categorySlugs.length === 0
      ? Promise.resolve([] as Array<{ id: string }>)
      : db
          .selectDistinct({ id: products.id })
          .from(products)
          .innerJoin(productCategories, eq(productCategories.productId, products.id))
          .innerJoin(categories, eq(categories.id, productCategories.categoryId))
          .where(and(isVisible, ne(products.id, product.id), inArray(categories.slug, categorySlugs))),
    brandSlug === null
      ? Promise.resolve([] as Array<{ id: string }>)
      : db
          .select({ id: products.id })
          .from(products)
          .innerJoin(brands, eq(brands.id, products.brandId))
          .where(and(isVisible, ne(products.id, product.id), eq(brands.slug, brandSlug))),
  ]);

  const scores = new Map<string, number>();
  for (const row of sameCategory) scores.set(row.id, (scores.get(row.id) ?? 0) + 2);
  for (const row of sameBrand) scores.set(row.id, (scores.get(row.id) ?? 0) + 1);

  let candidateIds = [...scores.keys()];

  // Nothing shares a category or brand: fall back to anything else in stock,
  // so the section is never empty on a sparsely-linked product.
  if (candidateIds.length === 0) {
    const fallback = await db
      .select({ id: products.id })
      .from(products)
      .where(and(isVisible, ne(products.id, product.id)))
      .orderBy(asc(products.name))
      .limit(limit);
    candidateIds = fallback.map((row) => row.id);
  }

  if (candidateIds.length === 0) return [];

  const rows = (await db
    .select(productColumns)
    .from(products)
    .leftJoin(brands, eq(products.brandId, brands.id))
    .where(inArray(products.id, candidateIds.slice(0, 200)))) as unknown as ProductRow[];

  const anchor = product.price ? Number(product.price.amount) : null;
  const ranked = rows
    .map((row) => ({
      row,
      score: scores.get(row.id) ?? 0,
      // Closeness of price only breaks ties; it never outranks relevance.
      priceGap:
        anchor !== null && row.price !== null ? Math.abs(Number(row.price) - anchor) : Number.MAX_SAFE_INTEGER,
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.priceGap - b.priceGap ||
        (a.row.name < b.row.name ? -1 : a.row.name > b.row.name ? 1 : 0),
    )
    .slice(0, limit);

  const images = await loadPrimaryImages(ranked.map((entry) => entry.row.id));
  return ranked.map((entry) => toCard(entry.row, images.get(entry.row.id)));
}

/**
 * Full category tree with live product counts.
 *
 * Counts come from a separate grouped query rather than a correlated subquery
 * in the select list. That is not a style preference: Drizzle does not
 * table-qualify column references inside select-list subqueries, so
 * `where pc.category_id = ${categories.id}` renders as a bare `"id"`, which
 * PostgreSQL happily resolves to the *subquery's* own table. The result is a
 * query that runs without error and returns zero for everything.
 */
export async function getCategoryTree(): Promise<readonly CategoryView[]> {
  const [rows, counts] = await Promise.all([
    db
      .select({
        id: categories.id,
        slug: categories.slug,
        name: categories.name,
        description: categories.description,
        parentId: categories.parentId,
        position: categories.position,
      })
      .from(categories)
      .where(eq(categories.status, "active"))
      .orderBy(asc(categories.position), asc(categories.name)),
    db
      .select({
        categoryId: productCategories.categoryId,
        count: sql<number>`count(distinct ${products.id})::int`,
      })
      .from(productCategories)
      .innerJoin(products, eq(products.id, productCategories.productId))
      .where(isVisible)
      .groupBy(productCategories.categoryId),
  ]);

  const countByCategory = new Map(counts.map((row) => [row.categoryId, row.count]));

  const byId = new Map(rows.map((row) => [row.id, row]));
  const build = (parentId: string | null): CategoryView[] =>
    rows
      .filter((row) => row.parentId === parentId)
      .map((row) => {
        const children = build(row.id);
        const direct = countByCategory.get(row.id) ?? 0;
        return {
          id: row.id,
          slug: row.slug,
          name: row.name,
          description: row.description,
          parentSlug: row.parentId ? (byId.get(row.parentId)?.slug ?? null) : null,
          // A parent's count includes its children's products: on this source
          // products hang off the subcategory, so `kapsuli` has none directly.
          productCount: direct + children.reduce((sum, child) => sum + child.productCount, 0),
          children,
        };
      });

  return build(null);
}

export async function getCategoryBySlug(slug: string): Promise<CategoryView | null> {
  const flatten = (nodes: readonly CategoryView[]): CategoryView[] =>
    nodes.flatMap((node) => [node, ...flatten(node.children)]);
  return flatten(await getCategoryTree()).find((category) => category.slug === slug) ?? null;
}

export async function listBrands(options: { withProductsOnly?: boolean } = {}): Promise<readonly BrandView[]> {
  const [rows, counts] = await Promise.all([
    db
      .select({
        id: brands.id,
        slug: brands.slug,
        name: brands.name,
        tagline: brands.tagline,
        description: brands.description,
      })
      .from(brands)
      .where(eq(brands.status, "active"))
      .orderBy(asc(brands.name)),
    db
      .select({ brandId: products.brandId, count: sql<number>`count(*)::int` })
      .from(products)
      .where(isVisible)
      .groupBy(products.brandId),
  ]);

  const countByBrand = new Map(counts.map((row) => [row.brandId, row.count]));

  const mapped = rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    description: row.description,
    productCount: countByBrand.get(row.id) ?? 0,
  }));

  return options.withProductsOnly ? mapped.filter((brand) => brand.productCount > 0) : mapped;
}

export async function getBrandBySlug(slug: string): Promise<BrandView | null> {
  return (await listBrands()).find((brand) => brand.slug === slug) ?? null;
}

/** Products with a genuine reduction, for the promotions route. */
export async function countPromotions(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(products)
    .where(and(isVisible, sql`${retailOldPrice} is not null and ${retailOldPrice} > ${retailPrice}`));
  return row?.count ?? 0;
}

/** Newest arrivals for the home page. */
export async function listNewArrivals(limit = 8): Promise<readonly ProductCardView[]> {
  const rows = await db
    .select(productColumns)
    .from(products)
    .leftJoin(brands, eq(products.brandId, brands.id))
    .where(isVisible)
    .orderBy(desc(products.firstSeenAt), asc(products.name))
    .limit(limit);

  const typed = rows as unknown as ProductRow[];
  const images = await loadPrimaryImages(typed.map((row) => row.id));
  return typed.map((row) => toCard(row, images.get(row.id)));
}

/** Every active product slug, for the sitemap. */
export async function listAllProductSlugs(): Promise<ReadonlyArray<{ slug: string; updatedAt: Date | null }>> {
  return db
    .select({ slug: products.slug, updatedAt: products.lastChangedAt })
    .from(products)
    .where(isVisible)
    .orderBy(asc(products.slug));
}

/** Catalog-wide counts used on the home page and in the coverage report. */
export async function getCatalogSummary(): Promise<{
  products: number;
  brands: number;
  categories: number;
  promotions: number;
}> {
  const [row] = await db
    .select({
      products: sql<number>`count(*) filter (where ${products.status} = 'active')::int`,
      promotions: sql<number>`count(*) filter (where ${products.status} = 'active' and ${retailOldPrice} is not null and ${retailOldPrice} > ${retailPrice})::int`,
    })
    .from(products);

  const [brandRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(brands)
    .where(eq(brands.status, "active"));

  const [categoryRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(categories)
    .where(eq(categories.status, "active"));

  return {
    products: row?.products ?? 0,
    promotions: row?.promotions ?? 0,
    brands: brandRow?.count ?? 0,
    categories: categoryRow?.count ?? 0,
  };
}

/* --- Recommendation wizard ---------------------------------------------- *
 *
 * The wizard needs two things the listing queries do not provide: how many
 * products exist per brewing system (so a system with nothing in it is never
 * offered, and one with almost nothing skips the questions), and the full
 * compatible set in one go, since scoring ranks a system's products against
 * each other rather than paginating them.
 *
 * A system is matched on the category slug *or* the source key behind it. The
 * slug is derived from the category's Bulgarian name and would change if the
 * source renamed it; the source key would not. Matching either means an
 * upstream rename costs us nothing.
 */

/** Categories belonging to a brewing system, by slug or by source key. */
function systemCategoryCondition(system: BrewingSystem): SQL {
  return sql`exists (
    select 1 from ${productCategories} pc
    join ${categories} c on c.id = pc.category_id
    where pc.product_id = ${products.id}
      and (
        c.slug = any(${sql.param([...system.categorySlugs])}::text[])
        or c.source_key = any(${sql.param([...system.categorySourceKeys])}::text[])
      )
  )`;
}

/**
 * How many products each brewing system currently holds.
 *
 * One query for every system rather than one per system: the wizard's first
 * two steps both need the whole picture, and a system that has fallen to zero
 * must disappear from the options rather than lead to an empty result.
 */
export async function getSystemAvailability(): Promise<Readonly<Record<BrewingSystemId, number>>> {
  const columns = Object.fromEntries(
    BREWING_SYSTEMS.map((system) => [
      system.id,
      sql<number>`count(*) filter (where ${systemCategoryCondition(system)})::int`,
    ]),
  );

  const [row] = await db.select(columns).from(products).where(isVisible);

  return Object.fromEntries(
    BREWING_SYSTEMS.map((system) => [system.id, Number(row?.[system.id] ?? 0)]),
  ) as Record<BrewingSystemId, number>;
}

/**
 * Every product compatible with a brewing system, ready for scoring.
 *
 * Deliberately unpaginated: the largest system holds 50 products, the scorer
 * ranks them against each other, and per-cup price is scored against the
 * pool's own range — all of which need the whole set. The bound is the
 * catalog, and `MAX_RECOMMENDATION_CANDIDATES` keeps it a bound rather than a
 * promise.
 */
export const MAX_RECOMMENDATION_CANDIDATES = 200;

export async function listRecommendationCandidates(
  system: BrewingSystem,
): Promise<readonly RecommendationCandidate[]> {
  const rows = await db
    .select({
      ...productColumns,
      weightValue: products.weightValue,
      weightUnit: products.weightUnit,
    })
    .from(products)
    .leftJoin(brands, eq(products.brandId, brands.id))
    .where(and(isVisible, systemCategoryCondition(system)))
    .orderBy(asc(products.name))
    .limit(MAX_RECOMMENDATION_CANDIDATES);

  const typed = rows as unknown as Array<
    ProductRow & { weightValue: string | null; weightUnit: string | null }
  >;
  const images = await loadPrimaryImages(typed.map((row) => row.id));

  return typed.map((row) => {
    const card = toCard(row, images.get(row.id));
    /*
     * Servings and per-cup price are computed here, in TypeScript, from the
     * shared exact-decimal helpers rather than in SQL. The grams-per-serving
     * figure is a business assumption; having one copy of it means the number
     * on the product page can never disagree with the number the wizard
     * ranked by.
     */
    const servings = packServings(row.weightValue, row.weightUnit);
    return {
      ...card,
      attributes: row.attributes ?? {},
      pricePerServing: pricePerServing(row.price, servings),
      servings: servings?.whole ?? null,
      servingsEstimated: servings?.estimated ?? false,
    };
  });
}
