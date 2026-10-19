import type { CSSProperties } from "react";
import { Img, Link } from "@react-email/components";
import { availabilityLabel } from "@/lib/catalog/format";
import type { NewsletterProduct } from "@/lib/newsletter/product-blocks";
import { Button } from "./components";
import { emailMediaUrl } from "./media";
import { color, font, mailUrl, type } from "./theme";

/**
 * Products in a newsletter: one a row, the photograph on the left and what a
 * reader decides on to its right — the name, what it is and how much, the
 * price (the old one struck through and the reduction beside it when there is
 * one), the price per cup, and "Виж продукта".
 *
 * Every figure is the storefront's own, already formatted
 * (`lib/newsletter/product-blocks.ts`); nothing here computes a price.
 *
 * Tables, not columns: Outlook on Windows lays a letter out with Word, which
 * knows `<td width>` and nothing about flex or floats, and Gmail strips the
 * `<style>` a media query would need. So the layout is the one that holds
 * everywhere without one: a fixed 112 px photograph and a text cell that takes
 * the rest. On a 375 px phone the sheet leaves about 310 px of content, and
 * the text cell keeps 180 of it — room for a name on two lines and the button
 * on one. A product with no photograph gives its row to the text.
 *
 * The photograph and the name link to the product as well as the button,
 * because that is where a reader taps; all three are the same address, which
 * carries the newsletter's `utm_*`, so the visits it brings are counted as its.
 */

/** Wide enough to recognise a pack; narrow enough to leave a phone its text. */
export const PRODUCT_IMAGE_WIDTH = 112;

const tabular: CSSProperties = {
  fontVariantNumeric: "tabular-nums",
  fontFeatureSettings: "'tnum' 1",
};

const cell: CSSProperties = { fontFamily: font.body, verticalAlign: "top" };

/** The product page, absolute, with the newsletter's campaign on it. */
export function productUrl(product: Pick<NewsletterProduct, "path">, campaign: string): string {
  const url = new URL(mailUrl(product.path));
  url.searchParams.set("utm_source", "newsletter");
  url.searchParams.set("utm_medium", "email");
  url.searchParams.set("utm_campaign", campaign);
  return url.toString();
}

/**
 * The height the photograph is drawn at, from its own proportions, so a
 * client that blocks images — Outlook does, until the reader allows them —
 * still keeps its place and the row does not collapse and jump when it
 * arrives. Absent when the catalog does not know the size; the row then
 * takes the text's height.
 */
export function imageHeight(image: {
  readonly width: number | null;
  readonly height: number | null;
}): number | undefined {
  if (!image.width || !image.height) return undefined;
  return Math.round((PRODUCT_IMAGE_WIDTH * image.height) / image.width);
}

/** A reduction under one percent rounds to zero: the struck price says it, as on the site. */
const showsBadge = (product: NewsletterProduct) =>
  product.oldPrice !== null && product.discountPercent !== null && product.discountPercent >= 1;

