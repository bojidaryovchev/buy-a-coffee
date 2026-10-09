/**
 * The storefront's curated tables, for code that is not the storefront.
 *
 * Three small tables are written by hand in `apps/web`, where the people who
 * edit them look: how each brand spells itself (`content/brand-names.ts`), the
 * product names the parser cannot get right (`content/product-names.ts`), and
 * every route's slug in every language (`src/i18n/slugs/`). A product's name
 * and its URL are built from all three, and the catalog sync allocates that
 * URL when it first sees a product. The sync cannot depend on the web app, so
 * it reads the tables through here.
 *
 * **This file is the only place a package reaches into `apps/web`**, and it
 * reaches only for plain data: each file imported below has no imports of its
 * own beyond a sibling type. The alternative was a second copy of each table
 * inside a package, kept equal to the first by a test; a copy is wrong on the
 * day someone adds a route and has not yet run the test, and on that day the
 * sync could hand a new product the URL of a page. Reading the one table
 * cannot disagree with it.
 *
 * Nothing here may import a module that needs React, Next or a path alias.
 */
import { brandDisplayNames } from "../../../apps/web/content/brand-names.ts";
import {
  productNameOverrides,
  type ProductNameOverride,
} from "../../../apps/web/content/product-names.ts";
import { LOCALES } from "../../../apps/web/src/i18n/config.ts";
import { bg } from "../../../apps/web/src/i18n/slugs/bg.ts";
import { en } from "../../../apps/web/src/i18n/slugs/en.ts";
import { ROUTE_SEGMENTS } from "../../../apps/web/src/i18n/slugs/types.ts";

export { brandDisplayNames, productNameOverrides, type ProductNameOverride };

const SLUG_TABLES = [bg, en] as const;

/**
 * Every first-level segment a product or category slug must never take: each
 * static route under the locale, in its canonical spelling and in every
 * locale's, and the locale codes themselves.
 *
 * Derived from the slug tables on every load, never listed: a route added to
 * `i18n/slugs/` is reserved here the moment it exists.
 */
export const RESERVED_ROUTE_SLUGS: ReadonlySet<string> = new Set([
  ...LOCALES,
  ...ROUTE_SEGMENTS.filter((key) => !key.includes("/")).flatMap((key) => [
    key,
    ...SLUG_TABLES.map((table) => table.segments[key]),
  ]),
]);

/** The curated landing slug of every category, in every locale. */
export const CATEGORY_LANDING_SLUGS: ReadonlySet<string> = new Set(
  SLUG_TABLES.flatMap((table) => Object.values(table.categories)),
);

/**
 * What a product slug may not be, as far as code can know without a database:
 * a route or a category's landing page. Callers add the category slugs the
 * catalog stores.
 */
export const RESERVED_PRODUCT_SLUGS: ReadonlySet<string> = new Set([
  ...RESERVED_ROUTE_SLUGS,
  ...CATEGORY_LANDING_SLUGS,
]);
