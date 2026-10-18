import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CapsuleDiagram,
  COMPACT_FRAME,
  capsuleDiagramLabel,
  hasCapsuleDiagram,
} from "@/components/wizard/capsule-diagrams";
import {
  CAPSULE_OUTLINES,
  halfProfile,
  sideOutlinePath,
} from "@/components/wizard/capsule-outlines";
import { BREWING_SYSTEMS } from "@/lib/recommend/systems";

/**
 * The drawings are the answer to "which capsule is this?", so a system that
 * silently renders no drawing is a broken page that still looks finished.
 * These tests make that a failure instead.
 */

const SHAPED = BREWING_SYSTEMS.filter((system) => system.method !== "beans");

function render(props: Parameters<typeof CapsuleDiagram>[0]): string {
  return renderToStaticMarkup(createElement(CapsuleDiagram, props));
}

describe("capsule diagrams", () => {
  it("covers every capsule and pod system, and only those", () => {
    expect(SHAPED.length).toBeGreaterThan(0);
    for (const system of BREWING_SYSTEMS) {
      expect(hasCapsuleDiagram(system.id), system.id).toBe(system.method !== "beans");
    }
  });

  it("renders nothing for a system with no capsule", () => {
    expect(render({ system: { id: "beans" } })).toBe("");
  });

  it.each(SHAPED.map((system) => [system.id, system] as const))(
    "%s renders as a named image with a Bulgarian description",
    (id, system) => {
      const html = render({ system });
      if (!hasCapsuleDiagram(id)) throw new Error(`no diagram for ${id}`);
      const label = capsuleDiagramLabel(id);

      expect(html).toContain(`data-capsule-diagram="${id}"`);
      expect(html).toContain('role="img"');
      expect(label).toMatch(/[А-Яа-я]/);

      const title = /<title id="([^"]+)">([^<]+)<\/title>/.exec(html);
      const desc = /<desc id="([^"]+)">([^<]+)<\/desc>/.exec(html);
      expect(title?.[2]).toBe(label);
      expect(desc?.[2]).toMatch(/[А-Яа-я]{4,}/);
      /* The name and description must actually be wired to the element. */
      expect(html).toContain(`aria-labelledby="${title?.[1]}"`);
      expect(html).toContain(`aria-describedby="${desc?.[1]}"`);
    },
  );

  it("gives every system a different name and a different drawing", () => {
    const labels = new Set<string>();
    const drawings = new Set<string>();
    for (const system of SHAPED) {
      if (!hasCapsuleDiagram(system.id)) continue;
      labels.add(capsuleDiagramLabel(system.id));
      const html = render({ system, variant: "compact", decorative: true });
      drawings.add(html.replace(/data-capsule-diagram="[^"]+"/, ""));
    }
    expect(labels.size).toBe(SHAPED.length);
    expect(drawings.size).toBe(SHAPED.length);
  });

  it("is hidden from assistive technology when decorative", () => {
    for (const system of SHAPED) {
      const html = render({ system, variant: "compact", decorative: true });
      expect(html).toContain('aria-hidden="true"');
      expect(html).not.toContain("<title");
      expect(html).not.toContain('role="img"');
    }
  });

  it("prints the established dimensions, and the recognition text states the same ones", () => {
    const printed = (id: string) =>
      [...render({ system: { id: id as never } }).matchAll(/(\d+)\s*мм<\/text>/g)].map(
        (match) => match[1],
      );

    for (const system of SHAPED) {
      for (const value of printed(system.id)) {
        expect(system.recognise, `${system.id} prints ${value} мм`).toContain(`${value} мм`);
      }
    }
    expect(printed("nespresso-original")).toEqual(["37", "28"]);
    expect(printed("dolce-gusto")).toEqual(["54", "36"]);
    expect(printed("a-modo-mio")).toEqual(["47", "17"]);
    expect(printed("caffitaly")).toEqual(["45", "27"]);
    expect(printed("lavazza-blue")).toEqual(["47", "26"]);
    /* The pod's thickness is not established, so only its diameter is printed. */
    expect(printed("ese-pod")).toEqual(["44"]);
  });

  it("leaves dimensions and view labels out of the compact drawing", () => {
    for (const system of SHAPED) {
      expect(render({ system, variant: "compact", decorative: true })).not.toContain("<text");
    }
  });

  it("draws every system at one scale, and the widest plate fits its 320 px column", () => {
    const size = (html: string) => {
      const viewBoxWidth = Number(/viewBox="0 0 ([\d.]+) [\d.]+"/.exec(html)?.[1]);
      const remWidth = Number(/width:([\d.]+)rem/.exec(html)?.[1]);
      return { pxPerMm: remWidth / viewBoxWidth, px: remWidth * 16 };
    };
    for (const variant of ["full", "compact"] as const) {
      const scales = SHAPED.map((system) => size(render({ system, variant })).pxPerMm);
      for (const scale of scales) expect(scale).toBeCloseTo(scales[0]!, 6);
    }
    for (const system of SHAPED) {
      expect(size(render({ system })).px, system.id).toBeLessThanOrEqual(320);
    }
  });

  it("fits every outline inside the shared compact frame", () => {
    for (const [id, outline] of Object.entries(CAPSULE_OUTLINES)) {
      const half = halfProfile(outline);
      const maxX = Math.max(...half.map(([x]) => x));
      expect(COMPACT_FRAME.axis - maxX, id).toBeGreaterThanOrEqual(0);
      expect(COMPACT_FRAME.axis + maxX, id).toBeLessThanOrEqual(COMPACT_FRAME.width);
      expect(COMPACT_FRAME.base - outline.height.mm, id).toBeGreaterThanOrEqual(0);
    }
    expect(COMPACT_FRAME.base).toBeLessThanOrEqual(COMPACT_FRAME.height);
  });
});

describe("capsule outlines", () => {
  it.each(Object.entries(CAPSULE_OUTLINES))(
    "%s is a closed outline in millimetres",
    (id, outline) => {
      const half = halfProfile(outline);
      /* From the centre of the lid to the centre of the base. */
      expect(half[0], id).toEqual([0, 0]);
      expect(half.at(-1), id).toEqual([0, outline.height.mm]);
      for (const [x, y] of half) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(outline.height.mm);
      }
      /* The declared width is the outline's own, so an icon can scale by it. */
      expect(Math.max(...half.map(([x]) => x)) * 2).toBeCloseTo(outline.width, 6);
      expect(sideOutlinePath(outline)).toMatch(/^M0 0L.*Z$/);
      expect(
        outline.profile.some((run) => run.feature),
        id,
      ).toBe(true);
    },
  );

  it("prints a figure only as the outline's own measurement, rounded", () => {
    for (const [id, outline] of Object.entries(CAPSULE_OUTLINES)) {
      for (const measure of [outline.diameter, outline.height]) {
        if (!measure.printed) continue;
        expect(measure.printed, id).toBe(`${Math.round(measure.mm)} мм`);
      }
    }
  });
});
