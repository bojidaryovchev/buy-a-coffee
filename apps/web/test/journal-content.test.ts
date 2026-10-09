import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ARTICLES } from "../content/journal";
import { ARABICA_ROBUSTA_SLUG } from "../content/journal/articles/arabica-robusta";
import { CHOOSE_BEANS_SLUG } from "../content/journal/articles/choose-beans";
import { CUP_COST_SLUG } from "../content/journal/articles/cup-cost";
import { FORMATS_SLUG } from "../content/journal/articles/formats";
import { WHICH_CAPSULE_SLUG } from "../content/journal/articles/which-capsule";
import type { Block, Inline } from "../content/journal/blocks";
import { CAPSULES_HREF, landingHref } from "../content/journal/links";
import { relatedCopy } from "../content/landing-copy";
import { LANDING_IDS, LANDING_PATHS, type LandingId } from "@/lib/catalog/landings";
import { MACHINE_BRANDS } from "@/content/machines";
import { STRENGTH_ORDER } from "@/lib/catalog/attributes";
import { EMPTY_JOURNAL_FIGURES, type JournalFigures } from "@/lib/catalog/journal-figures";
import { bg } from "@/i18n/dictionaries/bg";
import {
  JOURNAL_NAME,
  articleDate,
  collectLinks,
  formatArticleDate,
  getArticle,
  getMovedArticle,
  headingLevels,
  listArticles,
  listPreviousSlugs,
  plainText,
} from "@/lib/journal";
import { BREWING_SYSTEMS, systemsForMethod } from "@/lib/recommend/systems";
import { routes, type RouteTarget } from "@/lib/routes";
import { referencesSource } from "../e2e/support/source-guard";
import {
  ALL_LANDINGS,
  FIXTURE_FIGURES,
  FIXTURE_FIGURES_NO_LANDINGS,
  FIXTURE_ROWS,
} from "./journal-fixtures";

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
  { label: "with catalog figures and no landing listing", figures: FIXTURE_FIGURES_NO_LANDINGS },
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
 * Under `[lang]`, whose folder names are the canonical paths an article's
 * links are written in; `href` gives them a locale at render time.
 */

const SITE_ROOT = path.resolve(import.meta.dirname, "../src/app/(site)/[lang]");

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

const isDynamicSegment = (segment: string): boolean => segment.startsWith("[");

/*
 * Fixed routes before dynamic ones, as Next resolves them: `/izbor-na-kafe` is
 * the wizard, not a value of `/[slug]`. The order `readdirSync` returns is the
 * file system's — alphabetical on Windows, arbitrary on Linux — so it is
 * sorted here rather than trusted, or the first matching route would depend on
 * the machine running the test.
 */
const ROUTES = discoverRoutes(SITE_ROOT).sort(
  (a, b) =>
    a.filter(isDynamicSegment).length - b.filter(isDynamicSegment).length ||
    a.join("/").localeCompare(b.join("/")),
);
const routeKey = (segments: readonly string[]): string => `/${segments.join("/")}`;

/** What may fill each dynamic segment, keyed by the route it belongs to. */
const DYNAMIC_VALUES: Readonly<Record<string, () => ReadonlySet<string>>> = {
  "/blog/[slug]": () => new Set(ARTICLES.map((article) => article.slug)),
  "/za-kafemashina/[brand]": () => new Set(MACHINE_BRANDS.map((brand) => brand.slug)),
  /* Categories and products share the first level, and are linked by key —
     `{ category }`, `{ product }` — never by a path, which would carry one
     locale's slug into every locale. */
  "/[slug]": () => new Set(),
};

/* The brewing systems' own categories, and the capsule parent they hang off —
   the one listing no system names, linked through `CAPSULES_HREF`. */
const CAPSULE_PARENT_SLUG =
  typeof CAPSULES_HREF !== "string" && "category" in CAPSULES_HREF
    ? CAPSULES_HREF.category.slug
    : "";
const CATEGORY_SLUGS = new Set([
  ...BREWING_SYSTEMS.flatMap((system) => system.categorySlugs),
  CAPSULE_PARENT_SLUG,
]);
// Product links only ever come out of the catalog figures.
const PRODUCT_SLUGS = new Set(FIXTURE_ROWS.map((entry) => entry.slug));

