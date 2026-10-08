import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ARTICLES } from "../content/journal";
import { MACHINE_BRANDS } from "@/content/machines";
import { STRENGTH_ORDER } from "@/lib/catalog/attributes";
import { EMPTY_JOURNAL_FIGURES, type JournalFigures } from "@/lib/catalog/journal-figures";
import {
  articleDate,
  collectLinks,
  formatArticleDate,
  getArticle,
  headingLevels,
  listArticles,
  plainText,
} from "@/lib/journal";
import { BREWING_SYSTEMS, systemsForMethod } from "@/lib/recommend/systems";
import { referencesSource } from "../e2e/support/source-guard";
import { FIXTURE_FIGURES, FIXTURE_ROWS } from "./journal-fixtures";

/**
 * Content test for the journal.
 *
 * Every article is checked twice: against a populated catalog and against an
 * empty one. The second pass is the one that matters most — it is what a
 * reader gets if the catalog cannot be read, and it is the proof that no
 * sentence depends on a figure being there.
 */

const VARIANTS: ReadonlyArray<{ readonly label: string; readonly figures: JournalFigures }> = [
  { label: "with catalog figures", figures: FIXTURE_FIGURES },
  { label: "with no catalog figures", figures: EMPTY_JOURNAL_FIGURES },
];

/**
 * Today's date where the shop is.
 *
 * Articles carry calendar dates, so "not in the future" is a comparison of
 * calendar dates in Bulgaria — not of instants, which would call an article
 * published this morning in Sofia a day early for as long as UTC is still on
 * yesterday.
 */
function shopCalendarDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Sofia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/* --- The site's real routes ---------------------------------------------- *
 *
 * Read from the `app` directory rather than listed here, so a route that is
 * renamed or removed fails this test instead of leaving a dead link behind.
 */

const SITE_ROOT = path.resolve(import.meta.dirname, "../src/app/(site)");

function discoverRoutes(directory: string, segments: readonly string[] = []): string[][] {
  const routes: string[][] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === "page.tsx") routes.push([...segments]);
    if (entry.isDirectory()) {
      // Route groups — `(name)` — do not appear in the URL.
      const next = /^\(.+\)$/.test(entry.name) ? segments : [...segments, entry.name];
      routes.push(...discoverRoutes(path.join(directory, entry.name), next));
    }
  }
  return routes;
}

const ROUTES = discoverRoutes(SITE_ROOT);
const routeKey = (segments: readonly string[]): string => `/${segments.join("/")}`;

/** What may fill each dynamic segment, keyed by the route it belongs to. */
const DYNAMIC_VALUES: Readonly<Record<string, () => ReadonlySet<string>>> = {
  "/journal/[slug]": () => new Set(ARTICLES.map((article) => article.slug)),
  "/wizard/machines/[brand]": () => new Set(MACHINE_BRANDS.map((brand) => brand.slug)),
  "/categories/[slug]": () => new Set(BREWING_SYSTEMS.flatMap((system) => system.categorySlugs)),
  // Product links only ever come out of the catalog figures.
  "/products/[slug]": () => new Set(FIXTURE_ROWS.map((entry) => entry.slug)),
};

