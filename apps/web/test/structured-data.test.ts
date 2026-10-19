import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { JsonLd } from "@/components/seo/json-ld";
import { absoluteUrl, siteConfig, type CommerceConfig } from "@/config/site";
import { PLACEHOLDER_IMAGE } from "@/lib/catalog/images";
import type { ProductDetailView } from "@/lib/catalog/types";
import { articleJsonLd } from "@/lib/seo/article-json-ld";
import {
  ORGANIZATION_ID,
  breadcrumbJsonLd,
  itemListJsonLd,
  offerAvailability,
  organizationJsonLd,
  productJsonLd,
  productWeight,
  socialProfiles,
  validGtin,
  webSiteJsonLd,
} from "@/lib/seo/json-ld";
import { checkStructuredData } from "./helpers/structured-data";

/*
 * The structured data builders (`lib/seo/json-ld.ts`), held to schema.org's
 * vocabulary and Google's requirements offline (`helpers/structured-data.ts`),
 * and to the claims the shop can support. The browser suite runs the same
 * check on what a production build sends.
 */

const BLOB = "https://j6xpmlta50zfdxeo.public.blob.vercel-storage.com/catalog/ba/11/ba11.jpg";

const COMPLETE: CommerceConfig = {
  confirmedByOwner: true,
  freeDeliveryThreshold: "49.00",
  deliveryFee: "5.90",
  deliveryTime: { dispatch: { min: 0, max: 1 }, transit: { min: 1, max: 2 } },
  couriers: [],
  paymentMethods: ["cash_on_delivery"],
  returnWindowDays: 14,
  returnShippingPaidBy: "customer",
  openingHours: [{ from: "monday", to: "friday", opens: "09:00", closes: "18:00" }],
};

function product(patch: Partial<ProductDetailView> = {}): ProductDetailView {
  return {
    id: "p1",
    slug: "borbone-crema-classica-kapsuli-dolce-gusto-16-br",
    name: "Borbone Crema Classica — капсули за Dolce Gusto, 16 бр.",
    price: { amount: "5.90", currency: "EUR", formatted: "5,90 €" },
    oldPrice: null,
    discountPercent: null,
    availability: "in_stock",
    weight: "16 бр.",
    intensity: null,
    systemId: "dolce-gusto",
    servingPrice: null,
    brand: { slug: "borbone", name: "Borbone" },
    image: null,
    shortDescription: null,
    status: "active",
    unitPrice: null,
    descriptionHtml: null,
    descriptionText: "Капсули за Dolce Gusto от Borbone.",
    sku: null,
    gtin: null,
    pack: { value: "16", unit: "pc" },
    arabicaPercent: null,
    origin: null,
    roast: null,
    attributes: {},
    images: [{ url: BLOB, alt: "Пакет", width: 800, height: 1200 }],
    categories: [],
    updatedAt: null,
    ...patch,
  };
}

/** What every page carries from the layout, around a page's own blocks. */
const page = (...blocks: Array<Record<string, unknown>>) => [
  organizationJsonLd("bg"),
  webSiteJsonLd("bg"),
  ...blocks,
];

describe("the organisation", () => {
  const organization = organizationJsonLd("bg");

  it("is one entity with an @id, its address and a square logo of at least 112 px", () => {
    expect(organization["@id"]).toBe(ORGANIZATION_ID);
    expect(ORGANIZATION_ID).toBe(`${absoluteUrl("/")}#organization`);
    expect(organization.url).toBe(absoluteUrl("/bg"));
    const logo = organization.logo as Record<string, unknown>;
    expect(logo).toMatchObject({ "@type": "ImageObject", url: absoluteUrl("/icon-512.png") });
    expect(logo.width).toBe(logo.height);
    expect(logo.width as number).toBeGreaterThanOrEqual(112);
  });

  it("claims no profile elsewhere while the shop has none", () => {
    expect(siteConfig.social).toEqual({});
    expect(organization).not.toHaveProperty("sameAs");
  });

  it("names its real profiles, and only real addresses", () => {
    const social = {
      facebook: "https://www.facebook.com/buyacoffee",
      instagram: " https://www.instagram.com/buyacoffee ",
      nothing: "",
      typo: "facebook.com/x",
    };
    expect(socialProfiles(social)).toEqual([
      "https://www.facebook.com/buyacoffee",
      "https://www.instagram.com/buyacoffee",
    ]);
    expect(organizationJsonLd("bg", siteConfig.commerce, social).sameAs).toHaveLength(2);
  });

  it("is what the website says publishes it", () => {
    expect(webSiteJsonLd("bg").publisher).toEqual({ "@id": ORGANIZATION_ID });
  });

  it("passes the offline check", () => {
    expect(checkStructuredData(page())).toEqual([]);
  });
});

