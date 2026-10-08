import * as cheerio from "cheerio";
import { normalizeLabel } from "@catalog/shared";
import { parseProductPage } from "../parsers/productPage.ts";

/**
 * Storefront signals read during discovery.
 *
 * The generic page parser records what is true of any HTML page. These are
 * the few things the feature inventory needs to know about *this* storefront's
 * chrome and product pages: what the sitewide banner is for, which payment
 * methods the footer lists, whether a product page prints a code and a
 * characteristics list.
 *
 * What is recorded is the fact, not the wording. The banner's text and the
 * footer's descriptions are the source's own marketing copy; the reference
 * artifacts these signals end up in are committed, so only a classification,
 * a figure and neutral method keys leave this module.
 */

export type NoticeBannerKind =
  /** States the order value above which delivery is free. */
  | "delivery_threshold"
  /** Announces opening hours, closures or holidays. */
  | "opening_hours"
  /** A banner whose purpose was not recognised. */
  | "other";

export interface NoticeBannerSignal {
  readonly kind: NoticeBannerKind;
  /** The stated threshold, e.g. `49€`. Null unless `kind` is `delivery_threshold`. */
  readonly deliveryThreshold: string | null;
  /** True when the page carries a control or script that dismisses the banner. */
  readonly dismissible: boolean;
}

export interface StorefrontSignals {
  readonly hasNoticeBanner: boolean;
  readonly noticeBanner: NoticeBannerSignal | null;
  /** Neutral keys, e.g. `cash-on-delivery`; an unrecognised label is kept as text. */
  readonly paymentMethods: string[];
  /** Product pages only: the page prints a product code. */
  readonly hasProductCode: boolean;
  /** Product pages only: the page's Product JSON-LD carries the same code. */
  readonly productCodeInStructuredData: boolean;
  /** Product pages only: labels of the characteristics list, in page order. */
  readonly characteristicLabels: string[];
}

const AMOUNT = String.raw`(\d+(?:[.,]\d+)?)\s*(€|лв\.?|EUR|BGN)`;
/** "…доставка … над 49€" — the amount that follows "над" within the sentence. */
const DELIVERY_THRESHOLD = new RegExp(String.raw`доставка[^.!?]*?над\s*${AMOUNT}`, "iu");
const OPENING_HOURS =
  /работно време|почивн|затворен|няма да работ|не работим|ще работим|празни(?:к|ц|чн)/iu;

/** Read what a sitewide banner is for, from its text. */
export function classifyNoticeBanner(text: string): {
  kind: NoticeBannerKind;
  deliveryThreshold: string | null;
} {
  const threshold = DELIVERY_THRESHOLD.exec(text);
  if (threshold) {
    return { kind: "delivery_threshold", deliveryThreshold: `${threshold[1]}${threshold[2]}` };
  }
  if (OPENING_HOURS.test(text)) return { kind: "opening_hours", deliveryThreshold: null };
  return { kind: "other", deliveryThreshold: null };
}

const PAYMENT_HEADING = /^начини на плащане$/iu;

const PAYMENT_METHODS: ReadonlyArray<readonly [RegExp, string]> = [
  [/наложен\s+платеж/iu, "cash-on-delivery"],
  [/банков\s+превод/iu, "bank-transfer"],
  [/карта/iu, "card"],
];

function paymentMethodKey(label: string): string {
  return PAYMENT_METHODS.find(([pattern]) => pattern.test(label))?.[1] ?? label;
}

/**
 * Detect the storefront signals on one page.
 *
 * `isProductPage` gates the product-page reads: running the product parser on
 * a category would find nothing, slowly.
 */
export function detectStorefrontSignals(
  html: string,
  options: { readonly isProductPage?: boolean } = {},
): StorefrontSignals {
  const $ = cheerio.load(html);

  // --- Sitewide banner ------------------------------------------------------
  // Hidden until a script shows it, so visibility says nothing; the element
  // and its text are what is on the page.
  const bannerNode = $("[id$='-banner'], [id^='banner-'], [id='banner']")
    // A cookie-consent bar is a different capability, with its own page type.
    .filter((_, el) => !/cookie|consent/i.test($(el).attr("id") ?? ""))
    .filter((_, el) => normalizeLabel($(el).text()).length > 0)
    .first();
  let noticeBanner: NoticeBannerSignal | null = null;
  if (bannerNode.length > 0) {
    const id = bannerNode.attr("id") ?? "";
    const text = normalizeLabel(bannerNode.find("p").first().text() || bannerNode.text());
    noticeBanner = {
      ...classifyNoticeBanner(text),
      dismissible:
        bannerNode.find("button, [onclick]").length > 0 ||
        (id !== "" &&
          new RegExp(`getElementById\\(['"]${id}['"]\\)\\.style\\.display\\s*=\\s*['"]none`).test(
            html,
          )),
    };
  }

  // --- Payment methods -------------------------------------------------------
  // A heading-like line, then one row per method: a label and a description.
  // Rendered once per breakpoint, so de-duplicated.
  const paymentMethods: string[] = [];
  $("p, h2, h3, h4, h5, h6, span")
    .filter((_, el) => PAYMENT_HEADING.test(normalizeLabel($(el).text())))
    .each((_, heading) => {
      $(heading)
        .parent()
        .find("span")
        .each((__, el) => {
          const span = $(el);
          // The label is the first of the row's spans; the rest describe it.
          if (span.prevAll("span").length > 0 || span.nextAll("span").length === 0) return;
          const label = normalizeLabel(span.text());
          if (!label || PAYMENT_HEADING.test(label)) return;
          const key = paymentMethodKey(label);
          if (!paymentMethods.includes(key)) paymentMethods.push(key);
        });
    });

  // --- Product page ----------------------------------------------------------
  let hasProductCode = false;
  let productCodeInStructuredData = false;
  let characteristicLabels: string[] = [];
  if (options.isProductPage) {
    const product = parseProductPage(html);
    hasProductCode = product.sku !== null;
    characteristicLabels = [...new Set(product.characteristics.map((entry) => entry.label))];
    if (product.sku !== null) {
      const sku = product.sku;
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const parsed: unknown = JSON.parse($(el).contents().text());
          const blocks = Array.isArray(parsed) ? parsed : [parsed];
          for (const block of blocks) {
            const record = block as { "@type"?: unknown; sku?: unknown } | null;
            if (record && record["@type"] === "Product" && String(record.sku ?? "") === sku) {
              productCodeInStructuredData = true;
            }
          }
        } catch {
          // Malformed JSON-LD proves nothing either way.
        }
      });
    }
  }

  return {
    hasNoticeBanner: noticeBanner !== null,
    noticeBanner,
    paymentMethods,
    hasProductCode,
    productCodeInStructuredData,
    characteristicLabels,
  };
}
