/**
 * What a saved promotion refreshes. The lists and the rule (page by page,
 * never the layout) now live in `lib/revalidate-shop.ts`, which the catalog's
 * own revalidation (`/api/revalidate`) shares; this module keeps the
 * promotions' imports, and `test/promotion-revalidate.test.ts`, where they were.
 */
export { SELF_TIMED_ROUTES, SHOP_PAGE_ROUTES, revalidateShop } from "@/lib/revalidate-shop";
