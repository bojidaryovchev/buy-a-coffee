import { BREWING_SYSTEMS, type BrewingSystemId } from "@/lib/recommend/systems";
import type { ProductImageView } from "./types";

/**
 * Which packshots stand on the home page's hero shelf.
 *
 * The rule, from DESIGN.md ("Home page", hero): the newest product with a
 * photograph in each brewing system, in `BREWING_SYSTEMS` order, the first
 * six. Nobody picks them by hand, so the shelf can never show a product that
 * has left the catalog, and it never needs editing when one arrives.
 *
 * Kept apart from the query (`home-queries.ts`) so the rule can be tested
 * without a database: the query's only job is to hand over each system's
 * newest photographed products, already ranked.
 */

/** Wells on the shelf: two rows of three. */
export const HERO_SHELF_SIZE = 6;

/** Below this the shelf is left out — two wells are a gap, not a shelf. */
export const HERO_SHELF_MIN = 3;

/** One photographed product, as ranked inside its brewing system. */
export interface HeroShelfCandidate {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly systemId: BrewingSystemId;
  /** 1 is the newest photographed product in `systemId`. */
  readonly rank: number;
  readonly image: ProductImageView;
}

export type HeroShelfItem = Pick<HeroShelfCandidate, "id" | "slug" | "name" | "systemId" | "image">;

/**
 * Deal the shelf out of the ranked candidates.
 *
 * Systems take turns in `BREWING_SYSTEMS` order: every system's newest first,
 * and only when that leaves wells empty — a catalog with products in fewer
 * than six systems — every system's second newest, and so on. A full catalog
 * therefore shows six different systems; a small one still fills the shelf
 * with what it has rather than leaving holes.
 *
 * The result depends only on the candidates, never on their order in the
 * array or on anything that changes between two renders, so a revalidation
 * with the same catalog paints the same shelf.
 */
export function selectHeroShelf(
  candidates: readonly HeroShelfCandidate[],
  options: { readonly size?: number; readonly min?: number } = {},
): readonly HeroShelfItem[] {
  const size = Math.max(0, options.size ?? HERO_SHELF_SIZE);
  const min = options.min ?? HERO_SHELF_MIN;

  const queues = BREWING_SYSTEMS.map((system) =>
    candidates
      .filter((candidate) => candidate.systemId === system.id)
      // Rank decides; the id breaks a tie so equal ranks cannot flip.
      .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id)),
  );

  const chosen: HeroShelfItem[] = [];
  const seen = new Set<string>();
  const cursors = queues.map(() => 0);

  let dealt = true;
  while (chosen.length < size && dealt) {
    dealt = false;
    for (const [index, queue] of queues.entries()) {
      if (chosen.length >= size) break;
      // A product filed under two systems may already be on the shelf.
      let cursor = cursors[index] ?? 0;
      while (cursor < queue.length && seen.has(queue[cursor]!.id)) cursor += 1;
      const next = queue[cursor];
      cursors[index] = cursor + 1;
      if (!next) continue;

      seen.add(next.id);
      chosen.push({
        id: next.id,
        slug: next.slug,
        name: next.name,
        systemId: next.systemId,
        image: next.image,
      });
      dealt = true;
    }
  }

  return chosen.length < min ? [] : chosen;
}