/** Null when the link resolves; otherwise the reason it does not. */
function linkProblem(target: RouteTarget | string): string | null {
  if (typeof target !== "string") {
    if ("category" in target) {
      return CATEGORY_SLUGS.has(target.category.slug)
        ? null
        : `unknown category "${target.category.slug}"`;
    }
    return PRODUCT_SLUGS.has(target.product) ? null : `unknown product "${target.product}"`;
  }
  const href = target;
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
    expect(keys).toContain(routes.wizard);
    expect(keys).toContain(routes.machines);
    expect(keys).toContain("/za-kafemashina/[brand]");
    expect(keys).toContain("/[slug]");
    expect(keys).toContain("/blog/[slug]");
  });

  it("accepts real targets and rejects invented ones", () => {
    expect(linkProblem(routes.wizard)).toBeNull();
    expect(linkProblem(routes.machineBrand("krups"))).toBeNull();
    expect(linkProblem({ category: { slug: "nespresso", sourceKey: "nespresso" } })).toBeNull();
    expect(linkProblem(routes.machineBrand("not-a-brand"))).not.toBeNull();
    expect(linkProblem({ category: { slug: "not-a-category", sourceKey: null } })).not.toBeNull();
    expect(linkProblem({ product: "not-a-product" })).not.toBeNull();
    expect(linkProblem(routes.article("not-an-article"))).not.toBeNull();
    // A category reached by a bare path would be one locale's slug everywhere.
    expect(linkProblem("/nespresso")).not.toBeNull();
    expect(linkProblem("/no-such-page/at-all")).not.toBeNull();
    expect(linkProblem("https://example.com/")).not.toBeNull();
    expect(linkProblem(`${routes.wizard}?brew=beans`)).not.toBeNull();
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

  it("leads with the articles that answer a measured query", () => {
    expect(listArticles({ limit: 3 }).map((article) => article.slug)).toEqual([
      WHICH_CAPSULE_SLUG,
      CHOOSE_BEANS_SLUG,
      ARABICA_ROBUSTA_SLUG,
    ]);
  });

  it("gives every listing a canonical href under the journal", () => {
    for (const article of listArticles()) {
      expect(article.href).toBe(routes.article(article.slug));
      expect(linkProblem(article.href)).toBeNull();
    }
  });
});

/* --- Slugs an article used to have ---------------------------------------- *
 *
 * A retitled article moves to the slug of its new title and lists the old one,
 * which the article route answers with a 308. These tests keep that list from
 * ever becoming ambiguous: a previous slug that was also a live article would
 * be unreachable, and one claimed by two articles would redirect at random.
 */
