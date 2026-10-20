import { createElement, Fragment, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Bean, Crema, Cup, CupRing, Curl, Spill, Steam } from "@/components/illustrations/drawings";

/**
 * Our drawings — DESIGN.md, "Imagery" and "The Drawing Tone Rule": decorative,
 * small, in the drawing tones and the paper they sit on, never in a colour that
 * carries meaning (pine, gold, clay, a system's colour, a status).
 */

const render = (element: ReactElement) => renderToStaticMarkup(element);

const DRAWINGS: Array<[string, ReactElement, number]> = [
  ["curl", createElement(Curl), 400],
  ["steam", createElement(Steam), 800],
  ["bean", createElement(Bean), 800],
  ["bean", createElement(Bean, { roast: "dark" }), 800],
  ["cup", createElement(Cup), 2_000],
  ["cup", createElement(Cup, { ground: "dark", steam: true, pour: true }), 2_600],
  ["crema", createElement(Crema), 1_200],
  ["cup-ring", createElement(CupRing), 1_200],
  ["spill", createElement(Spill), 1_200],
];

/** A colour class on a drawing may name only these. */
const ALLOWED_COLOUR =
  /^(fill|stroke|text)-(illo-[a-z0-9-]+|paper|paper-raised|line|line-strong|black|ink-900)(\/\d+)?$/;

describe("drawings", () => {
  it.each(DRAWINGS)(
    "%s is decorative: hidden from assistive technology, not focusable",
    (name, element) => {
      const markup = render(element);
      expect(markup).toMatch(
        new RegExp(
          `<svg[^>]*aria-hidden="true"[^>]*focusable="false"[^>]*data-illustration="${name}"`,
        ),
      );
      expect(markup).not.toMatch(/<title|<desc|role="img"/);
    },
  );

  it.each(DRAWINGS)(
    "%s is drawn only in the drawing tones and the paper under it",
    (_name, element) => {
      const markup = render(element);
      const classes = [...markup.matchAll(/class="([^"]*)"/g)].flatMap((match) =>
        match[1]!.split(/\s+/),
      );
      const colours = classes.filter((name) => /^(fill|stroke|text)-/.test(name));
      // The curl and the steam are drawn in currentColor: the caller picks the
      // colour for its ground (gold on pine, ink on paper).
      const inheritsColour = markup.includes('stroke="currentColor"');
      expect(colours.length > 0 || inheritsColour).toBe(true);
      expect(colours.filter((name) => !ALLOWED_COLOUR.test(name))).toEqual([]);
    },
  );

  it.each(DRAWINGS)("%s stays small (%#)", (_name, element, limit) => {
    expect(new Blob([render(element)]).size).toBeLessThanOrEqual(limit);
  });

  it("steam is three wisps that rise in turn, held by the off-screen pause", () => {
    const markup = render(createElement(Steam));
    expect(markup.match(/class="steam-wisp"/g)).toHaveLength(3);
    expect(markup).toMatch(/^<span class="block/);
  });

  it("a glass with steam carries the wisps; without, it carries none", () => {
    expect(render(createElement(Cup, { steam: true })).match(/steam-wisp/g)).toHaveLength(3);
    expect(render(createElement(Cup))).not.toContain("steam-wisp");
  });

  it("a glass pours only when asked", () => {
    expect(render(createElement(Cup, { pour: true }))).toContain('class="cup-pour"');
    expect(render(createElement(Cup))).not.toContain("cup-pour");
  });

  it("gives every glass on a page its own clip path", () => {
    const markup = render(createElement(Fragment, null, createElement(Cup), createElement(Cup)));
    const ids = [...markup.matchAll(/<clipPath id="([^"]+)"/g)].map((match) => match[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(markup).toContain(`clip-path="url(#${id})"`);
  });

  it("lets a caller size a glass, instead of competing with its default size", () => {
    const sized = render(createElement(Cup, { className: "h-20 w-auto" }));
    expect(sized).toContain('class="block overflow-visible h-20 w-auto"');
    expect(render(createElement(Cup))).toContain('class="block overflow-visible h-auto w-full"');
  });
});
