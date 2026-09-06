import { describe, expect, it } from "vitest";
import { sanitizeHtml, htmlToPlainText } from "@/lib/sanitize";

/**
 * Adversarial cases for the sanitiser.
 *
 * Written when the implementation moved off `isomorphic-dompurify` (whose
 * jsdom dependency could not load in Vercel's bundle) onto `sanitize-html`.
 * The existing tests in format.test.ts cover the ordinary paths; these cover
 * the tricks where two sanitisers most plausibly disagree, because "the tests
 * still pass" is not evidence when the engine underneath has changed.
 */
describe("sanitizeHtml — evasion attempts", () => {
  it("blocks an entity-encoded javascript: scheme", () => {
    const result = sanitizeHtml('<a href="javas&#99;ript:alert(1)">click</a>');
    expect(result.toLowerCase()).not.toContain("javascript:");
  });

  it("blocks a scheme hidden behind leading whitespace or control characters", () => {
    expect(sanitizeHtml('<a href=" javascript:alert(1)">x</a>').toLowerCase()).not.toContain("javascript:");
    expect(sanitizeHtml('<a href="java\tscript:alert(1)">x</a>').toLowerCase()).not.toContain("javascript:");
  });

  it("blocks data: and vbscript: URLs", () => {
    expect(sanitizeHtml('<a href="data:text/html,<h1>x">x</a>')).not.toContain("data:");
    expect(sanitizeHtml('<a href="vbscript:msgbox(1)">x</a>').toLowerCase()).not.toContain("vbscript:");
  });

  it("survives a nested-tag smuggling attempt", () => {
    /**
     * `<scr<script>ipt>` is the classic trick against a sanitiser that strips
     * "<script>" by string replacement, where removing the inner tag splices
     * the outer one back together.
     *
     * The output here is `ipt&gt;alert(1)` — the residue survives as *text*,
     * escaped, with no element around it. That is the correct outcome and the
     * property worth asserting: what matters is that nothing executes, not
     * that the characters "alert(1)" are absent. A product description is
     * perfectly entitled to contain the word alert.
     */
    const result = sanitizeHtml("<scr<script>ipt>alert(1)</script>");
    expect(result).not.toContain("<script");
    expect(result).not.toContain("<");
    expect(result).toBe("ipt&gt;alert(1)");
  });

  it("drops the contents of style and noscript, not just the tags", () => {
    expect(sanitizeHtml("<style>body{display:none}</style><p>ok</p>")).not.toContain("display:none");
    expect(sanitizeHtml("<noscript><p>hidden</p></noscript><p>ok</p>")).not.toContain("hidden");
  });

  it("strips svg and its event handlers", () => {
    const result = sanitizeHtml('<svg onload="alert(1)"><circle r="1"/></svg><p>ok</p>');
    expect(result).not.toContain("<svg");
    expect(result).not.toContain("onload");
    expect(result).toContain("ok");
  });

  it("overrides attacker-supplied rel and target on a surviving link", () => {
    // A link that opts itself back into referrer leakage must not be honoured.
    const result = sanitizeHtml('<a href="https://ok.test" rel="dofollow" target="_self">x</a>');
    expect(result).toContain('rel="nofollow noopener noreferrer"');
    expect(result).toContain('target="_blank"');
    expect(result).not.toContain("dofollow");
    expect(result).not.toContain("_self");
  });

  it("keeps the text of a disallowed wrapper but drops the wrapper", () => {
    const result = sanitizeHtml("<div><p>kept</p></div>");
    expect(result).toContain("kept");
    expect(result).not.toContain("<div");
  });

  it("removes links entirely under stripLinks, keeping their text", () => {
    const result = sanitizeHtml('<p>see <a href="https://ok.test">this</a></p>', {
      stripLinks: true,
    });
    expect(result).not.toContain("<a");
    expect(result).not.toContain("ok.test");
    expect(result).toContain("this");
  });

  it("does not let a table attribute ride on an anchor", () => {
    expect(sanitizeHtml('<a href="https://ok.test" colspan="2">x</a>')).not.toContain("colspan");
  });
});

describe("htmlToPlainText", () => {
  it("decodes entities rather than leaving them to be escaped twice", () => {
    // This is the meta-description path: "Coffee & Cream" must not arrive as
    // "Coffee &amp;amp; Cream" once the framework escapes it again.
    expect(htmlToPlainText("<p>Coffee &amp; Cream</p>")).toBe("Coffee & Cream");
  });

  it("removes markup and collapses whitespace", () => {
    expect(htmlToPlainText("<p>a</p>\n\n<p>b</p>")).toBe("a b");
  });

  it("truncates on a word boundary", () => {
    const out = htmlToPlainText("<p>alpha beta gamma delta epsilon</p>", 14);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toContain("gam…");
  });

  it("drops script bodies rather than reading them as text", () => {
    expect(htmlToPlainText('<script>alert("xss")</script><p>ok</p>')).toBe("ok");
  });
});
