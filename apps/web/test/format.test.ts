import { describe, expect, it } from "vitest";
import {
  availabilityLabel,
  availabilitySchemaUrl,
  discountPercent,
  toPriceView,
} from "@/lib/catalog/format";
import { sanitizeHtml, htmlToPlainText } from "@/lib/sanitize";
import { isAllowedImageUrl, resolveImageUrl } from "@/lib/catalog/images";

describe("toPriceView", () => {
  it("formats a stored decimal string", () => {
    const price = toPriceView("30.00", "EUR", "en-GB");
    expect(price?.amount).toBe("30.00");
    expect(price?.currency).toBe("EUR");
    expect(price?.formatted).toContain("30.00");
  });

  it("keeps the exact amount as a string, never a float", () => {
    // The authoritative value must survive untouched by binary floating point.
    expect(toPriceView("0.10", "EUR")?.amount).toBe("0.10");
    expect(toPriceView("9007199254740993.01", "EUR")?.amount).toBe("9007199254740993.01");
  });

  it("returns null for a missing price rather than zero", () => {
    // Several real products genuinely have no price; "0.00" would read as free.
    expect(toPriceView(null, "EUR")).toBeNull();
    expect(toPriceView(undefined, "EUR")).toBeNull();
    expect(toPriceView("", "EUR")).toBeNull();
  });

  it("survives an unknown currency or locale", () => {
    expect(() => toPriceView("10.00", "XYZ", "not-a-locale")).not.toThrow();
    expect(toPriceView("10.00", "XYZ", "not-a-locale")?.amount).toBe("10.00");
  });

  it("normalises to two fraction digits", () => {
    expect(toPriceView("7", "EUR")?.amount).toBe("7.00");
    expect(toPriceView("7.5", "EUR")?.amount).toBe("7.50");
  });
});

describe("discountPercent", () => {
  it("computes a genuine reduction", () => {
    expect(discountPercent("15.00", "20.00")).toBe(25);
    expect(discountPercent("7.50", "10.00")).toBe(25);
  });

  it("returns null when the old price is not higher", () => {
    expect(discountPercent("20.00", "20.00")).toBeNull();
    expect(discountPercent("25.00", "20.00")).toBeNull();
  });

  it("returns null when either price is missing", () => {
    expect(discountPercent(null, "20.00")).toBeNull();
    expect(discountPercent("15.00", null)).toBeNull();
    expect(discountPercent(null, null)).toBeNull();
  });

  it("does not compare decimal strings lexicographically", () => {
    // "9.00" > "10.00" is true as strings, and would advertise a fake saving.
    expect(discountPercent("10.00", "9.00")).toBeNull();
    expect(discountPercent("9.00", "10.00")).toBe(10);
  });

  it("handles a zero old price without dividing by zero", () => {
    expect(discountPercent("5.00", "0.00")).toBeNull();
  });
});

describe("availability helpers", () => {
  it("labels every state", () => {
    expect(availabilityLabel("in_stock")).toBe("В наличност");
    expect(availabilityLabel("out_of_stock")).toBe("Изчерпан");
    expect(availabilityLabel("preorder")).toBe("Може да се поръча");
    expect(availabilityLabel("unknown")).toBe("Наличност при запитване");
  });

  it("maps to schema.org URLs", () => {
    expect(availabilitySchemaUrl("in_stock")).toBe("https://schema.org/InStock");
    expect(availabilitySchemaUrl("out_of_stock")).toBe("https://schema.org/OutOfStock");
    expect(availabilitySchemaUrl("anything else")).toBe("https://schema.org/LimitedAvailability");
  });
});

