import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, ne, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { brands, categories, productCategories, productImages, products } from "@catalog/db/schema";
import { formatListingLabel, packServings, pricePerServing, productName } from "@catalog/shared";
import { db } from "@/lib/db";
import { resolveImageUrl } from "./images";
import { brandDisplayName } from "./brand-display";
import { discountPercent, toPerServingView, toPriceView, unitPriceView } from "./format";
import type { CatalogQuery } from "./filters";
import { BREWING_SYSTEMS, type BrewingSystem, type BrewingSystemId } from "@/lib/recommend/systems";
import type { RecommendationCandidate } from "@/lib/recommend/score";
import { AROMAS_LABELS, DECAF_LABELS, STRENGTH_LABELS, STRENGTH_ORDER } from "./attributes";
import { publishedSummary, resolveProductFormat } from "./fallback-copy";
import {
  brandNameMatch,
  categoryNameMatch,
  searchMatch,
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
const retailPrice = sql<
  string | null
>`coalesce(${products.retailPriceOverride}, ${products.currentPrice})`;
const retailOldPrice = sql<
  string | null
>`coalesce(${products.retailOldPriceOverride}, ${products.oldPrice})`;

/*
 * The copy the customer sees: ours, or a sentence generated from our own data.
 *
 * This is where the copy layer stops looking like the price layer above. A
 * price falls back to the source's price, because a price is a fact. A
 * description must not fall back to the source's description, because that is
 * the source's prose: the same paragraph on two domains, in the visible copy,
 * the meta description and the Product JSON-LD at once. It used to — this was
 * `coalesce(override, source)` — and every product the sync created shipped
 * the source's text until someone wrote an entry for it.
 *
 * So `products.description_text` and `products.description_html` are not
 * selected anywhere in this file, and must not be. The override is read as it
 * is; when it is null, `publishedSummary` composes one factual sentence from
 * the columns in `fallbackCopyColumns`, and there is no long description at
 * all. Every reader of a description — product page, metadata, JSON-LD, cards,
 * the wizard's candidates — gets it through `toCard` / `getProductBySlug`, so
 * this stays a single decision.
 *
 * The one place the source's text is still read is the generated
 * `search_vector` column (`0005_description_overrides.sql`), which indexes
 * `coalesce(override, source)`. That is deliberate and it is not publishing:
 * the vector decides which products *match* a query, and nothing from it is
 * ever rendered. A new product stays findable by the words that describe it
 * while its page shows only what we wrote or generated.
 */
const ownDescriptionText = products.descriptionTextOverride;
const ownDescriptionHtml = products.descriptionHtmlOverride;

/**
 * The held facts the generated sentence is built from, beyond what
 * `productColumns` already carries (brand and attributes).
 *
 * `categoryKeys` holds each category's slug *and* source key: a brewing
 * system is bound to either, for the reason given in `lib/recommend/systems.ts`.
 * A correlated subquery rather than a join, so a product in two categories is
 * still one row.
 */
const fallbackCopyColumns = {
  weightValue: products.weightValue,
  weightUnit: products.weightUnit,
  categoryKeys: sql<string[]>`array(
    select distinct category_key
    from ${productCategories} pc
    join ${categories} c on c.id = pc.category_id
    cross join lateral unnest(array[c.slug, c.source_key]) as category_key
    where pc.product_id = ${products.id} and category_key is not null
  )`,
} as const;

/** Self-join alias for resolving a category's parent. */
const parentCategories = alias(categories, "parent_categories");

/** Products that may appear anywhere on the storefront. */
const isVisible = eq(products.status, "active");

/**
 * What the product's own name is built from, beyond the brand and the pack
 * size: its identity for a name override, and the source keys alone of its
 * categories. `categoryKeys` above mixes in our stored slugs, which is right
 * for binding a brewing system and wrong here — the name model reads exactly
 * what the sync hands it when it derives the slug.
 */
const nameColumns = {
  sourceKey: products.sourceKey,
  previousSourceKeys: products.previousSourceKeys,
  categorySourceKeys: sql<string[]>`array(
    select c.source_key
    from ${productCategories} pc
    join ${categories} c on c.id = pc.category_id
    where pc.product_id = ${products.id} and c.source_key is not null
    order by c.source_key
  )`,
} as const;

const productColumns = {
  id: products.id,
  slug: products.slug,
  /** The supplier's name. Never shown: `toCard` turns it into ours. */
  name: products.name,
  ...nameColumns,
  price: retailPrice,
  oldPrice: retailOldPrice,
  currency: products.currency,
  availability: products.availability,
  weight: products.weight,
  attributes: products.attributes,
  descriptionText: ownDescriptionText,
  ...fallbackCopyColumns,
  brandSlug: brands.slug,
  brandName: brands.name,
  brandSourceKey: brands.sourceKey,
  lastChangedAt: products.lastChangedAt,
} as const;

type ProductRow = {
  id: string;
  slug: string;
  /** The supplier's name; see `displayName`. */
  name: string;
  sourceKey: string;
  previousSourceKeys: string[] | null;
  categorySourceKeys: string[] | null;
  price: string | null;
  oldPrice: string | null;
  currency: string | null;
  availability: string;
  weight: string | null;
  attributes: Record<string, string>;
  /** Our override only — never the source's text. Null until copy is written. */
  descriptionText: string | null;
  weightValue: string | null;
  weightUnit: string | null;
  categoryKeys: string[] | null;
  brandSlug: string | null;
  brandName: string | null;
  brandSourceKey: string | null;
  lastChangedAt: Date | null;
};

/**
 * The product's name as this shop writes it.
 *
 * **The one place a stored name becomes a displayed one.** Every view of a
 * product is built by `toCard`, which calls this, so a card, the product page,
 * its title, the search dropdown and the structured data cannot name one
 * product two ways — and none of them can show the supplier's wording, because
 * none of them is ever handed it.
 */
function displayName(row: ProductRow) {
  return productName({
    sourceName: row.name,
    sourceKey: row.sourceKey,
    previousSourceKeys: row.previousSourceKeys,
    brand:
      row.brandSourceKey || row.brandName
        ? { sourceKey: row.brandSourceKey, name: row.brandName }
        : null,
    categoryKeys: row.categorySourceKeys,
    packValue: row.weightValue,
    packUnit: row.weightUnit,
  });
}

function toCard(
  row: ProductRow,
  image:
    { url: string; alt: string | null; width: number | null; height: number | null } | undefined,
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
  const servings = packServings(row.weightValue, row.weightUnit);
  const name = displayName(row);
  const card = {
    id: row.id,
    slug: row.slug,
    name: name.full,
    title: name.title,
    detail: name.detail,
    price,
    // An old price is only shown when it is genuinely a reduction.
    oldPrice: discount === null ? null : oldPrice,
    discountPercent: discount,
    availability: row.availability as ProductCardView["availability"],
    // Ours when the size parsed ("500 г"), the stored text ("0.500кг.") when not.
    weight: name.quantity?.label ?? row.weight,
    intensity: row.attributes?.intensity ?? null,
    systemId: resolveProductFormat(row.categoryKeys).system?.id ?? null,
    servingPrice: toPerServingView(pricePerServing(row.price, servings), row.currency, {
      estimated: servings?.estimated ?? false,
    }),
    brand:
      row.brandSlug && row.brandName
        ? {
            slug: row.brandSlug,
            sourceKey: row.brandSourceKey,
            name: brandDisplayName({ name: row.brandName, sourceKey: row.brandSourceKey }),
          }
        : null,
    image: image
      ? {
          url: options.resolveUrl === false ? image.url : resolveImageUrl(image.url),
          // The stored alt is the supplier's name for the product, written by
          // the sync when it mirrored the photograph. Ours says the same thing
          // in the shop's words.
          alt: name.full,
          width: image.width,
          height: image.height,
        }
      : null,
    shortDescription: null,
  } satisfies ProductCardView;

  return {
    ...card,
    /*
     * Override-or-generated, and nothing else. Composed from the card rather
     * than the row so the sentence names the brand exactly as the page around
     * it does.
     */
    shortDescription: publishedSummary(row.descriptionText, {
      brandName: card.brand?.name ?? null,
      categoryKeys: row.categoryKeys,
      packValue: row.weightValue,
      packUnit: row.weightUnit,
      attributes: row.attributes,
    }),
  };
}

/** Load the primary image for many products in one query. */
async function loadPrimaryImages(productIds: readonly string[]) {
  if (productIds.length === 0)
    return new Map<
      string,
      { url: string; alt: string | null; width: number | null; height: number | null }
    >();

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

  const map = new Map<
    string,
    { url: string; alt: string | null; width: number | null; height: number | null }
  >();
  for (const row of rows) {
    if (map.has(row.productId)) continue; // first by ordinal wins
    // The object key, not the stored absolute URL: the key is resolved against
    // whichever image host is configured today, so moving stores cannot strand
    // a row that still remembers the old host.
    const url = row.objectKey ?? row.publicUrl;
    if (!url) continue;
    map.set(row.productId, { url, alt: row.alt, width: row.width, height: row.height });
  }
  return map;
}

/**
 * Price per cup, for ordering: the displayed retail price over the cups the
 * sync stored for the pack. Both are `numeric`, so the division is exact
 * decimal arithmetic and never a float. Null — and so sorted last — when
 * either side is missing; a pack of zero cups has no per-cup price either.
 */
const retailPricePerCup = sql<
  string | null
>`case when ${products.servings} > 0 then ${retailPrice} / ${products.servings} end`;

/**
 * Products in any of the given brewing systems.
 *
 * `BREWING_SYSTEMS` is the only place that knows which categories make up a
 * system, and it binds them by slug *or* source key (see "Recommendation
 * wizard" below for why). Several systems are a union, like every other
 * multi-value filter.
 */
function brewingSystemsCondition(systemIds: readonly string[]): SQL {
  const selected = BREWING_SYSTEMS.filter((system) => systemIds.includes(system.id));
  const slugs = selected.flatMap((system) => [...system.categorySlugs]);
  const sourceKeys = selected.flatMap((system) => [...system.categorySourceKeys]);
  return sql`exists (
    select 1 from ${productCategories} pc
    join ${categories} c on c.id = pc.category_id
    where pc.product_id = ${products.id}
      and (
        c.slug = any(${sql.param(slugs)}::text[])
        or c.source_key = any(${sql.param(sourceKeys)}::text[])
      )
  )`;
}

/** Conditions shared by every listing query. */
function buildFilterConditions(query: CatalogQuery, extra: SQL[] = []): SQL[] {
  const conditions: SQL[] = [isVisible, ...extra];

  if (query.system.length > 0) {
    conditions.push(brewingSystemsCondition(query.system));
  }
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
  /*
   * Every order ends on the primary key. Two products can share a price, a
   * per-cup price and even a name, and without a total order PostgreSQL may
   * return such a pair in either order on each request — so one of them could
   * appear on two pages and the other on none.
   */
  const tieBreak = [asc(products.name), asc(products.id)];
  switch (query.sort) {
    case "name-asc":
      return tieBreak;
    case "name-desc":
      return [desc(products.name), asc(products.id)];
    case "price-per-cup":
      // No price or no known pack size: no per-cup figure, so last.
      return [sql`${retailPricePerCup} asc nulls last`, ...tieBreak];
    case "price-asc":
      // Products without a price sort last rather than first.
      return [sql`${retailPrice} asc nulls last`, ...tieBreak];
    case "price-desc":
      return [sql`${retailPrice} desc nulls last`, ...tieBreak];
    case "newest":
      return [desc(products.firstSeenAt), ...tieBreak];
    case "relevance":
    default:
      if (query.q) {
        return [...searchRank(query.q), ...tieBreak];
      }
      // With no query there is no relevance signal; in-stock first, then name.
      return [sql`(${products.availability} = 'in_stock') desc`, ...tieBreak];
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
    options.includeFacets === false ? Promise.resolve(emptyFacets()) : loadFacets(extra, query),
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
  return { systems: [], brands: [], strengths: [], decaf: [], aromas: [], categories: [] };
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
   * The same predicate the results use, brand-name match included — every
   * facet query below joins `brands`, which it needs. With the product-only
   * predicate a search for a brand whose products do not repeat its name
   * returned results beside counts of zero, and so beside no filters at all.
   */
  const scopeWithSearch = query.q ? and(scope, searchMatch(query.q)) : scope;

  /*
   * One aggregate per system over the same rows, each filtered by the very
   * predicate the `system` filter applies — so a count here is, by
   * construction, the number of results that filter returns.
   */
  const systemColumns = Object.fromEntries(
    BREWING_SYSTEMS.map((system) => [
      system.id,
      sql<number>`count(*) filter (where ${brewingSystemsCondition([system.id])})::int`,
    ]),
  );

  const [systemRows, brandRows, attributeRows, categoryRows] = await Promise.all([
    db
      .select(systemColumns)
      .from(products)
      .leftJoin(brands, eq(products.brandId, brands.id))
      .where(scopeWithSearch),
    db
      .select({
        value: brands.slug,
        label: brands.name,
        sourceKey: brands.sourceKey,
        count: sql<number>`count(*)::int`,
      })
      .from(products)
      .innerJoin(brands, eq(products.brandId, brands.id))
      .where(scopeWithSearch)
      .groupBy(brands.slug, brands.name, brands.sourceKey)
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
    // In the order `BREWING_SYSTEMS` lists them, which is the shop's own.
    systems: BREWING_SYSTEMS.map((system) => ({
      value: system.id,
      label: system.name,
      count: Number(systemRows[0]?.[system.id] ?? 0),
    })).filter((facet) => facet.count > 0),
    brands: brandRows.map((row) => ({
      value: row.value,
      label: brandDisplayName({ name: row.label, sourceKey: row.sourceKey }),
      count: row.count,
    })),
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
    categories: categoryRows.map((row) => ({
      value: row.value,
      label: row.label,
      count: row.count,
    })),
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
        sourceKey: brands.sourceKey,
        productCount: sql<number>`count(${products.id})::int`,
      })
      .from(brands)
      .innerJoin(products, and(eq(products.brandId, brands.id), isVisible))
      .where(and(eq(brands.status, "active"), brandNameMatch(trimmed)))
      .groupBy(brands.slug, brands.name, brands.sourceKey)
      .orderBy(desc(sql`count(${products.id})`), asc(brands.name))
      .limit(SUGGESTION_LINK_LIMIT),
    db
      .select({
        slug: categories.slug,
        sourceKey: categories.sourceKey,
        previousSourceKeys: categories.previousSourceKeys,
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
        title: card.title ?? card.name,
        detail: card.detail ?? null,
        systemId: card.systemId,
        brandName: card.brand?.name ?? null,
        weight: card.weight,
        price: card.price,
        image: card.image,
      };
    }),
    brands: brandRows.map((row) => ({
      slug: row.slug,
      sourceKey: row.sourceKey,
      name: brandDisplayName(row),
      productCount: row.productCount,
    })),
    categories: categoryRows.filter((row) => row.productCount > 0).slice(0, SUGGESTION_LINK_LIMIT),
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
      descriptionHtml: ownDescriptionHtml,
      sku: products.sku,
      gtin: products.gtin,
      arabicaPercent: products.arabicaPercent,
      origin: products.origin,
      roast: products.roast,
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
    arabicaPercent: number | null;
    origin: string | null;
    roast: string | null;
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
        sourceKey: categories.sourceKey,
        previousSourceKeys: categories.previousSourceKeys,
        name: categories.name,
        isPrimary: productCategories.isPrimary,
        // A real aliased join, not a select-list subquery, so the column
        // reference is properly table-qualified.
        parentSlug: parentCategories.slug,
        parentSourceKey: parentCategories.sourceKey,
        parentPreviousSourceKeys: parentCategories.previousSourceKeys,
        parentName: parentCategories.name,
      })
      .from(productCategories)
      .innerJoin(categories, eq(categories.id, productCategories.categoryId))
      .leftJoin(parentCategories, eq(parentCategories.id, categories.parentId))
      .where(eq(productCategories.productId, typed.id))
      .orderBy(desc(productCategories.isPrimary)),
  ]);

  const images = imageRows
    .map((image) => {
      const url = image.objectKey ?? image.publicUrl;
      return url
        ? {
            url: resolveImageUrl(url),
            // Ours, not the stored one: see `toCard`.
            alt: displayName(typed).full,
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
    /* Null for capsules and anything with no recorded pack size — see
       `pricePerUnitMeasure`. The page renders nothing rather than a guess. */
    unitPrice: unitPriceView(typed.price, typed.weightValue, typed.weightUnit, typed.currency),
    /* Ours or absent: with no override there is no long description, and the
       page omits the section rather than fill it with anything. */
    descriptionHtml: typed.descriptionHtml,
    /* The same override-or-generated sentence the card carries, so the lead
       paragraph, the meta description and the JSON-LD cannot disagree. */
    descriptionText: card.shortDescription,
    /* A blank code is no code: the page and the JSON-LD both test for null. */
    sku: typed.sku?.trim() || null,
    gtin: typed.gtin,
    pack:
      typed.weightValue && typed.weightUnit
        ? { value: typed.weightValue, unit: typed.weightUnit }
        : null,
    /* Null until the sync has read the product's own page, and null for good
       when that page does not state the fact. Blank text counts as absent. */
    arabicaPercent: typed.arabicaPercent,
    origin: typed.origin?.trim() || null,
    roast: typed.roast?.trim() || null,
    attributes: typed.attributes ?? {},
    images,
    categories: categoryRows.map((row) => ({
      slug: row.slug,
      sourceKey: row.sourceKey,
      previousSourceKeys: row.previousSourceKeys,
      name: row.name,
      isPrimary: row.isPrimary,
      parentSlug: row.parentSlug,
      parent:
        row.parentSlug && row.parentName
          ? {
              slug: row.parentSlug,
              sourceKey: row.parentSourceKey,
              previousSourceKeys: row.parentPreviousSourceKeys ?? [],
              name: row.parentName,
            }
          : null,
    })),
    formatListingLabel: formatListingLabel(typed.categorySourceKeys),
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
 *
 * One rule outranks all of that: a product that belongs to a brewing system is
 * only ever shown beside products of the same system. "Same brand" used to let
 * a Dolce Gusto capsule sit under a Nespresso one, which is a suggestion to
 * buy something that does not go in the machine.
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
          .where(
            and(isVisible, ne(products.id, product.id), inArray(categories.slug, categorySlugs)),
          ),
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

  const loaded = (await db
    .select(productColumns)
    .from(products)
    .leftJoin(brands, eq(products.brandId, brands.id))
    .where(inArray(products.id, candidateIds.slice(0, 200)))) as unknown as ProductRow[];

  // Compared on the resolved system, exactly as the cards' own badges are.
  const rows =
    product.systemId === null
      ? loaded
      : loaded.filter(
          (row) => resolveProductFormat(row.categoryKeys).system?.id === product.systemId,
        );

  const anchor = product.price ? Number(product.price.amount) : null;
  const ranked = rows
    .map((row) => ({
      row,
      score: scores.get(row.id) ?? 0,
      // Closeness of price only breaks ties; it never outranks relevance.
      priceGap:
        anchor !== null && row.price !== null
          ? Math.abs(Number(row.price) - anchor)
          : Number.MAX_SAFE_INTEGER,
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
        sourceKey: categories.sourceKey,
        previousSourceKeys: categories.previousSourceKeys,
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
          sourceKey: row.sourceKey,
          previousSourceKeys: row.previousSourceKeys,
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

export async function listBrands(
  options: { withProductsOnly?: boolean } = {},
): Promise<readonly BrandView[]> {
  const [rows, counts] = await Promise.all([
    db
      .select({
        id: brands.id,
        slug: brands.slug,
        name: brands.name,
        sourceKey: brands.sourceKey,
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
    sourceKey: row.sourceKey,
    // Ordered by the stored name above; only what is shown changes here.
    name: brandDisplayName(row),
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
    .where(
      and(isVisible, sql`${retailOldPrice} is not null and ${retailOldPrice} > ${retailPrice}`),
    );
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

/**
 * Cards for a set of products chosen elsewhere, keyed by product id.
 *
 * For the pages that pick their own products — the landing listings group and
 * rank the catalog in code (`landings.ts`) and then need the same card every
 * other listing draws. The row-to-card mapping (which price wins, whether a
 * reduction is genuine, which image) is private to this file, so the choice is
 * made there and the card is made here: one query for the rows and one for
 * their images, whatever the size of the set. Only products on sale come back;
 * an id that has since left the catalog is simply absent.
 */
export async function listProductCardsByIds(
  ids: readonly string[],
): Promise<ReadonlyMap<string, ProductCardView>> {
  if (ids.length === 0) return new Map();

  const rows = (await db
    .select(productColumns)
    .from(products)
    .leftJoin(brands, eq(products.brandId, brands.id))
    .where(and(isVisible, inArray(products.id, [...ids])))) as unknown as ProductRow[];

  const images = await loadPrimaryImages(rows.map((row) => row.id));
  return new Map(rows.map((row) => [row.id, toCard(row, images.get(row.id))]));
}

/**
 * The product that used to live at `slug`, or null.
 *
 * `catalog:reslug` moved every product from the supplier's wording to the
 * shop's own and kept the slug each one left in `previous_slugs`. Those old
 * addresses are indexed, bookmarked and printed in order mails, so each
 * answers 308 to the product's current one (`resolve-slug.ts`). Only the
 * current slug is returned: the caller builds the URL.
 *
 * Asked only after no product has `slug` as its current one, so a live
 * address always wins over a retired one.
 */
export async function getCurrentSlugOfFormer(slug: string): Promise<string | null> {
  const [row] = await db
    .select({ slug: products.slug })
    .from(products)
    .where(sql`${products.previousSlugs} @> array[${slug}]::text[]`)
    .orderBy(asc(products.slug))
    .limit(1);
  return row?.slug ?? null;
}

/** Every active product slug, for the sitemap. */
export async function listAllProductSlugs(): Promise<
  ReadonlyArray<{ slug: string; updatedAt: Date | null }>
> {
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
    // The stated facts are read here rather than added to `productColumns`:
    // only the scorer uses them, and every other listing would carry them for
    // nothing.
    .select({
      ...productColumns,
      arabicaPercent: products.arabicaPercent,
      origin: products.origin,
      roast: products.roast,
    })
    .from(products)
    .leftJoin(brands, eq(products.brandId, brands.id))
    .where(and(isVisible, systemCategoryCondition(system)))
    .orderBy(asc(products.name))
    .limit(MAX_RECOMMENDATION_CANDIDATES);

  const typed = rows as unknown as Array<
    ProductRow & { arabicaPercent: number | null; origin: string | null; roast: string | null }
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
      arabicaPercent: row.arabicaPercent,
      origin: row.origin,
      roast: row.roast,
    };
  });
}
