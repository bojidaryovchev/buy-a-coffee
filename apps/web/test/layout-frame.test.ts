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
vi.mock("next/navigation", () => ({
  usePathname: () => "/categories/nespresso",
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
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { absoluteUrl, siteConfig, type CommerceConfig } from "@/config/site";
import { BUSINESS_SECTIONS } from "@/lib/catalog/vending";
import type { CategoryView } from "@/lib/catalog/types";
import { listArticles } from "@/lib/journal";
import { BREWING_SYSTEMS } from "@/lib/recommend/systems";

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
): CategoryView {
  return {
    id: slug,
    slug,
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
  category("kapsuli", 72, [
    category("nespresso", 36),
    category("dolce-gusto", 33),
    category("a-modo-mio", 3),
    category("caffitaly", 0),
  ]),
  category("kafe-na-zyrna", 58),
  category("vending-zona", 5),
  category("konsumativi", 12),
  category("aksesoari", 4),
];

const navigation = (tree: CategoryView[] = TREE) =>
  buildNavigation(tree, { sections: BUSINESS_SECTIONS });

beforeEach(() => {
  catalog.tree = TREE;
  catalog.products = [{ slug: "kapsuli-a", updatedAt: new Date("2026-05-01T00:00:00.000Z") }];
  catalog.brands = [{ slug: "bianchi", name: "Bianchi" }];
});

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
      href: "/categories/nespresso",
      count: 36,
    });
  });

  it("omits a system with no products and one with no category", () => {
    const ids = navigation().capsules?.systems.map((system) => system.id) ?? [];
    expect(ids).not.toContain("caffitaly");
    expect(ids).not.toContain("lavazza-blue");
  });

  it("reads the capsules parent from the tree instead of naming it", () => {
    expect(navigation().capsules?.href).toBe("/categories/kapsuli");

    const renamed = [category("kapsuli-za-kafe", 36, [category("nespresso", 36)])];
    expect(navigation(renamed).capsules?.href).toBe("/categories/kapsuli-za-kafe");

    // Systems at the top level: there is no parent listing to link.
    expect(navigation([category("nespresso", 36)]).capsules?.href).toBe("/categories");
  });

  it("binds pods and beans through BREWING_SYSTEMS, and drops them when empty", () => {
    const nav = navigation();
    expect(nav.pods).toMatchObject({ id: "ese-pod", href: "/categories/kafe-dozi", count: 41 });
    expect(nav.beans).toMatchObject({ id: "beans", href: "/categories/kafe-na-zyrna" });

    const none = navigation([category("kafe-dozi", 0)]);
    expect(none.pods).toBeNull();
    expect(none.beans).toBeNull();
    expect(none.capsules).toBeNull();
  });

  it("links the business sections by their pages and never as categories", () => {
    const nav = navigation();
    expect(nav.vending.href).toBe(BUSINESS_SECTIONS.vending.path);
    expect(nav.consumables.href).toBe(BUSINESS_SECTIONS.consumables.path);

    const hrefs = nav.otherCategories.map((entry) => entry.href);
    for (const section of Object.values(BUSINESS_SECTIONS)) {
      for (const key of section.categoryKeys) {
        expect(hrefs).not.toContain(`/categories/${key}`);
      }
    }
    // A category nobody planned for is still reachable.
    expect(hrefs).toEqual(["/categories/aksesoari"]);
  });

  it("knows a section from its neighbour", () => {
    expect(isCurrentSection("/wizard/machines/krups", "/wizard/machines")).toBe(true);
    expect(isCurrentSection("/wizard/machines", "/wizard", ["/wizard/machines"])).toBe(false);
    expect(isCurrentSection("/wizard/result", "/wizard", ["/wizard/machines"])).toBe(true);
    expect(isCurrentSection("/brandsmith", "/brands")).toBe(false);
  });
});

describe("the header", () => {
  const markup = () => html(createElement(SiteHeader, { navigation: navigation() }));
  const rail = () => markup().match(/<nav aria-label="Основна навигация".*?<\/nav>/s)?.[0] ?? "";

  it("puts the machine finder and the wizard in the rail", () => {
    expect(rail()).toContain('href="/wizard/machines"');
    expect(rail()).toContain("Намери по машина");
    expect(rail()).toContain('href="/wizard"');
    expect(rail()).toContain('href="/vending"');
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
    expect(markup()).not.toContain("/categories/vending-zona");
    expect(markup()).not.toContain("/categories/konsumativi");
  });

  it("puts systems ahead of brands", () => {
    expect(rail().indexOf("/categories/nespresso")).toBeLessThan(rail().indexOf('href="/brands"'));
    expect(rail().indexOf("/wizard/machines")).toBeLessThan(rail().indexOf('href="/brands"'));
  });

  it("marks the current section in text, not only in colour", () => {
    // The mocked path is /categories/nespresso: the system is under "Капсули".
    expect(rail()).toMatch(/aria-current="true"[^>]*href="\/categories\/kapsuli"/);
  });

  it("makes the menu trigger a real link, so it works without JavaScript", () => {
    expect(markup()).toMatch(/<a[^>]*href="\/categories"[^>]*aria-label="Меню"/);
    // The drawer itself is not in the server markup.
    expect(markup()).not.toContain('role="dialog"');
  });

  it("has no heading of its own and no second pine strip", () => {
    expect(markup()).not.toMatch(/<h1/);
    expect(markup()).not.toContain("bg-pine-900");
  });

  it("prints the phone number itself only when there is no bar to carry it", () => {
    expect(markup()).not.toContain(siteConfig.contact.phone);
    expect(
      html(createElement(SiteHeader, { navigation: navigation(), showPhone: true })),
    ).toContain(siteConfig.contact.phone);
  });
});

