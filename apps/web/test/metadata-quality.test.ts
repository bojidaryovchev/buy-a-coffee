import { describe, expect, it } from "vitest";
import {
  landingCopy,
  machineBrandDescription,
  machineBrandNames,
  machineBrandFeatures,
  type LandingFacts,
} from "../content/landing-copy";
import { consumablesCopy, vendingCopy } from "../content/vending";
import { MACHINE_BRANDS } from "@/content/machines";
import { LANDING_IDS } from "@/lib/catalog/landings";
import { listArticles } from "@/lib/journal";
import { BREWING_SYSTEMS, type BrewingSystemId } from "@/lib/recommend/systems";
import { DESCRIPTION_LIMIT, fitDescription } from "@/lib/seo/description";
import {
  BRANDS_INDEX_META,
  CATEGORIES_INDEX_META,
  HOME_META,
  PROMOTIONS_META,
  brandDescriptionLead,
  brandTitle,
  categoryDescriptionLead,
  categoryTitle,
  metaDescription,
} from "@/lib/seo/listing-meta";
import {
  JOURNAL_META,
  contactMeta,
  cookiesMeta,
  privacyMeta,
  termsMeta,
} from "@/lib/seo/page-meta";
import { TITLE_LIMIT, fullTitle, titleLength, withShopName } from "@/lib/seo/title";
import { siteConfig } from "@/config/site";
import { CALLBACK_SENTENCE } from "../content/order-callback";
import {
  productMetaDescription,
  productTitleWords,
} from "@/app/(site)/[lang]/[slug]/_components/product-meta";
import type { ProductDetailView } from "@/lib/catalog/types";

/*
 * Every kind of indexable page, with the longest wording its facts can give
 * it, held to what a search result shows: a `<title>` of at most sixty
 * characters (`lib/seo/title.ts`) and a meta description of at most 160
 * (`lib/seo/description.ts`), long enough to say something, and none the
 * same as another page's.
 *
 * The browser suite (`e2e/seo-audit.spec.ts`) walks every URL in a production
 * build's sitemap with the same limits; this is the same rule failing before a
 * build, for the wordings a small catalog does not reach.
 */

/** A range of the longest shape a page can quote: both ends estimated. */
const WIDE_RANGE = {
  min: { amount: "0.0612", estimated: true },
  max: { amount: "12.6700", estimated: true },
} as const;

const landingFacts = (
  systemIds: readonly BrewingSystemId[],
  commonPack: string | null = null,
): LandingFacts => {
  const listed = BREWING_SYSTEMS.filter((system) => systemIds.includes(system.id));
  return {
    count: 187,
    systems: listed,
    methods: (["capsule", "pod", "beans"] as const).filter((method) =>
      listed.some((system) => system.method === method),
    ),
    cupRange: WIDE_RANGE,
    commonPack,
    currency: "EUR",
  };
};

const ALL_SYSTEMS = BREWING_SYSTEMS.map((system) => system.id);
const CAPSULE_SYSTEM_IDS = BREWING_SYSTEMS.filter((system) => system.method === "capsule").map(
  (system) => system.id,
);
const cupRange = {
  cheapest: { amount: "0.0612", estimated: true },
  dearest: { amount: "12.67", estimated: true },
  currency: "EUR",
};

interface Meta {
  readonly page: string;
  /** The page's own words; `fullTitle` decides whether the shop's name follows. */
  readonly title: string;
  readonly description: string;
}

const category = (sourceKey: string, slug: string, name: string) => ({ sourceKey, slug, name });
const CAPSULE_SYSTEMS = [
  category("nespresso", "nespresso", "Nespresso"),
  category("dolce-gusto", "dolce-gusto", "Dolce Gusto"),
  category("a-modo-mio", "a-modo-mio", "A Modo Mio"),
  category("caffitaly", "caffitaly", "Caffitaly"),
  category("lavazza-blue", "lavazza-blue", "Lavazza Blue"),
];
const CATEGORIES = [
  category("kafe-kapsuli", "kapsuli", "Кафе капсули"),
  ...CAPSULE_SYSTEMS,
  category("kafe-na-zyrna", "kafe-na-zarna", "Кафе на зърна"),
  category("kafe-dozi", "kafe-dozi", "Кафе дози"),
];

