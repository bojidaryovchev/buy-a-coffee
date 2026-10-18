import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SystemBadge } from "@/components/catalog/system-badge";
import { SystemIcon } from "@/components/catalog/system-icon";
import { ICON_BOX, SYSTEM_ICONS, systemIconShape } from "@/components/catalog/system-icons";
import { CAPSULE_OUTLINES, type DiagramSystemId } from "@/components/wizard/capsule-outlines";
import { BREWING_SYSTEMS } from "@/lib/recommend/systems";

/**
 * The system icon (DESIGN.md, "System icon"): our own capsule outline, derived
 * from the machine finder's data, in the system's colour, never alone.
 */

const CAPSULES = Object.keys(CAPSULE_OUTLINES).filter(
  (id) => !CAPSULE_OUTLINES[id as DiagramSystemId].top,
) as DiagramSystemId[];

/** Every number in a path, as x/y pairs where the path is made of M/L pairs. */
function points(d: string): Array<[number, number]> {
  const numbers = d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) out.push([numbers[i]!, numbers[i + 1]!]);
  return out;
}

describe("system icons", () => {
  it("draws one for every brewing system, and the seven differ", () => {
    for (const system of BREWING_SYSTEMS) {
      expect(systemIconShape(system.id), system.id).not.toBeNull();
    }
    const paths = BREWING_SYSTEMS.map((system) => SYSTEM_ICONS[system.id].d);
    expect(new Set(paths).size).toBe(BREWING_SYSTEMS.length);
    expect(systemIconShape("vertuo")).toBeNull();
  });

  it("keeps every shape inside the icon's box", () => {
    for (const [id, shape] of Object.entries(SYSTEM_ICONS)) {
      const { x, y, w, h } = shape.bounds;
      expect(x, id).toBeGreaterThanOrEqual(0);
      expect(y, id).toBeGreaterThanOrEqual(0);
      expect(x + w, id).toBeLessThanOrEqual(ICON_BOX.width + 1e-9);
      expect(y + h, id).toBeLessThanOrEqual(ICON_BOX.height + 1e-9);
    }
  });

  it("draws each capsule from its outline, full width, in its own proportions", () => {
    for (const id of CAPSULES) {
      const outline = CAPSULE_OUTLINES[id];
      const { w, h } = SYSTEM_ICONS[id].bounds;
      expect(w, id).toBeCloseTo(ICON_BOX.width, 1);
      // Height to width as the capsule's, to within the rounding of the path.
      expect(h / w, id).toBeCloseTo(outline.height.mm / outline.width, 2);
      // The ink stays on the path's own coordinates: lid at the top of the box.
      for (const [px, py] of points(SYSTEM_ICONS[id].d)) {
        expect(px, id).toBeGreaterThanOrEqual(0);
        expect(py, id).toBeLessThanOrEqual(ICON_BOX.height);
      }
    }
    // The tell between look-alikes survives: A Modo Mio is the shallowest,
    // Nespresso the deepest for its width.
    const ratio = (id: DiagramSystemId) => SYSTEM_ICONS[id].bounds.h / SYSTEM_ICONS[id].bounds.w;
    expect(Math.min(...CAPSULES.map(ratio))).toBe(ratio("a-modo-mio"));
    expect(Math.max(...CAPSULES.map(ratio))).toBe(ratio("nespresso-original"));
  });

  it("cuts Caffitaly's groove through the body, and only Caffitaly's", () => {
    const subpaths = (id: DiagramSystemId) => SYSTEM_ICONS[id].d.match(/M/g)?.length;
    expect(subpaths("caffitaly")).toBe(2);
    for (const id of CAPSULES.filter((id) => id !== "caffitaly")) expect(subpaths(id), id).toBe(1);
  });

  it("draws the ESE pod from above: a disc inside a ring", () => {
    // Three circles: the ring's outside and inside, and the coffee.
    expect(SYSTEM_ICONS["ese-pod"].d.match(/M/g)).toHaveLength(3);
    expect(SYSTEM_ICONS["ese-pod"].bounds.h).toBe(ICON_BOX.height);
  });
});

describe("SystemIcon", () => {
  const html = (systemId: string, size?: "sm" | "md" | "lg") =>
    renderToStaticMarkup(createElement(SystemIcon, { systemId, ...(size ? { size } : {}) }));

  it("is decorative and coloured by the system's token", () => {
    const markup = html("caffitaly");
    expect(markup).toMatch(/^<svg aria-hidden="true" focusable="false"/);
    expect(markup).toContain(`viewBox="0 0 ${ICON_BOX.width} ${ICON_BOX.height}"`);
    expect(markup).toContain("fill-(--system)");
    expect(markup).toContain('data-system-icon="caffitaly"');
    expect(markup).toContain(`d="${SYSTEM_ICONS.caffitaly.d}"`);
  });

  it("is 12, 16 or 32 px tall, five wide to four tall", () => {
    expect(html("beans", "sm")).toContain("h-3 w-3.75");
    expect(html("beans")).toContain("h-4 w-5");
    expect(html("beans", "lg")).toContain("h-8 w-10");
  });

  it("renders nothing for a system it has no drawing for", () => {
    expect(html("vertuo")).toBe("");
  });
});

describe("SystemBadge", () => {
  it("puts the system's icon before its name", () => {
    for (const system of BREWING_SYSTEMS) {
      const markup = renderToStaticMarkup(createElement(SystemBadge, { systemId: system.id }));
      expect(markup).toMatch(
        new RegExp(`data-system-icon="${system.id}"[^]*?</svg><span[^>]*>${system.name}</span>`),
      );
    }
  });

  it("is a 44 px target below lg where it links, the badge itself unchanged", () => {
    const markup = renderToStaticMarkup(
      createElement(SystemBadge, { systemId: "dolce-gusto", size: "md", href: "/bg/x" }),
    );
    expect(markup).toMatch(/^<a [^>]*class="[^"]*\bmin-h-11\b[^"]*\blg:min-h-6\b/);
    expect(markup).toMatch(/<span class="[^"]*bg-\(--system-wash\)[^"]*min-h-6/);
  });

  it("in a table cell, pads to 44 px instead of growing the row", () => {
    const markup = renderToStaticMarkup(
      createElement(SystemBadge, { systemId: "beans", size: "md", href: "/bg/x", target: "pad" }),
    );
    expect(markup).toMatch(/^<a [^>]*class="[^"]*-my-2\.5 py-2\.5 lg:my-0 lg:py-0/);
    expect(markup).not.toContain("min-h-11");
  });
});

/* No square is left: the system marker is the icon everywhere it is drawn. */
describe("the system marker", () => {
  const SRC = path.resolve(import.meta.dirname, "../src");
  const files = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) return files(full);
      return /\.tsx?$/.test(entry.name) ? [full] : [];
    });

  it("is never a coloured square", () => {
    const offenders = files(SRC).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .map((line, index) => ({ line, at: `${path.relative(SRC, file)}:${index + 1}` }))
        .filter(({ line }) => /\bbg-\(--system\)/.test(line))
        .map(({ at }) => at),
    );
    expect(offenders).toEqual([]);
  });
});
