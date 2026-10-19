import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const globals = readFileSync(path.join(__dirname, "..", "src", "app", "globals.css"), "utf8");

/** Every rule (selector and body) whose body names a `view()` timeline. */
function viewTimelineRules(css: string): { selector: string; body: string }[] {
  const rules: { selector: string; body: string }[] = [];
  for (const match of css.matchAll(/([^{};]+)\{([^{}]*animation-timeline:\s*view\(\)[^{}]*)\}/g)) {
    rules.push({ selector: match[1]!.trim(), body: match[2]! });
  }
  return rules;
}

describe('scroll-driven motion (DESIGN.md, "The Quiet Load Rule")', () => {
  const rules = viewTimelineRules(globals);

  it("finds the scroll-driven rules", () => {
    expect(rules.map((rule) => rule.selector)).toEqual([
      ":root[data-motion] .intensity-fill::after",
      ":root[data-motion] .reveal-on-scroll",
      ":root[data-motion] .draw-on-scroll",
    ]);
  });

  it("waits for the flag MotionGate sets after load, for every selector in a rule", () => {
    for (const { selector } of rules) {
      for (const part of selector.split(",")) {
        expect(part.trim().startsWith(":root[data-motion] ")).toBe(true);
      }
    }
  });

  it("sits inside @supports and a no-preference motion query", () => {
    for (const { selector } of rules) {
      const before = globals.slice(0, globals.indexOf(selector));
      const supports = before.lastIndexOf("@supports (animation-timeline: view())");
      const motion = before.lastIndexOf("@media (prefers-reduced-motion: no-preference)");
      expect(supports).toBeGreaterThan(-1);
      expect(motion).toBeGreaterThan(supports);
    }
  });
});