describe("journal: slugs an article used to have", () => {
  const current = new Set(ARTICLES.map((article) => article.slug));
  const previous = listPreviousSlugs();

  it("are URL-safe, unique, and never a live article's slug", () => {
    expect(new Set(previous).size).toBe(previous.length);
    for (const slug of previous) {
      expect(slug, slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(current.has(slug), `${slug} is both an article and a redirect`).toBe(false);
      expect(getArticle(slug), slug).toBeNull();
    }
  });

  it("each resolve to exactly the article that lists them", () => {
    for (const article of ARTICLES) {
      for (const slug of article.previousSlugs ?? []) {
        expect(getMovedArticle(slug), slug).toBe(article);
      }
    }
    expect(getMovedArticle("not-an-article")).toBeNull();
    expect(getMovedArticle(null)).toBeNull();
    // A live slug is an article, not a move.
    expect(getMovedArticle(ARTICLES[0]!.slug)).toBeNull();
  });

  it("are left out of every listing: only the current address is advertised", () => {
    const listed = new Set(listArticles().map((article) => article.slug));
    for (const slug of previous) expect(listed.has(slug), slug).toBe(false);
  });

  it("keep the addresses the journal launched at", () => {
    // The capsule and formats articles were live under these slugs before
    // they were retitled; removing either from its list would turn an
    // indexed URL into a 404.
    expect(WHICH_CAPSULE_SLUG).toBe("vidove-kapsuli-za-kafe");
    expect(getMovedArticle("koya-kapsula-pasva-na-koya-mashina")?.slug).toBe(WHICH_CAPSULE_SLUG);
    expect(FORMATS_SLUG).toBe("kafemashina-s-kapsuli-ili-na-zarna");
    expect(getMovedArticle("zarna-kapsuli-ili-dozi")?.slug).toBe(FORMATS_SLUG);
  });
});

describe("journal: what the section is called", () => {
  it("is „Блог“ on the page and in the navigation alike", () => {
    expect(JOURNAL_NAME).toBe("Блог");
    expect(bg.nav.journal).toBe(JOURNAL_NAME);
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
        for (const target of links) {
          expect(linkProblem(target), JSON.stringify(target)).toBeNull();
        }
      });

      it("leads into the wizard, the machine pages or the catalog", () => {
        const links = collectLinks(blocks);
        expect(
          links.some(
            (target) =>
              target === routes.wizard ||
              (typeof target === "string" && target.startsWith(routes.machines)) ||
              (typeof target !== "string" && "category" in target),
          ),
        ).toBe(true);
      });

      it("links to a listing it explains", () => {
        // Articles feed categories: with or without figures, every article
        // sends the reader to at least one shelf of the catalog.
        expect(
          collectLinks(blocks).some((target) => typeof target !== "string" && "category" in target),
        ).toBe(true);
      });

      it("does not link to itself", () => {
        expect(collectLinks(blocks)).not.toContain(routes.article(article.slug));
      });

      it("never names the mirrored shop", () => {
        expect(referencesSource(text)).toBe(false);
        expect(referencesSource(article.title)).toBe(false);
        expect(referencesSource(article.description)).toBe(false);
        expect(referencesSource(article.slug)).toBe(false);
      });

      it("ranks nothing and shouts nothing", () => {
        // PRODUCT.md: no quality ranking, no superlatives, no exclamation
        // marks. „най-доброто“ may be quoted as the question people ask —
        // the beans article opens by declining to answer it — but nothing
        // is ever called that.
        const said = `${article.title}\n${article.description}\n${text}`;
        expect(said).not.toMatch(/!/);
        expect(said).not.toMatch(/оригинал/i);
        expect(said.replace(/„[^“]*“/g, "")).not.toMatch(/най-добр|най-хубав|най-качествен/i);
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

/* --- Links to the landing listings ----------------------------------------- *
 *
 * A landing listing is a page only while it has products, so an article links
 * to one only while it exists (`figures.landings`), and reads as a finished
 * sentence when it does not. Each row is one link the market study asks for
 * (`docs/seo.md` §13.4): the article, the landing, the anchor, and the heading
 * of the section the link stands in.
 */
describe("journal: links to the landing listings", () => {
  const EXPECTED: ReadonlyArray<{
    readonly article: string;
    readonly landing: LandingId;
    readonly anchor: string;
    /** The `h2` the link stands under. */
    readonly section: string;
  }> = [
    {
      article: WHICH_CAPSULE_SLUG,
      landing: "lavazzaCapsules",
      anchor: "капсули Lavazza",
      section: "Марката на машината не е достатъчна",
    },
    {
      article: CHOOSE_BEANS_SLUG,
      landing: "decaf",
      anchor: "кафе без кофеин",
      section: "Съставът: арабика, робуста или смес",
    },
    {
      article: ARABICA_ROBUSTA_SLUG,
      landing: "decaf",
      anchor: "Безкофеиновото кафе",
      section: "Кофеинът",
    },
    {
      article: CHOOSE_BEANS_SLUG,
      landing: "cheapest",
      anchor: relatedCopy.cheapest,
      section: "Цената за килограм",
    },
    {
      article: FORMATS_SLUG,
      landing: "cheapest",
      anchor: relatedCopy.cheapest,
      section: "Как да решите",
    },
    {
      article: CUP_COST_SLUG,
      landing: "cheapest",
      anchor: relatedCopy.cheapest,
      section: "Какво излиза в момента",
    },
  ];

  /** Every link in a body, with the `h2` it stands under. */
  function linksBySection(blocks: readonly Block[]) {
    const found: Array<{ section: string | null; href: unknown; text: string }> = [];
    let section: string | null = null;
    const walk = (content: readonly Inline[]) => {
      for (const node of content) {
        if (typeof node !== "string" && node.type === "link") {
          found.push({ section, href: node.href, text: node.text });
        }
      }
    };
    for (const block of blocks) {
      if (block.type === "heading" && block.level === 2) section = block.text;
      if (block.type === "paragraph" || block.type === "callout") walk(block.content);
      if (block.type === "list") block.items.forEach(walk);
      if (block.type === "table") block.rows.forEach((cells) => cells.forEach(walk));
    }
    return found;
  }

  /*
   * The fixture catalog has no decaf beans, and the beans article mentions
   * decaf only when there are some; so these tests read it with one.
   */
  const withDecafBeans = (figures: JournalFigures): JournalFigures => ({
    ...figures,
    beans: figures.beans ? { ...figures.beans, decaf: 1 } : null,
  });
  const FULL = withDecafBeans(FIXTURE_FIGURES);
  const FULL_NO_LANDINGS = withDecafBeans(FIXTURE_FIGURES_NO_LANDINGS);

  const landingPaths = new Set<unknown>(LANDING_IDS.map((id) => LANDING_PATHS[id]));

  it("hands out a target only for a landing that exists", () => {
    for (const id of LANDING_IDS) {
      expect(landingHref(id, ALL_LANDINGS)).toBe(LANDING_PATHS[id]);
      expect(landingHref(id, EMPTY_JOURNAL_FIGURES.landings)).toBeNull();
      expect(linkProblem(LANDING_PATHS[id]), id).toBeNull();
    }
  });

  it.each(EXPECTED)(
    "$article links $landing under „$section“ while it exists",
    ({ article, landing, anchor, section }) => {
      const links = linksBySection(getArticle(article)!.body(FULL));
      expect(
        links.filter((entry) => entry.href === LANDING_PATHS[landing]),
        `${article} → ${landing}`,
      ).toEqual([{ section, href: LANDING_PATHS[landing], text: anchor }]);
    },
  );

  it("links exactly the landings listed above, and no other", () => {
    for (const article of ARTICLES) {
      const linked = linksBySection(article.body(FULL))
        .filter((entry) => landingPaths.has(entry.href))
        .map((entry) => entry.href)
        .sort();
      const expected = EXPECTED.filter((entry) => entry.article === article.slug)
        .map((entry) => LANDING_PATHS[entry.landing])
        .sort();
      expect(linked, article.slug).toEqual(expected);
    }
  });

  it.each([
    ["the catalog has figures", FULL_NO_LANDINGS],
    ["the catalog cannot be read", EMPTY_JOURNAL_FIGURES],
  ] as const)("links no landing that does not exist, when %s", (_label, figures) => {
    for (const article of ARTICLES) {
      const linked = linksBySection(article.body(figures)).filter((entry) =>
        landingPaths.has(entry.href),
      );
      expect(linked, article.slug).toEqual([]);
    }
  });

  it("follows each landing on its own: one that is gone takes only its own links", () => {
    for (const gone of LANDING_IDS) {
      const figures = { ...FULL, landings: { ...ALL_LANDINGS, [gone]: false } };
      for (const article of ARTICLES) {
        const linked = linksBySection(article.body(figures))
          .filter((entry) => landingPaths.has(entry.href))
          .map((entry) => entry.href)
          .sort();
        const expected = EXPECTED.filter(
          (entry) => entry.article === article.slug && entry.landing !== gone,
        )
          .map((entry) => LANDING_PATHS[entry.landing])
          .sort();
        expect(linked, `${article.slug} without ${gone}`).toEqual(expected);
      }
    }
  });

  it("keeps the sentence when the link inside it is gone", () => {
    // Where the anchor is words of an existing sentence, the article says the
    // same thing with and without the listing: only the link differs.
    const sameText: ReadonlyArray<readonly [string, string]> = [
      [WHICH_CAPSULE_SLUG, "така че и „капсули Lavazza“ не значи един вид капсула."],
      [CHOOSE_BEANS_SLUG, "Сред зърната има и кафе без кофеин — в момента"],
      [
        ARABICA_ROBUSTA_SLUG,
        "Безкофеиновото кафе е отделен продукт и в каталога е отбелязано като такова.",
      ],
    ];
    for (const [slug, sentence] of sameText) {
      const article = getArticle(slug)!;
      expect(plainText(article.body(FULL)), slug).toContain(sentence);
      expect(plainText(article.body(FULL_NO_LANDINGS)), slug).toContain(sentence);
    }
    // Where the link is a sentence of its own, the sentence goes with it.
    for (const slug of [CHOOSE_BEANS_SLUG, FORMATS_SLUG, CUP_COST_SLUG]) {
      const article = getArticle(slug)!;
      expect(plainText(article.body(FULL)), slug).toContain(relatedCopy.cheapest);
      expect(plainText(article.body(FULL_NO_LANDINGS)), slug).not.toContain(relatedCopy.cheapest);
    }
  });
});

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

  it("the capsule article's description names every capsule system", () => {
    const description = getArticle(WHICH_CAPSULE_SLUG)!.description;
    for (const system of systemsForMethod("capsule")) {
      // „Nespresso Original“ is „Nespresso“ to anyone who is not comparing it with Vertuo.
      expect(description, system.name).toContain(system.name.replace(/ Original$/, ""));
    }
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
