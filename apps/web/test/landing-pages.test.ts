import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The landing listings, the machine-brand pages and the consumables page's
 * metadata, rendered without a database. The catalog reads are replaced by
 * the fixtures below; which products a landing selects is `landings.test.ts`.
 * What is tested here is what a page does with a selection — and above all
 * what it does with an empty one.
 */

const state = vi.hoisted(() => ({
  landing: null as unknown,
  systemListing: null as unknown,
  consumablesListed: false,
}));

class NotFound extends Error {}

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFound();
  },
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  useParams: () => ({ lang: "bg" }),
}));
vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => createElement("img", { alt }),
}));
vi.mock("@/lib/catalog/landing-queries", () => ({
  getLanding: async () => state.landing,
  getSystemListing: async () => state.systemListing,
  getLandingAvailability: async () => ({}),
}));
vi.mock("@/lib/catalog/queries", () => ({
  getSystemAvailability: async () => ({ caffitaly: 2, "dolce-gusto": 5, "nespresso-original": 7 }),
}));
vi.mock("@/lib/catalog/vending", async () => {
  const { BUSINESS_SECTIONS } = await import("@/lib/catalog/business-sections");
  return {
    BUSINESS_SECTIONS,
    getSectionListing: async () => null,
    sectionListsProducts: async () => state.consumablesListed,
  };
});
// An async server component; its own links are covered in `landings.test.ts`.
vi.mock("@/components/catalog/related-landings", () => ({
  RelatedLandings: ({ subject }: { subject: unknown }) =>
    createElement("nav", { "data-related": JSON.stringify(subject) }),
}));
vi.mock("@/lib/forms/actions", () => ({
  submitContactMessage: async () => ({ status: "idle" }),
}));

import { LandingPage, landingMetadata } from "@/app/(site)/[lang]/_components/landing-page";
import { generateMetadata as consumablesMetadata } from "@/app/(site)/[lang]/konsumativi/page";
import MachineBrandPage, {
  dynamicParams,
  generateMetadata as machineMetadata,
} from "@/app/(site)/[lang]/za-kafemashina/[brand]/page";
import { absoluteUrl, siteConfig } from "@/config/site";
import { INDEXABLE } from "@/lib/seo/robots";
import { systemShelfLabel } from "../content/landing-copy";
import { CALLBACK_SENTENCE } from "../content/order-callback";
import { MACHINE_BRANDS } from "@/content/machines";
import type { LandingView } from "@/lib/catalog/landing-queries";
import { LANDING_IDS, NO_FLAVOURS } from "@/lib/catalog/landings";
import type { ProductCardView } from "@/lib/catalog/types";
import { BREWING_SYSTEMS, type BrewingSystemId } from "@/lib/recommend/systems";

const system = (id: BrewingSystemId) => BREWING_SYSTEMS.find((entry) => entry.id === id)!;

function product(slug: string, systemId: BrewingSystemId, perCup: string): ProductCardView {
  return {
    id: slug,
    slug,
    name: `Продукт ${slug}`,
    price: { amount: "5.00", currency: "EUR", formatted: "5,00 €" },
    oldPrice: null,
    discountPercent: null,
    availability: "in_stock",
    weight: "10 бр.",
    intensity: null,
    systemId,
    servingPrice: { formatted: `${perCup} € на чаша`, estimated: false },
    brand: { slug: "lavazza", name: "Lavazza" },
    image: null,
    shortDescription: null,
  };
}

const EMPTY: LandingView = {
  groups: [],
  count: 0,
  cupRange: null,
  methods: [],
  commonPack: null,
  flavours: NO_FLAVOURS,
};

