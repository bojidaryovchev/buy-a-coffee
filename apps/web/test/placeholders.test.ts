import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every placeholder a person reads is Bulgarian (DESIGN.md, "Inputs"): it says
 * what to type, and an example of a format starts with „Напр.“ so it is never
 * mistaken for a value already filled in. Read from the source, so a new field
 * with an English or bare example fails here rather than in front of a customer.
 */

const SRC = path.resolve(import.meta.dirname, "../src");

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return files(full);
    return /\.tsx$/.test(entry.name) ? [full] : [];
  });
}

const placeholders = files(SRC).flatMap((file) =>
  [...readFileSync(file, "utf8").matchAll(/placeholder="([^"]*)"/g)].map((match) => ({
    where: path.relative(SRC, file),
    text: match[1] ?? "",
  })),
);

describe("placeholders", () => {
  it("are found, so this test reads something", () => {
    expect(placeholders.length).toBeGreaterThan(1);
  });

  it("are written in Bulgarian", () => {
    for (const { where, text } of placeholders) {
      expect(/\p{Script=Cyrillic}/u.test(text), `${where}: "${text}"`).toBe(true);
    }
  });

  it("mark an example of a format with „Напр.“ when it starts with a digit", () => {
    for (const { where, text } of placeholders) {
      if (/\d/.test(text)) expect(text, where).toMatch(/^Напр\. /);
    }
  });
});
