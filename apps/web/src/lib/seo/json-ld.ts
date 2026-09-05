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
    /**
     * The address in parts rather than the one-line prose form.
     *
     * It used to put the whole string into `streetAddress`, which is what the
     * shape allowed while the address was empty — locality, region and country
     * simply were not available. They are now, and the difference matters:
     * `addressCountry` and `addressLocality` are what let a consumer resolve
     * this to a place rather than a sentence, and they are what Google reads
     * when it reconciles an entity against a Business Profile.
     */
    base.address = {
      "@type": "PostalAddress",
      streetAddress: siteConfig.legal.streetAddress,
      addressLocality: siteConfig.legal.addressLocality,
      addressRegion: siteConfig.legal.addressRegion,
      addressCountry: siteConfig.legal.addressCountry,
    };
    if (siteConfig.legal.vatId) {
      base.vatID = siteConfig.legal.vatId;
      /* The ЕИК is also the tax identifier. `identifier` above is the generic
         slot; `taxID` is the one a consumer looking for a company number reads,
         and the vend repos publish both. */
      base.taxID = siteConfig.legal.companyId;
    }
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
