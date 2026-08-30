import Image from "next/image";
import Link from "next/link";
import { AvailabilityBadge, Badge } from "@/components/ui/primitives";
import { IMAGE_SIZES, PLACEHOLDER_IMAGE } from "@/lib/catalog/images";
import type { ProductCardView } from "@/lib/catalog/types";

/**
 * Product card.
 *
 * Original composition: a portrait image panel on a sunken ground, then a
 * metadata line, the name, and a price row aligned to the baseline. The whole
 * card is one link rather than a card plus a separate call-to-action button,
 * which keeps the accessibility tree simple (one link, one accessible name).
 *
 * `width` and `height` are always supplied so the browser reserves space and
 * the grid does not shift as images arrive.
 */
export function ProductCard({
  product,
  priority = false,
}: {
  product: ProductCardView;
  priority?: boolean;
}) {
  const hasDiscount = product.discountPercent !== null && product.oldPrice !== null;

  return (
    <article className="group relative flex h-full flex-col">
      <div className="relative aspect-4/5 overflow-hidden rounded-md border border-line bg-paper-sunken">
        <Image
          src={product.image?.url ?? PLACEHOLDER_IMAGE}
          alt={product.image?.alt ?? product.name}
          fill
          sizes={IMAGE_SIZES.card}
          priority={priority}
          loading={priority ? undefined : "lazy"}
          className="object-contain p-4 transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transform-none"
        />

        {hasDiscount && (
          <div className="absolute top-2 left-2">
            <Badge tone="accent">−{product.discountPercent}%</Badge>
          </div>
        )}

        {product.availability !== "in_stock" && (
          <div className="absolute top-2 right-2">
            <AvailabilityBadge availability={product.availability} />
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col pt-3">
        <p className="flex items-center gap-1.5 text-2xs tracking-wide text-ink-500 uppercase">
          {product.brand && <span className="truncate">{product.brand.name}</span>}
          {product.brand && product.weight && <span aria-hidden>·</span>}
          {product.weight && <span className="shrink-0 normal-case">{product.weight}</span>}
        </p>

        <h3 className="mt-1 font-display text-base leading-snug font-semibold text-ink-900">
          <Link href={`/products/${product.slug}`} className="after:absolute after:inset-0">
            {product.name}
          </Link>
        </h3>

        <div className="mt-auto flex items-baseline gap-2 pt-3">
          {product.price ? (
            <>
              <span className="text-lg font-semibold text-ink-900">{product.price.formatted}</span>
              {product.oldPrice && (
                <span className="text-sm text-ink-300 line-through">{product.oldPrice.formatted}</span>
              )}
            </>
          ) : (
            /* Some products genuinely have no price; never render "0.00". */
            <span className="text-sm text-ink-500">Цена при запитване</span>
          )}
        </div>
      </div>
    </article>
  );
}

export function ProductGrid({
  products,
  priorityCount = 4,
}: {
  products: readonly ProductCardView[];
  priorityCount?: number;
}) {
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3 lg:grid-cols-4">
      {products.map((product, index) => (
        <li key={product.id}>
          <ProductCard product={product} priority={index < priorityCount} />
        </li>
      ))}
    </ul>
  );
}
