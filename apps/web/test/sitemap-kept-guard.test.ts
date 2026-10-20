import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Nothing in the app may expire the cache entries the sitemap route reads.
 *
 * The route's copies (`lib/seo/sitemap-copy.ts`) live in Next.js's data cache,
 * and every entry the route reads carries the route's implicit tags as soft
 * tags: `_N_T_/sitemap.xml`, `_N_T_/sitemap.xml/route`, `_N_T_/layout`. So
 * `revalidatePath("/sitemap.xml")` — or a layout revalidated, which reaches
 * every route under it, the root one included — would expire the kept copy
 * as well, and the first draw to fail after it would find nothing to stand in.
 * The sitemap is revalidated by its own tag instead (`SITEMAP_TAG`). The shop's
 * pages are revalidated page by page for the same reason
 * (`lib/revalidate-shop.ts`), and `/api/revalidate` refuses any path that is
 * not a page of the shop.
 *
 * This reads the source, every `revalidatePath` and `revalidateTag` call in
 * it, and fails on one that names the sitemap, a layout or an implicit tag.
 */

const SRC = path.resolve(import.meta.dirname, "../src");

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

/** The source with comments blanked, keeping line numbers. */
const code = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`])\/\/.*$/gm, (_, before: string) => before);

/** Each call to `name`, with its argument text (balanced parentheses). */
function calls(source: string, name: string): string[] {
  const found: string[] = [];
  const opener = new RegExp(`\\b${name}\\(`, "g");
  for (const match of source.matchAll(opener)) {
    let depth = 1;
    let at = match.index + match[0].length;
    const start = at;
    while (at < source.length && depth > 0) {
      if (source[at] === "(") depth += 1;
      else if (source[at] === ")") depth -= 1;
      at += 1;
    }
    found.push(source.slice(start, at - 1));
  }
  return found;
}

/** What a call's arguments must not say, and why. */
function problems(name: "revalidatePath" | "revalidateTag", args: string): string[] {
  const found: string[] = [];
  if (name === "revalidatePath") {
    if (/sitemap|SITEMAP_PATH/i.test(args)) found.push("names the sitemap");
    if (/,\s*["'`]layout["'`]/.test(args)) found.push("revalidates a layout");
  }
  if (/_N_T_|NEXT_CACHE_IMPLICIT_TAG_ID/.test(args)) found.push("names an implicit tag");
  return found;
}

function scan(): string[] {
  const findings: string[] = [];
  for (const file of files(SRC)) {
    const source = code(readFileSync(file, "utf8"));
    for (const name of ["revalidatePath", "revalidateTag"] as const) {
      for (const args of calls(source, name)) {
        for (const problem of problems(name, args)) {
          findings.push(`${path.relative(SRC, file)}: ${name}(${args.trim()}) ${problem}`);
        }
      }
    }
  }
  return findings;
}

describe("the sitemap's kept copy", () => {
  it("is expired by nothing in the app: no revalidatePath of the sitemap or a layout", () => {
    expect(scan()).toEqual([]);
  });

  it("would be caught if one were written", () => {
    const written = [
      ["revalidatePath", `"/sitemap.xml"`],
      ["revalidatePath", "SITEMAP_PATH"],
      ["revalidatePath", `"/(site)/[lang]", "layout"`],
      ["revalidatePath", `"/", 'layout'`],
      ["revalidateTag", '`_N_T_/sitemap.xml`, "max"'],
    ] as const;
    for (const [name, args] of written) expect(problems(name, args), args).not.toEqual([]);

    // And what the shop does write passes.
    expect(problems("revalidatePath", '`${SHOP_ROOT}${route}`, "page"')).toEqual([]);
    expect(problems("revalidatePath", "LLMS_PATH")).toEqual([]);
    expect(problems("revalidateTag", "SITEMAP_TAG, { expire: 0 }")).toEqual([]);
  });

  it("reads every call, arguments with parentheses in them included", () => {
    expect(
      calls(
        `revalidatePath(href(locale, "/x"), "page"); revalidateTag(t, { expire: 0 })`,
        "revalidatePath",
      ),
    ).toEqual([`href(locale, "/x"), "page"`]);
  });
});
