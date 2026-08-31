import Image from "next/image";
import Link from "next/link";
import { Badge, ButtonLink, cx } from "@/components/ui/primitives";
import { IMAGE_SIZES, PLACEHOLDER_IMAGE } from "@/lib/catalog/images";
import { toPerServingView } from "@/lib/catalog/format";
import type { ScoredRecommendation } from "@/lib/recommend/score";

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
 */
export function RecommendationCard({
  entry,
  rank,
  emphasis = false,
}: {
  entry: ScoredRecommendation;
  /** 1-based position, shown so the ordering is legible rather than implied. */
  rank?: number;
  emphasis?: boolean;
}) {
  const product = entry.product;
  const perServing = toPerServingView(product.pricePerServing, product.price?.currency, {
    estimated: product.servingsEstimated,
  });

  return (
    <article
      className={cx(
        "relative flex gap-4 rounded-md border bg-paper-raised p-4 sm:gap-5 sm:p-5",
        emphasis ? "border-pine-500" : "border-line",
      )}
    >
      <div className="relative aspect-4/5 w-24 shrink-0 overflow-hidden rounded-sm border border-line bg-paper-sunken sm:w-32">
        <Image
          src={product.image?.url ?? PLACEHOLDER_IMAGE}
          alt={product.image?.alt ?? product.name}
          fill
          sizes={IMAGE_SIZES.card}
          className="object-contain p-2"
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-2xs tracking-wide text-ink-500 uppercase">
          {rank !== undefined && <span className="text-pine-700">№{rank}</span>}
          {product.brand && <span className="truncate">{product.brand.name}</span>}
          {product.weight && <span className="normal-case">· {product.weight}</span>}
        </p>

        <h3 className="mt-1 font-display text-lg leading-snug font-semibold text-ink-900">
          <Link href={`/products/${product.slug}`} className="hover:underline">
            {product.name}
          </Link>
        </h3>

        {entry.reasons.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {entry.reasons.map((reason) => (
              <li key={reason}>
                <Badge tone="positive">{reason}</Badge>
              </li>
            ))}
          </ul>
        )}

        {entry.caveat && (
          <p className="mt-2 text-sm text-clay-600">
            <span className="font-medium">Внимание:</span> {entry.caveat}
          </p>
        )}

        <div className="mt-auto flex flex-wrap items-baseline gap-x-3 gap-y-1 pt-3">
          {product.price ? (
            <span className="text-lg font-semibold text-ink-900">{product.price.formatted}</span>
          ) : (
            <span className="text-sm text-ink-500">Цена при запитване</span>
          )}
          {perServing && (
            <span className="text-sm font-medium text-pine-700">{perServing.formatted}</span>
          )}
        </div>

        <div className="mt-3">
          <ButtonLink
            href={`/products/${product.slug}`}
            size="sm"
            variant={emphasis ? "primary" : "secondary"}
          >
            Вижте и поръчайте
          </ButtonLink>
        </div>
      </div>
    </article>
  );
}