/** Null when the link resolves; otherwise the reason it does not. */
function linkProblem(href: string): string | null {
  if (!href.startsWith("/")) return "not a site-relative path";
  if (/[?#]/.test(href)) return "carries a query or fragment";
  if (href !== "/" && href.endsWith("/")) return "has a trailing slash";

  const segments = href.split("/").filter(Boolean);

  for (const route of ROUTES) {
    if (route.length !== segments.length) continue;

    // The fixed segments decide which route this is; only then is the
    // dynamic one checked against the values that route can take.
    const isDynamic = (pattern: string): boolean => pattern.startsWith("[");
    if (!route.every((pattern, index) => isDynamic(pattern) || pattern === segments[index])) {
      continue;
    }
    if (!route.some(isDynamic)) return null;

    const allowed = DYNAMIC_VALUES[routeKey(route)];
    if (!allowed) return `route ${routeKey(route)} has no known values in this test`;
    const known = allowed();
    const unknown = segments.filter(
      (_, index) => isDynamic(route[index]!) && !known.has(segments[index]!),
    );
    return unknown.length === 0
      ? null
      : `unknown slug "${unknown.join("/")}" for ${routeKey(route)}`;
  }

  return "matches no route";
}

describe("journal: the link checker itself", () => {
  it("discovers the routes it is about to rely on", () => {
    const keys = ROUTES.map(routeKey);
    expect(keys).toContain("/wizard");
    expect(keys).toContain("/wizard/machines");
    expect(keys).toContain("/wizard/machines/[brand]");
    expect(keys).toContain("/categories/[slug]");
    expect(keys).toContain("/journal/[slug]");
  });

  it("accepts real targets and rejects invented ones", () => {
    expect(linkProblem("/wizard")).toBeNull();
    expect(linkProblem("/wizard/machines/krups")).toBeNull();
    expect(linkProblem("/categories/nespresso")).toBeNull();
    expect(linkProblem("/wizard/machines/not-a-brand")).not.toBeNull();
    expect(linkProblem("/categories/not-a-category")).not.toBeNull();
    expect(linkProblem("/journal/not-an-article")).not.toBeNull();
    expect(linkProblem("/no-such-page")).not.toBeNull();
    expect(linkProblem("https://example.com/")).not.toBeNull();
    expect(linkProblem("/wizard?brew=beans")).not.toBeNull();
  });
});

describe("journal: the set of articles", () => {
  it("is no longer empty", () => {
    expect(ARTICLES.length).toBeGreaterThanOrEqual(4);
  });

  it("has unique, URL-safe slugs", () => {
    const slugs = ARTICLES.map((article) => article.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) {
      expect(slug, slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(slug.length, slug).toBeLessThanOrEqual(80);
      expect(encodeURIComponent(slug), slug).toBe(slug);
    }
  });

  it("has unique titles and descriptions", () => {
    expect(new Set(ARTICLES.map((article) => article.title)).size).toBe(ARTICLES.length);
    expect(new Set(ARTICLES.map((article) => article.description)).size).toBe(ARTICLES.length);
  });

  it("is listed newest first, same-day articles in written order", () => {
    const listed = listArticles();
    expect(listed.map((article) => article.slug).sort()).toEqual(
      ARTICLES.map((article) => article.slug).sort(),
    );
    for (let index = 1; index < listed.length; index += 1) {
      expect(listed[index - 1]!.publishedAt >= listed[index]!.publishedAt).toBe(true);
    }
    const sameDay = listed.filter((article) => article.publishedAt === listed[0]!.publishedAt);
    const written = ARTICLES.filter((article) => article.publishedAt === listed[0]!.publishedAt);
    expect(sameDay.map((article) => article.slug)).toEqual(written.map((article) => article.slug));
  });

  it("honours a teaser limit and looks articles up by slug", () => {
    expect(listArticles({ limit: 2 })).toHaveLength(2);
    expect(listArticles({ limit: 0 })).toHaveLength(0);
    expect(getArticle(ARTICLES[0]!.slug)).toBe(ARTICLES[0]);
    expect(getArticle("not-an-article")).toBeNull();
    expect(getArticle(null)).toBeNull();
  });

  it("gives every listing an href under /journal", () => {
    for (const article of listArticles()) {
      expect(article.href).toBe(`/journal/${article.slug}`);
      expect(linkProblem(article.href)).toBeNull();
    }
  });
});

describe.each(ARTICLES.map((article) => [article.slug, article] as const))(
  "journal article %s",
  (_slug, article) => {
    it("has a real publication date that is not in the future", () => {
      const today = shopCalendarDate(new Date());
      for (const value of [article.publishedAt, article.updatedAt]) {
        if (value === undefined) continue;
        expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        const date = articleDate(value);
        expect(Number.isNaN(date.getTime())).toBe(false);
        // Round-tripping rejects dates such as 2026-02-30.
        expect(date.toISOString().slice(0, 10)).toBe(value);
        expect(value <= today, `${value} is after ${today}`).toBe(true);
        expect(formatArticleDate(value)).toMatch(/\d{4}/);
      }
      if (article.updatedAt !== undefined) {
        expect(article.updatedAt >= article.publishedAt).toBe(true);
      }
    });

    it("has exactly one top-level title, in Bulgarian, and a usable description", () => {
      expect(article.title.trim()).toBe(article.title);
      expect(article.title.length).toBeGreaterThan(10);
      expect(article.title.length).toBeLessThanOrEqual(70);
      expect(article.title).toMatch(/[а-я]/i);
      expect(article.description).toMatch(/[а-я]/i);
      expect(article.description.length).toBeGreaterThanOrEqual(70);
      expect(article.description.length).toBeLessThanOrEqual(220);
    });

    describe.each(VARIANTS)("$label", ({ figures }) => {
      const blocks = article.body(figures);
      const text = plainText(blocks);

      it("has a body with real prose in it", () => {
        expect(blocks.length).toBeGreaterThan(5);
        expect(text.length).toBeGreaterThan(1200);
        expect(text).toMatch(/[а-я]/i);
      });

      it("never repeats the title as a heading and never skips a level", () => {
        const levels = headingLevels(blocks);
        expect(levels.length).toBeGreaterThan(0);

        // The title is the page's h1, so the body opens at 2 and may only go
        // one level deeper at a time.
        let previous = 1;
        for (const level of levels) {
          expect(level).toBeGreaterThanOrEqual(2);
          expect(level - previous).toBeLessThanOrEqual(1);
          previous = level;
        }

        const headings = blocks.flatMap((block) => (block.type === "heading" ? [block.text] : []));
        expect(headings).not.toContain(article.title);
        expect(new Set(headings).size).toBe(headings.length);
      });

      it("opens with a paragraph, not a heading", () => {
        expect(blocks[0]?.type).toBe("paragraph");
      });

      it("links only to routes and slugs that exist", () => {
        const links = collectLinks(blocks);
        expect(links.length).toBeGreaterThan(0);
        for (const href of links) {
          expect(linkProblem(href), `${href}`).toBeNull();
        }
      });

      it("leads into the wizard, the machine pages or the catalog", () => {
        const links = collectLinks(blocks);
        expect(
          links.some(
            (href) =>
              href === "/wizard" ||
              href.startsWith("/wizard/machines") ||
              href.startsWith("/categories/"),
          ),
        ).toBe(true);
      });

      it("does not link to itself", () => {
        expect(collectLinks(blocks)).not.toContain(`/journal/${article.slug}`);
      });

      it("never names the mirrored shop", () => {
        expect(referencesSource(text)).toBe(false);
        expect(referencesSource(article.title)).toBe(false);
        expect(referencesSource(article.description)).toBe(false);
        expect(referencesSource(article.slug)).toBe(false);
      });

      it("reads as finished text", () => {
        // What a missing figure or a bad join leaves behind.
        expect(text).not.toMatch(/undefined|null|NaN|\[object/);
        expect(text).not.toMatch(/ {2,}/);
        expect(text).not.toMatch(/\s[.,;:]/);
        expect(text).not.toMatch(/[,;:]\./);
        expect(text).not.toMatch(/\.\.(?!\.)/);
        expect(text).not.toMatch(/\(\s*\)/);

        for (const block of blocks) {
          if (block.type === "paragraph" || block.type === "callout") {
            expect(plainText([block]).trim().length).toBeGreaterThan(0);
          }
          if (block.type === "list") expect(block.items.length).toBeGreaterThan(0);
          if (block.type === "table") {
            expect(block.rows.length).toBeGreaterThan(0);
            for (const cells of block.rows) expect(cells).toHaveLength(block.columns.length);
          }
        }
      });

      it("types no price into its prose", () => {
        if (figures !== EMPTY_JOURNAL_FIGURES) return;
        // With no catalog there is nothing a price could have been computed
        // from, so any amount on the page was typed by hand.
        expect(text).not.toMatch(/€|EUR|лв/);
        expect(text).not.toMatch(/\d+[.,]\d{2}\b/);
      });
    });

    it("reads no catalog figures unless it says it does", () => {
      if (article.usesCatalog) return;
      expect(article.body(FIXTURE_FIGURES)).toEqual(article.body(EMPTY_JOURNAL_FIGURES));
    });
  },
);

/* --- Claims that are typed, pinned to the data they rest on --------------- *
 *
 * A few sentences state a number in words — "five systems", "three steps".
 * They are true today; these tests make them fail loudly on the day the data
 * stops agreeing, instead of leaving a wrong sentence in a published article.
 */
describe("journal: typed claims still match the data", () => {
  it("there are five capsule systems", () => {
    expect(systemsForMethod("capsule")).toHaveLength(5);
  });

  it("the shop's own strength filter has three steps", () => {
    expect(STRENGTH_ORDER).toHaveLength(3);
  });

  it("Krups makes machines for exactly three systems", () => {
    const krups = MACHINE_BRANDS.find((brand) => brand.slug === "krups");
    expect(new Set(krups?.models.map((model) => model.system))).toEqual(
      new Set(["dolce-gusto", "nespresso-original", "beans"]),
    );
  });

  it("every machine the capsule article names is in the machine database", () => {
    const names = MACHINE_BRANDS.flatMap((brand) =>
      brand.models.map((model) => `${brand.name} ${model.name}`),
    ).join("\n");
    for (const mention of [
      "Dolce Gusto Piccolo",
      "Dolce Gusto Genio",
      "Dolce Gusto Mini Me",
      "Dolce Gusto Infinissima",
      "Smeg for Lavazza A Modo Mio",
      "Cafissimo",
      "Blue Classy",
      "De'Longhi Dedica",
      "Gaggia Classic",
      "VeroCup",
      "Tassimo",
    ]) {
      expect(names, mention).toContain(mention);
    }
  });
});