/** Every brand the catalog has held, each in every format: the longest title it can get. */
const BRAND_NAMES = [
  "3 Bourbons",
  "Amann",
  "Biancaffè",
  "Bianchi",
  "Borbone",
  "Caffitaly",
  "Elia",
  "Este",
  "Eurocaf",
  "Foodness",
  "illy",
  "Julius Meinl",
  "Kimbo",
  "Lavazza",
  "Lollo Caffè",
  "Molini",
  "Rema Caffè",
  "Tezzoro",
  "Vandino",
  "Vergnano",
  "Ristora",
  "Excelsior",
  "Cafe Moreno",
];

const listingMeta = (title: string, lead: string): Meta => ({
  page: title,
  title,
  description: metaDescription(lead, cupRange),
});

/**
 * Product pages: one line in every format and pack the shop sells it in, at
 * three lengths of line name, and the longest names the catalog has held.
 * A product's title is its own words alone when the shop's name does not fit,
 * so `fullTitle` is applied to `productTitleWords`, as the page does.
 */
const FORMATS: ReadonlyArray<readonly [detail: string, price: string, perCup: string]> = [
  ["Капсули за Dolce Gusto, 16 бр.", "5,90 €", "0,37 € на чаша"],
  ["Капсули за Nespresso, 10 бр.", "4,60 €", "0,46 € на чаша"],
  ["Капсули за Nespresso, 100 бр.", "31,00 €", "0,31 € на чаша"],
  ["Капсули Lavazza Blue, 100 бр.", "33,25 €", "0,33 € на чаша"],
  ["Капсули за Lavazza A Modo Mio, 16 бр.", "6,20 €", "0,39 € на чаша"],
  ["Кафе дози ESE, 150 бр.", "42,00 €", "0,28 € на чаша"],
  ["Кафе на зърна, 1 кг", "25,10 €", "≈ 0,18 € на чаша"],
  ["Кафе на зърна, 500 г", "13,90 €", "≈ 0,19 € на чаша"],
];

const productPage = (title: string, [detail, price, perCup]: (typeof FORMATS)[number]): Meta => {
  const product = {
    title,
    detail,
    name: `${title} — ${detail.charAt(0).toLowerCase()}${detail.slice(1)}`,
    price: { amount: "1.00", currency: "EUR", formatted: price },
    servingPrice: { formatted: perCup, estimated: perCup.startsWith("≈") },
    status: "active",
    availability: "in_stock",
  } as unknown as ProductDetailView;
  return {
    page: product.name,
    title: productTitleWords(product),
    description: productMetaDescription(product),
  };
};

const PRODUCT_PAGES: readonly Meta[] = [
  "Lollo Caffè Classico",
  "Bianchi Irish Cream Aroma Espresso",
  "Lollo Caffè Classico Miscela Oro Extra Crema Intensa",
].flatMap((line) => FORMATS.map((format) => productPage(line, format)));

const PAGES: readonly Meta[] = [
  ...PRODUCT_PAGES,
  {
    page: "home",
    title: HOME_META.title,
    description: metaDescription(HOME_META.description, cupRange),
  },
  listingMeta(CATEGORIES_INDEX_META.title, CATEGORIES_INDEX_META.description),
  listingMeta(BRANDS_INDEX_META.title, "23 марки кафе, италиански и други"),
  listingMeta(PROMOTIONS_META.title, PROMOTIONS_META.description),
  listingMeta(vendingCopy.metaTitle, vendingCopy.metaDescription),
  listingMeta(consumablesCopy.metaTitle, consumablesCopy.metaDescription),
  ...CATEGORIES.flatMap((keys) =>
    [{}, { uniformPieceCount: 100 }, { children: CAPSULE_SYSTEMS }].map((facts, index) => ({
      page: `${keys.slug} (${index})`,
      title: categoryTitle(keys, facts),
      description: metaDescription(categoryDescriptionLead(keys, facts), cupRange),
    })),
  ),
  ...BRAND_NAMES.map((name) => {
    const brand = { slug: name.toLowerCase().replace(/\W+/g, "-"), name };
    return {
      page: `marki/${brand.slug}`,
      title: brandTitle(brand, BREWING_SYSTEMS, true),
      description: metaDescription(brandDescriptionLead(brand, BREWING_SYSTEMS, true), cupRange),
    };
  }),
  ...LANDING_IDS.flatMap((id) =>
    (id === "lavazzaCapsules"
      ? [
          landingFacts(CAPSULE_SYSTEM_IDS),
          landingFacts(["lavazza-blue", "a-modo-mio", "nespresso-original"]),
          landingFacts(["lavazza-blue"]),
        ]
      : [
          landingFacts(ALL_SYSTEMS, "1 кг"),
          landingFacts(["nespresso-original"]),
          landingFacts(["beans"], "1 кг"),
        ]
    ).map((facts, index) => ({
      page: `${id} (${index})`,
      title: landingCopy[id].title(facts),
      description: landingCopy[id].description(facts),
    })),
  ),
  ...MACHINE_BRANDS.map((brand) => {
    const feature = machineBrandFeatures[brand.slug];
    return {
      page: `za-kafemashina/${brand.slug}`,
      title: machineBrandNames(brand).title,
      description: feature
        ? feature.description(landingFacts(["caffitaly"]))
        : machineBrandDescription(brand),
    };
  }),
  ...listArticles().map((summary) => ({
    page: summary.href,
    title: summary.title,
    description: summary.metaDescription,
  })),
  { page: "contact", ...contactMeta() },
  { page: "terms", ...termsMeta() },
  { page: "privacy", ...privacyMeta() },
  { page: "cookies", ...cookiesMeta() },
  { page: "journal", ...JOURNAL_META },
];

