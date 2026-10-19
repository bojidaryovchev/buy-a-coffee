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

/* --- The still life (Phase K) ---------------------------------------------- */

/** Below this the still life gives way to the shelf of photographs. */
export const STILL_LIFE_MIN = 3;
/** Packs in the still life. */
export const STILL_LIFE_SIZE = 4;

export type StillLifeSlot = "centre" | "back" | "front-right" | "front-left";

/**
 * Where each slot stands, as percentages of a square stage: the pack's foot is
 * centred on `anchor`, `bottom` above the stage's foot, `height` tall unless
 * that would make it wider than `maxWidth`. `z` orders the overlap.
 */
const SLOTS: Record<
  StillLifeSlot,
  { anchor: number; bottom: number; height: number; maxWidth: number; rotate: number; z: number }
> = {
  centre: { anchor: 46, bottom: 13, height: 74, maxWidth: 40, rotate: -2, z: 2 },
  back: { anchor: 23, bottom: 25, height: 52, maxWidth: 30, rotate: -8, z: 1 },
  "front-right": { anchor: 64, bottom: 5, height: 37, maxWidth: 38, rotate: 8, z: 3 },
  "front-left": { anchor: 15, bottom: 6, height: 30, maxWidth: 28, rotate: -11, z: 3 },
};

export interface StillLifePack extends HeroShelfItem {
  readonly slot: StillLifeSlot;
  /** The cut-out, already resolved. */
  readonly cutout: { readonly url: string; readonly width: number; readonly height: number };
  /** Placement in percentages of the square stage; `rotate` in degrees. */
  readonly box: {
    readonly left: number;
    readonly bottom: number;
    readonly width: number;
    readonly height: number;
    readonly rotate: number;
    readonly z: number;
  };
}

/**
 * The hero's still life (DESIGN.md, "Home page", hero): up to four packs with
 * live cut-outs, chosen by the shelf's own rule (newest per system, systems
 * taking turns), then given their places by shape — the most upright pack in
 * the centre, the widest in front on the right, the next most upright behind
 * on the left, the last in front on the left — so the group always overlaps
 * the same way whatever is new. Fewer than three: nothing, and the hero shows
 * the shelf of photographs instead.
 *
 * The centre pack is the tallest image above the fold, the likely LCP element
 * on a desktop; the hero preloads it and never fades it in.
 */
export function selectHeroStillLife(
  candidates: readonly HeroShelfCandidate[],
): readonly StillLifePack[] {
  const cut = candidates.filter(
    (candidate) =>
      (candidate.image.cutout?.width ?? 0) > 0 && (candidate.image.cutout?.height ?? 0) > 0,
  );
  const chosen = selectHeroShelf(cut, { size: STILL_LIFE_SIZE, min: STILL_LIFE_MIN });
  if (chosen.length < STILL_LIFE_MIN) return [];

  const aspect = (item: HeroShelfItem) => item.image.cutout!.width! / item.image.cutout!.height!;
  const tallestFirst = [...chosen].sort(
    (a, b) => aspect(a) - aspect(b) || a.id.localeCompare(b.id),
  );
  const centre = tallestFirst[0]!;
  const rest = tallestFirst.slice(1);
  const widest = rest.reduce((best, item) =>
    aspect(item) > aspect(best) || (aspect(item) === aspect(best) && item.id < best.id)
      ? item
      : best,
  );
  const remaining = rest.filter((item) => item !== widest);
  const order: Array<[StillLifeSlot, HeroShelfItem | undefined]> = [
    ["centre", centre],
    ["back", remaining[0]],
    ["front-right", widest],
    ["front-left", remaining[1]],
  ];

  return order
    .filter((entry): entry is [StillLifeSlot, HeroShelfItem] => entry[1] !== undefined)
    .map(([slot, item]) => {
      const place = SLOTS[slot];
      const ratio = aspect(item);
      let height = place.height;
      let width = height * ratio;
      if (width > place.maxWidth) {
        width = place.maxWidth;
        height = width / ratio;
      }
      const left = Math.min(Math.max(place.anchor - width / 2, 0), 100 - width);
      const round = (n: number) => Math.round(n * 100) / 100;
      return {
        ...item,
        slot,
        cutout: {
          url: item.image.cutout!.url,
          width: item.image.cutout!.width!,
          height: item.image.cutout!.height!,
        },
        box: {
          left: round(left),
          bottom: place.bottom,
          width: round(width),
          height: round(height),
          rotate: place.rotate,
          z: place.z,
        },
      };
    });
}
