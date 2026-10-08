import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CapsuleDiagram,
  capsuleDiagramLabel,
  hasCapsuleDiagram,
} from "@/components/wizard/capsule-diagrams";
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

  it("prints only the dimensions the system data already states", () => {
    const printed = (id: string) =>
      [...render({ system: { id: id as never } }).matchAll(/(\d+)\s*мм<\/text>/g)].map(
        (match) => match[1],
      );

    for (const system of SHAPED) {
      for (const value of printed(system.id)) {
        expect(system.recognise, `${system.id} prints ${value} мм`).toContain(`${value} мм`);
      }
    }
    expect(printed("nespresso-original")).toEqual(["37"]);
    expect(printed("ese-pod")).toEqual(["44"]);
  });

  it("leaves dimensions and view labels out of the compact drawing", () => {
    for (const system of SHAPED) {
      expect(render({ system, variant: "compact", decorative: true })).not.toContain("<text");
    }
  });
});
