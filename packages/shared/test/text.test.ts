import { describe, expect, it } from "vitest";
import {
  decodeEntities,
  htmlToText,
  normalizeHtmlForHash,
  normalizeLabel,
  normalizeRichTextForHash,
  normalizeWhitespace,
  slugify,
  stripVolatileMarkup,
  transliterate,
} from "../src/text.ts";

describe("decodeEntities", () => {
  it("decodes the entities the source site actually emits", () => {
    expect(decodeEntities("Piacere d&#039;Oro")).toBe("Piacere d'Oro");
    expect(decodeEntities("Виж всички бранд &rarr;")).toBe("Виж всички бранд →");
    expect(decodeEntities("&times;")).toBe("×");
    expect(decodeEntities("[email&#160;protected]")).toBe("[email\u00a0protected]");
    expect(decodeEntities("&quot;Make Your World&quot;")).toBe('"Make Your World"');
  });

  it("decodes hex and named forms", () => {
    expect(decodeEntities("&#x41;&amp;&#66;")).toBe("A&B");
  });

  it("leaves unknown or malformed entities untouched", () => {
    expect(decodeEntities("&notarealentity;")).toBe("&notarealentity;");
    expect(decodeEntities("100% & more")).toBe("100% & more");
  });

  it("refuses to emit lone surrogates", () => {
    expect(decodeEntities("&#xD800;")).toBe("&#xD800;");
  });
});

describe("normalizeWhitespace", () => {
  it("collapses runs including non-breaking spaces", () => {
    expect(normalizeWhitespace("  a \n\t b\u00a0c  ")).toBe("a b c");
  });

  it("removes zero-width characters", () => {
    expect(normalizeWhitespace("a\u200bb")).toBe("a b");
  });
});

describe("stripVolatileMarkup", () => {
  it("neutralises Cloudflare's per-response email obfuscation", () => {
    // Without this, every page hashes differently on every single crawl.
    const a = '<a href="/cdn-cgi/l/email-protection#8ce5e2eae3cc"><span data-cfemail="6b02050d042b">x</span></a>';
    const b = '<a href="/cdn-cgi/l/email-protection#deb7b0b8b19e"><span data-cfemail="adc4c3cbc2ed">x</span></a>';
    expect(stripVolatileMarkup(a)).toBe(stripVolatileMarkup(b));
  });

  it("removes HTML comments", () => {
    expect(stripVolatileMarkup("<p>a</p><!-- build 123 -->")).toBe("<p>a</p>");
  });
});

describe("normalizeHtmlForHash", () => {
  it("is stable across formatting-only differences", () => {
    expect(normalizeHtmlForHash("<p>a</p>\n  <p>b</p>")).toBe(normalizeHtmlForHash("<p>a</p> <p>b</p>"));
  });

  it("still distinguishes different content", () => {
    expect(normalizeHtmlForHash("<p>a</p>")).not.toBe(normalizeHtmlForHash("<p>b</p>"));
  });
});

describe("htmlToText", () => {
  it("drops scripts and styles entirely", () => {
    expect(htmlToText("<div>a<script>var x=1;</script><style>.a{}</style>b</div>")).toBe("a b");
  });

  it("inserts separators at block boundaries", () => {
    expect(htmlToText("<li>a</li><li>b</li>")).toBe("a b");
    expect(htmlToText("a<br>b")).toBe("a b");
  });

  it("decodes entities in the extracted text", () => {
    expect(htmlToText("<p>Piacere d&#039;Oro</p>")).toBe("Piacere d'Oro");
  });
});

describe("normalizeRichTextForHash", () => {
  it("ignores markup and case differences that do not change meaning", () => {
    expect(normalizeRichTextForHash("<p><b>Hello</b> World</p>")).toBe(
      normalizeRichTextForHash("<div>hello world</div>"),
    );
  });

  it("collapses the double-space typo variant seen in the catalog", () => {
    expect(normalizeRichTextForHash("Matcha Latte  от Rema")).toBe(
      normalizeRichTextForHash("Matcha Latte от Rema"),
    );
  });

  it("maps null and empty to the same token", () => {
    expect(normalizeRichTextForHash(null)).toBe("");
    expect(normalizeRichTextForHash(undefined)).toBe("");
    expect(normalizeRichTextForHash("")).toBe("");
  });
});

describe("normalizeLabel", () => {
  it("trims the stray spaces present in real brand names", () => {
    expect(normalizeLabel(" VERGNANO")).toBe("VERGNANO");
    expect(normalizeLabel("BIANCHI ")).toBe("BIANCHI");
    expect(normalizeLabel("Dolce Gusto ")).toBe("Dolce Gusto");
    expect(normalizeLabel(null)).toBe("");
  });
});

describe("transliterate / slugify", () => {
  it("transliterates Bulgarian into readable Latin", () => {
    expect(transliterate("Кафе на зърна")).toBe("kafe na zarna");
    expect(slugify("Кафе на зърна")).toBe("kafe-na-zarna");
    expect(slugify("Капсули")).toBe("kapsuli");
  });

  it("produces clean slugs from mixed-script product names", () => {
    expect(slugify("Кафе на зърна Lavazza Super Crema 1кг.")).toBe(
      "kafe-na-zarna-lavazza-super-crema-1kg",
    );
  });

  it("handles apostrophes and punctuation", () => {
    expect(slugify("Eurocaf Piacere d'Oro 1кг.")).toBe("eurocaf-piacere-d-oro-1kg");
  });

  it("collapses and trims separators", () => {
    expect(slugify("  --A  &&  B--  ")).toBe("a-b");
    expect(slugify("!!!")).toBe("");
  });

  it("truncates on a word boundary", () => {
    const slug = slugify("alpha bravo charlie delta echo foxtrot golf hotel", { maxLength: 20 });
    expect(slug.length).toBeLessThanOrEqual(20);
    expect(slug.endsWith("-")).toBe(false);
  });
});
