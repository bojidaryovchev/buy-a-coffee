import type { Article } from "./blocks";
import { cupCost } from "./articles/cup-cost";
import { formats } from "./articles/formats";
import { intensity } from "./articles/intensity";
import { whichCapsule } from "./articles/which-capsule";

/**
 * The journal.
 *
 * Adding an article is two steps: a file under `articles/` that exports an
 * `Article`, and a line here. There is no directory scan — an explicit list is
 * what lets the bundler, the type checker and the content test all see exactly
 * the same set, and it keeps a half-written draft out of production until
 * somebody deliberately lists it.
 *
 * Order matters only between articles published on the same day: the journal
 * is shown newest first, and same-day articles keep the order written here.
 */
export const ARTICLES: readonly Article[] = [whichCapsule, cupCost, intensity, formats];
