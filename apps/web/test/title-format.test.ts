import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { siteConfig } from "@/config/site";
import { pageTitle } from "@/lib/seo/listing-meta";
import { TITLE_TEMPLATE, fullTitle } from "@/lib/seo/title";

/*
 * One title format across the storefront: the page's own words, a bar, the
 * shop's name (`docs/seo.md` §12).
 *
 * A page gets there through the layout's template or through `pageTitle`, and
 * both are `fullTitle` in `lib/seo/title.ts`. The first half of this file
 * holds those two together. The second reads the source, because the way this
 * breaks is somebody typing a separator into a page: a dash before the name in
 * a share title, or a template of a route's own.
 */

describe("the title format", () => {
  it("ends a title with a bar and the shop's name", () => {
    expect(fullTitle("Кафе на зърна")).toBe(`Кафе на зърна | ${siteConfig.name}`);
    expect(fullTitle("x")).toMatch(/^x \| \S/);
  });

  it("gives the layout's template and an absolute title the same ending", () => {
    expect(TITLE_TEMPLATE).toBe(`%s | ${siteConfig.name}`);
    const viaTemplate = TITLE_TEMPLATE.replace("%s", "Безкофеиново кафе");
    expect(pageTitle("Безкофеиново кафе")).toEqual({ absolute: viaTemplate });
  });
});

const WEB = path.resolve(import.meta.dirname, "..");
const relative = (file: string) => path.relative(WEB, file).split(path.sep).join("/");

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

/** The source with comments blanked, keeping line numbers. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`])\/\/.*$/gm, (_, before: string) => before);
}

/* Everything a storefront page is built from. The admin panel titles itself. */
const STOREFRONT = files(path.join(WEB, "src"))
  .concat(files(path.join(WEB, "content")))
  .filter((file) => !relative(file).startsWith("src/app/(admin)/"));

describe("the title format, in the source", () => {
  it("is used by the storefront layout's template", () => {
    const layout = readFileSync(path.join(WEB, "src/app/(site)/[lang]/layout.tsx"), "utf8");
    expect(code(layout)).toMatch(/template:\s*TITLE_TEMPLATE\b/);
  });

  it("is spelled in one file: nothing else puts a separator before the shop's name", () => {
    // `… — ${siteConfig.name}`, `… | ${siteConfig.name}`, `%s — …`: a title
    // ending built by hand. `${siteConfig.name} — tagline`, where the name
    // leads, is the home page's default title and is not an ending.
    const ending = /[—–|-]\s*\$\{\s*siteConfig\.name\s*\}|%s\s*[—–|-]/;
    const found = STOREFRONT.filter((file) => relative(file) !== "src/lib/seo/title.ts").flatMap(
      (file) =>
        code(readFileSync(file, "utf8"))
          .split("\n")
          .flatMap((line, index) =>
            ending.test(line) ? [`${relative(file)}:${index + 1}: ${line.trim()}`] : [],
          ),
    );
    expect(found).toEqual([]);
  });

  it("leaves no route with a title template of its own", () => {
    const found = STOREFRONT.filter(
      (file) => relative(file) !== "src/app/(site)/[lang]/layout.tsx",
    ).filter((file) => /\btemplate:\s*[`"']/.test(code(readFileSync(file, "utf8"))));
    expect(found.map(relative)).toEqual([]);
  });
});
