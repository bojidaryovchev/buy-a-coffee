import type { Article } from "./blocks";
import { arabicaRobusta } from "./articles/arabica-robusta";
import { chooseBeans } from "./articles/choose-beans";
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
 * Today that is all of them, so this list is the index: the three articles
 * that answer a question people measurably search come first (and are the
 * three the home page shows), then the machine question, then the two that
 * explain how the shop's own numbers are read.
 */
export const ARTICLES: readonly Article[] = [
  whichCapsule,
  chooseBeans,
  arabicaRobusta,
  formats,
  cupCost,
  intensity,
];
