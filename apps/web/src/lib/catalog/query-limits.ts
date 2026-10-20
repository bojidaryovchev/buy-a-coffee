/**
 * Bounded so a long query cannot be used to make the database work hard.
 *
 * In a module of its own, with no imports, because the header's search field
 * needs it on every page and `filters.ts` — which re-exports it — builds its
 * zod schemas when it loads: importing the number from there shipped zod to
 * every visitor before the first paint.
 */
export const MAX_QUERY_LENGTH = 80;