describe("sanitizeHtml", () => {
  it("keeps ordinary formatting", () => {
    expect(sanitizeHtml("<p>Rich <strong>coffee</strong></p>")).toContain("<strong>coffee</strong>");
  });

  it("strips scripts", () => {
    const result = sanitizeHtml('<p>ok</p><script>alert("xss")</script>');
    expect(result).not.toContain("<script");
    expect(result).not.toContain("alert");
    expect(result).toContain("ok");
  });

  it("strips event handlers", () => {
    expect(sanitizeHtml('<p onclick="steal()">text</p>')).not.toContain("onclick");
  });

  it("strips javascript: URLs", () => {
     
    const result = sanitizeHtml('<a href="javascript:alert(1)">click</a>');
    expect(result).not.toContain("javascript:");
  });

  it("strips img tags and their src, so nothing can hotlink", () => {
    const result = sanitizeHtml('<p><img src="https://evil.test/track.gif"></p>');
    expect(result).not.toContain("evil.test");
    expect(result).not.toContain("<img");
  });

  it("strips iframes, forms and inputs", () => {
    const result = sanitizeHtml(
      '<iframe src="https://evil.test"></iframe><form><input name="password"></form>',
    );
    expect(result).not.toContain("iframe");
    expect(result).not.toContain("<form");
    expect(result).not.toContain("<input");
  });

  it("strips inline styles", () => {
    expect(sanitizeHtml('<p style="position:fixed;inset:0">x</p>')).not.toContain("style");
  });

  it("marks surviving links as safe external links", () => {
    const result = sanitizeHtml('<a href="https://example.com">link</a>');
    expect(result).toContain('rel="nofollow noopener noreferrer"');
    expect(result).toContain('target="_blank"');
  });

  it("can strip links entirely", () => {
    const result = sanitizeHtml('<a href="https://example.com">link</a>', { stripLinks: true });
    expect(result).not.toContain("<a ");
    expect(result).toContain("link");
  });

  it("returns an empty string for empty input", () => {
    expect(sanitizeHtml(null)).toBe("");
    expect(sanitizeHtml(undefined)).toBe("");
    expect(sanitizeHtml("")).toBe("");
  });

  it("preserves Cyrillic content", () => {
    expect(sanitizeHtml("<p>Кафе на зърна</p>")).toContain("Кафе на зърна");
  });
});

describe("htmlToPlainText", () => {
  it("removes all markup", () => {
    expect(htmlToPlainText("<p>Hello <b>world</b></p>")).toBe("Hello world");
  });

  it("truncates on a word boundary", () => {
    const result = htmlToPlainText("<p>one two three four five six seven</p>", 20);
    expect(result.length).toBeLessThanOrEqual(21);
    expect(result.endsWith("…")).toBe(true);
    expect(result).not.toMatch(/\s…$/);
  });

  it("does not truncate short text", () => {
    expect(htmlToPlainText("<p>short</p>", 100)).toBe("short");
  });
});

describe("image URL guard", () => {
  const ORIGINAL = process.env.NEXT_PUBLIC_IMAGE_BASE_URL;

  it("rejects the source domain outright", () => {
    process.env.NEXT_PUBLIC_IMAGE_BASE_URL = "https://cdn.example.com";
    // This is the rule the whole storefront depends on: never hotlink.
    expect(isAllowedImageUrl("https://www.kafezona.com/img/x.jpg")).toBe(false);
    expect(isAllowedImageUrl("https://kafezona.com/img/x.jpg")).toBe(false);
    expect(resolveImageUrl("https://www.kafezona.com/img/x.jpg")).toBe("/placeholder-product.svg");
    process.env.NEXT_PUBLIC_IMAGE_BASE_URL = ORIGINAL;
  });

  it("accepts our configured host", () => {
    process.env.NEXT_PUBLIC_IMAGE_BASE_URL = "https://cdn.example.com";
    expect(isAllowedImageUrl("https://cdn.example.com/catalog/x.jpg")).toBe(true);
    process.env.NEXT_PUBLIC_IMAGE_BASE_URL = ORIGINAL;
  });

  it("rejects any other third-party host", () => {
    process.env.NEXT_PUBLIC_IMAGE_BASE_URL = "https://cdn.example.com";
    expect(isAllowedImageUrl("https://someone-else.test/x.jpg")).toBe(false);
    process.env.NEXT_PUBLIC_IMAGE_BASE_URL = ORIGINAL;
  });

  it("serves bare object keys through our own media route in development", () => {
    delete process.env.NEXT_PUBLIC_IMAGE_BASE_URL;
    expect(resolveImageUrl("catalog/kafezona/ab/cd/hash.jpg")).toBe("/media/catalog/kafezona/ab/cd/hash.jpg");
    process.env.NEXT_PUBLIC_IMAGE_BASE_URL = ORIGINAL;
  });

  it("falls back to the placeholder for empty input", () => {
    expect(resolveImageUrl("")).toBe("/placeholder-product.svg");
  });

  it("rejects a malformed URL", () => {
    expect(isAllowedImageUrl("http://[::bad")).toBe(false);
  });
});
