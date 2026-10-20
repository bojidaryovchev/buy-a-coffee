import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { products } from "./catalog.ts";

const now = sql`now()`;

/** The largest reduction the panel accepts. A typo, not a decision, above it. */
export const PROMOTION_MAX_PERCENT = 50;

/**
 * What a promotion covers, as the owner chose it.
 *
 * Whole brands and whole categories are kept as choices, not expanded into
 * products, so a product the sync brings into a promoted brand joins the
 * promotion at the next refresh (`promotion_products`). A category covers its
 * subcategories. `excludedProductIds` wins over every inclusion.
 */
export interface PromotionTargets {
  readonly productIds: readonly string[];
  readonly brandIds: readonly string[];
  readonly categoryIds: readonly string[];
  readonly excludedProductIds: readonly string[];
}

export const EMPTY_PROMOTION_TARGETS: PromotionTargets = {
  productIds: [],
  brandIds: [],
  categoryIds: [],
  excludedProductIds: [],
};

/**
 * The shop's own price reductions (a change of course from PRODUCT.md's first
 * scope, which mirrored the source's prices only; the owner's decision of
 * 20 October 2026).
 *
 * A promotion takes `percent_off` off the price the shop would otherwise
 * charge, for every product it covers, from `starts_at` until `ends_at`, or
 * until `stopped_at` if the owner ends it early. Dates are chosen as whole
 * days in Sofia; these are the instants those days begin and end.
 *
 * A promotion that has started is never deleted: what it charged is part of
 * the 30-day price history the next reduction's "before" price is computed
 * from (Directive 98/6/EC, Art. 6a). One that has not started can be.
 */
export const promotions = pgTable(
  "promotions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The owner's own name for it. Never shown in the shop. */
    name: text("name").notNull(),
    /** Optional words the shop shows beside the reduction: "Есенни дни". */
    label: text("label"),
    percentOff: integer("percent_off").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    /** Set when the owner ends it before `ends_at`. */
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
    targets: jsonb("targets").$type<PromotionTargets>().notNull().default(EMPTY_PROMOTION_TARGETS),
    /** When `promotion_products` was last brought in line with `targets`. */
    refreshedAt: timestamp("refreshed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
  },
  (table) => [
    index("promotions_period_idx").on(table.startsAt, table.endsAt),
    check(
      "promotions_percent_off_range",
      sql`${table.percentOff} between 1 and ${sql.raw(String(PROMOTION_MAX_PERCENT))}`,
    ),
    check("promotions_period_order", sql`${table.endsAt} > ${table.startsAt}`),
  ],
);

/**
 * The products a promotion covers, resolved from its `targets`, each with the
 * price its reduction is announced against.
 *
 * `reference_price` is the lowest price the shop charged for the product in
 * the 30 days before the reduction began for it (`reference_at`: the
 * promotion's start, or the moment the product joined a running one). Until
 * that moment it is provisional and recomputed at every refresh; from then on
 * `reference_final` is set and it never moves. The shop shows
 * `least(reference_price, regular price now)` as the struck price, so a price
 * that fell after the reference was taken can only make the claim smaller.
 *
 * A product that leaves the promotion keeps its row with `removed_at`, for the
 * same price history; it rejoins by clearing it.
 */
export const promotionProducts = pgTable(
  "promotion_products",
  {
    promotionId: uuid("promotion_id")
      .notNull()
      .references(() => promotions.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    referencePrice: numeric("reference_price", { precision: 12, scale: 2 }),
    referenceAt: timestamp("reference_at", { withTimezone: true }),
    referenceFinal: boolean("reference_final").notNull().default(false),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().default(now),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.promotionId, table.productId] }),
    index("promotion_products_product_idx").on(table.productId),
  ],
);
