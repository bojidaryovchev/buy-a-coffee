/**
 * The newsletter's body language: a small subset of Markdown, read into a tree
 * that the mail components draw. Never into HTML.
 *
 * WHY A TREE AND NOT A MARKDOWN LIBRARY. Every Markdown renderer produces an
 * HTML string, and most of them pass inline HTML through: `<img onerror=…>`
 * typed into the composer would be in every subscriber's inbox. Sanitising
 * that string afterwards is a second parser guessing what the first one
 * meant. Here there is no HTML at any point. The parser returns plain data —
 * text, bold, italic, a link, a heading, a list — and React draws it, escaping
 * every character of text on the way out. A `<script>` typed into the body is
 * printed as the eight characters `<script>`.
 *
 * WHAT IS UNDERSTOOD, which is also what the composer's toolbar writes:
 *
 *   a blank line           a new paragraph; a single line break stays a break
 *   ## Заглавие            a heading (`#` and `##` both: the subject is the
 *                          message's one first-level heading); `###` a smaller one
 *   - точка  /  * точка    a bulleted list, one item per line
 *   **удебелен**           bold
 *   *курсив*               italic
 *   [текст](https://…)     a link: http, https and mailto only
 *   https://…              a bare address becomes a link to itself
 *   \*                     a literal character that would otherwise be syntax
 *
 * Anything else is text. A link to any other scheme (`javascript:`, `data:`,
 * a relative path) is not a link: its words are kept and the target is
 * dropped, so a typo costs a link and never a hole in the message.
 *
 * Pure and dependency-free: the composer's preview, the sender and the tests
 * all read the same tree.
 */

export type Inline =
  | { type: "text"; value: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "link"; href: string; children: Inline[] }
  | { type: "break" };

export type Block =
  | { type: "heading"; level: 2 | 3; children: Inline[] }
  | { type: "paragraph"; children: Inline[] }
  | { type: "list"; items: Inline[][] };

/** Long enough for any newsletter worth reading; short enough to stay under
    Gmail's 102 KB clipping point once it is wrapped in the letterhead. */
export const MAX_BODY_LENGTH = 20_000;

const SAFE_SCHEME = /^(https?:\/\/|mailto:)/i;

/**
 * The target, if it is one we will put in a message, else null.
 *
 * A URL must parse, and its scheme is checked on the parsed value rather than
 * on the text: `JaVaScRiPt:` and a leading space are the classic ways round a
 * prefix check on a string. Control characters are refused outright.
 */
export function safeHref(raw: string): string | null {
  const candidate = raw.trim();
  // eslint-disable-next-line no-control-regex
  if (!candidate || /[\u0000-\u001f\u007f\s<>"]/.test(candidate)) return null;
  if (!SAFE_SCHEME.test(candidate)) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol === "mailto:") return url.pathname.includes("@") ? candidate : null;
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    /* As typed, not `url.toString()`: the parse is the check, and normalising
       would make the link differ from its own text ("…bg" and "…bg/"). React
       escapes the attribute; the pattern above has already refused anything
       that could end it. */
    return url.hostname ? candidate : null;
  } catch {
    return null;
  }
}

/** Characters a backslash makes literal. */
const ESCAPABLE = new Set(["\\", "*", "_", "[", "]", "(", ")", "#", "-", "`"]);

/** Bare addresses: up to whitespace, with sentence punctuation left outside. */
const BARE_URL = /https?:\/\/[^\s<>"]+/y;
const TRAILING_PUNCTUATION = /[.,;:!?)\]»"']+$/;

/** Merge adjacent text nodes, so the tree is the same however it was scanned. */
function compact(nodes: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const node of nodes) {
    const last = out[out.length - 1];
    if (node.type === "text" && last?.type === "text") last.value += node.value;
    else if (node.type !== "text" || node.value) out.push(node);
  }
  return out;
}

/**
 * One line's worth of inline syntax (line breaks are added by the caller).
 *
 * `depth` stops pathological nesting — `**[*…*](…)**` is fine, a thousand
 * levels of it is a stack overflow — by reading anything deeper as text.
 */
