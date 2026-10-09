import {
  CATEGORY_LANDING_SLUGS,
  RESERVED_PRODUCT_SLUGS,
  RESERVED_ROUTE_SLUGS,
} from "@catalog/shared/storefront-data";
import { describe, expect, it } from "vitest";
import {
  productMetaDescription,
  productPageTitle,
} from "@/app/(site)/[lang]/[slug]/_components/product-meta";
import { siteConfig } from "@/config/site";
import { LOCALES, isLocale } from "@/i18n/config";
import { SLUGS } from "@/i18n/slugs";
import type { ProductDetailView } from "@/lib/catalog/types";
import {
  RESERVED_SLUGS,
  assertBrandSlugTables,
  brandHref,
  brandSlug,
  isReservedSlug,
  matchBrandSlug,
} from "@/lib/routes";
import { breadcrumbJsonLd, productJsonLd } from "@/lib/seo/json-ld";
import { brandDisplayNames } from "../content/brand-names";

/*
 * A product's identity on this site: what the sync may not name a product,
 * where a brand's page lives, and what the product page says in its title,
 * its description and its structured data. All pure.
 */

describe("the reserved slugs the sync reads", () => {
  it("are exactly the ones the storefront refuses", () => {
    // One table (`i18n/slugs`), two readers. If these ever differ, the sync
    // could give a product a route's address, or refuse one for no reason.
    const storefront = [...RESERVED_SLUGS, ...LOCALES].sort();
    expect([...RESERVED_ROUTE_SLUGS].sort()).toEqual(storefront);
    for (const slug of RESERVED_ROUTE_SLUGS) expect(isReservedSlug(slug), slug).toBe(true);
    for (const slug of RESERVED_ROUTE_SLUGS) {
      expect(RESERVED_SLUGS.has(slug) || isLocale(slug), slug).toBe(true);
    }
  });

  it("include every category's landing slug in every locale, for a product", () => {
    const landing = LOCALES.flatMap((locale) => Object.values(SLUGS[locale].categories)).sort();
    expect([...CATEGORY_LANDING_SLUGS].sort()).toEqual([...new Set(landing)].sort());
    for (const slug of landing) expect(RESERVED_PRODUCT_SLUGS.has(slug), slug).toBe(true);
  });
});

describe("brand slugs", () => {
  const lollo = { slug: "lollocafe", sourceKey: "lollocafe" };
  const bourbons = { slug: "3bourbons", sourceKey: "3-bourbons" };
  const lavazza = { slug: "lavazza", sourceKey: "lavazza" };

  it("are the brand's own spelling where the stored one is not", () => {
    expect(brandSlug("bg", lollo)).toBe("lollo-caffe");
    expect(brandSlug("bg", bourbons)).toBe("3-bourbons");
    expect(brandHref("bg", lollo)).toBe("/bg/marki/lollo-caffe");
    expect(brandHref("en", lollo)).toBe("/en/brands/lollo-caffe");
    expect(brandHref("bg", bourbons, "?sort=price-asc")).toBe(
      "/bg/marki/3-bourbons?sort=price-asc",
    );
  });

  it("are the stored slug for every other brand, and for one nobody has curated", () => {
    expect(brandSlug("bg", lavazza)).toBe("lavazza");
    expect(brandSlug("bg", { slug: "new-roast", sourceKey: "new-roast" })).toBe("new-roast");
    // A view that carries no source key still links somewhere that resolves.
    expect(brandSlug("bg", { slug: "lollocafe" })).toBe("lollocafe");
    expect(brandSlug("bg", { slug: "constructor", sourceKey: "constructor" })).toBe("constructor");
  });

  it("resolve a public slug to the brand, and say whether it is the published one", () => {
    const brands = [lavazza, lollo, bourbons];
    expect(matchBrandSlug("bg", brands, "lollo-caffe")).toEqual({ brand: lollo, published: true });
    expect(matchBrandSlug("bg", brands, "lollocafe")).toEqual({ brand: lollo, published: false });
    expect(matchBrandSlug("bg", brands, "3bourbons")).toEqual({
      brand: bourbons,
      published: false,
    });
    expect(matchBrandSlug("bg", brands, "lavazza")).toEqual({ brand: lavazza, published: true });
    expect(matchBrandSlug("bg", brands, "nobody")).toBeNull();
  });

  it("prefer the brand published at a slug over one merely stored there", () => {
    // A later brand whose stored slug is another's published one must not
    // capture that brand's page.
    const squatter = { slug: "lollo-caffe", sourceKey: "lollo-caffe-2" };
    expect(matchBrandSlug("bg", [squatter, lollo], "lollo-caffe")?.brand).toBe(squatter);
    expect(matchBrandSlug("bg", [lollo], "lollo-caffe")?.brand).toBe(lollo);
  });

  it("are curated only for brands the shop knows, as one URL segment each", () => {
    expect(() => assertBrandSlugTables()).not.toThrow();
    for (const locale of LOCALES) {
      for (const key of Object.keys(SLUGS[locale].brands)) {
        expect(Object.hasOwn(brandDisplayNames, key), `${locale}: ${key}`).toBe(true);
      }
      expect(SLUGS[locale].brands).toEqual(SLUGS.bg.brands);
    }
  });
});

const price = (amount: string, formatted: string) => ({ amount, currency: "EUR", formatted });

