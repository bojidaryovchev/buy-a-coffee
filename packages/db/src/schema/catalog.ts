import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  type AnyPgColumn,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  availabilityEnum,
  cutoutStatusEnum,
  entityStatusEnum,
  imageStatusEnum,
  productStatusEnum,
} from "./enums.ts";
import { sourceSites } from "./source.ts";

const now = sql`now()`;

/**
 * Brands as published by the source.
 *
 * `sourceKey` is the source slug verbatim, including its warts: one real brand
 * slug is literally `" vergnano"` with a leading space. `name` is the cleaned
 * label and `slug` is our own storefront-safe slug.
 */
export const brands = pgTable(
  "brands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceSiteId: uuid("source_site_id")
      .notNull()
      .references(() => sourceSites.id, { onDelete: "cascade" }),
    sourceKey: text("source_key").notNull(),
    /** The source's own numeric id. Stable across slug renames; matched first. */
    sourceId: text("source_id"),
    /** Source keys this row answered to before a rename, oldest first. */
    previousSourceKeys: text("previous_source_keys")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    sourceUrl: text("source_url"),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    tagline: text("tagline"),
    description: text("description"),
    /** Product count as advertised by the source, for cross-checking. */
    sourceProductCount: integer("source_product_count"),
    status: entityStatusEnum("status").notNull().default("active"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().default(now),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().default(now),
    lastChangedAt: timestamp("last_changed_at", { withTimezone: true }).notNull().default(now),
  },
  (table) => [
    uniqueIndex("brands_source_key_idx").on(table.sourceSiteId, table.sourceKey),
    uniqueIndex("brands_slug_idx").on(table.sourceSiteId, table.slug),
    index("brands_source_id_idx").on(table.sourceSiteId, table.sourceId),
    index("brands_status_idx").on(table.status),
  ],
);

/** Category tree. Self-referencing parent for the capsule subcategories. */
export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceSiteId: uuid("source_site_id")
      .notNull()
      .references(() => sourceSites.id, { onDelete: "cascade" }),
    sourceKey: text("source_key").notNull(),
    /** The source's own numeric id. Stable across slug renames; matched first. */
    sourceId: text("source_id"),
    /** Source keys this row answered to before a rename, oldest first. */
    previousSourceKeys: text("previous_source_keys")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    sourceUrl: text("source_url"),
    parentId: uuid("parent_id").references((): AnyPgColumn => categories.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    position: integer("position").notNull().default(0),
    sourceProductCount: integer("source_product_count"),
    status: entityStatusEnum("status").notNull().default("active"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().default(now),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().default(now),
    lastChangedAt: timestamp("last_changed_at", { withTimezone: true }).notNull().default(now),
  },
  (table) => [
    uniqueIndex("categories_source_key_idx").on(table.sourceSiteId, table.sourceKey),
    uniqueIndex("categories_slug_idx").on(table.sourceSiteId, table.slug),
    index("categories_source_id_idx").on(table.sourceSiteId, table.sourceId),
    index("categories_parent_idx").on(table.parentId),
    index("categories_status_idx").on(table.status),
  ],
);

/**
 * Current normalised catalog state.
 *
 * Identity note: `sourceKey` is a composite of the canonical source path and
 * the normalised pack size, because the source genuinely serves two different
 * products from `/borbone-crema-classica/` (0.500кг at EUR 10.70 and 1кг at
 * EUR 20.50). Keying on URL alone would silently drop one of them.
 */