const TWO_GROUPS: LandingView = {
  groups: [
    {
      key: "lavazza-blue",
      system: system("lavazza-blue"),
      poolSize: 7,
      lowestPerKg: null,
      products: [
        product("blue-a", "lavazza-blue", "0,33"),
        product("blue-b", "lavazza-blue", "0,34"),
      ],
    },
    {
      key: "nespresso-original",
      system: system("nespresso-original"),
      poolSize: 36,
      lowestPerKg: null,
      products: [product("nes-a", "nespresso-original", "0,48")],
    },
  ],
  count: 3,
  cupRange: {
    min: { amount: "0.3325", estimated: false },
    max: { amount: "0.4800", estimated: false },
  },
  methods: ["capsule"],
  commonPack: null,
  flavours: NO_FLAVOURS,
};

const html = (element: ReactElement) => renderToStaticMarkup(element);
const jsonLd = (markup: string, id: string): Record<string, unknown> =>
  JSON.parse(markup.match(new RegExp(`<script id="${id}"[^>]*>(.*?)</script>`, "s"))?.[1] ?? "{}");

beforeEach(() => {
  state.landing = TWO_GROUPS;
  state.systemListing = EMPTY;
  state.consumablesListed = false;
});

describe("a landing listing with nothing to list", () => {
  it("is a 404, for every one of them", async () => {
    state.landing = EMPTY;
    for (const id of LANDING_IDS) {
      await expect(LandingPage({ locale: "bg", id })).rejects.toBeInstanceOf(NotFound);
    }
  });

  it("asks not to be indexed and names no canonical", async () => {
    state.landing = EMPTY;
    for (const id of LANDING_IDS) {
      const metadata = await landingMetadata("bg", id);
      expect(metadata.robots).toEqual({ index: false, follow: true });
      expect(metadata.alternates).toBeUndefined();
      expect(metadata.description).toBeUndefined();
    }
  });
});