function product(patch: Partial<ProductDetailView> = {}): ProductDetailView {
  return {
    id: "p1",
    slug: "borbone-crema-classica-kapsuli-dolce-gusto-16-br",
    name: "Borbone Crema Classica — капсули за Dolce Gusto, 16 бр.",
    title: "Borbone Crema Classica",
    detail: "Капсули за Dolce Gusto, 16 бр.",
    price: price("5.60", "5,60 €"),
    oldPrice: null,
    discountPercent: null,
    availability: "in_stock",
    weight: "16 бр.",
    intensity: null,
    systemId: "dolce-gusto",
    servingPrice: { formatted: "0,35 € на чаша", estimated: false },
    brand: { slug: "borbone", sourceKey: "borbone", name: "Borbone" },
    image: null,
    shortDescription: "Капсули от Borbone.",
    status: "active",
    unitPrice: null,
    descriptionHtml: null,
    descriptionText: "Капсули от Borbone.",
    sku: null,
    gtin: null,
    pack: { value: "16", unit: "pc" },
    arabicaPercent: null,
    origin: null,
    roast: null,
    attributes: {},
    images: [],
    categories: [],
    updatedAt: null,
    ...patch,
  };
}

describe("the product page's title and description", () => {
  it("titles the page <Brand> <Line> — <format>, <qty> | <shop>", () => {
    expect(productPageTitle(product())).toBe(
      `Borbone Crema Classica — капсули за Dolce Gusto, 16 бр. | ${siteConfig.name}`,
    );
    expect(productPageTitle(product({ name: "Lavazza Super Crema — кафе на зърна, 1 кг" }))).toBe(
      `Lavazza Super Crema — кафе на зърна, 1 кг | ${siteConfig.name}`,
    );
  });

  it("says what it is, what it costs, what a cup costs and how to order", () => {
    expect(productMetaDescription(product())).toBe(
      "Borbone Crema Classica: капсули за Dolce Gusto, 16 бр. Цена 5,60 €, 0,35 € на чаша. " +
        "Оставете номер и ще ви се обадим, за да потвърдим поръчката.",
    );
    expect(
      productMetaDescription(
        product({
          title: "Lavazza Super Crema",
          detail: "Кафе на зърна, 1 кг",
          price: price("21.50", "21,50 €"),
          servingPrice: { formatted: "≈ 0,15 € на чаша", estimated: true },
        }),
      ),
    ).toBe(
      "Lavazza Super Crema: кафе на зърна, 1 кг. Цена 21,50 €, ≈ 0,15 € на чаша. " +
        "Оставете номер и ще ви се обадим, за да потвърдим поръчката.",
    );
  });

  it("leaves out whatever it has no figure for", () => {
    expect(productMetaDescription(product({ servingPrice: null }))).toBe(
      "Borbone Crema Classica: капсули за Dolce Gusto, 16 бр. Цена 5,60 €. " +
        "Оставете номер и ще ви се обадим, за да потвърдим поръчката.",
    );
    expect(productMetaDescription(product({ price: null, servingPrice: null }))).toBe(
      "Borbone Crema Classica: капсули за Dolce Gusto, 16 бр. " +
        "Оставете номер и ще ви се обадим, за да потвърдим поръчката.",
    );
    expect(productMetaDescription(product({ detail: null, title: undefined }))).toMatch(
      /^Borbone Crema Classica — капсули за Dolce Gusto, 16 бр\. Цена /u,
    );
  });

  it("does not invite an order for something that cannot be ordered", () => {
    expect(productMetaDescription(product({ availability: "out_of_stock" }))).not.toContain(
      "Оставете номер",
    );
    expect(productMetaDescription(product({ status: "removed" }))).not.toContain("Оставете номер");
  });

  it("fits a search result, with no exclamation and no superlative", () => {
    const description = productMetaDescription(product());
    expect(description.length).toBeLessThanOrEqual(160);
    expect(description).not.toMatch(/!|най-|оригинал/iu);
  });
});

describe("the product's structured data", () => {
  it("names the product as the page does", () => {
    const data = productJsonLd(product(), "bg");
    expect(data.name).toBe("Borbone Crema Classica — капсули за Dolce Gusto, 16 бр.");
    expect(data.url).toMatch(/\/bg\/borbone-crema-classica-kapsuli-dolce-gusto-16-br$/);
    expect(data.brand).toMatchObject({ "@type": "Brand", name: "Borbone" });
  });

  it("lists the breadcrumb by format, then system, then product", () => {
    const data = breadcrumbJsonLd([
      { name: "Начало", href: "/bg" },
      { name: "Кафе капсули", href: "/bg/kafe-kapsuli" },
      { name: "Капсули за Dolce Gusto", href: "/bg/dolce-gusto-kapsuli" },
      {
        name: "Borbone Crema Classica",
        href: "/bg/borbone-crema-classica-kapsuli-dolce-gusto-16-br",
      },
    ]) as { itemListElement: Array<{ position: number; name: string; item: string }> };
    expect(data.itemListElement.map((item) => item.name)).toEqual([
      "Начало",
      "Кафе капсули",
      "Капсули за Dolce Gusto",
      "Borbone Crema Classica",
    ]);
    expect(data.itemListElement.map((item) => item.position)).toEqual([1, 2, 3, 4]);
    expect(data.itemListElement[2]?.item).toMatch(/\/bg\/dolce-gusto-kapsuli$/);
  });
});