export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceSiteId: uuid("source_site_id")
      .notNull()
      .references(() => sourceSites.id, { onDelete: "cascade" }),
    sourceKey: text("source_key").notNull(),
    sourceUrl: text("source_url").notNull(),
    sourcePath: text("source_path").notNull(),
    /** The pack-size discriminator inside `sourceKey`, e.g. `1000g`. */
    sourceVariantKey: text("source_variant_key"),
    /** True when more than one product shares this source URL. */
    hasUrlCollision: boolean("has_url_collision").notNull().default(false),
    /**
     * Every `sourceKey` this row has answered to before its current one,
     * oldest first. The source renames product URLs; when it does, the sync
     * re-points the row instead of creating a twin, and the key it left is
     * kept here so the rename stays traceable.
     */
    previousSourceKeys: text("previous_source_keys")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),

    name: text("name").notNull(),
    slug: text("slug").notNull(),
    /**
     * Every slug this product has had before its current one, oldest first.
     * A slug is allocated once and frozen; the one deliberate exception is
     * `catalog:reslug`, which moves a product to the shop's own name for it
     * and records the slug it left. Each of these answers 308 to `slug`, and
     * the sync never gives one to another product.
     */
    previousSlugs: text("previous_slugs")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /**
     * The shop's own name for the product, stored for search and for nothing
     * else: `productSearchName` in `@catalog/shared`. Pages compute the name
     * they show; this exists so a search for the words on the page finds the
     * product, where `name` holds the supplier's wording. Written by the sync
     * and by `catalog:reslug`.
     */
    searchName: text("search_name"),

    /**
     * Source prices, exactly as published by the reference site. Money is
     * numeric, never floating point. These are owned by the sync and are
     * never edited by the storefront.
     */
    currentPrice: numeric("current_price", { precision: 12, scale: 2 }),
    oldPrice: numeric("old_price", { precision: 12, scale: 2 }),
    currency: text("currency"),

    /**
     * Retail-price layer.
     *
     * The storefront shows `retailPriceOverride ?? currentPrice`. Leaving the
     * override null means "track the source", which is the default for every
     * product. Setting it pins a price without destroying the source value, so
     * a later markup rule can still be computed from the original.
     *
     * The sync deliberately never writes these columns.
     */
    retailPriceOverride: numeric("retail_price_override", { precision: 12, scale: 2 }),
    retailOldPriceOverride: numeric("retail_old_price_override", { precision: 12, scale: 2 }),

    availability: availabilityEnum("availability").notNull().default("unknown"),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),

    descriptionHtml: text("description_html"),
    descriptionText: text("description_text"),

    /**
     * Original-copy layer.
     *
     * The storefront never publishes the source's text. It shows
     * `descriptionTextOverride` when one is written, and otherwise a sentence
     * generated from the product's recorded facts (`publishedSummary` in
     * `apps/web/src/lib/catalog/fallback-copy.ts`); `descriptionHtmlOverride`
     * is the only long description, and a product without one has none.
     * Leaving an override null — the state every product starts in — means
     * "use the generated sentence", not "publish the source copy". The source
     * columns are still read for the search index, which is never rendered.
     *
     * This exists for the same reason the retail-price layer does: the sync
     * owns the source columns and rewrites them on every run, so copy written
     * into them would not survive the next `pnpm sync:catalog`. Keeping the
     * two apart also means the source text stays available to diff against,
     * which is what `pnpm check:originality` uses to prove we are not
     * republishing it.
     *
     * `descriptionTextOverride` is the one-sentence summary: it is the lead
     * paragraph, the meta description and the Product JSON-LD `description`.
     * `descriptionHtmlOverride` is the longer body copy.
     *
     * The sync deliberately never writes these columns.
     */
    descriptionTextOverride: text("description_text_override"),
    descriptionHtmlOverride: text("description_html_override"),

    /**
     * Who wrote the override copy above, and from what.
     *
     * `copyOrigin` is `hand` for the curated file (`content/product-copy.ts`,
     * written by `copy:apply`), `ai` for the catalog copywriter
     * (`@catalog/scraper-core/catalog/copywriter`), and `edited` for an AI text
     * the owner corrected in the admin. Only `ai` copy is ever rewritten by the
     * machine: a person's words are never overwritten by one.
     *
     * `copySourceHash` is a hash of the facts the copy was written from (name,
     * the source's description, pack, stated facts) - not `semanticHash`, which
     * also moves with the price. When the hash of a product's current facts
     * stops matching, its AI copy is stale and is written again.
     *
     * `copyAttempts`/`copyLastError` count consecutive failed attempts (the
     * text did not pass the originality audit, or the run failed), so a product
     * the copywriter cannot handle stops being retried every six hours and is
     * shown to the owner instead.
     *
     * `copyWrittenAt` is when the override text was last written, whoever
     * wrote it: the sitemap and the page date themselves by it
     * (`productPageChangedAt` in the storefront). `copyModel` names the model
     * behind `ai` copy.
     */
    copyOrigin: text("copy_origin"),
    copySourceHash: text("copy_source_hash"),
    copyWrittenAt: timestamp("copy_written_at", { withTimezone: true }),
    copyModel: text("copy_model"),
    copyAttempts: smallint("copy_attempts").notNull().default(0),
    copyLastError: text("copy_last_error"),

    /** Raw pack-size text plus its normalised form. */
    weight: text("weight"),
    weightValue: numeric("weight_value", { precision: 14, scale: 4 }),
    weightUnit: text("weight_unit"),
    /**
     * Cups in the pack, written by the sync from `packServings()` in
     * `@catalog/shared` — the same function the storefront displays with — so
     * a listing can be sorted by price per cup in SQL without a second copy of
     * the grams-per-cup assumption. `servingsEstimated` is true when the
     * figure is derived from weight rather than counted pieces.
     */
    servings: numeric("servings", { precision: 14, scale: 4 }),
    servingsEstimated: boolean("servings_estimated"),

    /**
     * A researched correction of the pack size, and the research behind it.
     *
     * The sync owns the pack columns above and rewrites them every run from
     * what the source lists. When the source contradicts itself (a name saying
     * 18 pods over a pack field saying 100) or the result is implausible, the
     * catalog copywriter researches the product on the open web. If it finds
     * the size stated consistently by independent sources, and it differs from
     * ours, the correction is written here *and* applied to the pack columns -
     * and while it is set, the sync's upsert leaves the pack columns alone
     * (`keepResearchedPack`), so the next run does not undo it. Clearing
     * `packOverrideValue` (the admin's "Текстове" screen) hands the pack back
     * to the source on the next sync, and the size turned down is kept in
     * `factsResearch.rejected` so research never applies it again by itself.
     *
     * `factsResearch` keeps every check, applied or not - the verdict, the
     * values found, the sources and the confidence - so the owner can see why a
     * size changed, or why one that looked wrong was confirmed.
     */
    packOverrideValue: numeric("pack_override_value", { precision: 14, scale: 4 }),
    packOverrideUnit: text("pack_override_unit"),
    factsCheckedAt: timestamp("facts_checked_at", { withTimezone: true }),
    factsResearch: jsonb("facts_research").$type<Record<string, unknown>>(),

    /**
     * Stated facts about the coffee, read from the source's product page.
     * Null means the source does not state it; nothing here is ever inferred.
     */
    arabicaPercent: smallint("arabica_percent"),
    origin: text("origin"),
    roast: text("roast"),
    /**
     * The labelled "Характеристики" list from the source's product page, in
     * page order: `[{ label, value }]`. Its own column rather than keys inside
     * `attributes`, because `attributes` belongs to the catalog-blob upsert —
     * it is rewritten on every run and takes part in the semantic hash — and
     * this belongs to the enrichment step. Two writers, two columns.
     */
    characteristics: jsonb("characteristics")
      .$type<Array<{ label: string; value: string }>>()
      .notNull()
      .default([]),

    /**
     * The source's product code ("Код: 00072"), read from the product page by
     * the enrichment step. A string: leading zeros are part of it. It is a
     * move-detection signal only — never part of `sourceKey` — and the
     * catalog-blob upsert never writes it.
     */
    sku: text("sku"),
    gtin: text("gtin"),
    /**
     * When the product page was last read successfully. Null means a read is
     * due: the product is new, was renamed or changed, or its last read failed.
     */
    enrichedAt: timestamp("enriched_at", { withTimezone: true }),
    /** Last attempt, successful or not; spaces out retries of a failing page. */
    enrichAttemptedAt: timestamp("enrich_attempted_at", { withTimezone: true }),

    /** Normalised key/value attributes (intensity, decaf, aromas, strength). */
    attributes: jsonb("attributes").$type<Record<string, string>>().notNull().default({}),
    /** Verbatim source record, so nothing observed is ever thrown away. */
    sourceData: jsonb("source_data").$type<Record<string, unknown>>().notNull().default({}),

    /** Hash of business-relevant fields only; drives the change diff. */
    semanticHash: text("semantic_hash").notNull(),

    status: productStatusEnum("status").notNull().default("active"),
    consecutiveMissingCount: integer("consecutive_missing_count").notNull().default(0),

    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().default(now),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().default(now),
    lastChangedAt: timestamp("last_changed_at", { withTimezone: true }).notNull().default(now),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    latestSyncRunId: uuid("latest_sync_run_id"),
  },
  (table) => [
    uniqueIndex("products_source_key_idx").on(table.sourceSiteId, table.sourceKey),
    uniqueIndex("products_slug_idx").on(table.sourceSiteId, table.slug),
    index("products_status_idx").on(table.status),
    index("products_brand_idx").on(table.brandId),
    index("products_semantic_hash_idx").on(table.semanticHash),
    index("products_last_seen_idx").on(table.lastSeenAt),
    index("products_source_path_idx").on(table.sourcePath),
    // Storefront listing pattern: active products ordered by price.
    index("products_status_price_idx").on(table.status, table.currentPrice),
    // Promotions: active products that carry an old price.
    index("products_old_price_idx").on(table.oldPrice),
    // Move detection looks a product code up; the code is not unique by decree.
    index("products_sku_idx").on(table.sourceSiteId, table.sku),
    // Looks up the product a retired slug redirects to.
    index("products_previous_slugs_idx").using("gin", table.previousSlugs),
  ],
);

