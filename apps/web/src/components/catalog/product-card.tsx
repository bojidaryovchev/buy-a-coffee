import Link from "next/link";
import { AvailabilityBadge, Badge, buttonClasses, cx } from "@/components/ui/primitives";
import { IMAGE_SIZES } from "@/lib/catalog/images";
import { ImagePlaceholder } from "@/components/catalog/image-placeholder";
import { IntensityScale } from "@/components/catalog/intensity-scale";
import { ProductImage } from "@/components/catalog/product-image";
import { QuickOrderControl } from "@/components/catalog/quick-order-control";
import { SystemBadge } from "@/components/catalog/system-badge";
import type { ProductCardView } from "@/lib/catalog/types";

/**
 * Product card. Specified row by row in DESIGN.md, "Product card".
 *
 * Top to bottom: the packshot on a white, unpadded square; the brewing system;
 * brand and pack size; the name; intensity on the brand's own scale; the price
 * and what one cup costs; and the order control. The system and the price per
 * cup are there because they are the two questions a pack price and a
 * photograph do not answer: does it fit my machine, and what does it cost me.
 *
 * Every row has a fixed or minimum height whether or not it has anything to
 * show, and the price block is pushed to the bottom. So every card in a grid
 * row is the same height, and prices and buttons line up across the row
 * whatever a product happens to be missing.
 *
 * The card is one link — the name, stretched over the whole card by its
 * `::after` — plus one separate control beneath it. The control is a sibling
 * of that link and sits above it (`z-10`); it is never inside it. Two tab
 * stops per card, in reading order.
 */
export function ProductCard({
  product,
  priority = false,
  headingLevel: Heading = "h3",
}: {
  product: ProductCardView;
  priority?: boolean;
  /**
   * `h3` under a section's `h2`; `h2` where the grid sits directly under the
   * page's `h1`, so that no heading level is skipped.
   */
  headingLevel?: "h2" | "h3";
}) {
  const reduced = product.price !== null && product.oldPrice !== null;
  const href = `/products/${product.slug}`;
  const controlClasses = "relative z-10 mt-3 min-h-10 w-full";

  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-md border border-line bg-paper-raised transition-colors focus-within:border-line-strong focus-within:shadow-raise hover:border-line-strong hover:shadow-raise">
      <div className="relative aspect-square border-b border-line bg-well">
        {product.image ? (
          <ProductImage
            src={product.image.url}
            alt={product.image.alt || product.name}
            fill
            sizes={IMAGE_SIZES.card}
            priority={priority}
            loading={priority ? undefined : "lazy"}
            className="object-contain"
          />
        ) : (
          <ImagePlaceholder />
        )}

        {reduced && product.discountPercent !== null && (
          <div className="absolute top-2 left-2 flex">
            <Badge tone="reduction">−{product.discountPercent}%</Badge>
          </div>
        )}

        {product.availability !== "in_stock" && (
          <div className="absolute top-2 right-2 flex">
            <AvailabilityBadge availability={product.availability} />
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col p-3 md:p-4">
        {/* Each optional row keeps its height when empty; see the note above. */}
        <div className="flex h-5 min-w-0 items-center">
          <SystemBadge systemId={product.systemId} size="sm" />
        </div>

        <p className="mt-1.5 flex h-4 items-center gap-1.5 text-2xs font-semibold tracking-[0.06em] text-ink-500 uppercase">
          {product.brand && <span className="truncate">{product.brand.name}</span>}
          {product.brand && product.weight && <span aria-hidden>·</span>}
          {product.weight && (
            <span className="shrink-0 font-normal tracking-normal normal-case tabular-nums">
              {product.weight}
            </span>
          )}
        </p>

        {/*
          The clamp clips whatever leaves the heading's box, the link's focus
          ring included. The side padding, cancelled by the margin, is room for
          the ring; there is none above or below, where padding would let a
          sliver of the clamped fourth line show.
        */}
        <Heading className="-mx-1 mt-1.5 line-clamp-3 min-h-[3.75rem] px-1 font-sans text-sm font-medium tracking-normal text-wrap text-ink-900">
          <Link
            href={href}
            className="underline-offset-2 group-focus-within:underline group-hover:underline after:absolute after:inset-0"
          >
            {product.name}
          </Link>
        </Heading>

        <div className="mt-1.5 flex h-4 items-center">
          <IntensityScale raw={product.intensity} size="card" />
        </div>

        <div className="mt-auto pt-3">
          <p className="flex flex-wrap items-baseline gap-x-2">
            {product.price ? (
              <>
                {reduced && <span className="sr-only">Намалена цена </span>}
                <span
                  className={cx(
                    "text-lg font-semibold tabular-nums",
                    reduced ? "text-clay-600" : "text-ink-900",
                  )}
                >
                  {product.price.formatted}
                </span>
                {product.oldPrice && (
                  <>
                    <span className="sr-only">Стара цена </span>
                    <span className="text-sm text-ink-300 tabular-nums line-through">
                      {product.oldPrice.formatted}
                    </span>
                  </>
                )}
              </>
            ) : (
              /* Some products genuinely have no price; never render "0,00 €". */
              <span className="text-sm leading-[1.625rem] text-ink-500">Цена при запитване</span>
            )}
          </p>

          <p className="min-h-[1.125rem] text-xs font-medium text-pine-700 tabular-nums">
            {product.servingPrice?.formatted}
          </p>
        </div>

        {product.availability === "out_of_stock" ? (
          /*
           * Nothing to order, so no order control — but the same box, so the
           * row above still lines up with its neighbours.
           */
          <Link
            href={href}
            className={buttonClasses({
              variant: "secondary",
              size: "sm",
              className: controlClasses,
            })}
          >
            <span>
              Виж продукта<span className="sr-only">: {product.name}</span>
            </span>
          </Link>
        ) : (
          <QuickOrderControl slug={product.slug} name={product.name} className={controlClasses} />
        )}
      </div>
    </article>
  );
}

const GRID_COLUMNS = {
  /** Full width of the shell. */
  4: "grid-cols-2 md:grid-cols-3 lg:grid-cols-4",
  /** Beside the filter rail, where a fourth column would starve the cards. */
  3: "grid-cols-2 md:grid-cols-3",
} as const;

export function ProductGrid({
  products,
  priorityCount = 4,
  columns = 4,
  headingLevel = "h3",
}: {
  products: readonly ProductCardView[];
  priorityCount?: number;
  /** Columns from `lg` up. Use 3 for a grid beside the filter rail. */
  columns?: 3 | 4;
  /** See `ProductCard`. */
  headingLevel?: "h2" | "h3";
}) {
  return (
    <ul className={cx("grid gap-x-3 gap-y-6 md:gap-x-5 md:gap-y-8", GRID_COLUMNS[columns])}>
      {products.map((product, index) => (
        <li key={product.id} className="min-w-0">
          <ProductCard
            product={product}
            priority={index < priorityCount}
            headingLevel={headingLevel}
          />
        </li>
      ))}
    </ul>
  );
}
