import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/*
 * `next/image` needs the framework's image configuration to render. A plain
 * `<img>` that keeps the props this page is specified by is enough here.
 */
vi.mock("next/image", async () => {
  const React = await import("react");
  return {
    default: React.forwardRef<HTMLImageElement, Record<string, unknown>>(function Img(props, ref) {
      const { fill: _fill, priority, preload, fetchPriority: _fetchPriority, ...rest } = props;
      return React.createElement("img", {
        ref,
        ...rest,
        "data-preload": preload || priority ? "true" : undefined,
      });
    }),
  };
});

import { HERO_SHELF_SIZES } from "@/components/home/hero";
import { HomeView, type HomeData } from "@/components/home/home-view";
import { DeliveryPromise, deliveryFacts } from "@/components/home/sections";
import { freeDeliveryPromise } from "@/components/commerce/terms";
import { siteConfig, type CommerceConfig } from "@/config/site";
import type { HeroShelfItem } from "@/lib/catalog/home-shelf";
import type { BrandView, ProductCardView } from "@/lib/catalog/types";
import type { ArticleSummary } from "@/lib/journal";
import { STEP_LABELS, STEP_SEQUENCE } from "@/lib/recommend/answers";
import { BREWING_SYSTEMS, type BrewingSystemId } from "@/lib/recommend/systems";
import { categoryHref, systemCategory } from "@/lib/routes";

/**
 * The home page rendered from fixtures: which sections exist, in what order,
 * and that each one is gone — not empty — when it has nothing to show.
 */

/* --- Fixtures ------------------------------------------------------------ */

function product(index: number, overrides: Partial<ProductCardView> = {}): ProductCardView {
  return {
    id: `p-${index}`,
    slug: `produkt-${index}`,
    name: `Капсули Примерни ${index} 10 бр.`,
    price: { amount: "5.60", currency: "EUR", formatted: "5,60 €" },
    oldPrice: null,
    discountPercent: null,
    availability: "in_stock",
    weight: "10 бр.",
    intensity: "8 от 12",
    systemId: "dolce-gusto",
    servingPrice: { formatted: "0,56 € на чаша", estimated: false },
    brand: { slug: "alfa", name: "Alfa" },
    image: { url: `/media/p-${index}.jpg`, alt: `Снимка ${index}`, width: 600, height: 600 },
    shortDescription: null,
    ...overrides,
  };
}

const reduced = (index: number): ProductCardView =>
  product(index, {
    oldPrice: { amount: "6.60", currency: "EUR", formatted: "6,60 €" },
    discountPercent: 15,
  });

function brand(index: number, productCount: number): BrandView {
  return {
    id: `b-${index}`,
    slug: `marka-${index}`,
    name: `Марка ${index}`,
    tagline: null,
    description: null,
    productCount,
  };
}

function shelfItem(index: number, systemId: BrewingSystemId = "beans"): HeroShelfItem {
  return {
    id: `s-${index}`,
    slug: `shelf-${index}`,
    name: `Пакет на рафта ${index}`,
    systemId,
    image: { url: `/media/s-${index}.jpg`, alt: `Stored alt ${index}`, width: 600, height: 600 },
  };
}

function article(index: number): ArticleSummary {
  return {
    slug: `statia-${index}`,
    href: `/blog/statia-${index}`,
    title: `Статия номер ${index}`,
    description: `Кратко описание ${index}.`,
    publishedAt: "2026-10-09",
    modifiedAt: "2026-10-09",
    lastModified: new Date("2026-10-09T00:00:00.000Z"),
  };
}

const range = <T>(count: number, make: (index: number) => T): T[] =>
  Array.from({ length: count }, (_, index) => make(index + 1));

const COMMERCE: CommerceConfig = {
  confirmedByOwner: false,
  freeDeliveryThreshold: "49.00",
  deliveryFee: "5.90",
  deliveryTime: { dispatch: { min: 1, max: 1 }, transit: { min: 1, max: 2 } },
  couriers: [],
  paymentMethods: ["cash_on_delivery", "bank_transfer"],
  returnWindowDays: 14,
  returnShippingPaidBy: null,
  openingHours: [],
};

const BARE_COMMERCE: CommerceConfig = {
  ...COMMERCE,
  freeDeliveryThreshold: null,
  deliveryFee: null,
  deliveryTime: null,
  paymentMethods: [],
};