function ProductRow({
  product,
  campaign,
  last,
}: {
  product: NewsletterProduct;
  campaign: string;
  last: boolean;
}) {
  const url = productUrl(product, campaign);
  const reduced = product.price !== null && product.oldPrice !== null;
  const rule: CSSProperties = {
    borderTop: `1px solid ${color.line}`,
    ...(last ? { borderBottom: `1px solid ${color.line}` } : {}),
  };
  return (
    <tr>
      {product.image && (
        <td
          width={PRODUCT_IMAGE_WIDTH}
          style={{
            ...cell,
            ...rule,
            width: `${PRODUCT_IMAGE_WIDTH}px`,
            padding: "16px 16px 16px 0",
          }}
        >
          <Link
            href={url}
            style={{ display: "block", color: color.ink900, textDecoration: "none" }}
          >
            <Img
              src={emailMediaUrl(product.image.url)}
              alt={product.image.alt.trim() || product.name}
              width={PRODUCT_IMAGE_WIDTH}
              height={imageHeight(product.image)}
              style={{
                display: "block",
                width: `${PRODUCT_IMAGE_WIDTH}px`,
                maxWidth: "100%",
                height: "auto",
                border: `1px solid ${color.line}`,
                borderRadius: "4px",
                backgroundColor: color.paperRaised,
              }}
            />
          </Link>
        </td>
      )}
      <td colSpan={product.image ? 1 : 2} style={{ ...cell, ...rule, padding: "16px 0" }}>
        <Link
          href={url}
          style={{
            ...type.body,
            display: "block",
            fontFamily: font.body,
            fontWeight: 600,
            color: color.ink900,
            textDecoration: "none",
            wordBreak: "break-word",
          }}
        >
          {product.title}
        </Link>
        {product.detail && (
          <div style={{ ...type.small, ...tabular, color: color.ink700, margin: "2px 0 0" }}>
            {product.detail}
          </div>
        )}
        <div style={{ ...type.body, ...tabular, color: color.ink900, margin: "8px 0 0" }}>
          {product.price ? (
            <>
              <span
                style={{
                  ...type.lead,
                  fontWeight: 700,
                  color: reduced ? color.clay600 : color.ink900,
                  whiteSpace: "nowrap",
                }}
              >
                {product.price}
              </span>
              {reduced && (
                <>
                  {" "}
                  <del style={{ ...type.small, color: color.ink500, whiteSpace: "nowrap" }}>
                    {product.oldPrice}
                  </del>
                </>
              )}
              {showsBadge(product) && (
                <>
                  {" "}
                  <span
                    style={{
                      ...type.caption,
                      fontWeight: 700,
                      color: color.paperRaised,
                      backgroundColor: color.clay600,
                      borderRadius: "2px",
                      padding: "1px 6px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {`−${product.discountPercent}%`}
                  </span>
                </>
              )}
            </>
          ) : (
            <span style={{ ...type.small, color: color.ink500 }}>Цена при запитване</span>
          )}
        </div>
        {product.perCup && (
          <div style={{ ...type.small, ...tabular, fontWeight: 600, color: color.pine700 }}>
            {product.perCup}
          </div>
        )}
        {product.availability !== "in_stock" && (
          <div style={{ ...type.small, color: color.ink700, margin: "2px 0 0" }}>
            {availabilityLabel(product.availability)}
          </div>
        )}
        <div style={{ margin: "12px 0 0" }}>
          <Button href={url} variant="secondary">
            Виж продукта
          </Button>
        </div>
      </td>
    </tr>
  );
}

/** A block's products, or nothing when it has none: an empty block is not drawn. */
export function ProductCards({
  products,
  campaign,
}: {
  products: readonly NewsletterProduct[];
  campaign: string;
}) {
  if (products.length === 0) return null;
  return (
    <table
      role="presentation"
      width="100%"
      cellPadding={0}
      cellSpacing={0}
      style={{ borderCollapse: "collapse", margin: "4px 0 24px" }}
    >
      <tbody>
        {products.map((product, index) => (
          <ProductRow
            key={`${product.id}-${index}`}
            product={product}
            campaign={campaign}
            last={index === products.length - 1}
          />
        ))}
      </tbody>
    </table>
  );
}

/**
 * The same products in the text part, one a line:
 * "Name — 19,90 € (0,31 € на чаша) — https://…", with the old price after
 * "вместо" when it is reduced and the availability when it is not in stock.
 */
export function productTextLines(products: readonly NewsletterProduct[], campaign: string): string {
  return products
    .map((product) => {
      const price = product.price
        ? product.oldPrice
          ? `${product.price} вместо ${product.oldPrice}`
          : product.price
        : "Цена при запитване";
      const perCup = product.perCup ? ` (${product.perCup})` : "";
      const availability =
        product.availability === "in_stock" ? "" : ` — ${availabilityLabel(product.availability)}`;
      return `- ${product.name} — ${price}${perCup}${availability} — ${productUrl(product, campaign)}`;
    })
    .join("\n");
}