export function parseInline(source: string, depth = 0): Inline[] {
  const nodes: Inline[] = [];
  let text = "";
  const flush = () => {
    if (text) nodes.push({ type: "text", value: text });
    text = "";
  };

  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    const next = source[i + 1];

    if (ch === "\\" && next !== undefined && ESCAPABLE.has(next)) {
      text += next;
      i += 2;
      continue;
    }

    if (depth < 4 && ch === "*" && next === "*") {
      const close = source.indexOf("**", i + 2);
      if (close > i + 2) {
        flush();
        nodes.push({
          type: "strong",
          children: parseInline(source.slice(i + 2, close), depth + 1),
        });
        i = close + 2;
        continue;
      }
    }

    /* Italic only when it hugs its words: `2 * 3 * 4` is arithmetic, and
       `* точка` at the start of a line was already taken as a list item. */
    if (depth < 4 && ch === "*" && next !== undefined && next !== " " && next !== "*") {
      let close = source.indexOf("*", i + 1);
      while (close !== -1 && (source[close - 1] === " " || source[close + 1] === "*")) {
        close = source.indexOf("*", close + 1);
      }
      if (close > i + 1) {
        flush();
        nodes.push({ type: "em", children: parseInline(source.slice(i + 1, close), depth + 1) });
        i = close + 1;
        continue;
      }
    }

    if (ch === "[") {
      /* The target may hold one level of balanced parentheses, as addresses
         like `…/Espresso_(drink)` do. */
      const match = /^\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/.exec(source.slice(i));
      if (match) {
        flush();
        const label =
          depth < 4
            ? parseInline(match[1]!, depth + 1)
            : [{ type: "text" as const, value: match[1]! }];
        const href = safeHref(match[2]!);
        if (href) nodes.push({ type: "link", href, children: label });
        // Unsafe or malformed target: the words stay, the link does not.
        else nodes.push(...label);
        i += match[0].length;
        continue;
      }
    }

    if ((ch === "h" || ch === "H") && (i === 0 || /[\s(«"']/.test(source[i - 1]!))) {
      BARE_URL.lastIndex = i;
      const match = BARE_URL.exec(source);
      if (match) {
        const raw = match[0];
        const trailing = TRAILING_PUNCTUATION.exec(raw)?.[0] ?? "";
        const address = raw.slice(0, raw.length - trailing.length);
        const href = safeHref(address);
        if (href) {
          flush();
          nodes.push({ type: "link", href, children: [{ type: "text", value: address }] });
          i += address.length;
          continue;
        }
      }
    }

    text += ch;
    i += 1;
  }
  flush();
  return compact(nodes);
}

/** Lines joined by a break, each read for inline syntax. */
function inlineLines(lines: readonly string[]): Inline[] {
  const nodes: Inline[] = [];
  lines.forEach((line, index) => {
    if (index > 0) nodes.push({ type: "break" });
    nodes.push(...parseInline(line.trim()));
  });
  return compact(nodes);
}

const HEADING = /^(#{1,3})\s+(.+?)\s*#*\s*$/;
const BULLET = /^[-*]\s+(.*)$/;

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").slice(0, MAX_BODY_LENGTH).split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: Inline[][] | null = null;

  const endParagraph = () => {
    if (paragraph.length > 0) blocks.push({ type: "paragraph", children: inlineLines(paragraph) });
    paragraph = [];
  };
  const endList = () => {
    if (list && list.length > 0) blocks.push({ type: "list", items: list });
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      endParagraph();
      endList();
      continue;
    }

    const heading = HEADING.exec(trimmed);
    if (heading) {
      endParagraph();
      endList();
      blocks.push({
        type: "heading",
        level: heading[1]!.length === 3 ? 3 : 2,
        children: parseInline(heading[2]!),
      });
      continue;
    }

    const bullet = BULLET.exec(trimmed);
    if (bullet) {
      endParagraph();
      list ??= [];
      list.push(parseInline(bullet[1]!.trim()));
      continue;
    }

    /* A line after a list item with no blank line between is the next
       paragraph, not a continuation of the item: the composer has no way to
       show an indented continuation, so it should not mean one. */
    endList();
    paragraph.push(trimmed);
  }
  endParagraph();
  endList();
  return blocks;
}

/* -- the plain-text twin ---------------------------------------------------- */

function inlineText(nodes: readonly Inline[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
          return node.value;
        case "break":
          return "\n";
        case "strong":
        case "em":
          return inlineText(node.children);
        case "link": {
          const label = inlineText(node.children);
          const target = node.href.replace(/^mailto:/i, "");
          // A bare address is already its own text.
          return label === node.href || label === target ? label : `${label} (${target})`;
        }
      }
    })
    .join("");
}

/**
 * The same tree as plain text, for the message's text part: a heading on a
 * line of its own, a list as "- " lines, a link as "words (address)" so the
 * address survives a client that shows no HTML.
 */
export function markdownToText(blocks: readonly Block[]): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case "heading":
        case "paragraph":
          return inlineText(block.children);
        case "list":
          return block.items.map((item) => `- ${inlineText(item)}`).join("\n");
      }
    })
    .join("\n\n");
}

/**
 * Plain text with nothing but its addresses linked, for a body somebody typed
 * without meaning any syntax: the admin's reply, where `*` is an asterisk.
 * One paragraph per blank-line run, one break per line.
 */
export function plainParagraphs(source: string): Inline[][] {
  return source
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const nodes: Inline[] = [];
      chunk.split("\n").forEach((line, index) => {
        if (index > 0) nodes.push({ type: "break" });
        nodes.push(...autolink(line));
      });
      return compact(nodes);
    });
}

/** Bare http(s) addresses as links; every other character as text. */
export function autolink(line: string): Inline[] {
  const nodes: Inline[] = [];
  let last = 0;
  for (const match of line.matchAll(/https?:\/\/[^\s<>"]+/g)) {
    const raw = match[0];
    const address = raw.replace(TRAILING_PUNCTUATION, "");
    const href = safeHref(address);
    if (!href) continue;
    const at = match.index ?? 0;
    if (at > last) nodes.push({ type: "text", value: line.slice(last, at) });
    nodes.push({ type: "link", href, children: [{ type: "text", value: address }] });
    last = at + address.length;
  }
  if (last < line.length) nodes.push({ type: "text", value: line.slice(last) });
  return compact(nodes);
}
