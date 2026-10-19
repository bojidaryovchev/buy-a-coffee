import Link from "next/link";
import { AvailabilityBadge, Badge, buttonClasses, cx } from "@/components/ui/primitives";
import { AddToCartButton } from "@/components/cart/add-to-cart-button";
import { BrandLogo, legibleBrandLogo } from "@/components/catalog/brand-logo";
import { IMAGE_SIZES } from "@/lib/catalog/images";
import { ImagePlaceholder } from "@/components/catalog/image-placeholder";
import { IntensityScale } from "@/components/catalog/intensity-scale";
import { ProductImage } from "@/components/catalog/product-image";
import { SystemBadge } from "@/components/catalog/system-badge";
import type { ProductCardView } from "@/lib/catalog/types";
import type { Locale } from "@/i18n/config";
import { productHref } from "@/lib/routes";

/**
 * Product card. Specified row by row in DESIGN.md, "Product card".
 *
 * Top to bottom: the packshot on a white, unpadded square; the brewing system;
 * brand and pack size; the name; intensity on the brand's own scale; the price
 * and what one cup costs; and „Добави“, which puts one in the cart. The system and the price per
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
  locale,
  product,
  priority = false,
  headingLevel: Heading = "h3",
}: {
  locale: Locale;
  product: ProductCardView;
  priority?: boolean;
  /**
   * `h3` under a section's `h2`; `h2` where the grid sits directly under the
   * page's `h1`, so that no heading level is skipped.
   */
  headingLevel?: "h2" | "h3";
}) {
  const reduced = product.price !== null && product.oldPrice !== null;
  const href = productHref(locale, product);
  // Its height is the `sm` button's: 44 px below `lg`, where a card is touched,
  // 40 px from `lg` (DESIGN.md, "Product card", row 8).
  const controlClasses = "relative z-10 mt-3 w-full";

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

        {/* A reduction under one percent rounds to zero: the struck old price
            says it; a "−0%" badge would only look like a mistake. */}
        {reduced && product.discountPercent !== null && product.discountPercent >= 1 && (
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

      {/* A size container, so the cart button's label follows the card's width,
          not the window's (DESIGN.md, "The Meta Rule"). */}
      <div className="@container flex flex-1 flex-col p-3 md:p-4">
        {/* Each optional row keeps its height when empty; see the note above. */}
        <div className="flex h-5 min-w-0 items-center">
          <SystemBadge systemId={product.systemId} size="sm" />
          {/*
            Instant coffee fits no system, so it has no badge; the row says
            what it is instead, in plain ink, with no system colour and no
            `data-system`: it is the product's kind, not a compatibility claim.
          */}
          {!product.systemId && product.kind === "instant" && (
            <span className="truncate text-2xs font-semibold text-ink-700">Разтворимо кафе</span>
          )}
        </div>

        {/* The brand's logo, named by its alt; its name where there is none.
            The row is the `card` box's height, so cards line up either way. */}
        <BrandPackLine brand={product.brand} weight={product.weight} className="mt-1.5 h-10" />

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
            {/* Brand and line. The format is the badge above (for instant
                coffee, the words in its place) and the pack size is beside the
                brand, so the heading need not repeat either. */}
            {product.title ?? product.name}
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
           * Nothing to order, so nothing to put in the cart — but the same box,
           * so the row above still lines up with its neighbours.
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
          <AddToCartButton
            productId={product.id}
            slug={product.slug}
            name={product.name}
            className={controlClasses}
          />
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
  locale,
  products,
  priorityCount = 4,
  columns = 4,
  headingLevel = "h3",
}: {
  locale: Locale;
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
            locale={locale}
            product={product}
            priority={index < priorityCount}
            headingLevel={headingLevel}
          />
        </li>
      ))}
    </ul>
  );
}

const LINE = "flex items-center text-2xs font-semibold tracking-[0.06em] text-ink-500 uppercase";
const PACK = "shrink-0 font-normal tracking-normal normal-case tabular-nums";

/**
 * A card's brand line: the brand's logo (or its name), "·", the pack size.
 * Shared by the product card and the wizard's result. DESIGN.md, "Product
 * card", row 3.
 *
 * Neither part may be cut off on a 320 px phone. A logo gives way to the
 * pack size, proportions kept (`shrink`). A name cannot — a word cut in half
 * („Excelsio“) names nothing — so where the brand is written out, the pack
 * size moves under it instead when the two do not fit side by side. Its "·"
 * then starts the second line, outside the line's clipped box, so it is not
 * seen: each part carries a 12 px left margin that the wrapper takes back,
 * and the separator sits in that margin.
 */
export function BrandPackLine({
  brand,
  weight,
  className,
}: {
  readonly brand: { readonly slug: string; readonly name: string } | null;
  readonly weight: string | null;
  readonly className?: string;
}) {
  if (!brand || legibleBrandLogo(brand.slug, "card")) {
    return (
      <p className={cx(LINE, "gap-1.5", className)}>
        {brand && <BrandLogo brand={brand} size="card" inline shrink />}
        {brand && weight && <span aria-hidden>·</span>}
        {weight && <span className={PACK}>{weight}</span>}
      </p>
    );
  }
  return (
    <p className={cx(LINE, "overflow-hidden", className)}>
      <span className="-ml-3 flex min-w-0 flex-wrap items-center *:ml-3">
        <BrandLogo brand={brand} size="card" inline />
        {weight && (
          <span className={cx(PACK, "relative")}>
            <span aria-hidden className="absolute -left-2">
              ·
            </span>
            {weight}
          </span>
        )}
      </span>
    </p>
  );
}