/** Many-to-many product/category mapping with an explicit primary category. */
export const productCategories = pgTable(
  "product_categories",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  },
  (table) => [
    primaryKey({ columns: [table.productId, table.categoryId] }),
    index("product_categories_category_idx").on(table.categoryId),
    index("product_categories_primary_idx").on(table.productId, table.isPrimary),
  ],
);

/**
 * Mirrored product images.
 *
 * `objectKey` points at our own object storage. The storefront must never
 * render `sourceUrl`; it is kept purely for re-fetch and audit.
 */
export const productImages = pgTable(
  "product_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    sourceUrl: text("source_url").notNull(),
    /** Content hash of the fetched bytes; drives dedup and change detection. */
    sourceContentHash: text("source_content_hash"),
    objectKey: text("object_key"),
    publicUrl: text("public_url"),
    mimeType: text("mime_type"),
    width: integer("width"),
    height: integer("height"),
    byteSize: integer("byte_size"),
    ordinal: integer("ordinal").notNull().default(0),
    isPrimary: boolean("is_primary").notNull().default(false),
    alt: text("alt"),
    status: imageStatusEnum("status").notNull().default("active"),
    lastError: text("last_error"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().default(now),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().default(now),
    mirroredAt: timestamp("mirrored_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("product_images_product_source_idx").on(table.productId, table.sourceUrl),
    index("product_images_hash_idx").on(table.sourceContentHash),
    index("product_images_product_ordinal_idx").on(table.productId, table.ordinal),
    index("product_images_object_key_idx").on(table.objectKey),
  ],
);

/** What the cut-out tool's shape check did to a mask (`tools/cutout`). */
export interface CutoutShape {
  /** Share of the pack's outline that was enclosed holes, filled. */
  readonly holes: number;
  /** Each gap that reached deep into the pack and was filled back. */
  readonly dents: ReadonlyArray<{ readonly share: number; readonly depth: number }>;
  /** How nearly the filled pack fills its bounding box; null if nothing was dented. */
  readonly box: number | null;
  /** Share of the pack the ground check added where the model missed it (from v2). */
  readonly added?: number;
  /** Share the ground check took away as the floor's reflection (v2 only). */
  readonly removed?: number;
  /** The cut went on under the pack's base, onto its reflection (from v3). */
  readonly reflection?: boolean;
  /** Share of the cut that is light grey like a shadow, beyond the pack's own print (from v3). */
  readonly kept?: number;
  /** The cut reaches the edge of the frame, where only the backdrop is (from v3). */
  readonly framed?: boolean;
}

/**
 * A packshot cut out to transparency — DESIGN.md, "Imagery"; Phase K, K1.
 *
 * Keyed by the photo's content hash, not by product image: objects are already
 * de-duplicated by that hash, so a photo two products share is cut once, and a
 * photo that changes at the source gets a new hash and a new cut-out. The PNG
 * is content-addressed under `cutouts/` like the photos under `catalog/`.
 *
 * Written by `pnpm images:cutout`; `status` is decided there (`auto` when the
 * two models agreed and nothing was filled, `pending` otherwise) and by the
 * owner on /admin/snimki. A `rejected` row is what stops the next run from
 * making the same cut-out again.
 */
export const imageCutouts = pgTable(
  "image_cutouts",
  {
    sourceContentHash: text("source_content_hash").primaryKey(),
    objectKey: text("object_key"),
    width: integer("width"),
    height: integer("height"),
    byteSize: integer("byte_size"),
    /** Share of pixels on which the two models agreed, 0 to 1. */
    agreement: numeric("agreement", { precision: 5, scale: 4, mode: "number" }),
    shape: jsonb("shape").$type<CutoutShape>(),
    status: cutoutStatusEnum("status").notNull(),
    /** The models and tool version that made it, for a later re-run. */
    madeBy: text("made_by"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    /** "owner" when a person decided; null when the tool did. */
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
  },
  (table) => [index("image_cutouts_status_idx").on(table.status)],
);

export const brandsRelations = relations(brands, ({ many }) => ({
  products: many(products),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: "category_parent",
  }),
  children: many(categories, { relationName: "category_parent" }),
  productLinks: many(productCategories),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  brand: one(brands, { fields: [products.brandId], references: [brands.id] }),
  images: many(productImages),
  categoryLinks: many(productCategories),
}));

export const productCategoriesRelations = relations(productCategories, ({ one }) => ({
  product: one(products, { fields: [productCategories.productId], references: [products.id] }),
  category: one(categories, {
    fields: [productCategories.categoryId],
    references: [categories.id],
  }),
}));

export const productImagesRelations = relations(productImages, ({ one }) => ({
  product: one(products, { fields: [productImages.productId], references: [products.id] }),
}));
