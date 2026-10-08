import { absoluteUrl, siteConfig, type CommerceConfig, type DayRange } from "@/config/site";
import {
  daysInRange,
  deliveryCostFor,
  deliveryTime,
  returnWindowDays,
} from "@/components/commerce/terms";
import { availabilitySchemaUrl } from "@/lib/catalog/format";
import type { ProductDetailView } from "@/lib/catalog/types";

/**
 * Structured data builders.
 *
 * Only claims we can actually support are emitted. In particular there is no
 * `aggregateRating` and no `review` anywhere: the storefront has no reviews,
 * and inventing them would be both a policy violation and a lie to customers.
 */

const SCHEMA_DAY = {
  monday: "https://schema.org/Monday",
  tuesday: "https://schema.org/Tuesday",
  wednesday: "https://schema.org/Wednesday",
  thursday: "https://schema.org/Thursday",
  friday: "https://schema.org/Friday",
  saturday: "https://schema.org/Saturday",
  sunday: "https://schema.org/Sunday",
} as const;

/** When the phone is answered, as `OpeningHoursSpecification`s. */
function hoursAvailable(commerce: CommerceConfig): Array<Record<string, unknown>> {
  return commerce.openingHours
    .map((range) => ({ range, days: daysInRange(range) }))
    .filter(({ days }) => days.length > 0)
    .map(({ range, days }) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: days.map((day) => SCHEMA_DAY[day]),
      opens: range.opens,
      closes: range.closes,
    }));
}

export function organizationJsonLd(
  commerce: CommerceConfig = siteConfig.commerce,
): Record<string, unknown> {
  const hours = hoursAvailable(commerce);
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
        // The hours the header and footer already print, in the form a
        // machine can read. Not a new claim, so not gated on confirmation.
        ...(hours.length > 0 ? { hoursAvailable: hours } : {}),
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

const daysQuantity = (range: DayRange) => ({
  "@type": "QuantitativeValue",
  minValue: range.min,
  maxValue: range.max,
  unitCode: "DAY",
});

/**
 * `OfferShippingDetails` for one product, or null.
 *
 * Google's merchant-listing shape wants three things together — where it
 * ships, what that costs and how long it takes — and an incomplete one is
 * worse than none: a guessed delivery time is a promise. So this is all or
 * nothing:
 *
 *   - the rate must be a single true number for one unit of this product:
 *     zero above the free-delivery threshold, the configured fee below it.
 *     With no fee configured, a product under the threshold gets no shipping
 *     details at all;
 *   - both halves of the delivery time must be configured, because the shape
 *     asks for handling and transit separately and one cannot be derived from
 *     the other.
 *
 * The destination is Bulgaria: the shop delivers nowhere else, and the terms
 * page says so.
 */
function shippingDetails(
  price: { readonly amount: string; readonly currency: string },
  commerce: CommerceConfig,
): Record<string, unknown> | null {
  const rate = deliveryCostFor(price, commerce);
  const time = deliveryTime(commerce);
  if (!rate || !time) return null;

  return {
    "@type": "OfferShippingDetails",
    shippingRate: { "@type": "MonetaryAmount", value: rate.amount, currency: rate.currency },
    shippingDestination: { "@type": "DefinedRegion", addressCountry: "BG" },
    deliveryTime: {
      "@type": "ShippingDeliveryTime",
      handlingTime: daysQuantity(time.dispatch),
      transitTime: daysQuantity(time.transit),
    },
  };
}

/**
 * `MerchantReturnPolicy`, or null while no return window is configured.
 *
 * The country, the category and the number of days are what the shape
 * requires. `returnFees` is recommended rather than required, so it is added
 * when the shop has said who pays for the return and left out — not defaulted
 * — when it has not. A fixed return-shipping fee is not something the config
 * can express, so `ReturnShippingFees` is never emitted.
 */
function merchantReturnPolicy(commerce: CommerceConfig): Record<string, unknown> | null {
  const days = returnWindowDays(commerce);
  if (days === null) return null;

  const fees =
    commerce.returnShippingPaidBy === "merchant"
      ? "https://schema.org/FreeReturn"
      : commerce.returnShippingPaidBy === "customer"
        ? "https://schema.org/ReturnFeesCustomerResponsibility"
        : null;

  return {
    "@type": "MerchantReturnPolicy",
    applicableCountry: "BG",
    returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
    merchantReturnDays: days,
    ...(fees ? { returnFees: fees } : {}),
    merchantReturnLink: absoluteUrl("/delivery"),
  };
}

function offerPolicies(
  price: { readonly amount: string; readonly currency: string },
  commerce: CommerceConfig,
): Record<string, unknown> {
  const shipping = shippingDetails(price, commerce);
  const returns = merchantReturnPolicy(commerce);
  return {
    ...(shipping ? { shippingDetails: shipping } : {}),
    ...(returns ? { hasMerchantReturnPolicy: returns } : {}),
  };
}

export function productJsonLd(
  product: ProductDetailView,
  commerce: CommerceConfig = siteConfig.commerce,
): Record<string, unknown> {
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
      /*
       * Shipping and returns leave the site here as machine-readable claims
       * that a search engine may print next to the price. That is a different
       * thing from a sentence on our own page, so they wait for the business
       * to confirm its terms — proposed values are never published this way.
       */
      ...(commerce.confirmedByOwner ? offerPolicies(product.price, commerce) : {}),
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
