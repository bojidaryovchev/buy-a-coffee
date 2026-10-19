import { describe, expect, it } from "vitest";
import {
  MAX_BODY_LENGTH,
  autolink,
  markdownToText,
  parseInline,
  parseMarkdown,
  plainParagraphs,
  safeHref,
} from "@/emails/markdown";
import { composeNewsletterEmail } from "@/emails/newsletter";

/**
 * The newsletter body's language, and above all what it must never do: turn
 * something typed in the panel into markup in a subscriber's inbox, or into a
 * link to anywhere but the web or an address.
 */

const text = (value: string) => ({ type: "text", value });

describe("blocks", () => {
  it("reads paragraphs on blank lines and keeps a single break as a break", () => {
    expect(parseMarkdown("Едно\nи две\n\nТри")).toEqual([
      { type: "paragraph", children: [text("Едно"), { type: "break" }, text("и две")] },
      { type: "paragraph", children: [text("Три")] },
    ]);
  });

  it("reads `##` (and `#`) as a section heading and `###` as a smaller one", () => {
    expect(parseMarkdown("## Ново\n# Също\n### По-малко")).toEqual([
      { type: "heading", level: 2, children: [text("Ново")] },
      { type: "heading", level: 2, children: [text("Също")] },
      { type: "heading", level: 3, children: [text("По-малко")] },
    ]);
  });

  it("does not take a hashtag or a hyphenated word for syntax", () => {
    expect(parseMarkdown("#кафе\n-5 градуса")).toEqual([
      { type: "paragraph", children: [text("#кафе"), { type: "break" }, text("-5 градуса")] },
    ]);
  });

  it("reads `- ` and `* ` lines as one list, and the next plain line as a paragraph", () => {
    expect(parseMarkdown("- едно\n* две\nслед това")).toEqual([
      { type: "list", items: [[text("едно")], [text("две")]] },
      { type: "paragraph", children: [text("след това")] },
    ]);
  });

  it("normalises Windows line endings and stops at the length limit", () => {
    expect(parseMarkdown("а\r\n\r\nб")).toHaveLength(2);
    const long = parseMarkdown("я".repeat(MAX_BODY_LENGTH + 500));
    expect(markdownToText(long)).toHaveLength(MAX_BODY_LENGTH);
  });
});

describe("inline", () => {
  it("reads bold, italic and both together", () => {
    expect(parseInline("**силно** и *меко*")).toEqual([
      { type: "strong", children: [text("силно")] },
      text(" и "),
      { type: "em", children: [text("меко")] },
    ]);
    expect(parseInline("**много *наистина* силно**")).toEqual([
      {
        type: "strong",
        children: [text("много "), { type: "em", children: [text("наистина")] }, text(" силно")],
      },
    ]);
  });

  it("leaves arithmetic and an unclosed marker alone", () => {
    expect(parseInline("2 * 3 * 4")).toEqual([text("2 * 3 * 4")]);
    expect(parseInline("**без край")).toEqual([text("**без край")]);
  });

  it("makes a backslash-escaped character literal", () => {
    expect(parseInline("\\*не курсив\\*")).toEqual([text("*не курсив*")]);
  });

  it("links http, https and mailto, and keeps the words of any other target", () => {
    expect(parseInline("[сайта](https://buy-a-coffee.com/bg)")).toEqual([
      { type: "link", href: "https://buy-a-coffee.com/bg", children: [text("сайта")] },
    ]);
    expect(parseInline("[пишете](mailto:info@buy-a-coffee.com)")).toEqual([
      { type: "link", href: "mailto:info@buy-a-coffee.com", children: [text("пишете")] },
    ]);
    for (const target of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:text/html,<b>x</b>",
      "vbscript:x",
      "/bg/promotsii",
      "//evil.example",
      "ftp://example.bg/file",
      "mailto:nobody",
    ]) {
      expect(parseInline(`[натиснете](${target})`), target).toEqual([text("натиснете")]);
    }
  });

  it("takes balanced parentheses as part of a link's address", () => {
    expect(parseInline("[еспресо](https://bg.wikipedia.org/wiki/Еспресо_(напитка))")).toEqual([
      {
        type: "link",
        href: "https://bg.wikipedia.org/wiki/Еспресо_(напитка)",
        children: [text("еспресо")],
      },
    ]);
  });

  it("links a bare address and leaves the sentence's punctuation outside it", () => {
    expect(parseInline("Вижте https://buy-a-coffee.com/bg.")).toEqual([
      text("Вижте "),
      {
        type: "link",
        href: "https://buy-a-coffee.com/bg",
        children: [text("https://buy-a-coffee.com/bg")],
      },
      text("."),
    ]);
  });

  it("refuses targets that could break out of an attribute", () => {
    expect(safeHref('https://a.bg/"onmouseover="x')).toBeNull();
    expect(safeHref("https://a.bg/<x>")).toBeNull();
    expect(safeHref("https://a.bg/\u0000")).toBeNull();
    expect(safeHref(" https://a.bg")).toBe("https://a.bg");
  });
});

describe("in the message", () => {
  const render = (body: string) =>
    composeNewsletterEmail(
      { subject: "Тема <b>", preheader: "", body, attachments: [] },
      { unsubscribeUrl: "https://buy-a-coffee.com/bg/byuletin/otpisvane?token=x" },
    );

  it("prints typed HTML as text, in the subject and in the body", async () => {
    const { html, text: plain } = await render(
      '<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n<a href="javascript:x">а</a>',
    );
    // As text, escaped: never as an element or an attribute.
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img[^>]*onerror/i);
    expect(html).not.toContain('href="javascript');
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("Тема &lt;b&gt;");
    // The text part is text, so it is printed as typed.
    expect(plain).toContain("<script>alert(1)</script>");
  });

  it("draws a refused link as its words, with no anchor", async () => {
    const { html } = await render("[натиснете тук](javascript:alert(1))");
    expect(html).toContain("натиснете тук");
    expect(html).not.toMatch(/href="javascript/i);
  });

  it("draws headings, lists and links as real markup", async () => {
    const { html } = await render(
      "## Ново\n\n- едно\n- две\n\n[сайта](https://buy-a-coffee.com/bg)",
    );
    expect(html).toMatch(/<h2[^>]*>Ново<\/h2>/);
    expect(html).toMatch(/<ul[^>]*><li[^>]*>едно<\/li><li[^>]*>две<\/li><\/ul>/);
    expect(html).toMatch(/<a href="https:\/\/buy-a-coffee\.com\/bg"[^>]*>сайта<\/a>/);
  });
});

describe("the text part", () => {
  it("keeps a link's address and a list's dashes", () => {
    const blocks = parseMarkdown(
      "## Ново\n\n- [сайта](https://a.bg/x)\n- https://a.bg/y\n\n**край**",
    );
    expect(markdownToText(blocks)).toBe(
      "Ново\n\n- сайта (https://a.bg/x)\n- https://a.bg/y\n\nкрай",
    );
  });
});

describe("a reply's plain paragraphs", () => {
  it("links addresses and nothing else", () => {
    expect(plainParagraphs("*не курсив* https://a.bg/x\n\nвтори")).toEqual([
      [
        text("*не курсив* "),
        { type: "link", href: "https://a.bg/x", children: [text("https://a.bg/x")] },
      ],
      [text("втори")],
    ]);
    expect(autolink("javascript:alert(1)")).toEqual([text("javascript:alert(1)")]);
  });
});