/** A catalog with something in every module. */
const FULL: HomeData = {
  locale: "bg",
  productCount: 187,
  brands: range(20, (index) => brand(index, 20 + index)),
  systemCounts: {
    "nespresso-original": 36,
    "dolce-gusto": 33,
    "a-modo-mio": 3,
    caffitaly: 9,
    "lavazza-blue": 7,
    "ese-pod": 41,
    beans: 58,
  },
  shelf: range(6, (index) => shelfItem(index)),
  newArrivals: range(8, (index) => product(index)),
  promotions: range(4, (index) => reduced(100 + index)),
  articles: range(3, article),
  commerce: COMMERCE,
};

/** A different catalog: every number differs from `FULL`. */
const SMALL: HomeData = {
  locale: "bg",
  productCount: 12,
  brands: [brand(1, 5), brand(2, 6), brand(3, 0)],
  systemCounts: { "dolce-gusto": 4, beans: 8 },
  shelf: range(3, (index) => shelfItem(index)),
  newArrivals: range(2, (index) => product(index)),
  promotions: [],
  articles: [],
  commerce: BARE_COMMERCE,
};

/** Nothing at all: a database before its first synchronisation. */
const EMPTY: HomeData = {
  locale: "bg",
  productCount: 0,
  brands: [],
  systemCounts: {},
  shelf: [],
  newArrivals: [],
  promotions: [],
  articles: [],
  commerce: BARE_COMMERCE,
};

const render = (data: HomeData): string => renderToStaticMarkup(createElement(HomeView, data));

/* --- Reading the markup -------------------------------------------------- */

const text = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, " ")
    // `\s` also matches the no-break space a price carries before its currency sign.
    .replace(/\s+/g, " ")
    .trim();

function headings(markup: string): Array<{ level: number; text: string }> {
  return [...markup.matchAll(/<h([1-6])[^>]*>(.*?)<\/h\1>/gs)].map((match) => ({
    level: Number(match[1]),
    text: text(match[2] ?? ""),
  }));
}

const sectionCount = (markup: string): number => markup.match(/<section\b/g)?.length ?? 0;

/** The opening tags of the hero's images, in order. */
function shelfImages(markup: string): string[] {
  const hero = markup.slice(0, markup.indexOf("</section>"));
  return hero.match(/<img\b[^>]*>/g) ?? [];
}

const TITLES = {
  systems: "Изберете по машината си",
  wizard: "Кое кафе е за вас?",
  promotions: "Намалени в момента",
  arrivals: "Ново в асортимента",
  ordering: "Поръчката е на една стъпка",
  brands: "Марките, които предлагаме",
  journal: "От блога",
  vending: "Вендинг зона",
} as const;

const h2s = (markup: string): string[] =>
  headings(markup)
    .filter((heading) => heading.level === 2)
    .map((heading) => heading.text);

/* --- Tests --------------------------------------------------------------- */

describe("home page: order and outline", () => {
  const markup = render(FULL);

  it("renders the ten sections in the specified order", () => {
    expect(sectionCount(markup)).toBe(10);
    expect(h2s(markup)).toEqual([
      TITLES.systems,
      TITLES.wizard,
      TITLES.promotions,
      TITLES.arrivals,
      TITLES.ordering,
      TITLES.brands,
      TITLES.journal,
      TITLES.vending,
    ]);
    // The delivery strip has no heading; it sits between the hero and the tiles.
    expect(markup.indexOf("</h1>")).toBeLessThan(markup.indexOf("<dl"));
    expect(markup.indexOf("<dl")).toBeLessThan(markup.indexOf(TITLES.systems));
  });

  it("has exactly one h1, first, carrying the tagline", () => {
    const all = headings(markup);
    expect(all.filter((heading) => heading.level === 1)).toEqual([
      { level: 1, text: siteConfig.tagline },
    ]);
    expect(all[0]?.level).toBe(1);
  });

  it.each([
    ["a full catalog", FULL],
    ["a small catalog", SMALL],
    ["an empty catalog", EMPTY],
  ])("never skips a heading level with %s", (_label, data) => {
    const levels = headings(render(data)).map((heading) => heading.level);
    expect(levels.filter((level) => level === 1)).toHaveLength(1);
    levels.reduce((previous, level) => {
      expect(level - previous).toBeLessThanOrEqual(1);
      return level;
    }, 0);
  });

  it("keeps every pine band inside .on-pine, so focus stays visible on it", () => {
    const bands = markup.match(/<section\b[^>]*\bbg-pine-900\b[^>]*>/g) ?? [];
    // The hero and the Vending Zone.
    expect(bands).toHaveLength(2);
    for (const band of bands) expect(band).toContain("on-pine");
    // The finder tile is pine inside a paper section, so its own item carries it.
    expect(markup).toMatch(/<li class="on-pine"><a[^>]*href="\/bg\/za-kafemashina"/);
  });
});

