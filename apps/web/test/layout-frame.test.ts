import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The frame every page sits in: announcement bar, header rail, drawer trigger,
 * footer — and the two machine-readable maps of the site, the sitemap and
 * `llms.txt`. All of it without a database: the catalog reads are replaced by
 * the fixtures below, so what is tested is what the frame does with a catalog,
 * not the catalog.
 */

const catalog = vi.hoisted(() => ({
  tree: [] as unknown[],
  products: [] as { slug: string; updatedAt: Date | null }[],
  brands: [] as { slug: string; name: string }[],
  consumablesListed: false,
  /** Products each landing listing holds; zero means the page does not exist. */
  landings: { lavazzaCapsules: 0, lavazzaBeans: 0, decaf: 0, cheapest: 0 },
}));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/catalog/queries", () => ({
  getCategoryTree: async () => catalog.tree,
  listAllProductSlugs: async () => catalog.products,
  listBrands: async () => catalog.brands,
  getCatalogSummary: async () => ({ products: 3, brands: 1, categories: 2, promotions: 0 }),
  getProductBySlug: async () => null,
  listProducts: async () => ({ items: [] }),
}));
vi.mock("@/lib/catalog/vending", () => ({
  sectionListsProducts: async () => catalog.consumablesListed,
}));
vi.mock("@/lib/catalog/landing-queries", async () => {
  const { NO_LANDINGS } = await import("@/lib/catalog/landings");
  return {
    getLandingAvailability: async () => ({ ...NO_LANDINGS, counts: { ...catalog.landings } }),
  };
});
vi.mock("next/navigation", () => ({
  usePathname: () => "/bg/nespresso-kapsuli",
  useParams: () => ({ lang: "bg" }),
  useRouter: () => ({ push: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => createElement("img", { alt }),
}));
// The search field and the newsletter form are other people's components with
// their own tests; here they are only a place in the markup.
vi.mock("@/components/catalog/search-field", () => ({
  SearchField: () => createElement("form", { role: "search" }),
}));
vi.mock("@/components/forms/newsletter-form", () => ({
  NewsletterForm: () => createElement("form", { "data-newsletter": "" }),
}));

import sitemap from "@/app/sitemap";
import { GET as llmsRoute } from "@/app/llms.txt/route";
import { deliveryTermLines, llmsText, type LlmsInput } from "@/app/llms.txt/body";
import { AnnouncementBar, hasAnnouncement } from "@/components/commerce/announcement-bar";
import { buildNavigation, isCurrentSection } from "@/components/layout/navigation";
import { SiteFooter, SiteFooterView } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { absoluteUrl, siteConfig, type CommerceConfig } from "@/config/site";
import { BUSINESS_SECTIONS } from "@/lib/catalog/business-sections";
import { NO_LANDINGS, type LandingAvailability } from "@/lib/catalog/landings";
import type { CategoryView } from "@/lib/catalog/types";
import { listArticles } from "@/lib/journal";
import { BREWING_SYSTEMS } from "@/lib/recommend/systems";
import { bg as dict } from "@/i18n/dictionaries/bg";
import { href } from "@/lib/routes";

/** A canonical path as a Bulgarian URL, the way every link is built. */
const bgPath = (path: string) => href("bg", path);

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);

const UNSET: CommerceConfig = {
  confirmedByOwner: false,
  freeDeliveryThreshold: null,
  deliveryFee: null,
  deliveryTime: null,
  couriers: [],
  paymentMethods: [],
  returnWindowDays: null,
  returnShippingPaidBy: null,
  openingHours: [],
};

const WITH_THRESHOLD: CommerceConfig = {
  ...UNSET,
  freeDeliveryThreshold: "49.00",
  paymentMethods: ["cash_on_delivery"],
};

function category(
  slug: string,
  productCount: number,
  children: CategoryView[] = [],
  parentSlug: string | null = null,
  /* The source's key. For most categories it is our slug; the capsule parent
     is the one the source renamed (`kapsuli` became `kafe-kapsuli`). */
  sourceKey: string = slug,
): CategoryView {
  return {
    id: slug,
    slug,
    sourceKey,
    previousSourceKeys: [],
    name: `Име ${slug}`,
    description: null,
    parentSlug,
    productCount,
    children: children.map((child) => ({ ...child, parentSlug: slug })),
  };
}

/**
 * A catalog with one sold-out capsule system (Caffitaly), one system the
 * source does not list at all (Lavazza Blue), both business-section
 * categories filed by the sync, and one category nobody planned for.
 */
const TREE: CategoryView[] = [
  category("kafe-dozi", 41),
  category(
    "kapsuli",
    72,
    [
      category("nespresso", 36),
      category("dolce-gusto", 33),
      category("a-modo-mio", 3),
      category("caffitaly", 0),
    ],
    null,
    "kafe-kapsuli",
  ),
  category("kafe-na-zyrna", 58),
  category("vending-zona", 5),
  category("konsumativi", 12),
  category("aksesoari", 4),
];

const navigation = (tree: CategoryView[] = TREE) =>
  buildNavigation(tree, { locale: "bg", labels: dict.nav, sections: BUSINESS_SECTIONS });

beforeEach(() => {
  catalog.tree = TREE;
  catalog.products = [{ slug: "kapsuli-a", updatedAt: new Date("2026-05-01T00:00:00.000Z") }];
  catalog.brands = [{ slug: "bianchi", name: "Bianchi" }];
  catalog.consumablesListed = false;
  catalog.landings = { lavazzaCapsules: 0, lavazzaBeans: 0, decaf: 0, cheapest: 0 };
});

const LANDING_URLS = [
  "/bg/lavazza-kapsuli",
  "/bg/kafe-na-zarna-lavazza",
  "/bg/bezkofeinovo-kafe",
  "/bg/nay-evtino-na-chasha",
] as const;

describe("the navigation built from the category tree", () => {
  it("lists capsule systems that have products, in the systems' own order", () => {
    const nav = navigation();
    expect(nav.capsules?.systems.map((system) => system.id)).toEqual([
      "nespresso-original",
      "dolce-gusto",
      "a-modo-mio",
    ]);
    expect(nav.capsules?.systems[0]).toMatchObject({
      name: "Nespresso Original",
      href: "/bg/nespresso-kapsuli",
      count: 36,
    });
  });

  it("omits a system with no products and one with no category", () => {
    const ids = navigation().capsules?.systems.map((system) => system.id) ?? [];
    expect(ids).not.toContain("caffitaly");
    expect(ids).not.toContain("lavazza-blue");
  });

  it("reads the capsules parent from the tree instead of naming it", () => {
    // By its landing slug, found through the source key, not its stored `kapsuli`.
    expect(navigation().capsules?.href).toBe("/bg/kafe-kapsuli");

    // A parent the slug table does not know is linked at its stored slug.
    const renamed = [category("kapsuli-za-kafe", 36, [category("nespresso", 36)])];
    expect(navigation(renamed).capsules?.href).toBe("/bg/kapsuli-za-kafe");

    // Systems at the top level: there is no parent listing to link.
    expect(navigation([category("nespresso", 36)]).capsules?.href).toBe("/bg/kategorii");
  });

  it("binds pods and beans through BREWING_SYSTEMS, and drops them when empty", () => {
    const nav = navigation();
    expect(nav.pods).toMatchObject({ id: "ese-pod", href: "/bg/kafe-dozi", count: 41 });
    expect(nav.beans).toMatchObject({ id: "beans", href: "/bg/kafe-na-zarna" });

    const none = navigation([category("kafe-dozi", 0)]);
    expect(none.pods).toBeNull();
    expect(none.beans).toBeNull();
    expect(none.capsules).toBeNull();
  });

  it("links the business sections by their pages and never as categories", () => {
    const nav = navigation();
    expect(nav.vending.href).toBe("/bg/kafe-za-vending-mashini");
    expect(nav.consumables.href).toBe("/bg/konsumativi");

    const hrefs = nav.otherCategories.map((entry) => entry.href);
    // A category nobody planned for is still reachable, at its stored slug.
    expect(hrefs).toEqual(["/bg/aksesoari"]);
  });

  it("knows a section from its neighbour", () => {
    expect(isCurrentSection("/bg/za-kafemashina/krups", "/bg/za-kafemashina")).toBe(true);
    expect(isCurrentSection("/bg/izbor-na-kafe/rezultat", "/bg/izbor-na-kafe")).toBe(true);
    expect(
      isCurrentSection("/bg/izbor-na-kafe/rezultat", "/bg/izbor-na-kafe", [
        "/bg/izbor-na-kafe/rezultat",
      ]),
    ).toBe(false);
    expect(isCurrentSection("/bg/markisti", "/bg/marki")).toBe(false);
    // The locale's home is above every page and counts only as itself.
    expect(isCurrentSection("/bg/marki", "/bg")).toBe(false);
    expect(isCurrentSection("/bg", "/bg")).toBe(true);
  });
});

describe("the header", () => {
  const markup = () => html(createElement(SiteHeader, { navigation: navigation(), dict }));
  const rail = () => markup().match(/<nav aria-label="Основна навигация".*?<\/nav>/s)?.[0] ?? "";

  it("puts the machine finder and the wizard in the rail", () => {
    expect(rail()).toContain('href="/bg/za-kafemashina"');
    expect(rail()).toContain("Намери по машина");
    expect(rail()).toContain('href="/bg/izbor-na-kafe"');
    expect(rail()).toContain('href="/bg/kafe-za-vending-mashini"');
  });

  it("names every listed system beside its colour, and leaves the empty one out", () => {
    for (const id of ["nespresso-original", "dolce-gusto", "a-modo-mio"]) {
      const name = BREWING_SYSTEMS.find((system) => system.id === id)?.name ?? "";
      expect(rail()).toMatch(new RegExp(`data-system="${id}"[^>]*>.*?${name}`, "s"));
    }
    expect(rail()).not.toContain("caffitaly");
    expect(rail()).not.toContain("Caffitaly");
  });

  it("never lists a business-section category", () => {
    expect(markup()).not.toContain("/bg/vending-zona");
    expect(markup()).not.toContain("konsumativi-kategoriya");
  });

  it("puts systems ahead of brands", () => {
    expect(rail().indexOf("/bg/nespresso-kapsuli")).toBeLessThan(
      rail().indexOf('href="/bg/marki"'),
    );
    expect(rail().indexOf("/bg/za-kafemashina")).toBeLessThan(rail().indexOf('href="/bg/marki"'));
  });

  it("marks the current section in text, not only in colour", () => {
    // The mocked path is the Nespresso shelf: the system is under "Капсули".
    expect(rail()).toMatch(/aria-current="true"[^>]*href="\/bg\/kafe-kapsuli"/);
  });

  it("makes the menu trigger a real link, so it works without JavaScript", () => {
    expect(markup()).toMatch(/<a[^>]*href="\/bg\/kategorii"[^>]*aria-label="Меню"/);
    // The drawer itself is not in the server markup.
    expect(markup()).not.toContain('role="dialog"');
  });

  it("has no heading of its own and no second pine strip", () => {
    expect(markup()).not.toMatch(/<h1/);
    expect(markup()).not.toContain("bg-pine-900");
  });

  it("draws no language switcher while one locale ships", () => {
    expect(markup()).not.toContain("hreflang=");
    expect(markup()).not.toContain('aria-label="Език"');
  });

  it("prints the phone number itself only when there is no bar to carry it", () => {
    expect(markup()).not.toContain(siteConfig.contact.phone);
    expect(
      html(createElement(SiteHeader, { navigation: navigation(), dict, showPhone: true })),
    ).toContain(siteConfig.contact.phone);
  });
});

describe("the footer", () => {
  const markup = (landings?: LandingAvailability) =>
    html(createElement(SiteFooterView, { navigation: navigation(), dict, landings }));

  it("links decaf and cheapest per cup, each only while it lists something", () => {
    expect(markup()).not.toContain("/bg/bezkofeinovo-kafe");
    expect(markup()).not.toContain("/bg/nay-evtino-na-chasha");

    const both = markup({
      ...NO_LANDINGS,
      counts: { ...NO_LANDINGS.counts, decaf: 8, cheapest: 21 },
    });
    expect(both).toMatch(/href="\/bg\/bezkofeinovo-kafe"[^>]*>Безкофеиново кафе</);
    expect(both).toMatch(/href="\/bg\/nay-evtino-na-chasha"[^>]*>Най-евтино на чаша</);

    const one = markup({ ...NO_LANDINGS, counts: { ...NO_LANDINGS.counts, cheapest: 21 } });
    expect(one).not.toContain("/bg/bezkofeinovo-kafe");
    expect(one).toContain('href="/bg/nay-evtino-na-chasha"');
  });

  it("reads for itself which landings exist, so the layout passes nothing new", async () => {
    catalog.landings = { ...catalog.landings, decaf: 8 };
    const element = await SiteFooter({ navigation: navigation(), dict });
    const rendered = html(element);
    expect(rendered).toContain('href="/bg/bezkofeinovo-kafe"');
    expect(rendered).not.toContain("/bg/nay-evtino-na-chasha");
  });

  it("reaches every new section", () => {
    for (const path of [
      "/bg/kafe-za-vending-mashini",
      "/bg/konsumativi",
      "/bg/dostavka-i-plashtane",
      "/bg/blog",
      "/bg/za-kafemashina",
      "/bg/obshti-usloviya",
      "/bg/poveritelnost",
      "/bg/biskvitki",
    ]) {
      expect(markup()).toContain(`href="${path}"`);
    }
  });

  it("draws no language switcher while one locale ships", () => {
    expect(markup()).not.toContain("hreflang=");
  });

  it("lists systems, not the business-section categories", () => {
    expect(markup()).toContain('href="/bg/nespresso-kapsuli"');
    expect(markup()).not.toContain("/bg/vending-zona");
    expect(markup()).not.toContain("caffitaly-kapsuli");
  });

  it("uses no clay: nothing here is a reduced price", () => {
    expect(markup()).not.toMatch(/clay-/);
    expect(markup()).not.toMatch(/<h1/);
  });
});

describe("the announcement bar", () => {
  it("is absent, not empty, without a threshold", () => {
    expect(html(createElement(AnnouncementBar, { commerce: UNSET }))).toBe("");
    expect(hasAnnouncement(UNSET)).toBe(false);
    // A threshold that is not a usable amount is no threshold.
    expect(
      html(createElement(AnnouncementBar, { commerce: { ...UNSET, freeDeliveryThreshold: "0" } })),
    ).toBe("");
  });

  it("is pine, with the figure — and only the figure — in gold", () => {
    const markup = html(createElement(AnnouncementBar, { commerce: WITH_THRESHOLD }));
    expect(hasAnnouncement(WITH_THRESHOLD)).toBe(true);
    expect(markup).toMatch(/^<aside[^>]*class="on-pine bg-pine-900 text-paper"/);
    expect(markup).toMatch(
      /Безплатна доставка за поръчки над <strong class="font-semibold text-gold-300">49,00\s€<\/strong>/,
    );
    expect(markup.match(/gold-/g)).toHaveLength(1);
    expect(markup).not.toMatch(/clay-|bg-gold/);
  });

  it("carries the phone number as a link", () => {
    const markup = html(createElement(AnnouncementBar, { commerce: WITH_THRESHOLD }));
    expect(markup).toContain(`href="tel:${siteConfig.contact.phoneHref}"`);
  });

  it("cannot be dismissed: it is where the hours and the phone number live", () => {
    const markup = html(createElement(AnnouncementBar, { commerce: WITH_THRESHOLD }));
    expect(markup).not.toContain("<button");
    expect(markup).toMatch(/^<aside aria-label="Доставка и поръчка"/);
    expect(markup).toContain("tel:");
  });
});

describe("the sitemap", () => {
  const urls = async () => (await sitemap()).map((entry) => entry.url);

  it("lists delivery, the vending section and the journal", async () => {
    const listed = await urls();
    for (const path of ["/bg/dostavka-i-plashtane", "/bg/kafe-za-vending-mashini", "/bg/blog"]) {
      expect(listed).toContain(absoluteUrl(path));
    }
  });

  it("leaves consumables out while it lists nothing, and in once it does", async () => {
    expect(await urls()).not.toContain(absoluteUrl("/bg/konsumativi"));
    catalog.consumablesListed = true;
    expect(await urls()).toContain(absoluteUrl("/bg/konsumativi"));
  });

  it("lists each landing only while it has products", async () => {
    const none = await urls();
    for (const path of LANDING_URLS) expect(none).not.toContain(absoluteUrl(path));

    catalog.landings = { lavazzaCapsules: 10, lavazzaBeans: 0, decaf: 8, cheapest: 0 };
    const some = await urls();
    expect(some).toContain(absoluteUrl("/bg/lavazza-kapsuli"));
    expect(some).toContain(absoluteUrl("/bg/bezkofeinovo-kafe"));
    expect(some).not.toContain(absoluteUrl("/bg/kafe-na-zarna-lavazza"));
    expect(some).not.toContain(absoluteUrl("/bg/nay-evtino-na-chasha"));

    catalog.landings = { lavazzaCapsules: 10, lavazzaBeans: 8, decaf: 8, cheapest: 21 };
    const all = await urls();
    for (const path of LANDING_URLS) expect(all).toContain(absoluteUrl(path));
  });

  it("gives every entry its hreflang set, x-default included", async () => {
    for (const entry of await sitemap()) {
      expect(entry.url.startsWith(absoluteUrl("/bg"))).toBe(true);
      expect(entry.alternates?.languages).toEqual({ bg: entry.url, "x-default": entry.url });
    }
  });

  it("lists every article with its own date", async () => {
    const entries = await sitemap();
    const articles = listArticles();
    expect(articles.length).toBeGreaterThan(0);
    for (const article of articles) {
      const entry = entries.find(
        (candidate) => candidate.url === absoluteUrl(bgPath(article.href)),
      );
      expect(entry?.lastModified).toEqual(article.lastModified);
    }
  });

  it("dates the journal by its newest article and a product by its last change", async () => {
    const entries = await sitemap();
    const newest = Math.max(...listArticles().map((article) => article.lastModified.getTime()));
    const journal = entries.find((entry) => entry.url === absoluteUrl("/bg/blog"));
    expect((journal?.lastModified as Date).getTime()).toBe(newest);

    const product = entries.find((entry) => entry.url === absoluteUrl("/bg/kapsuli-a"));
    expect(product?.lastModified).toEqual(new Date("2026-05-01T00:00:00.000Z"));
  });

  it("lists nothing twice", async () => {
    // A category whose slug the tree repeats must still appear once.
    catalog.tree = [...TREE, category("aksesoari", 4)];
    const listed = await urls();
    expect(new Set(listed).size).toBe(listed.length);
  });

  it("advertises a business section once, at its own page", async () => {
    const listed = await urls();
    expect(listed).not.toContain(absoluteUrl("/bg/vending-zona"));
    expect(listed.some((url) => url.includes("konsumativi-kategoriya"))).toBe(false);
    expect(listed).toContain(absoluteUrl("/bg/nespresso-kapsuli"));
  });

  it("is still the live catalog: no product, no URL", async () => {
    catalog.products = [];
    expect(await urls()).not.toContain(absoluteUrl("/bg/kapsuli-a"));
  });
});

describe("llms.txt", () => {
  const input = (commerce: CommerceConfig): LlmsInput => ({
    summary: { products: 3, brands: 1, categories: 2 },
    categories: [{ name: "Кафе капсули", href: "/bg/kafe-kapsuli" }],
    brands: [{ name: "Bianchi", href: "/bg/marki/bianchi" }],
    machineBrandCount: 4,
    sections: [
      { name: "Вендинг зона", href: "/bg/kafe-za-vending-mashini", description: "За оператори." },
    ],
    articles: [{ name: "Статия", href: "/bg/blog/statiya", description: "За какво е." }],
    commerce,
    company: null,
  });

  it("says nothing about delivery or payment when nothing is set", () => {
    expect(deliveryTermLines(UNSET)).toEqual([]);
    const text = llmsText(input(UNSET));
    expect(text).not.toContain("## Доставка и плащане");
    expect(text).not.toMatch(/Доставката (е|струва)/);
    expect(text).not.toContain("Плащате");
  });

  it("states exactly the terms that are set, in the site's own sentences", () => {
    const lines = deliveryTermLines(WITH_THRESHOLD);
    expect(lines[0]).toMatch(/^Доставката е безплатна за поръчки над 49,00\s€\.$/);
    expect(lines).toContain("Плащате в брой при получаване на пратката (наложен платеж).");
    // No delivery time and no courier were configured, so neither is mentioned.
    expect(lines.join(" ")).not.toMatch(/куриер|работн/);

    const text = llmsText(input(WITH_THRESHOLD));
    expect(text).toContain("## Доставка и плащане");
    expect(text).toContain(`- ${lines[0]}`);
  });

  it("states a fee on its own, and payment on its own", () => {
    expect(deliveryTermLines({ ...UNSET, deliveryFee: "5.90" })).toHaveLength(1);
    expect(deliveryTermLines({ ...UNSET, paymentMethods: ["bank_transfer"] })).toEqual([
      "Плащате предварително с банков превод.",
    ]);
  });

  it("lists the business sections and the journal, and drops an empty journal", () => {
    const text = llmsText(input(UNSET));
    expect(text).toContain(
      `- [Вендинг зона](${absoluteUrl("/bg/kafe-za-vending-mashini")}): За оператори.`,
    );
    expect(text).toContain(`- [Статия](${absoluteUrl("/bg/blog/statiya")}): За какво е.`);
    expect(text).toContain(`(${absoluteUrl("/bg/dostavka-i-plashtane")})`);
    expect(text).toContain(`(${absoluteUrl("/bg/za-kafemashina")})`);

    expect(llmsText({ ...input(UNSET), articles: [] })).not.toContain("## Блог");
  });

  it("lists the landing listings it is given, and no empty block without them", () => {
    expect(llmsText(input(UNSET))).not.toContain("## Подбрани списъци");
    const text = llmsText({
      ...input(UNSET),
      landings: [
        { name: "Безкофеиново кафе", href: "/bg/bezkofeinovo-kafe", description: "Без кофеин." },
      ],
    });
    expect(text).toContain("## Подбрани списъци");
    expect(text).toContain(
      `- [Безкофеиново кафе](${absoluteUrl("/bg/bezkofeinovo-kafe")}): Без кофеин.`,
    );
  });

  it("is served only on production, with the real sections and articles", async () => {
    const previous = process.env.VERCEL_ENV;
    try {
      process.env.VERCEL_ENV = "preview";
      expect((await llmsRoute()).status).toBe(404);

      process.env.VERCEL_ENV = "production";
      const text = await (await llmsRoute()).text();
      expect(text).toContain(`(${absoluteUrl("/bg/kafe-za-vending-mashini")})`);
      // Consumables and the landings follow the sitemap: out while they list nothing.
      expect(text).not.toContain(`(${absoluteUrl("/bg/konsumativi")})`);
      for (const path of LANDING_URLS) expect(text).not.toContain(`(${absoluteUrl(path)})`);

      catalog.consumablesListed = true;
      catalog.landings = { lavazzaCapsules: 10, lavazzaBeans: 8, decaf: 8, cheapest: 21 };
      const filled = await (await llmsRoute()).text();
      expect(filled).toContain(`(${absoluteUrl("/bg/konsumativi")})`);
      for (const path of LANDING_URLS) expect(filled).toContain(`(${absoluteUrl(path)})`);
      for (const article of listArticles()) {
        expect(text).toContain(`(${absoluteUrl(bgPath(article.href))})`);
      }
      // The category behind a section is named by the section, not twice.
      expect(text).not.toContain("/bg/vending-zona");
      expect(text).toContain(`(${absoluteUrl("/bg/kafe-kapsuli")})`);
    } finally {
      if (previous === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = previous;
    }
  });
});
