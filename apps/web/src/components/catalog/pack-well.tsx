import type { ReactNode } from "react";
import { ImagePlaceholder } from "@/components/catalog/image-placeholder";
import { ProductImage } from "@/components/catalog/product-image";
import { cx } from "@/components/ui/primitives";
import type { ProductImageView } from "@/lib/catalog/types";

/**
 * A packshot's well — DESIGN.md, "Imagery" and "The Cut-out Rule".
 *
 * Three cases, one box: whichever a product gets, the well keeps the size its
 * caller gives it, so a cut-out arriving later moves nothing.
 *
 * - A live cut-out stands in an inner box anchored to the bottom, on a well
 *   that fades to `paper-sunken` at its foot, with a contact shadow as wide as
 *   the pack's own footprint (worked out from the cut-out's proportions, so a
 *   tall bag and a wide pouch each cast their own).
 * - A photo with no cut-out sits on white as it was taken: its own white
 *   margin is its padding.
 * - No photo at all: the placeholder.
 *
 * `lift`: the pack rises 5 px as its card is hovered or focused, on devices
 * that hover (DESIGN.md, "Motion"). The card is the `group`.
 */

/** The box a cut-out stands in, as shares of a square well. */
const STAND = { side: 0.14, top: 0.1, bottom: 0.13 } as const;

export function PackWell({
  image,
  alt,
  sizes,
  priority = false,
  lift = false,
  className,
  children,
}: {
  readonly image: ProductImageView | null;
  readonly alt: string;
  readonly sizes: string;
  /** Preload: the likely LCP image of its page. */
  readonly priority?: boolean;
  readonly lift?: boolean;
  /** The well's box: its aspect ratio and radius. */
  readonly className?: string;
  /** Overlays: badges in a corner. */
  readonly children?: ReactNode;
}) {
  const loading = priority ? undefined : ("lazy" as const);

  if (!image) {
    return (
      <div className={cx("relative overflow-hidden bg-paper-sunken", className)}>
        <ImagePlaceholder />
        {children}
      </div>
    );
  }

  const cutout = image.cutout ?? null;
  if (!cutout) {
    return (
      <div className={cx("relative overflow-hidden bg-well", className)} data-pack="photo">
        <ProductImage
          src={image.url}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          loading={loading}
          className="object-contain"
        />
        {children}
      </div>
    );
  }

  // How wide the pack stands, as a share of the well: the whole inner box for a
  // wide pack, less for a tall one (object-contain, anchored to the bottom).
  const boxWidth = 1 - 2 * STAND.side;
  const boxHeight = 1 - STAND.top - STAND.bottom;
  const aspect =
    cutout.width && cutout.height ? cutout.width / cutout.height : boxWidth / boxHeight;
  const footprint = Math.min(boxWidth, aspect * boxHeight);
  const shadowWidth = footprint * 0.96;

  return (
    <div
      className={cx(
        "relative overflow-hidden bg-linear-to-b from-well from-60% to-paper-sunken",
        lift && "pack-lift",
        className,
      )}
      data-pack="cutout"
    >
      <span
        aria-hidden
        className="pack-shadow absolute h-[7%]"
        style={{
          left: `${(50 - (shadowWidth * 100) / 2).toFixed(2)}%`,
          width: `${(shadowWidth * 100).toFixed(2)}%`,
          bottom: `${((STAND.bottom - 0.035) * 100).toFixed(2)}%`,
        }}
      />
      <span
        className="pack-stand absolute"
        style={{
          left: `${STAND.side * 100}%`,
          right: `${STAND.side * 100}%`,
          top: `${STAND.top * 100}%`,
          bottom: `${STAND.bottom * 100}%`,
        }}
      >
        <ProductImage
          src={cutout.url}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          loading={loading}
          className="object-contain object-bottom"
        />
      </span>
      {children}
    </div>
  );
}