describe("a product", () => {
  it("is sold by the organisation on the page, by its @id", () => {
    const offer = productJsonLd(product(), "bg").offers as Record<string, unknown>;
    expect(offer.seller).toMatchObject({ "@type": "Organization", "@id": ORGANIZATION_ID });
    expect(offer.itemCondition).toBe("https://schema.org/NewCondition");
  });

  it("passes the offline check, photographed on the image host or not", () => {
    expect(checkStructuredData(page(productJsonLd(product(), "bg")))).toEqual([]);
    expect(
      checkStructuredData(
        page(
          productJsonLd(
            product({ images: [{ url: PLACEHOLDER_IMAGE, alt: "", width: null, height: null }] }),
            "bg",
          ),
        ),
      ),
    ).toEqual([]);
  });

  it("passes it with shipping and returns, once the owner confirms them", () => {
    expect(checkStructuredData(page(productJsonLd(product(), "bg", COMPLETE)))).toEqual([]);
  });

  it("passes it with no price, as a product with no offer", () => {
    expect(checkStructuredData(page(productJsonLd(product({ price: null }), "bg")))).toEqual([]);
  });

  it("states a weight in grams as a quantity, and none for a count of capsules", () => {
    expect(productWeight({ value: "1000", unit: "g" })).toEqual({
      "@type": "QuantitativeValue",
      value: 1000,
      unitCode: "GRM",
    });
    expect(productWeight({ value: "16", unit: "pc" })).toBeNull();
    expect(productWeight({ value: "500", unit: "ml" })).toBeNull();
    expect(productWeight({ value: "0", unit: "g" })).toBeNull();
    expect(productWeight(null)).toBeNull();

    const beans = productJsonLd(
      product({ weight: "1 кг.", pack: { value: "1000", unit: "g" } }),
      "bg",
    );
    expect(beans.weight).toEqual({ "@type": "QuantitativeValue", value: 1000, unitCode: "GRM" });
    // Never the stored text: "16 бр." is not a weight, and a string is not valid.
    expect(productJsonLd(product(), "bg")).not.toHaveProperty("weight");
    expect(productJsonLd(product({ pack: null, weight: "250 г" }), "bg")).not.toHaveProperty(
      "weight",
    );
  });

  it("is never InStock once it is off sale", () => {
    expect(offerAvailability({ status: "active", availability: "in_stock" })).toBe(
      "https://schema.org/InStock",
    );
    expect(offerAvailability({ status: "missing", availability: "in_stock" })).toBe(
      "https://schema.org/OutOfStock",
    );
    expect(offerAvailability({ status: "removed", availability: "in_stock" })).toBe(
      "https://schema.org/Discontinued",
    );
    const removed = productJsonLd(product({ status: "removed" }), "bg");
    expect((removed.offers as Record<string, unknown>).availability).toBe(
      "https://schema.org/Discontinued",
    );
  });

  it("carries a GTIN only when it is one", () => {
    expect(validGtin("8000070012345")).toBeNull(); // wrong check digit
    expect(validGtin("8000070038677")).toBe("8000070038677");
    expect(validGtin(" 8000-0700-38677 ")).toBe("8000070038677");
    expect(validGtin("96385074")).toBe("96385074");
    expect(validGtin("12345")).toBeNull();
    expect(validGtin("")).toBeNull();
    expect(validGtin(null)).toBeNull();

    expect(productJsonLd(product({ gtin: "8000070038677" }), "bg").gtin).toBe("8000070038677");
    expect(productJsonLd(product({ gtin: "not-a-code" }), "bg")).not.toHaveProperty("gtin");
  });
});

describe("the offline check itself", () => {
  it("catches what this repository once shipped", () => {
    const broken = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: "x",
      weight: "1 кг.",
      image: [`${absoluteUrl("/")}${BLOB}`],
      offers: {
        "@type": "Offer",
        price: "5.90",
        priceCurrency: "EUR",
        availability: "InStock",
        seller: { "@type": "Organization", "@id": "https://elsewhere.example/#org", name: "x" },
      },
      colour: "brown",
    };
    const problems = checkStructuredData([broken]).join("\n");
    expect(problems).toMatch(/weight must be a QuantitativeValue/);
    expect(problems).toMatch(/a URL inside a URL/);
    expect(problems).toMatch(/not a schema.org enumeration member/);
    expect(problems).toMatch(/no block on the page defines/);
    expect(problems).toMatch(/Product has no property "colour"/);
  });
});

describe("breadcrumbs, lists and articles", () => {
  it("pass the offline check", () => {
    const crumbs = breadcrumbJsonLd([
      { name: "Начало", href: "/bg" },
      { name: "Кафе капсули", href: "/bg/kafe-kapsuli" },
      { name: "Капсули за Dolce Gusto", href: "/bg/dolce-gusto-kapsuli" },
    ]);
    const list = itemListJsonLd(
      [
        { name: "A", href: "/bg/a" },
        { name: "B", href: "/bg/b" },
      ],
      "Капсули",
    );
    const article = articleJsonLd(
      {
        href: "/blog/vidove-kapsuli-za-kafe",
        title: "Видове капсули за кафе: коя пасва на вашата машина",
        description: "Капсулите се делят по системи.",
        publishedAt: "2026-09-01",
        modifiedAt: "2026-10-01",
      },
      "bg",
    );
    expect(checkStructuredData(page(crumbs, list, article))).toEqual([]);
  });
});

describe("the script element that carries it", () => {
  it("cannot be closed by a name with markup in it, and reads back unchanged", () => {
    const data = { "@type": "Product", name: "Капсули </script><script>alert(1)</script>" };
    const html = renderToStaticMarkup(createElement(JsonLd, { id: "product", data }));
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    const payload = /<script[^>]*>([\s\S]*)<\/script>/.exec(html)![1]!;
    expect(JSON.parse(payload)).toEqual(data);
  });
});