describe("a landing listing with products", () => {
  it("describes itself with the range of what it lists, and its own canonical", async () => {
    const metadata = await landingMetadata("bg", "lavazzaCapsules");
    expect(metadata.title).toEqual({
      absolute: `Капсули Lavazza (Лаваца): Blue и за Nespresso | ${siteConfig.name}`,
    });
    expect(metadata.description).toMatch(/От 0,33\s€ до 0,48\s€ на чаша\./);
    // The one sentence every page uses for how ordering works.
    expect(metadata.description).toContain(CALLBACK_SENTENCE);
    expect(metadata.robots).toBeUndefined();
    expect(metadata.alternates).toEqual({
      canonical: absoluteUrl("/bg/lavazza-kapsuli"),
      languages: {
        bg: absoluteUrl("/bg/lavazza-kapsuli"),
        "x-default": absoluteUrl("/bg/lavazza-kapsuli"),
      },
    });
  });

  it("has one h1, a section per system with its id as the anchor, and cards under h3", async () => {
    const markup = html(await LandingPage({ locale: "bg", id: "lavazzaCapsules" }));
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(markup).toMatch(/<h1[^>]*>Капсули Lavazza<\/h1>/);
    expect(markup).toMatch(/<section id="lavazza-blue"[^>]*aria-labelledby="lavazza-blue-heading"/);
    expect(markup).toMatch(/<section id="nespresso-original"/);
    expect(markup).toMatch(/<h2 id="lavazza-blue-heading"[^>]*>Капсули за Lavazza Blue<\/h2>/);
    expect(markup).toContain("Капсули Lavazza, съвместими с Nespresso Original");
    expect(markup.match(/<h3/g)).toHaveLength(3);
    // Each group links to its system's own shelf, and the page jumps to each group.
    expect(markup).toContain('href="/bg/lavazza-blue-kapsuli"');
    expect(markup).toContain('href="/bg/nespresso-kapsuli"');
    expect(markup).toContain('href="#lavazza-blue"');
    expect(markup).toContain('href="/bg/za-kafemashina"');
  });

  it("emits a breadcrumb list and an item list of everything shown, in order", async () => {
    const markup = html(await LandingPage({ locale: "bg", id: "decaf" }));
    const crumbs = jsonLd(markup, "ld-breadcrumbs");
    expect(crumbs["@type"]).toBe("BreadcrumbList");
    expect((crumbs.itemListElement as { item: string }[]).map((entry) => entry.item)).toEqual([
      absoluteUrl("/bg"),
      absoluteUrl("/bg/bezkofeinovo-kafe"),
    ]);

    const list = jsonLd(markup, "ld-itemlist");
    expect(list).toMatchObject({
      "@type": "ItemList",
      name: "Безкофеиново кафе",
      numberOfItems: 3,
    });
    expect((list.itemListElement as { url: string }[]).map((entry) => entry.url)).toEqual(
      ["blue-a", "blue-b", "nes-a"].map((slug) => absoluteUrl(`/bg/${slug}`)),
    );
  });

  it("says on the cheapest page how each group was chosen, and links the explanation", async () => {
    const markup = html(await LandingPage({ locale: "bg", id: "cheapest" }));
    expect(markup).toContain(
      "Най-ниската цена: 0,33 € на чаша. 2 продукта с най-ниска цена на чаша от общо 7 в тази система.",
    );
    expect(markup).toContain(
      "Най-ниската цена: 0,48 € на чаша. 1 продукт с най-ниска цена на чаша от общо 36 в тази система.",
    );
    // Its headings in the searched words, the Cyrillic beside the Latin where it is typed.
    expect(markup).toMatch(/<h2[^>]*>Най-евтини капсули за Lavazza Blue<\/h2>/);
    expect(markup).toMatch(/<h2[^>]*>Най-евтини капсули за Nespresso \(Неспресо\)<\/h2>/);
    expect(markup).toContain('href="/bg/blog/');
    // The one article this listing links (§13.4), under the article's own title.
    expect(markup).toMatch(
      /href="\/bg\/blog\/kolko-struva-edna-chasha-kafe"[^>]*>Колко струва една чаша кафе всъщност</,
    );
  });

  it("gives a one-group page no second heading, and its cards the h2", async () => {
    state.landing = {
      ...TWO_GROUPS,
      groups: [
        {
          key: "beans",
          system: system("beans"),
          poolSize: 1,
          lowestPerKg: null,
          products: [product("b", "beans", "0,14")],
        },
      ],
      count: 1,
      methods: ["beans"],
      commonPack: "1 кг",
    } satisfies LandingView;
    const markup = html(await LandingPage({ locale: "bg", id: "lavazzaBeans" }));
    expect(markup).toMatch(/<section id="beans"/);
    // The card, and the order section at the foot.
    expect(markup.match(/<h2/g)).toHaveLength(2);
    expect(markup).not.toMatch(/<h3/);
    expect(markup).not.toContain('href="#beans"');
  });

  it("draws the flavoured page as the decaf one: one h1, a group per system, its own canonical", async () => {
    state.landing = {
      ...TWO_GROUPS,
      groups: [
        {
          key: "nespresso-original",
          system: system("nespresso-original"),
          poolSize: 2,
          lowestPerKg: null,
          products: [
            product("nes-caramel", "nespresso-original", "0,46"),
            product("nes-hazelnut", "nespresso-original", "0,46"),
          ],
        },
        {
          key: "ese-pod",
          system: system("ese-pod"),
          poolSize: 1,
          lowestPerKg: null,
          products: [product("ese-hazelnut", "ese-pod", "0,36")],
        },
      ],
      count: 3,
      methods: ["capsule", "pod"],
      flavours: { named: ["hazelnut", "caramel"], others: false },
    } satisfies LandingView;

    const metadata = await landingMetadata("bg", "flavoured");
    // Forty-five characters: the shop's name still fits after them.
    expect(metadata.title).toEqual({
      absolute: `Ароматизирано кафе с вкус на лешник и карамел | ${siteConfig.name}`,
    });
    expect(metadata.description).toMatch(
      /^Кафе с вкус на лешник и карамел — в капсули и дози ESE\. От 0,33\s€ до 0,48\s€ на чаша\./,
    );
    expect(metadata.description).toContain(CALLBACK_SENTENCE);
    expect([...(metadata.description ?? "")].length).toBeLessThanOrEqual(160);
    // `index, follow` is the layout's; the page states no robots of its own.
    expect(metadata.robots).toBeUndefined();
    expect(metadata.alternates?.canonical).toBe(absoluteUrl("/bg/aromatizirano-kafe"));

    const markup = html(await LandingPage({ locale: "bg", id: "flavoured" }));
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(markup).toMatch(/<h1[^>]*>Ароматизирано кафе<\/h1>/);
    expect(markup).toMatch(
      /<h2 id="nespresso-original-heading"[^>]*>Ароматизирани капсули за Nespresso<\/h2>/,
    );
    expect(markup).toMatch(/<h2 id="ese-pod-heading"[^>]*>Ароматизирани дози ESE<\/h2>/);
    expect(markup).toContain('href="#nespresso-original"');
    expect(markup).toContain('href="/bg/nespresso-kapsuli"');
    expect(markup).toContain('href="/bg/kafe-dozi"');
    // Capsules are listed, so the page sends a visitor unsure of the system to the finder.
    expect(markup).toContain('href="/bg/za-kafemashina"');
    expect(markup).toContain(
      "Тук са 3 продукта с добавен аромат — сред тях кафе с вкус на лешник и на карамел.",
    );
    expect(markup).toContain("Всички са в капсули и дози ESE.");
    expect(markup).not.toContain("всичко ароматизирано");

    const crumbs = jsonLd(markup, "ld-breadcrumbs");
    expect((crumbs.itemListElement as { item: string }[]).map((entry) => entry.item)).toEqual([
      absoluteUrl("/bg"),
      absoluteUrl("/bg/aromatizirano-kafe"),
    ]);
    expect(jsonLd(markup, "ld-itemlist")).toMatchObject({
      "@type": "ItemList",
      name: "Ароматизирано кафе",
      numberOfItems: 3,
    });
  });

  it("offers the phone, and promises nothing about stock, delivery or quality", async () => {
    for (const id of LANDING_IDS) {
      const markup = html(await LandingPage({ locale: "bg", id }));
      expect(markup).toMatch(/href="tel:/);
      expect(markup).not.toMatch(/!<|оригиналн|най-добр|безплатна доставка/i);
    }
  });
});

describe("a landing's link to a system's whole shelf", () => {
  it("names the shelf as the shelf names itself", () => {
    // One anchor per listing (`docs/seo.md` §13.1): „Всички“ and the name the
    // breadcrumbs, chips and footer give that listing.
    expect(BREWING_SYSTEMS.map((entry) => [entry.id, systemShelfLabel(entry)])).toEqual([
      ["nespresso-original", "Всички капсули за Nespresso"],
      ["dolce-gusto", "Всички капсули за Dolce Gusto"],
      ["a-modo-mio", "Всички капсули за Lavazza A Modo Mio"],
      ["caffitaly", "Всички капсули Caffitaly"],
      ["lavazza-blue", "Всички капсули за Lavazza Blue"],
      ["ese-pod", "Всички дози ESE"],
      ["beans", "Цялото кафе на зърна"],
    ]);
  });
});

describe("the machine-brand pages", () => {
  const params = (brand: string) => ({ params: Promise.resolve({ lang: "bg", brand }) });

  it("answers an unknown brand at routing, where the 404 is drawn on the server", () => {
    expect(dynamicParams).toBe(false);
  });

  it("titles Tchibo for Cafissimo and every other brand generically", async () => {
    state.systemListing = { ...TWO_GROUPS, groups: [TWO_GROUPS.groups[0]!], count: 2 };
    const tchibo = await machineMetadata(params("tchibo"));
    expect(tchibo.title).toEqual({
      absolute: "Капсули за Tchibo Cafissimo (Чибо) — формат Caffitaly",
    });
    expect(tchibo.description).toMatch(
      /2 вида капсули Caffitaly\. От 0,33\s€ до 0,48\s€ на чаша\./,
    );

    const krups = await machineMetadata(params("krups"));
    expect(krups.title).toEqual({
      absolute: "Капсули и кафе за кафемашини Krups — какво пасва",
    });
    expect((await machineMetadata(params("jura"))).title).toEqual({
      absolute: `Кафе за кафемашини Jura — какво пасва | ${siteConfig.name}`,
    });
  });

  it("leads the Tchibo page with which capsules fit, lists them, then the models", async () => {
    state.systemListing = {
      ...EMPTY,
      groups: [
        {
          key: "caffitaly",
          system: system("caffitaly"),
          poolSize: 2,
          lowestPerKg: null,
          products: [product("caf-a", "caffitaly", "0,54"), product("caf-b", "caffitaly", "0,60")],
        },
      ],
      count: 2,
      methods: ["capsule"],
    } satisfies LandingView;
    const markup = html(await MachineBrandPage(params("tchibo")));

    expect(markup).toMatch(/<h1[^>]*>Капсули за Tchibo Cafissimo<\/h1>/);
    expect(markup).toContain("капсулите Caffitaly пасват в тях по размер и форма");
    // With Tchibo's own caveat, in the summary and beside the models.
    expect(markup).toContain(
      "Tchibo посочва, че в Cafissimo трябва да се използват само нейните капсули",
    );
    expect(markup).toContain(
      "Производителят на машината посочва, че в нея трябва да се използват само неговите капсули",
    );
    expect(markup).toContain('data-related="{&quot;machineBrand&quot;:&quot;tchibo&quot;}"');
    expect(markup).toContain('href="/bg/caf-a"');
    expect(markup).toContain('href="/bg/caf-b"');
    expect(jsonLd(markup, "ld-itemlist")).toMatchObject({ "@type": "ItemList", numberOfItems: 2 });

    const list = markup.indexOf('id="fits-heading"');
    const models = markup.indexOf('id="tchibo-cafissimo-classic"');
    expect(markup.indexOf("<h1")).toBeLessThan(list);
    expect(list).toBeLessThan(models);
    // No heading level is skipped: h1, the list's h2, the cards' h3, the system's h2.
    const levels = [...markup.matchAll(/<h([1-6])/g)].map((match) => Number(match[1]));
    levels.reduce((previous, level) => {
      expect(level - previous).toBeLessThanOrEqual(1);
      return level;
    }, 1);
  });

  it("drops the list, and the sentence about it, when Caffitaly has nothing on sale", async () => {
    const markup = html(await MachineBrandPage(params("tchibo")));
    expect(markup).toMatch(/<h1[^>]*>Капсули за Tchibo Cafissimo<\/h1>/);
    expect(markup).not.toContain('id="fits-heading"');
    expect(markup).not.toContain("ld-itemlist");
    expect(markup).not.toContain("По-долу са капсулите");
    expect(markup).toContain('id="tchibo-cafissimo-classic"');
  });

  it("sends each system's group to that system's shelf, once, under the shelf's name", async () => {
    // Krups makes machines for Dolce Gusto and Nespresso (both on sale in the
    // fixture) and bean-to-cup ones (not on sale in it).
    const markup = html(await MachineBrandPage(params("krups")));
    expect(markup).toMatch(
      /<a[^>]*href="\/bg\/dolce-gusto-kapsuli"[^>]*>Капсули за Dolce Gusto<\/a>/,
    );
    expect(markup).toMatch(/<a[^>]*href="\/bg\/nespresso-kapsuli"[^>]*>Капсули за Nespresso<\/a>/);
    for (const shelf of ["/bg/dolce-gusto-kapsuli", "/bg/nespresso-kapsuli"]) {
      expect(markup.split(`href="${shelf}"`), shelf).toHaveLength(2);
    }
    // One anchor per listing (`docs/seo.md` §13.1): not seven links called the same.
    expect(markup).not.toContain("Вижте всички");
    // A system with nothing on sale offers the phone, not a link to an empty shelf.
    expect(markup).not.toContain('href="/bg/kafe-na-zarna"');
  });

  it.each(MACHINE_BRANDS.map((brand) => brand.slug))(
    "%s links nothing a crawler is told not to fetch",
    async (slug) => {
      // `robots.ts` disallows answered wizard states and filtered listings;
      // nothing crawlable may point at one (`docs/seo.md` §13.6).
      const markup = html(await MachineBrandPage(params(slug)));
      const hrefs = [...markup.matchAll(/href="([^"]*)"/g)].map((match) => match[1] ?? "");
      expect(hrefs.length).toBeGreaterThan(0);
      expect(hrefs.filter((target) => target.includes("?"))).toEqual([]);
      expect(hrefs.filter((target) => target.startsWith("/bg/izbor-na-kafe/"))).toEqual([]);
    },
  );

  it("gives every other brand the generic heading and no product list", async () => {
    const markup = html(await MachineBrandPage(params("krups")));
    expect(markup).toMatch(/<h1[^>]*>Кафемашини Krups: какво им пасва<\/h1>/);
    expect(markup).not.toContain('id="fits-heading"');
    expect(markup.match(/<h1/g)).toHaveLength(1);
  });
});

describe("the consumables page", () => {
  const props = (search: Record<string, string> = {}) => ({
    params: Promise.resolve({ lang: "bg" }),
    searchParams: Promise.resolve(search),
  });

  it("is noindex while it lists nothing", async () => {
    expect((await consumablesMetadata(props())).robots).toEqual({ index: false, follow: true });
  });

  it("indexes again by itself once the catalog files a product under it", async () => {
    state.consumablesListed = true;
    const metadata = await consumablesMetadata(props());
    /* Stated, not left undefined: `robots: undefined` erases the layout's
       directive rather than inheriting it (`lib/seo/robots.ts`). */
    expect(metadata.robots).toEqual(INDEXABLE);
    expect(metadata.alternates?.canonical).toBe(absoluteUrl("/bg/konsumativi"));
    // A filtered view of the listing still consolidates on the clean page.
    const sorted = await consumablesMetadata(props({ sort: "price-asc" }));
    expect(sorted.robots).toEqual({ index: false, follow: true });
    expect(sorted.alternates?.canonical).toBe(absoluteUrl("/bg/konsumativi"));
  });

  /* Page two is a page of its own: its own canonical, its own title, and
     indexed, since it is the only page linking what page one has no room for
     (`lib/seo/pagination.ts`). */
  it("names page two as itself, under a title that says which page it is", async () => {
    state.consumablesListed = true;
    const second = await consumablesMetadata(props({ page: "2" }));
    expect(second.robots).toEqual(INDEXABLE);
    expect(second.alternates?.canonical).toBe(absoluteUrl("/bg/konsumativi?page=2"));
    expect(second.alternates?.languages).toEqual({
      bg: absoluteUrl("/bg/konsumativi?page=2"),
      "x-default": absoluteUrl("/bg/konsumativi?page=2"),
    });
    expect(JSON.stringify(second.title)).toContain("— страница 2");
    expect(second.openGraph).toMatchObject({ url: absoluteUrl("/bg/konsumativi?page=2") });
    // Sorted and on page two is still an arrangement of the clean listing.
    const sortedSecond = await consumablesMetadata(props({ page: "2", sort: "price-asc" }));
    expect(sortedSecond.alternates?.canonical).toBe(absoluteUrl("/bg/konsumativi"));
  });
});
