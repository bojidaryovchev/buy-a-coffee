/**
 * Edits the composer makes to the body, as pure functions of the text and
 * the selection, so they are tested without a browser. The formatting
 * buttons write the Markdown subset the template reads (`emails/markdown.ts`),
 * in a text block and in the whole-body "Markdown" view alike.
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

/** Wrap the selection, or insert the markers around a placeholder word. */
export const wrap =
  (marker: string, placeholder: string): Edit =>
  (text, start, end) => {
    const selected = text.slice(start, end) || placeholder;
    const next = `${text.slice(0, start)}${marker}${selected}${marker}${text.slice(end)}`;
    return {
      text: next,
      selectionStart: start + marker.length,
      selectionEnd: start + marker.length + selected.length,
    };
  };

/** Put a prefix at the start of every line the selection touches. */
export const prefixLines =
  (prefix: string): Edit =>
  (text, start, end) => {
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    const lineEndIndex = text.indexOf("\n", end);
    const lineEnd = lineEndIndex === -1 ? text.length : lineEndIndex;
    const block = text
      .slice(lineStart, lineEnd)
      .split("\n")
      .map((line) =>
        line.startsWith(prefix) ? line : `${prefix}${line.replace(/^(#+|-|\*)\s+/, "")}`,
      )
      .join("\n");
    const next = `${text.slice(0, lineStart)}${block}${text.slice(lineEnd)}`;
    return { text: next, selectionStart: lineStart, selectionEnd: lineStart + block.length };
  };

/** `[selection](https://)`, with the address selected for pasting over. */
export const link: Edit = (text, start, end) => {
  const label = text.slice(start, end) || "текст на връзката";
  const inserted = `[${label}](https://)`;
  const next = `${text.slice(0, start)}${inserted}${text.slice(end)}`;
  const urlStart = start + label.length + 3;
  return { text: next, selectionStart: urlStart, selectionEnd: urlStart + "https://".length };
};

/** The formatting buttons, in the order they are shown. */
export const TEXT_TOOLS: readonly { label: string; title: string; edit: Edit }[] = [
  { label: "Заглавие", title: "Подзаглавие (## в началото на реда)", edit: prefixLines("## ") },
  { label: "Удебелен", title: "Удебелен текст (**…**)", edit: wrap("**", "удебелен текст") },
  { label: "Курсив", title: "Курсив (*…*)", edit: wrap("*", "курсив") },
  { label: "Връзка", title: "Връзка ([текст](https://…))", edit: link },
  { label: "Списък", title: "Списък (- в началото на всеки ред)", edit: prefixLines("- ") },
];

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
