import { sql, type SQL } from "drizzle-orm";
import { products } from "@catalog/db/schema";
import { INSTANT_COFFEE_PATTERN } from "@catalog/shared";

/**
 * `productKind()` in SQL: whether a row is instant coffee, by its name.
 *
 * The same pattern string `isInstantCoffeeName` matches in TypeScript, over
 * `catalog_translit(name)`, which folds and lower-cases exactly as
 * `transliterate()` does. One string, two engines, no second copy of the rule;
 * `test/product-kind.db.test.ts` runs both over the catalog and fails if they
 * disagree.
 *
 * Used where a query decides something a product's kind changes: a brewing
 * system's members (instant coffee belongs to none, whatever it is filed
 * under) and so the wizard's candidates (it never recommends instant coffee).
 */
export const isInstantCoffee: SQL<boolean> = sql<boolean>`(catalog_translit(${products.name}) ~ ${INSTANT_COFFEE_PATTERN})`;

export const isNotInstantCoffee: SQL<boolean> = sql<boolean>`(not ${isInstantCoffee})`;
