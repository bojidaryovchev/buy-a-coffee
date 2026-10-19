/**
 * Edits the composer makes to the body, as pure functions of the text and
 * the selection, so they are tested without a browser.
 */

export type Edit = (
  text: string,
  start: number,
  end: number,
) => {
  text: string;
  selectionStart: number;
  selectionEnd: number;
};

/**
 * Put a block line (`[[промоции]]`) where the cursor is, on a line of its own
 * with an empty line before and after it — a block is read only from a whole
 * line, and the empty lines keep the text around it as it was. A selection is
 * replaced. The cursor ends past the empty line after the block: where the
 * next paragraph starts, or where what followed now does.
 */
export const insertBlockLine =
  (line: string): Edit =>
  (text, start, end) => {
    const before = text.slice(0, start).replace(/[ \t]+$/, "");
    const rest = text.slice(end).replace(/^[ \t]*\n*/, "");
    const lead =
      before === "" || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    const head = `${before}${lead}${line}\n\n`;
    return { text: `${head}${rest}`, selectionStart: head.length, selectionEnd: head.length };
  };
