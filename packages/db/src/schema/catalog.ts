import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { availabilityEnum, entityStatusEnum, imageStatusEnum, productStatusEnum } from "./enums.ts";
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
    sourceId: text("source_id"),
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
    sourceId: text("source_id"),
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

    name: text("name").notNull(),
    slug: text("slug").notNull(),

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
     * The storefront shows `descriptionTextOverride ?? descriptionText` and
     * `descriptionHtmlOverride ?? descriptionHtml`. Leaving an override null
     * means "publish the source copy", which is the state every product starts
     * in.
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

    /** Raw pack-size text plus its normalised form. */
    weight: text("weight"),
    weightValue: numeric("weight_value", { precision: 14, scale: 4 }),
    weightUnit: text("weight_unit"),

    sku: text("sku"),
    gtin: text("gtin"),

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
