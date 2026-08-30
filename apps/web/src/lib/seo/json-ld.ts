import { absoluteUrl, siteConfig } from "@/config/site";
import { availabilitySchemaUrl } from "@/lib/catalog/format";
import type { ProductDetailView } from "@/lib/catalog/types";

/**
 * Structured data builders.
 *
 * Only claims we can actually support are emitted. In particular there is no
 * `aggregateRating` and no `review` anywhere: the storefront has no reviews,
 * and inventing them would be both a policy violation and a lie to customers.
 */

export function organizationJsonLd(): Record<string, unknown> {
  const base: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: siteConfig.name,
    url: absoluteUrl("/"),
    description: siteConfig.description,
    contactPoint: [
      {
        "@type": "ContactPoint",
        telephone: siteConfig.contact.phone,
        email: siteConfig.contact.email,
        contactType: "customer service",
        areaServed: "BG",
        availableLanguage: ["bg"],
      },
    ],
  };

  // Legal identifiers are only published once they are real.
  if (siteConfig.legal.isComplete) {
    base.legalName = siteConfig.legal.companyName;
    base.identifier = siteConfig.legal.companyId;
    base.address = { "@type": "PostalAddress", streetAddress: siteConfig.legal.address };
    if (siteConfig.legal.vatId) base.vatID = siteConfig.legal.vatId;
  }
  return base;
}

/**
 * `SearchAction` is only declared because the site really does have a search
 * route that accepts `q`. Declaring one without it is a common way to make
 * structured data actively wrong.
 */
export function webSiteJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: siteConfig.name,
    url: absoluteUrl("/"),
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${absoluteUrl("/search")}?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

export function productJsonLd(product: ProductDetailView): Record<string, unknown> {
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    url: absoluteUrl(`/products/${product.slug}`),
    ...(product.descriptionText ? { description: product.descriptionText } : {}),
    ...(product.images.length > 0
      ? { image: product.images.map((image) => absoluteUrl(image.url)) }
      : {}),
    ...(product.brand ? { brand: { "@type": "Brand", name: product.brand.name } } : {}),
    ...(product.sku ? { sku: product.sku } : {}),
    ...(product.gtin ? { gtin: product.gtin } : {}),
    ...(product.weight ? { weight: product.weight } : {}),
  };

  // An Offer without a price is invalid structured data, so it is omitted
  // entirely for the products that genuinely have no price.
  if (product.price) {
    data.offers = {
      "@type": "Offer",
      price: product.price.amount,
      priceCurrency: product.price.currency,
      availability: availabilitySchemaUrl(product.availability),
      url: absoluteUrl(`/products/${product.slug}`),
      seller: { "@type": "Organization", name: siteConfig.name },
    };
  }

  return data;
}

export function breadcrumbJsonLd(
  items: ReadonlyArray<{ name: string; href: string }>,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.href),
    })),
  };
}

export function itemListJsonLd(
  items: ReadonlyArray<{ name: string; href: string }>,
  listName: string,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: listName,
    numberOfItems: items.length,
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      url: absoluteUrl(item.href),
    })),
  };
}
