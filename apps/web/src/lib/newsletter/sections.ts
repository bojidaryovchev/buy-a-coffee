import type { Block, ProductsBlock } from "@/emails/markdown";

/**
 * What of a body the letter draws, once its product blocks are known.
 *
 * A product block with nothing to show draws nothing — an automatic block
 * when nothing is new or reduced, a hand-picked one whose products have all
 * sold out — and neither does a heading whose section held nothing but such
 * blocks: "## Промоции" over nothing reads as a mistake, and a monthly letter
 * prepared on the 1st must still read well on the 5th. The section of a
 * heading is everything after it up to the next heading of its level or
 * above; any text in it keeps the heading, because then the heading has
 * something to stand over.
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
  blocks.forEach((block, index) => {
    if (block.type === "products") {
      if (!isEmpty(block)) drawn.push(block);
      return;
    }
    if (block.type === "heading" && emptySection(blocks, index, isEmpty)) return;
    drawn.push(block);
  });
  return drawn;
}

/** Does the heading at `index` stand over product blocks that all draw nothing, and nothing else? */
function emptySection(
  blocks: readonly Block[],
  index: number,
  isEmpty: (block: ProductsBlock) => boolean,
): boolean {
  const heading = blocks[index];
  if (heading?.type !== "heading") return false;
  let products = 0;
  for (let next = index + 1; next < blocks.length; next += 1) {
    const block = blocks[next]!;
    if (block.type === "heading") {
      if (block.level <= heading.level) break;
      // A subheading is the section's own; it is judged by its own section.
      continue;
    }
    if (block.type !== "products") return false;
    if (!isEmpty(block)) return false;
    products += 1;
  }
  return products > 0;
}