describe("home page: the hero", () => {
  const markup = render(FULL);

  it("offers the wizard, the tiles and the machine finder, in that order", () => {
    const hero = markup.slice(0, markup.indexOf("</section>"));
    const hrefs = [...hero.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map((match) => match[1]);
    expect(hrefs.slice(0, 3)).toEqual(["/bg/izbor-na-kafe", "#systems", "/bg/za-kafemashina"]);
    expect(markup).toContain('id="systems"');
  });

  it("has one gold control on the whole page: the hero's", () => {
    const controls = markup.match(/<a\b[^>]*\bbg-gold-500\b[^>]*>/g) ?? [];
    expect(controls).toHaveLength(1);
    expect(controls[0]).toContain('href="/bg/izbor-na-kafe"');
    expect(controls[0]).toContain("text-ink-900");
    expect(controls[0]).toContain("hover:bg-gold-300");
  });

  it("links every well to its product and names it by the product", () => {
    const images = shelfImages(markup);
    expect(images).toHaveLength(6);
    for (const [index, item] of FULL.shelf.entries()) {
      expect(markup).toContain(`href="/bg/${item.slug}"`);
      expect(images[index]).toContain(`alt="${item.name}"`);
      expect(images[index]).toContain(`sizes="${HERO_SHELF_SIZES}"`);
    }
  });

  it("preloads the first well only, and nothing else on the page", () => {
    const preloaded = (markup.match(/<img\b[^>]*>/g) ?? []).filter((tag) =>
      tag.includes('data-preload="true"'),
    );
    expect(preloaded).toHaveLength(1);
    expect(preloaded[0]).toBe(shelfImages(markup)[0]);
    for (const tag of shelfImages(markup).slice(1)) expect(tag).toContain('loading="lazy"');
  });

  it("reserves every well's box and hides the second row on a phone", () => {
    const hero = markup.slice(0, markup.indexOf("</section>"));
    expect(hero.match(/aspect-square/g)).toHaveLength(6);
    expect(hero.match(/<li class="hidden md:block">/g)).toHaveLength(3);
    // The packshots sit on the white well, never on a tint.
    expect(hero.match(/bg-well/g)).toHaveLength(6);
  });

  it("drops the shelf and lets the text span the row without photographs", () => {
    const hero = render({ ...FULL, shelf: [] });
    expect(shelfImages(hero)).toHaveLength(0);
    expect(hero).toContain("md:col-span-12");
    expect(hero).not.toContain("grid-cols-3 gap-3");
  });
});

describe("home page: nothing is hard-coded", () => {
  it("prints the counts it is given, and different ones for a different catalog", () => {
    expect(text(render(FULL))).toContain("20 марки · 187 продукта");
    expect(text(render(SMALL))).toContain("2 марки · 12 продукта");
    expect(text(render(SMALL))).not.toContain("187");
    expect(text(render(SMALL))).not.toContain("20 марки");
  });

  it("uses the singular for one", () => {
    const one = text(
      render({ ...SMALL, productCount: 1, brands: [brand(1, 1)], systemCounts: { beans: 1 } }),
    );
    expect(one).toContain("1 марка · 1 продукт");
    expect(one).toContain("1 продукт →");
  });

  it("omits the eyebrow rather than print a zero", () => {
    expect(text(render(EMPTY))).not.toMatch(/\b0 (марки|продукта)/);
  });

  it("contains no number that the fixture did not supply", () => {
    // Everything numeric on the page must trace back to data or configuration:
    // rendering two catalogs that share no number may share only those digits
    // that come from the shared fixtures (names, prices, dates, phone, steps).
    const numbers = (markup: string) => new Set(text(markup).match(/\d+(?=\s+(продукт|марк))/g));
    const full = numbers(render(FULL));
    const small = numbers(render(SMALL));
    expect([...full].filter((value) => small.has(value))).toEqual([]);
  });
});

describe("home page: shop by system", () => {
  it("shows a tile for each stocked system, in system order, then the finder", () => {
    const markup = render(FULL);
    const tiles = markup.slice(markup.indexOf('id="systems"'), markup.indexOf(TITLES.wizard));
    const titles = headings(tiles)
      .filter((heading) => heading.level === 3)
      .map((heading) => heading.text);

    expect(titles).toEqual([
      ...BREWING_SYSTEMS.map((system) => system.name),
      "Не знаете системата?",
    ]);
    for (const system of BREWING_SYSTEMS) {
      // Colour and name together, and a link to the system's own listing.
      expect(tiles).toMatch(
        new RegExp(
          `<a[^>]*href="${categoryHref("bg", systemCategory(system))}"[^>]*data-system="${system.id}"|` +
            `<a[^>]*data-system="${system.id}"[^>]*href="${categoryHref("bg", systemCategory(system))}"`,
        ),
      );
      expect(text(tiles)).toContain(`${FULL.systemCounts[system.id]} продукта`);
    }
    expect(tiles).toContain('href="/bg/za-kafemashina"');
    expect(text(tiles)).toContain("Намери по машина");
  });

  it("drops the tile of a system with no products", () => {
    const markup = render({ ...FULL, systemCounts: { ...FULL.systemCounts, "a-modo-mio": 0 } });
    expect(markup).not.toContain('data-system="a-modo-mio"');
    expect(markup).toContain('data-system="caffitaly"');
    expect(markup).toContain('href="/bg/za-kafemashina"');
  });

  it("drops the section, the wizard entry and the hero's link to it with no system at all", () => {
    const markup = render({ ...FULL, systemCounts: {} });
    expect(h2s(markup)).not.toContain(TITLES.systems);
    expect(h2s(markup)).not.toContain(TITLES.wizard);
    expect(markup).not.toContain('id="systems"');
    expect(markup).not.toContain('href="#systems"');
    // The finder is still one tap away, from the hero.
    expect(markup).toContain('href="/bg/za-kafemashina"');
  });
});

describe("home page: the wizard entry", () => {
  it("is its own block, with the wizard's own step labels", () => {
    const markup = render(FULL);
    const block = markup.slice(markup.indexOf(TITLES.wizard), markup.indexOf(TITLES.promotions));
    expect(block).toContain('href="/bg/izbor-na-kafe"');
    for (const step of STEP_SEQUENCE) expect(block).toContain(STEP_LABELS[step]);
    // The page's gold is the hero's; this block's action is the primary button.
    expect(block).not.toContain("bg-gold-500 px");
    expect(markup).toContain("bg-gold-100");
  });
});

describe("home page: modules that come and go", () => {
  it("shows promotions only for a genuine reduction", () => {
    expect(h2s(render(FULL))).toContain(TITLES.promotions);
    expect(render(FULL)).toContain('href="/bg/promotsii"');

    const none = render({ ...FULL, promotions: [] });
    expect(h2s(none)).not.toContain(TITLES.promotions);
    expect(none).not.toContain("bg-clay-100");

    // An old price without a computed reduction is not a reduction.
    const unproven = render({
      ...FULL,
      promotions: [
        product(1, { oldPrice: { amount: "5.60", currency: "EUR", formatted: "5,60 €" } }),
      ],
    });
    expect(h2s(unproven)).not.toContain(TITLES.promotions);
  });

  it("shows new arrivals when there are any, with no priority image", () => {
    const markup = render(FULL);
    const section = markup.slice(markup.indexOf(TITLES.arrivals), markup.indexOf(TITLES.ordering));
    for (const item of FULL.newArrivals) expect(section).toContain(`/bg/${item.slug}"`);
    expect(section).not.toContain('data-preload="true"');
    // Eight on a desktop, four on a phone.
    expect(markup).toContain("max-md:[&amp;&gt;ul&gt;li:nth-child(n+5)]:hidden");

    expect(h2s(render({ ...FULL, newArrivals: [] }))).not.toContain(TITLES.arrivals);
  });

  it("shows brands as tiles with their counts: the name where there is no logo", () => {
    const markup = render(SMALL);
    const section = markup.slice(markup.indexOf(TITLES.brands));
    expect(section).toContain('href="/bg/marki/marka-1"');
    expect(text(section)).toContain("Марка 2 6 продукта");
    // A brand without products is not a route into anything.
    expect(section).not.toContain("marka-3");
    // None of the fixture brands has a logo, so none is drawn.
    expect(section.slice(0, section.indexOf("</section>"))).not.toContain("<img");
  });

  it("shows a brand's own logo in its tile, named by its alt", () => {
    const lavazza: BrandView = { ...brand(1, 21), slug: "lavazza", name: "Lavazza" };
    const markup = render({ ...SMALL, brands: [lavazza, brand(2, 6)] });
    const section = markup.slice(markup.indexOf(TITLES.brands));
    const tiles = section.slice(0, section.indexOf("</section>"));
    expect(tiles).toMatch(
      /<a [^>]*href="\/bg\/marki\/lavazza"[^>]*>\s*<span[^>]*><img src="\/brand-logos\/lavazza.svg" alt="Lavazza"/,
    );
    expect(text(tiles)).toContain("21 продукта");
    expect(tiles.match(/<img/g)).toHaveLength(1);

    expect(h2s(render({ ...FULL, brands: [] }))).not.toContain(TITLES.brands);
    expect(h2s(render({ ...FULL, brands: [brand(1, 0)] }))).not.toContain(TITLES.brands);
  });

  it("shows up to three articles, and no journal section without them", () => {
    const markup = render({ ...FULL, articles: range(5, article) });
    const section = markup.slice(markup.indexOf(TITLES.journal), markup.indexOf(TITLES.vending));
    expect(section.match(/<article\b/g)).toHaveLength(3);
    expect(section).toContain('href="/bg/blog/statia-1"');
    expect(section).toMatch(/<time datetime="2026-10-09">/i);
    expect(section).toContain('href="/bg/blog"');

    const none = render({ ...FULL, articles: [] });
    expect(h2s(none)).not.toContain(TITLES.journal);
    expect(none).not.toContain("/bg/blog");
  });

  it("always explains ordering and points the business buyer to the Vending Zone", () => {
    for (const data of [FULL, SMALL, EMPTY]) {
      const markup = render(data);
      expect(h2s(markup)).toContain(TITLES.ordering);
      expect(markup).toContain(`href="tel:${siteConfig.contact.phoneHref}"`);
      expect(h2s(markup)).toContain(TITLES.vending);
      expect(markup).toContain('href="/bg/kafe-za-vending-mashini"');
    }
  });

  it("renders only what an empty catalog can support, and no empty shell", () => {
    const markup = render(EMPTY);
    expect(h2s(markup)).toEqual([TITLES.ordering, TITLES.vending]);
    expect(sectionCount(markup)).toBe(3);
    expect(markup).not.toContain("<ul");
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("<dl");
  });
});

describe("home page: the delivery promise", () => {
  const strip = (commerce: CommerceConfig): string =>
    renderToStaticMarkup(createElement(DeliveryPromise, { commerce }));

  it("states delivery, time, payment and the phone confirmation when all are set", () => {
    expect(deliveryFacts(COMMERCE).map((fact) => fact.id)).toEqual([
      "delivery",
      "time",
      "payment",
      "confirmation",
    ]);
    const markup = strip(COMMERCE);
    expect(markup).toContain("md:grid-cols-4");
    expect(text(markup)).toContain("49,00 €");
    expect(text(markup)).toContain("5,90 €");
  });

  it("omits each fact whose term is unset", () => {
    const noThreshold = { ...COMMERCE, freeDeliveryThreshold: null };
    expect(text(strip(noThreshold))).not.toContain("безплатна");
    expect(text(strip(noThreshold))).toContain("5,90 €");

    const ids = (commerce: CommerceConfig) => deliveryFacts(commerce).map((fact) => fact.id);
    expect(ids({ ...COMMERCE, freeDeliveryThreshold: null, deliveryFee: null })).toEqual([
      "time",
      "payment",
      "confirmation",
    ]);
    expect(ids({ ...COMMERCE, deliveryTime: null })).not.toContain("time");
    expect(ids({ ...COMMERCE, paymentMethods: [] })).not.toContain("payment");
  });

  it("does not invent a fee: a threshold alone yields one sentence about it", () => {
    const [delivery] = deliveryFacts({ ...COMMERCE, deliveryFee: null });
    expect(text(delivery?.line ?? "")).toBe("Доставката е безплатна за поръчки над 49,00 €.");
  });

  it("is absent with fewer than two facts", () => {
    expect(deliveryFacts(BARE_COMMERCE).map((fact) => fact.id)).toEqual(["confirmation"]);
    expect(strip(BARE_COMMERCE)).toBe("");
    expect(render(EMPTY)).not.toContain("Потвърждаваме по телефона");
  });

  it("does not repeat the announcement bar's wording", () => {
    const promise = freeDeliveryPromise(COMMERCE);
    expect(promise).not.toBeNull();
    expect(text(strip(COMMERCE))).not.toContain(promise as string);
    expect(text(strip(COMMERCE))).not.toContain("Поръчка на една стъпка");
  });

  it("sizes the grid to the facts it has", () => {
    expect(strip({ ...COMMERCE, deliveryTime: null })).toContain("md:grid-cols-3");
    expect(strip({ ...BARE_COMMERCE, paymentMethods: ["cash_on_delivery"] })).toContain(
      "md:grid-cols-2",
    );
  });
});
