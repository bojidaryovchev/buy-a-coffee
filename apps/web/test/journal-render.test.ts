import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ARTICLES } from "../content/journal";
import {
  action,
  callout,
  h2,
  h3,
  link,
  ol,
  p,
  phone,
  strong,
  table,
  ul,
  type Block,
} from "../content/journal/blocks";
import { ArticleBody } from "@/components/journal/article-body";
import { siteConfig } from "@/config/site";
import { EMPTY_JOURNAL_FIGURES } from "@/lib/catalog/journal-figures";
import { articleJsonLd } from "@/lib/seo/article-json-ld";
import { summariseArticle } from "@/lib/journal";
import { FIXTURE_FIGURES } from "./journal-fixtures";

/**
 * Rendering test for the block component.
 *
 * The markup is produced with `renderToStaticMarkup`, which is the same thing
 * a browser with JavaScript off receives — so "works without JavaScript" is
 * what is being asserted, not assumed.
 */

/*
 * The unit-test transform compiles JSX to `React.createElement` (the app's
 * tsconfig says `jsx: preserve`, which leaves the choice to the bundler, and
 * Vitest's default is the classic runtime). Next.js supplies the automatic
 * runtime in the real build; here the global is supplied by hand so the
 * component under test is the unmodified one.
 */
(globalThis as { React?: typeof React }).React = React;

const render = (blocks: readonly Block[]): string =>
  renderToStaticMarkup(createElement(ArticleBody, { blocks }));

const count = (html: string, pattern: RegExp): number => html.match(pattern)?.length ?? 0;

describe("ArticleBody: each block", () => {
  it("renders a paragraph with inline links and emphasis", () => {
    const html = render([p("Преди ", link("/wizard", "въпросника"), " и ", strong("важно"), ".")]);
    expect(html).toContain("<p>Преди ");
    expect(html).toMatch(/<a [^>]*href="\/wizard"[^>]*>въпросника<\/a>/);
    expect(html).toMatch(/<strong[^>]*>важно<\/strong>/);
  });

  it("renders headings at the level the block states and never an h1", () => {
    const html = render([h2("Втора"), h3("Трета")]);
    expect(html).toMatch(/<h2[^>]*>Втора<\/h2>/);
    expect(html).toMatch(/<h3[^>]*>Трета<\/h3>/);
    expect(html).not.toMatch(/<h1/);
  });

  it("renders ordered and unordered lists as lists", () => {
    const html = render([ul("едно", ["две ", link("/journal", "връзка")]), ol("първо", "второ")]);
    expect(html).toMatch(/<ul[^>]*>.*<\/ul>/s);
    expect(html).toMatch(/<ol[^>]*>.*<\/ol>/s);
    expect(count(html, /<li/g)).toBe(4);
    expect(html).toMatch(/<a [^>]*href="\/journal"/);
  });

  it("renders a callout as an aside with its title", () => {
    const html = render([callout({ tone: "caution", title: "Внимание" }, "Текст.")]);
    expect(html).toMatch(/<aside/);
    expect(html).toContain("Внимание");
    expect(html).toContain("Текст.");
  });

  it("renders a table with a caption and scoped headers", () => {
    const html = render([
      table({
        caption: "Цена на чаша",
        columns: ["Система", "На чаша"],
        rows: [
          ["Nespresso", "0,33 €"],
          [[link("/categories/nespresso", "Още")], "—"],
        ],
        note: "Приблизително.",
      }),
    ]);
    expect(html).toMatch(/<caption[^>]*>Цена на чаша<\/caption>/);
    expect(count(html, /<th [^>]*scope="col"/g)).toBe(2);
    expect(count(html, /<th [^>]*scope="row"/g)).toBe(2);
    expect(count(html, /<td/g)).toBe(2);
    expect(html).toMatch(/<figcaption[^>]*>Приблизително\.<\/figcaption>/);
    // The scroll box is reachable and named for keyboard and screen-reader users.
    expect(html).toMatch(/role="region"/);
    expect(html).toMatch(/aria-label="Цена на чаша"/);
    expect(html).toMatch(/tabindex="0"/);
  });

  it("renders the phone number from the site configuration as a tel: link", () => {
    const html = render([p("Обадете се на ", phone, ".")]);
    expect(html).toContain(`href="tel:${siteConfig.contact.phoneHref}"`);
    expect(html).toContain(siteConfig.contact.phone);
  });

  it("renders actions as plain links, not buttons", () => {
    const html = render([
      action(
        { href: "/wizard", label: "Към въпросника" },
        { href: "/categories", label: "Каталог" },
      ),
    ]);
    expect(count(html, /<a /g)).toBe(2);
    expect(html).not.toMatch(/<button/);
  });

  it("escapes text rather than interpreting it", () => {
    const html = render([p("<script>alert(1)</script>"), h2("<b>не</b>")]);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe.each(ARTICLES.map((article) => [article.slug, article] as const))(
  "ArticleBody: %s",
  (_slug, article) => {
    it.each([
      ["with catalog figures", FIXTURE_FIGURES],
      ["with no catalog figures", EMPTY_JOURNAL_FIGURES],
    ] as const)("renders as static, script-free HTML %s", (_label, figures) => {
      const blocks = article.body(figures);
      const html = render(blocks);

      // The title is the page's h1; the body must not add another.
      expect(html).not.toMatch(/<h1/);
      expect(count(html, /<h[23]/g)).toBe(blocks.filter((b) => b.type === "heading").length);

      // Nothing that needs JavaScript to work.
      expect(html).not.toMatch(/<script|<button|onclick=|<form|<input/i);

      // Every link is a real anchor with an internal or tel: target.
      const hrefs = [...html.matchAll(/<a [^>]*href="([^"]*)"/g)].map((match) => match[1]!);
      expect(hrefs.length).toBeGreaterThan(0);
      for (const href of hrefs) expect(href).toMatch(/^(\/|tel:\+)/);
      expect(count(html, /<a /g)).toBe(hrefs.length);

      expect(html).not.toMatch(/undefined|\[object/);
    });
  },
);

describe("articleJsonLd", () => {
  const article = ARTICLES[0]!;
  const data = articleJsonLd(summariseArticle(article));

  it("describes an Article with real dates and an absolute URL", () => {
    expect(data["@context"]).toBe("https://schema.org");
    expect(data["@type"]).toBe("Article");
    expect(data.headline).toBe(article.title);
    expect(data.description).toBe(article.description);
    expect(data.datePublished).toBe(article.publishedAt);
    expect(data.dateModified).toBe(article.updatedAt ?? article.publishedAt);
    expect(data.url).toBe(`${siteConfig.url.replace(/\/+$/, "")}/journal/${article.slug}`);
    expect(data.mainEntityOfPage).toEqual({ "@type": "WebPage", "@id": data.url });
    expect(data.inLanguage).toBe(siteConfig.locale);
  });

  it("names the shop, an organisation, as author and publisher — never a person", () => {
    for (const key of ["author", "publisher"] as const) {
      expect(data[key]).toMatchObject({ "@type": "Organization", name: siteConfig.name });
    }
    expect(JSON.stringify(data)).not.toContain('"Person"');
  });

  it("claims no rating, review or word count it cannot support", () => {
    for (const key of ["aggregateRating", "review", "wordCount", "articleBody"]) {
      expect(data).not.toHaveProperty(key);
    }
  });
});
