import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IntensityScale } from "@/components/catalog/intensity-scale";
import { SystemBadge } from "@/components/catalog/system-badge";
import { BREWING_SYSTEMS } from "@/lib/recommend/systems";

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);

/** How many track segments a rendered scale has, and how many are filled. */
function track(markup: string): { total: number; filled: number } {
  const filled = markup.match(/bg-pine-700/g)?.length ?? 0;
  const empty = markup.match(/bg-line/g)?.length ?? 0;
  return { total: filled + empty, filled };
}

describe("SystemBadge", () => {
  it("names every brewing system and carries its id for colour", () => {
    for (const system of BREWING_SYSTEMS) {
      const markup = html(createElement(SystemBadge, { systemId: system.id }));
      expect(markup).toContain(`data-system="${system.id}"`);
      expect(markup).toContain(system.name);
    }
  });

  it("never shows the swatch without the name", () => {
    const markup = html(createElement(SystemBadge, { systemId: "dolce-gusto" }));
    // The swatch is decorative; the name is the content.
    expect(markup).toMatch(/aria-hidden="true"[^>]*><\/span><span[^>]*>Dolce Gusto/);
  });

  it("renders nothing for an unknown or absent system", () => {
    expect(html(createElement(SystemBadge, { systemId: "vertuo" }))).toBe("");
    expect(html(createElement(SystemBadge, { systemId: null }))).toBe("");
  });

  it("is a link only when given somewhere to go", () => {
    expect(html(createElement(SystemBadge, { systemId: "beans" }))).toMatch(/^<span/);
    expect(
      html(createElement(SystemBadge, { systemId: "beans", href: "/categories/kafe-na-zarna" })),
    ).toMatch(/^<a [^>]*href="\/categories\/kafe-na-zarna"/);
  });
});

describe("IntensityScale", () => {
  it("draws exactly as many segments as the product's own scale", () => {
    for (const [raw, value, max] of [
      ["4 от 5", 4, 5],
      ["7 от 9", 7, 9],
      ["8 от 10", 8, 10],
      ["8 от 12", 8, 12],
      ["12 от 13", 12, 13],
    ] as const) {
      const markup = html(createElement(IntensityScale, { raw }));
      expect(track(markup)).toEqual({ total: max, filled: value });
      expect(markup).toContain(`${value} от ${max}`);
    }
  });

  it("always states the maximum, so an 8 is never read without its scale", () => {
    const outOfTen = html(createElement(IntensityScale, { raw: "8 от 10" }));
    const outOfTwelve = html(createElement(IntensityScale, { raw: "8 от 12" }));
    expect(outOfTen).toContain("8 от 10");
    expect(outOfTwelve).toContain("8 от 12");
    expect(outOfTen).not.toEqual(outOfTwelve);
  });

  it("keeps the track the same width whatever the scale", () => {
    const five = html(createElement(IntensityScale, { raw: "4 от 5" }));
    const thirteen = html(createElement(IntensityScale, { raw: "12 от 13" }));
    expect(five).toContain("w-16");
    expect(thirteen).toContain("w-16");
    expect(html(createElement(IntensityScale, { raw: "4 от 5", size: "page" }))).toContain("w-30");
  });

  it("reads as a phrase to a screen reader and hides the track", () => {
    const markup = html(createElement(IntensityScale, { raw: "8 от 12" }));
    expect(markup).toContain('<span class="sr-only">Интензивност </span>');
    expect(markup).toContain('aria-hidden="true"');
  });

  it("renders nothing when there is no intensity", () => {
    expect(html(createElement(IntensityScale, { raw: null }))).toBe("");
    expect(html(createElement(IntensityScale, { raw: "  " }))).toBe("");
  });

  it("shows unparseable text raw, with no track", () => {
    for (const raw of ["силно", "14 от 12"]) {
      const markup = html(createElement(IntensityScale, { raw }));
      expect(markup).toContain(raw);
      expect(track(markup).total).toBe(0);
    }
  });
});
