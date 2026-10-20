import type { Block, ProductsBlock } from "@/emails/markdown";

/**
 * What of a body the letter draws, once its product blocks are known.
 *
 * A product block with nothing to show draws nothing — an automatic block
 * when nothing is new or reduced, a list whose products have all sold out —
 * and a heading over nothing reads as a mistake, so it goes too. How much of
 * its section goes with it depends on who filled the section:
 *
 *   - The catalog's sections — every block in it new arrivals or reductions
 *     (`[[нови-продукти]]`, `[[промоции]]`, `[[промоции: адрес, …]]`) — go
 *     whole: heading, the sentence about the promotion, the link to the
 *     promotions page. Words about reductions over no reductions are stale.
 *   - A section with chosen products (`[[продукти: …]]`) is the owner's: its
 *     heading goes only when nothing else is under it, and any text keeps it,
 *     because then the heading stands over the text.
 *
 * The section of a heading is everything after it up to the next heading of
 * its level or above. Text before the first heading belongs to no section and
 * is always drawn.
 *
 * One rule for every reader of a letter: the template draws by it, the send's
 * checks count by it (`product-blocks.ts`), and so do the composer's notes in
 * the browser (`deliverability.ts`), which know a block only by its report —
 * hence the predicate. Pure and free of the catalog.
 */
export function drawnBlocks(
  blocks: readonly Block[],
  isEmpty: (block: ProductsBlock) => boolean,
): Block[] {
  const drawn: Block[] = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]!;
    if (block.type === "products") {
      if (!isEmpty(block)) drawn.push(block);
      continue;
    }
    if (block.type === "heading") {
      const section = sectionOf(blocks, index, isEmpty);
      if (section.vanishes) {
        index = section.end - 1;
        continue;
      }
      if (section.headingOnly) continue;
    }
    drawn.push(block);
  }
  return drawn;
}

/** The catalog fills these: what they show is whatever is new or reduced at the send. */
const fromCatalog = (block: ProductsBlock) =>
  block.token.spec !== null && block.token.spec.kind !== "picked";

/**
 * The section of the heading at `index`: where it ends, whether it all goes
 * (the catalog's, and empty), or only its heading (nothing but empty blocks).
 */
function sectionOf(
  blocks: readonly Block[],
  index: number,
  isEmpty: (block: ProductsBlock) => boolean,
): { end: number; vanishes: boolean; headingOnly: boolean } {
  const heading = blocks[index] as Extract<Block, { type: "heading" }>;
  let end = index + 1;
  let products = 0;
  let catalogOnly = true;
  let allEmpty = true;
  let text = false;
  for (; end < blocks.length; end += 1) {
    const block = blocks[end]!;
    if (block.type === "heading") {
      if (block.level <= heading.level) break;
      // A subheading is the section's own; it is judged by its own section too.
      continue;
    }
    if (block.type !== "products") {
      text = true;
      continue;
    }
    products += 1;
    if (!isEmpty(block)) allEmpty = false;
    if (!fromCatalog(block)) catalogOnly = false;
  }
  const empty = products > 0 && allEmpty;
  return { end, vanishes: empty && catalogOnly, headingOnly: empty && !text };
}
