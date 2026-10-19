import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { INDEXABLE, NOINDEX, robotsFor } from "@/lib/seo/robots";

/*
 * The robots directive of every storefront page (`lib/seo/robots.ts`).
 *
 * Next merges metadata key by key and a present key replaces the parent's,
 * `undefined` included. Product, category, brand, wizard and vending pages once
 * wrote `robots: indexable ? undefined : {…}` to mean "inherit", and so went
 * out with no robots tag and no `max-image-preview:large` at all. This holds
 * the values, and reads the source for the pattern that caused it.
 */

describe("the directives", () => {
  it("indexes and follows, with large image previews, on an indexable page", () => {
    expect(INDEXABLE).toMatchObject({
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, "max-image-preview": "large" },
    });
  });

  it("keeps a page out of the index without cutting the links on it", () => {
    expect(NOINDEX).toEqual({ index: false, follow: true });
  });

  it("is always stated: robotsFor never answers undefined", () => {
    expect(robotsFor(true)).toBe(INDEXABLE);
    expect(robotsFor(false)).toBe(NOINDEX);
  });
});

const WEB = path.resolve(import.meta.dirname, "..");
const STOREFRONT = path.join(WEB, "src/app/(site)/[lang]");
const relative = (file: string) => path.relative(WEB, file).split(path.sep).join("/");

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

/** The source with comments blanked. */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, (_, before: string) => before);
}

/**
 * The one page with a directive of its own: the newsletter unsubscribe page
 * carries a personal token in its URL, so its links are not followed either.
 */
const OWN_DIRECTIVE = new Set(["src/app/(site)/[lang]/byuletin/otpisvane/page.tsx"]);

describe("the storefront's pages", () => {
  const sources = files(STOREFRONT).map((file) => ({ file: relative(file), source: code(file) }));
  const declaring = sources.filter(({ source }) => /\brobots\s*:/.test(source));

  it("are found, and many of them state a directive", () => {
    expect(sources.length).toBeGreaterThan(20);
    expect(declaring.length).toBeGreaterThan(10);
  });

  it("never write `robots: undefined`, which erases the layout's directive", () => {
    const erasing = sources
      .filter(({ source }) =>
        /\brobots\s*:[^,}]*\bundefined\b|\brobots\s*:\s*[^,}]*\?\s*undefined/.test(source),
      )
      .map(({ file }) => file);
    expect(erasing).toEqual([]);
  });

  it("state it through lib/seo/robots, never by hand", () => {
    const byHand = declaring
      .filter(({ file }) => !OWN_DIRECTIVE.has(file))
      .filter(({ source }) =>
        [...source.matchAll(/\brobots\s*:\s*([^,}\n]+)/g)].some(
          ([, value]) => !/^(INDEXABLE|NOINDEX|robotsFor\()/.test(value!.trim()),
        ),
      )
      .map(({ file }) => file);
    expect(byHand).toEqual([]);
  });
});
