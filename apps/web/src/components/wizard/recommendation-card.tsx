import Link from "next/link";
import { ButtonLink, ReasonBadge, cx } from "@/components/ui/primitives";
import { IMAGE_SIZES } from "@/lib/catalog/images";
import { ImagePlaceholder } from "@/components/catalog/image-placeholder";
import { ProductImage } from "@/components/catalog/product-image";
import { SystemBadge } from "@/components/catalog/system-badge";
import { toPerServingView } from "@/lib/catalog/format";
import type { ScoredRecommendation } from "@/lib/recommend/score";
import type { Locale } from "@/i18n/config";
import { productHref } from "@/lib/routes";

/**
 * A recommendation, with its reasons.
 *
 * The reasons are the point. A ranked list with no explanation is a filter
 * wearing a costume: the visitor cannot tell whether it understood them, and
 * has no way to judge the suggestion except by trusting it. Every phrase here
 * comes from a criterion that actually contributed to the score, so the card
 * cannot claim a match the ranking did not make.
 *
 * Price per cup is given prominence over pack price on purpose. It is the
 * comparison the visitor came to make and the one the pack price actively
 * obscures — in this catalog a 100-capsule box at EUR 33.25 undercuts a
 * 16-capsule box at EUR 5.60 per cup.
 *
 * It is the product card's content laid out as a row (DESIGN.md, "Wizard"):
 * the same white, unpadded well, the same system badge, the same sans name.
 */
export function RecommendationCard({
  locale,
  entry,
  rank,
  emphasis = false,
  headingLevel: Heading = "h3",
}: {
  locale: Locale;
  entry: ScoredRecommendation;
  /** 1-based position, shown so the ordering is legible rather than implied. */
  rank?: number;
  emphasis?: boolean;
  /** `h3` under a section's `h2`; `h2` where the list sits directly under the `h1`. */
  headingLevel?: "h2" | "h3";
}) {
  const product = entry.product;
  const perServing = toPerServingView(product.pricePerServing, product.price?.currency, {
    estimated: product.servingsEstimated,
    locale,
  });
  const productPath = productHref(locale, product);

  return (
    <article
      className={cx(
        "relative flex gap-4 rounded-md border bg-paper-raised p-4 sm:gap-5 sm:p-5",
        emphasis ? "border-pine-500" : "border-line",
      )}
    >
      <div className="relative aspect-square w-24 shrink-0 self-start overflow-hidden rounded-md border border-line bg-well sm:w-32">
        {product.image ? (
          <ProductImage
            src={product.image.url}
            alt={product.image.alt || product.name}
            fill
            sizes={IMAGE_SIZES.thumb}
            className="object-contain"
            placeholderLabel="from-sm"
          />
        ) : (
          /* At 96 px the words do not fit; they return with the wider well. */
          <ImagePlaceholder label="from-sm" />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {(rank !== undefined || product.systemId) && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {rank !== undefined && (
              <span className="text-2xs font-semibold tracking-[0.06em] text-pine-700 tabular-nums">
                №{rank}
              </span>
            )}
            <SystemBadge systemId={product.systemId} size="sm" />
          </p>
        )}

        {(product.brand || product.weight) && (
          <p className="mt-1.5 flex items-center gap-1.5 text-2xs font-semibold tracking-[0.06em] text-ink-500 uppercase">
            {product.brand && <span className="truncate">{product.brand.name}</span>}
            {product.brand && product.weight && <span aria-hidden>·</span>}
            {product.weight && (
              <span className="shrink-0 font-normal tracking-normal normal-case tabular-nums">
                {product.weight}
              </span>
            )}
          </p>
        )}

        <Heading className="mt-1.5 font-sans text-base font-medium tracking-normal text-wrap text-ink-900">
          <Link href={productPath} className="underline-offset-2 hover:underline">
            {product.name}
          </Link>
        </Heading>

        {entry.reasons.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {entry.reasons.map((reason) => (
              <li key={reason} className="flex">
                <ReasonBadge>{reason}</ReasonBadge>
              </li>
            ))}
          </ul>
        )}

        {entry.caveat && (
          <p className="mt-2 text-sm text-caution">
            <span className="font-semibold">Внимание:</span> {entry.caveat}
          </p>
        )}

        <div className="mt-auto flex flex-wrap items-baseline gap-x-3 gap-y-1 pt-3">
          {product.price ? (
            <span className="text-lg font-semibold text-ink-900 tabular-nums">
              {product.price.formatted}
            </span>
          ) : (
            <span className="text-sm text-ink-500">Цена при запитване</span>
          )}
          {perServing && (
            <span className="text-sm font-medium text-pine-700 tabular-nums">
              {perServing.formatted}
            </span>
          )}
        </div>

        <div className="mt-3">
          <ButtonLink href={productPath} size="sm" variant={emphasis ? "primary" : "secondary"}>
            Вижте и поръчайте
          </ButtonLink>
        </div>
      </div>
    </article>
  );
}
