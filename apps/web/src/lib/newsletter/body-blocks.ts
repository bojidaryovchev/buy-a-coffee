import { isTokenLine } from "./tokens";

/**
 * The composer's blocks: the body as an ordered list of text and product
 * blocks, which is still, and only, the body string.
 *
 * The body stays the one thing that is saved, previewed, checked, frozen into
 * a snapshot and sent (`actions.ts` and everything after it read `body` and
 * nothing else). This is a way of looking at it: the body is split on the
 * lines that are a product block (`isTokenLine`, the very test the letter's
 * parser applies) into the text between them and those lines. Every non-blank
 * character belongs to a block; every run of whitespace between two blocks —
 * the blank lines, a trailing newline, a `\r\n` from a Windows paste — is kept
 * beside them as it was (`seps`). So `serializeBody(parseBody(body))` is the
 * body, character for character, and editing one block leaves every other
 * character where it was.
 *
 * Moving, removing and adding blocks can bring two blocks too close: two
 * texts on neighbouring lines read as one paragraph, a product line with text
 * on its own line no longer is a product line. `settle` puts back exactly the
 * line breaks that are missing — a blank line between two texts, a line break
 * beside a product line — and nothing else.
 *
 * Pure and free of the DOM: the composer and `test/newsletter-body.test.ts`
 * share it.
 */

export type BodyBlock =
  /** Text in the letter's Markdown subset, without the whitespace around it. */
  | { readonly id: string; readonly kind: "text"; readonly text: string }
  /** One `[[…]]` line, trimmed: what it asks for is `parseProductToken`'s. */
  | { readonly id: string; readonly kind: "products"; readonly line: string };

export interface BodyModel {
  readonly blocks: readonly BodyBlock[];
  /** `seps[i]` is the whitespace before `blocks[i]`; the last one follows them all. */
  readonly seps: readonly string[];
}

let lastId = 0;
/** A key for a block, for React; unique within the page's life, meaningless otherwise. */
export const blockId = (): string => `blok-${(lastId += 1)}`;

const LEADING = /^\s*/;
const TRAILING = /\s*$/;

/** The body as blocks. */
export function parseBody(body: string): BodyModel {
  const blocks: BodyBlock[] = [];
  const seps: string[] = [];
  let pending = "";
  let text = "";

  const flushText = () => {
    if (!text) return;
    const lead = LEADING.exec(text)![0];
    const rest = text.slice(lead.length);
    const trail = TRAILING.exec(rest)![0];
    const core = rest.slice(0, rest.length - trail.length);
    pending += lead;
    if (core) {
      seps.push(pending);
      blocks.push({ id: blockId(), kind: "text", text: core });
      pending = "";
    }
    pending += trail;
    text = "";
  };

  /* Lines with the break after each, as the letter's parser splits them
     (`\r\n`, `\r` and `\n` alike), so a line is a block here exactly when it
     is a block in the letter. */
  const pieces = body.split(/(\r\n|\r|\n)/);
  for (let index = 0; index < pieces.length; index += 2) {
    const line = pieces[index]!;
    const lineBreak = pieces[index + 1] ?? "";
    if (!isTokenLine(line)) {
      text += line + lineBreak;
      continue;
    }
    flushText();
    const lead = LEADING.exec(line)![0];
    const trimmed = line.trim();
    pending += lead;
    seps.push(pending);
    blocks.push({ id: blockId(), kind: "products", line: trimmed });
    pending = line.slice(lead.length + trimmed.length) + lineBreak;
  }
  flushText();
  seps.push(pending);
  return { blocks, seps };
}

/** The blocks as the body. */
export function serializeBody(model: BodyModel): string {
  let body = model.seps[0] ?? "";
  model.blocks.forEach((block, index) => {
    body += block.kind === "text" ? block.text : block.line;
    body += model.seps[index + 1] ?? "";
  });
  return body;
}

const breaks = (whitespace: string): number => (whitespace.match(/\r\n|\r|\n/g) ?? []).length;

/**
 * Put back the line breaks two neighbouring blocks need and no longer have:
 * a blank line between two texts (or they are one paragraph), a line break
 * beside a product line (or it is not one). A gap that already has them is
 * left exactly as it is; one that does not becomes one blank line.
 */
export function settle(model: BodyModel): BodyModel {
  const seps = [...model.seps];
  for (let index = 1; index < model.blocks.length; index += 1) {
    const before = model.blocks[index - 1]!;
    const after = model.blocks[index]!;
    const needed = before.kind === "text" && after.kind === "text" ? 2 : 1;
    const gap =
      (before.kind === "text" ? TRAILING.exec(before.text)![0] : "") +
      seps[index] +
      (after.kind === "text" ? LEADING.exec(after.text)![0] : "");
    if (breaks(gap) < needed) seps[index] = "\n\n";
  }
  return { blocks: model.blocks, seps };
}

/** One block changed in place: its text, or its product line. */
export function replaceBlock(model: BodyModel, index: number, block: BodyBlock): BodyModel {
  const blocks = [...model.blocks];
  blocks[index] = block;
  return settle({ blocks, seps: model.seps });
}

/** A block one place up (`-1`) or down (`1`); the whitespace stays where it was. */
export function moveBlock(model: BodyModel, index: number, direction: -1 | 1): BodyModel {
  const target = index + direction;
  if (target < 0 || target >= model.blocks.length) return model;
  const blocks = [...model.blocks];
  [blocks[index], blocks[target]] = [blocks[target]!, blocks[index]!];
  return settle({ blocks, seps: model.seps });
}

/**
 * A block taken out. The whitespace on its two sides becomes one gap: the
 * body's own start or end when the block was first or last, else the wider
 * of the two, so the gap neither vanishes nor doubles.
 */
export function removeBlock(model: BodyModel, index: number): BodyModel {
  if (index < 0 || index >= model.blocks.length) return model;
  const blocks = model.blocks.filter((_, at) => at !== index);
  const before = model.seps[index] ?? "";
  const after = model.seps[index + 1] ?? "";
  const kept =
    index === 0
      ? before
      : index === model.blocks.length - 1
        ? after
        : breaks(after) > breaks(before)
          ? after
          : before;
  const seps = [...model.seps];
  seps.splice(index, 2, kept);
  return settle({ blocks, seps });
}

/** A block put in at `index` (the end when it is the length), a blank line from its neighbours. */
export function insertBlock(model: BodyModel, index: number, block: BodyBlock): BodyModel {
  const at = Math.max(0, Math.min(index, model.blocks.length));
  const blocks = [...model.blocks];
  blocks.splice(at, 0, block);
  // The first block of an empty body: whatever whitespace there was stays before it.
  if (model.blocks.length === 0) return { blocks, seps: [model.seps[0] ?? "", ""] };
  const seps = [...model.seps];
  /* Before the last block's trailing whitespace when it goes at the end, so a
     body that ended with a newline still does. */
  seps.splice(at === model.blocks.length ? at : at + 1, 0, "\n\n");
  return settle({ blocks, seps });
}
