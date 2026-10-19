import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { absoluteUrl, siteConfig } from "@/config/site";
import { pageAlternates } from "@/lib/seo/alternates";
import { shareDefaults, shareMetadata } from "@/lib/seo/share";
import { SHARE_CARD, SHARE_CARD_ALT, SHARE_CARD_SIZE } from "@/lib/seo/share-card";

/*
 * What a page says about itself when its link is shared (`lib/seo/share.ts`).
 *
 * Next shallow-merges `openGraph`: a page takes the layout's whole object or
 * replaces it whole. The first half of this file holds the two objects built
 * here to that fact. The second reads the source, because the way this breaks
 * is a new page that declares a canonical and nothing for sharing. The browser
 * suite (`e2e/i18n.spec.ts`) checks the tags a production build sends; this is
 * the same rule, failing before a build.
 */

const CARD = absoluteUrl(SHARE_CARD);
/** The shop's card as a page names it: with its size, type and alt. */
const CARD_IMAGE = {
  url: CARD,
  width: SHARE_CARD_SIZE.width,
  height: SHARE_CARD_SIZE.height,
  alt: SHARE_CARD_ALT,
  type: "image/png",
};

describe("shareMetadata", () => {
  const share = shareMetadata({
    locale: "bg",
    title: "Кафе капсули",
    description: "Капсули за пет системи.",
    path: "/bg/kafe-kapsuli",
  });

  it("names the page's own address, title and description", () => {
    expect(share.openGraph).toMatchObject({
      url: absoluteUrl("/bg/kafe-kapsuli"),
      title: "Кафе капсули",
      description: "Капсули за пет системи.",
    });
  });

  it("names the same address the canonical does", () => {
    const { canonical } = pageAlternates("bg", "/kontakti");
    const contact = shareMetadata({ locale: "bg", title: "Контакти", path: "/bg/kontakti" });
    expect(contact.openGraph).toMatchObject({ url: canonical });
  });

  it("leaves the shop's name to og:site_name", () => {
    expect(share.openGraph).toMatchObject({ siteName: siteConfig.name });
    expect(JSON.stringify([share.openGraph?.title, share.twitter?.title])).not.toContain(
      siteConfig.name,
    );
  });

  it("restates what the layout would have given: kind, locale and the card", () => {
    expect(share.openGraph).toMatchObject({
      type: "website",
      locale: "bg_BG",
      images: [{ url: CARD }],
    });
  });

  it("gives X the same title, description and image", () => {
    expect(share.twitter).toEqual({
      card: "summary_large_image",
      title: "Кафе капсули",
      description: "Капсули за пет системи.",
      images: [CARD_IMAGE],
    });
  });

  it("names the card's size and alt, which a preview is laid out and read by", () => {
    expect(share.openGraph).toMatchObject({ images: [CARD_IMAGE] });
    expect(SHARE_CARD_SIZE).toEqual({ width: 1200, height: 630 });
    expect(SHARE_CARD_ALT).toContain(siteConfig.name);
  });

  /* A page with a card of its own (`opengraph-image.tsx` beside it) must name
     no `images` at all, not even an empty list: that is the only case in which
     Next attaches the segment's file, with its width, height and alt. */
  it("leaves the picture to the page's own card when it has one", () => {
    const product = shareMetadata({
      locale: "bg",
      title: "x",
      description: "y",
      path: "/bg/x",
      image: "generated",
    });
    expect(product.openGraph).not.toHaveProperty("images");
    expect(product.twitter).not.toHaveProperty("images");
    expect(product.openGraph).toMatchObject({ url: absoluteUrl("/bg/x"), title: "x" });
    expect(product.twitter).toMatchObject({ card: "summary_large_image", title: "x" });
  });

  it("shares a page's own picture when it has one, in both cards", () => {
    const photo = absoluteUrl("/media/products/a.webp");
    const product = shareMetadata({ locale: "bg", title: "x", path: "/bg/x", image: photo });
    expect(product.openGraph).toMatchObject({ images: [{ url: photo }] });
    expect(product.twitter).toMatchObject({ images: [{ url: photo }] });
  });

  it("never shares without an image: no picture means the card", () => {
    for (const image of [undefined, null, ""]) {
      const product = shareMetadata({ locale: "bg", title: "x", path: "/bg/x", image });
      expect(product.openGraph).toMatchObject({ images: [{ url: CARD }] });
    }
  });

  it("types an article as one and carries its dates", () => {
    const article = shareMetadata({
      locale: "bg",
      title: "x",
      path: "/bg/blog/x",
      article: {
        publishedTime: "2026-01-02T00:00:00.000Z",
        modifiedTime: "2026-02-03T00:00:00.000Z",
      },
    });
    expect(article.openGraph).toMatchObject({
      type: "article",
      publishedTime: "2026-01-02T00:00:00.000Z",
      modifiedTime: "2026-02-03T00:00:00.000Z",
      url: absoluteUrl("/bg/blog/x"),
      images: [{ url: CARD }],
    });
  });

  it("leaves a missing description for Next to fill, not as an empty tag", () => {
    const bare = shareMetadata({ locale: "bg", title: "x", path: "/bg/x" });
    expect(bare.openGraph?.description).toBeUndefined();
    expect(bare.twitter?.description).toBeUndefined();
  });
});

describe("shareDefaults, the layout's half", () => {
  const defaults = shareDefaults("bg");

  it("gives every page the kind, the shop's name, the locale and the card", () => {
    expect(defaults.openGraph).toMatchObject({
      type: "website",
      siteName: siteConfig.name,
      locale: "bg_BG",
      images: [{ url: CARD }],
    });
    expect(defaults.twitter).toMatchObject({
      card: "summary_large_image",
      images: [{ url: CARD }],
    });
  });

  /* Whatever is here is announced by every page that declares no `openGraph`
     of its own. An address or a title here is the home page's, on all of them. */
  it("describes no page: no address, no title, no description", () => {
    for (const half of [defaults.openGraph, defaults.twitter]) {
      expect(half).not.toHaveProperty("url");
      expect(half).not.toHaveProperty("title");
      expect(half).not.toHaveProperty("description");
    }
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

describe("the storefront's pages", () => {
  const sources = files(STOREFRONT).map((file) => ({ file: relative(file), source: code(file) }));

  it("are found", () => {
    expect(sources.length).toBeGreaterThan(20);
  });

  /* A canonical is declared wherever a page's metadata is built, so that is
     where its share tags belong: the two are built from the same path. */
  it("declare what they share as wherever they declare a canonical", () => {
    const withCanonical = sources.filter(({ source }) =>
      /\b(pageAlternates|localeAlternates)\(/.test(source),
    );
    expect(withCanonical.length).toBeGreaterThan(15);
    const forgetful = withCanonical
      .filter(({ source }) => !/\bshareMetadata\(/.test(source))
      .map(({ file }) => file);
    expect(forgetful).toEqual([]);
  });

  /* By hand is how the pages came to disagree: one with the shop's name in
     its title, one without the site name, most with nothing at all. */
  it("never spell openGraph or twitter by hand", () => {
    const byHand = sources
      .filter(({ source }) => /\b(openGraph|twitter)\s*:/.test(source))
      .map(({ file }) => file);
    expect(byHand).toEqual([]);
  });
});
