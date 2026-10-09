import type { Locale } from "@/i18n/config";
import { bg } from "./bg";
import { en } from "./en";
import type { LocaleSlugs } from "./types";

/**
 * The slug tables, one per locale.
 *
 * A static map rather than the dictionaries' server-only loader, on purpose:
 * the language switcher and the search field are client components that build
 * URLs, and these are a few dozen short strings.
 */
export const SLUGS: Readonly<Record<Locale, LocaleSlugs>> = { bg, en };

export { ROUTE_SEGMENTS, type LocaleSlugs, type RouteSegment } from "./types";