describe("the footer", () => {
  const markup = () => html(createElement(SiteFooter, { navigation: navigation() }));

  it("reaches every new section", () => {
    for (const href of ["/vending", "/consumables", "/delivery", "/journal", "/wizard/machines"]) {
      expect(markup()).toContain(`href="${href}"`);
    }
  });

  it("lists systems, not the business-section categories", () => {
    expect(markup()).toContain('href="/categories/nespresso"');
    expect(markup()).not.toContain("/categories/vending-zona");
    expect(markup()).not.toContain("/categories/konsumativi");
    expect(markup()).not.toContain("/categories/caffitaly");
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

  it("has no close button until JavaScript runs, and its space is already there", () => {
    const markup = html(createElement(AnnouncementBar, { commerce: WITH_THRESHOLD }));
    expect(markup).not.toContain("<button");
    expect(markup).toMatch(/<span class="[^"]*h-6 w-6[^"]*"><\/span><\/div><\/aside>$/);
  });
});

describe("the sitemap", () => {
  const urls = async () => (await sitemap()).map((entry) => entry.url);

  it("lists delivery, both business sections and the journal", async () => {
    const listed = await urls();
    for (const path of ["/delivery", "/vending", "/consumables", "/journal"]) {
      expect(listed).toContain(absoluteUrl(path));
    }
  });

  it("lists every article with its own date", async () => {
    const entries = await sitemap();
    const articles = listArticles();
    expect(articles.length).toBeGreaterThan(0);
    for (const article of articles) {
      const entry = entries.find((candidate) => candidate.url === absoluteUrl(article.href));
      expect(entry?.lastModified).toEqual(article.lastModified);
    }
  });

  it("dates the journal by its newest article and a product by its last change", async () => {
    const entries = await sitemap();
    const newest = Math.max(...listArticles().map((article) => article.lastModified.getTime()));
    const journal = entries.find((entry) => entry.url === absoluteUrl("/journal"));
    expect((journal?.lastModified as Date).getTime()).toBe(newest);

    const product = entries.find((entry) => entry.url === absoluteUrl("/products/kapsuli-a"));
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
    expect(listed).not.toContain(absoluteUrl("/categories/vending-zona"));
    expect(listed).not.toContain(absoluteUrl("/categories/konsumativi"));
    expect(listed).toContain(absoluteUrl("/categories/nespresso"));
  });

  it("is still the live catalog: no product, no URL", async () => {
    catalog.products = [];
    expect((await urls()).some((url) => url.includes("/products/"))).toBe(false);
  });
});

describe("llms.txt", () => {
  const input = (commerce: CommerceConfig): LlmsInput => ({
    summary: { products: 3, brands: 1, categories: 2 },
    categories: [{ name: "Кафе капсули", href: "/categories/kapsuli" }],
    brands: [{ name: "Bianchi", href: "/brands/bianchi" }],
    machineBrandCount: 4,
    sections: [{ name: "Вендинг зона", href: "/vending", description: "За оператори." }],
    articles: [{ name: "Статия", href: "/journal/statiya", description: "За какво е." }],
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
    expect(text).toContain(`- [Вендинг зона](${absoluteUrl("/vending")}): За оператори.`);
    expect(text).toContain(`- [Статия](${absoluteUrl("/journal/statiya")}): За какво е.`);
    expect(text).toContain(`(${absoluteUrl("/delivery")})`);

    expect(llmsText({ ...input(UNSET), articles: [] })).not.toContain("## Дневник");
  });

  it("is served only on production, with the real sections and articles", async () => {
    const previous = process.env.VERCEL_ENV;
    try {
      process.env.VERCEL_ENV = "preview";
      expect((await llmsRoute()).status).toBe(404);

      process.env.VERCEL_ENV = "production";
      const text = await (await llmsRoute()).text();
      expect(text).toContain(`(${absoluteUrl("/vending")})`);
      expect(text).toContain(`(${absoluteUrl("/consumables")})`);
      for (const article of listArticles()) {
        expect(text).toContain(`(${absoluteUrl(article.href)})`);
      }
      // The category behind a section is named by the section, not twice.
      expect(text).not.toContain("/categories/vending-zona");
    } finally {
      if (previous === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = previous;
    }
  });
});