describe("every kind of page, at its longest", () => {
  it("is found", () => {
    expect(PAGES.length).toBeGreaterThan(80);
  });

  it.each(PAGES.map((meta) => [meta.page, meta] as const))(
    "%s: a title within sixty characters",
    (_, meta) => {
      expect(titleLength(fullTitle(meta.title)), fullTitle(meta.title)).toBeLessThanOrEqual(
        TITLE_LIMIT,
      );
    },
  );

  it.each(PAGES.map((meta) => [meta.page, meta] as const))(
    "%s: a description a result shows whole, and says something",
    (_, meta) => {
      expect([...meta.description].length, meta.description).toBeLessThanOrEqual(DESCRIPTION_LIMIT);
      expect([...meta.description].length, meta.description).toBeGreaterThanOrEqual(70);
      expect(meta.description).toMatch(/[.!?…]$/);
    },
  );

  it("tells every pack of one line apart by its title", () => {
    const titles = PRODUCT_PAGES.map((meta) => fullTitle(meta.title));
    expect(titles.filter((title, index) => titles.indexOf(title) !== index)).toEqual([]);
  });

  it("are told apart: no two kinds of page share a title or a description", () => {
    const first = PAGES.filter((meta) => !/ \([12]\)$/.test(meta.page));
    const titles = first.map((meta) => fullTitle(meta.title));
    expect(titles.filter((title, index) => titles.indexOf(title) !== index)).toEqual([]);
    const descriptions = first.map((meta) => meta.description);
    expect(
      descriptions.filter((description, index) => descriptions.indexOf(description) !== index),
    ).toEqual([]);
  });
});

describe("how a title ends", () => {
  it("ends with the shop's name while that fits", () => {
    expect(fullTitle("Кафе на зърна")).toBe(`Кафе на зърна | ${siteConfig.name}`);
  });

  it("gives up the name, never the page's own words, when it does not", () => {
    const long = "Rema Caffè Fortissimo — капсули за Nespresso, 20 бр.";
    expect(titleLength(withShopName(long))).toBeGreaterThan(TITLE_LIMIT);
    expect(fullTitle(long)).toBe(long);
  });

  it("counts characters, not UTF-16 units", () => {
    expect(titleLength("Кафе")).toBe(4);
    expect(titleLength("Caffè")).toBe(5);
  });
});

describe("how a description fits", () => {
  it("keeps the parts in order while they fit, and drops the one that does not", () => {
    const lead = "а".repeat(120) + ".";
    expect(fitDescription(lead, CALLBACK_SENTENCE)).toBe(lead);
    expect(fitDescription("Кратко.", CALLBACK_SENTENCE)).toBe(`Кратко. ${CALLBACK_SENTENCE}`);
  });

  it("still adds a later part that fits after one that did not", () => {
    const lead = "а".repeat(100) + ".";
    expect(fitDescription(lead, "б".repeat(80) + ".", "Кратко.")).toBe(`${lead} Кратко.`);
  });

  it("skips empty parts", () => {
    expect(fitDescription(null, "", "Едно.", undefined, "Две.")).toBe("Едно. Две.");
    expect(fitDescription()).toBe("");
  });
});
