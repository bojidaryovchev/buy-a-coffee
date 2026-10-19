import { absoluteUrl, siteConfig, type CommerceConfig, type DayRange } from "@/config/site";
import {
  daysInRange,
  deliveryCostFor,
  deliveryTime,
  returnWindowDays,
} from "@/components/commerce/terms";
import { availabilitySchemaUrl } from "@/lib/catalog/format";
import { isPlaceholderImage } from "@/lib/catalog/images";
import type { ProductDetailView } from "@/lib/catalog/types";
import { brandLogoFor } from "../../../content/brand-logos";
import { categoryNameFor } from "../../../content/category-copy";
import { HTML_LANG, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { categoryHref, href, productHref, routes, type CategoryKeys } from "@/lib/routes";

/**
 * Structured data builders.
 *
 * Only claims we can actually support are emitted. In particular there is no
 * `aggregateRating` and no `review` anywhere: the storefront has no reviews,
 * and inventing them would be both a policy violation and a lie to customers.
 *
 * Every builder that writes a URL takes the locale first and builds the URL
 * through `lib/routes.ts`, so structured data can never point at an unprefixed
 * path — buy-a-vend's breadcrumbs once did, and pointed at 404s while the
 * visible page was fine.
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

/**
 * The shop as one entity, wherever it is named.
 *
 * Every page carries the `Organization` (the layout emits it), so a product's
 * `seller`, an article's `publisher` and the `WebSite`'s `publisher` refer to
 * it by this `@id` instead of describing a second, nameless organisation each
 * time. On the origin, not under a locale: the shop is one company in every
 * language it may one day speak.
 */
export const ORGANIZATION_ID = `${absoluteUrl("/")}#organization`;

/**
 * The mark Google may show beside the shop's results: square, 512 px (it asks
 * for at least 112), on the paper ground, so it reads on white. The same file
 * the web app manifest names, written by `pnpm brand:assets`.
 */
export const ORGANIZATION_LOGO = { path: "/icon-512.png", width: 512, height: 512 } as const;

/** A reference to the shop, for a node that is not the `Organization` itself. */
export function organizationRef(): Record<string, unknown> {
  return { "@type": "Organization", "@id": ORGANIZATION_ID, name: siteConfig.name };
}

/**
 * The shop's profiles elsewhere, as absolute URLs. Empty while
 * `siteConfig.social` is: a `sameAs` that names no real profile is a claim
 * about an identity the shop does not have.
 */
export function socialProfiles(
  social: Readonly<Record<string, string>> = siteConfig.social,
): string[] {
  return Object.values(social)
    .map((url) => url.trim())
    .filter((url) => /^https:\/\/[^/]+\.[^/]+/i.test(url));
}

export function organizationJsonLd(
  locale: Locale,
  commerce: CommerceConfig = siteConfig.commerce,
  social: Readonly<Record<string, string>> = siteConfig.social,
): Record<string, unknown> {
  const hours = hoursAvailable(commerce);
  const profiles = socialProfiles(social);
  const base: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": ORGANIZATION_ID,
    name: siteConfig.name,
    url: absoluteUrl(href(locale, routes.home)),
    logo: {
      "@type": "ImageObject",
      url: absoluteUrl(ORGANIZATION_LOGO.path),
      width: ORGANIZATION_LOGO.width,
      height: ORGANIZATION_LOGO.height,
    },
    description: getDictionary(locale).site.description,
    ...(profiles.length > 0 ? { sameAs: profiles } : {}),
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
export function webSiteJsonLd(locale: Locale): Record<string, unknown> {
  const home = absoluteUrl(href(locale, routes.home));
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${home}#website`,
    name: siteConfig.name,
    url: home,
    inLanguage: HTML_LANG[locale],
    publisher: { "@id": ORGANIZATION_ID },
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${absoluteUrl(href(locale, routes.search))}?q={search_term_string}`,
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
function merchantReturnPolicy(
  commerce: CommerceConfig,
  locale: Locale,
): Record<string, unknown> | null {
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
    merchantReturnLink: absoluteUrl(href(locale, routes.delivery)),
  };
}

function offerPolicies(
  price: { readonly amount: string; readonly currency: string },
  commerce: CommerceConfig,
  locale: Locale,
): Record<string, unknown> {
  const shipping = shippingDetails(price, commerce);
  const returns = merchantReturnPolicy(commerce, locale);
  return {
    ...(shipping ? { shippingDetails: shipping } : {}),
    ...(returns ? { hasMerchantReturnPolicy: returns } : {}),
  };
}

/**
 * The product's real photographs, as absolute URLs.
 *
 * An image whose stored URL is not ours resolves to the placeholder drawing
 * (`resolveImageUrl`). That is the right thing to paint in the gallery and the
 * wrong thing to publish: `image` tells a search engine "this is a picture of
 * the product", and a grey outline of a coffee pack is not one. So placeholders
 * are dropped, and a product left with nothing has no `image` at all.
 */
export function productImageUrls(product: Pick<ProductDetailView, "images">): readonly string[] {
  return product.images
    .filter((image) => !isPlaceholderImage(image.url))
    .map((image) => absoluteUrl(image.url));
}

/**
 * A `Brand`, as the product page and the brand page both publish it.
 *
 * `logo` only when we hold the brand's own logo (`content/brand-logos.ts`),
 * as an absolute URL on our own origin; a brand without one is a name alone.
 */
export function brandJsonLd(brand: {
  readonly slug: string;
  readonly name: string;
}): Record<string, unknown> {
  const logo = brandLogoFor(brand.slug);
  return {
    "@type": "Brand",
    name: brand.name,
    ...(logo ? { logo: absoluteUrl(logo.file) } : {}),
  };
}

/**
 * A GTIN, when the record holds a real one: 8, 12, 13 or 14 digits whose last
 * is the GS1 check digit of the rest. Spaces and dashes a supplier types are
 * dropped first. Anything else is not a GTIN, and an invalid one is a
 * structured-data error, not a harmless extra.
 */
export function validGtin(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/[\s-]/g, "");
  if (!/^(\d{8}|\d{12,14})$/.test(digits)) return null;
  const body = digits.slice(0, -1);
  const sum = [...body]
    .reverse()
    .reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === Number(digits.at(-1)) ? digits : null;
}

/**
 * The pack's weight, as a quantity a machine can read: grams as
 * `QuantitativeValue` with the UN/CEFACT code `GRM`.
 *
 * Only grams. A count of capsules or pods is not a weight, and the stored text
 * ("1 кг.", "16 бр.") is not a value — `weight` as a plain string is invalid
 * for `Product`. So a product sold by the piece, by volume, or with no
 * normalised size has no `weight` at all.
 */
export function productWeight(pack: ProductDetailView["pack"]): Record<string, unknown> | null {
  if (pack?.unit !== "g") return null;
  const grams = Number(pack.value);
  if (!Number.isFinite(grams) || grams <= 0) return null;
  return { "@type": "QuantitativeValue", value: grams, unitCode: "GRM" };
}

/**
 * What the offer says about availability.
 *
 * An active product says what the record says. One that is not active is not
 * on sale, and its page says so ("Този продукт вече не се предлага"), so its
 * structured data must not say `InStock` behind it: a product the sync has
 * lost track of for now (`missing`) is `OutOfStock`; one taken off the
 * catalog (`removed`) is `Discontinued`. Both pages are `noindex`; this is
 * for every other reader of the markup.
 */
export function offerAvailability(
  product: Pick<ProductDetailView, "status" | "availability">,
): string {
  if (product.status === "removed") return "https://schema.org/Discontinued";
  if (product.status !== "active") return "https://schema.org/OutOfStock";
  return availabilitySchemaUrl(product.availability);
}

export function productJsonLd(
  product: ProductDetailView,
  locale: Locale,
  commerce: CommerceConfig = siteConfig.commerce,
): Record<string, unknown> {
  const images = productImageUrls(product);
  // The product code, when the record holds one. Blank is not a code.
  const sku = product.sku?.trim();
  const gtin = validGtin(product.gtin);
  const weight = productWeight(product.pack);
  const url = absoluteUrl(productHref(locale, product));

  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    url,
    ...(product.descriptionText ? { description: product.descriptionText } : {}),
    ...(images.length > 0 ? { image: images } : {}),
    ...(product.brand ? { brand: brandJsonLd(product.brand) } : {}),
    ...(sku ? { sku } : {}),
    ...(gtin ? { gtin } : {}),
    ...(weight ? { weight } : {}),
  };

  // An Offer without a price is invalid structured data, so it is omitted
  // entirely for the products that genuinely have no price.
  if (product.price) {
    data.offers = {
      "@type": "Offer",
      price: product.price.amount,
      priceCurrency: product.price.currency,
      availability: offerAvailability(product),
      // Everything the shop sells is new, sealed retail packs.
      itemCondition: "https://schema.org/NewCondition",
      url,
      seller: organizationRef(),
      /*
       * Shipping and returns leave the site here as machine-readable claims
       * that a search engine may print next to the price. That is a different
       * thing from a sentence on our own page, so they wait for the business
       * to confirm its terms — proposed values are never published this way.
       */
      ...(commerce.confirmedByOwner ? offerPolicies(product.price, commerce, locale) : {}),
    };
  }

  return data;
}

/** One step of a breadcrumb trail: what it is called and its public URL. */
export interface Crumb {
  readonly name: string;
  readonly href: string;
}

/**
 * A listing's trail: „Начало“, then the steps given.
 *
 * The visible breadcrumb and the `BreadcrumbList` are both built from what
 * this returns, so the two cannot disagree about a name or a URL.
 */
export function listingBreadcrumbs(locale: Locale, crumbs: readonly Crumb[]): readonly Crumb[] {
  return [{ name: "Начало", href: href(locale, routes.home) }, ...crumbs];
}

/**
 * The steps that lead to a category: its parent listing, when it has one, and
 * the category itself — „Кафе капсули › Капсули за Dolce Gusto“.
 *
 * **By format, never by brand, and with no index page in between**
 * (`docs/seo.md` §13.2): the trail is the path a customer would walk from the
 * kind of coffee to the system. Each step is named as the page that owns it is
 * named everywhere else (`categoryNameFor`), not as the catalog stores it.
 *
 * A product page puts its own name after these, which is why they are returned
 * without „Начало“ and without a last step of their own.
 */
export function categoryCrumbs(
  locale: Locale,
  category: CategoryKeys & { readonly name: string },
  parent: (CategoryKeys & { readonly name: string }) | null = null,
): readonly Crumb[] {
  return [...(parent ? [parent] : []), category].map((step) => ({
    name: categoryNameFor(step),
    href: categoryHref(locale, step),
  }));
}

/** `items[].href` are public URLs from `lib/routes.ts`, as the visible breadcrumb uses. */
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
