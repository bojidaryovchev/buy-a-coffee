import { brandLogoFor, type BrandLogo as BrandLogoAsset } from "../../../content/brand-logos";

/**
 * A brand's own logo, where the brand itself is the subject.
 *
 * Specified in DESIGN.md, "Brand logo". The short version: a logo is the
 * brand's trademark, shown to identify the genuine product, so it is drawn
 * exactly as the brand publishes it — never recoloured, cropped, stretched or
 * combined — and only where it can be read.
 *
 * A plain `<img>`, not `next/image`: the files are small, served from our own
 * origin, and SVG would otherwise need `dangerouslyAllowSVG`, which lets the
 * optimiser serve SVG from anywhere it is pointed. Explicit `width` and
 * `height` give the browser the box before the file arrives, so nothing moves.
 */

export interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * The boxes a logo is fitted into, one per place it appears. The box is the
 * most room a logo may take; the optical rule below decides how much of it a
 * given logo actually uses.
 */
export const LOGO_BOXES = {
  /** Brands index tile and the home page's brand row. */
  tile: { width: 160, height: 56 },
  /** Above the `h1` on a brand page. */
  header: { width: 240, height: 80 },
  /** The brand line on a product page, beside the system badge. */
  line: { width: 112, height: 32 },
  /** Before the name in the search typeahead. */
  suggestion: { width: 64, height: 28 },
} as const satisfies Record<string, Size>;

export type BrandLogoSize = keyof typeof LOGO_BOXES;

/** Padding of the dark tile around a logo drawn for a dark ground, per box. */
const DARK_PADDING: Record<BrandLogoSize, { readonly x: number; readonly y: number }> = {
  tile: { x: 10, y: 8 },
  header: { x: 14, y: 10 },
  line: { x: 6, y: 4 },
  suggestion: { x: 4, y: 3 },
};

/**
 * The optical sizing rule.
 *
 * Fitting every logo to one height makes a square mark a speck beside a wide
 * wordmark: at 32 px tall, illy is 32 by 32 and Lavazza 127 by 32, four times
 * the ink. So each logo gets the same *area* instead — a share of the box
 * height squared — and its height follows from its aspect ratio:
 *
 *     height = √(AREA_SHARE × boxHeight² ÷ aspect)
 *
 * which makes a square mark √AREA_SHARE of the box tall and a 4:1 wordmark
 * half that, twice as wide. Then, in order:
 *
 *  1. no taller than the box, and no shorter than MIN_HEIGHT (below that a
 *     wordmark cannot be read);
 *  2. no wider than the box — width wins over the minimum, because the box is
 *     a promise to the layout;
 *  3. a raster logo is never drawn larger than its own pixels: upscaling would
 *     blur someone else's trademark.
 *
 * Aspect ratio is kept exactly; only the scale changes.
 */
export const AREA_SHARE = 0.75;
export const MIN_HEIGHT = 12;

export function fitLogo(
  intrinsic: Size,
  box: Size,
  { raster = false }: { readonly raster?: boolean } = {},
): Size {
  const aspect = intrinsic.width / intrinsic.height;
  let height = Math.sqrt((AREA_SHARE * box.height * box.height) / aspect);
  height = Math.min(box.height, Math.max(MIN_HEIGHT, height));
  if (height * aspect > box.width) height = box.width / aspect;
  if (raster) height = Math.min(height, intrinsic.height);
  // Whole pixels, each within half a pixel of the exact size, so the two
  // attributes describe the logo's own proportions and stay inside the box.
  return {
    width: Math.min(box.width, Math.max(1, Math.round(height * aspect))),
    height: Math.min(box.height, Math.max(1, Math.round(height))),
  };
}

/** What a placement renders when the brand has no logo. */
export type BrandLogoFallback = "text" | "blank" | "none";

const TEXT_CLASS: Record<BrandLogoSize, string> = {
  tile: "text-lg",
  header: "text-2xl",
  line: "text-sm",
  suggestion: "text-sm",
};

/**
 * The size one placement draws a logo at, and the dark tile's padding when it
 * has one. Exposed so a test can check the whole catalogue against the rule
 * without rendering.
 *
 * A logo on a dark tile is fitted to the room inside the tile's padding, not
 * to the whole box. The tile is ink too: sized against the whole box, the
 * logo matched its neighbours and the tile around it came out twice their
 * area, the heaviest thing in the row. Fitted to the room, tile and logo
 * together land near the others.
 */
export function brandLogoLayout(
  logo: BrandLogoAsset,
  size: BrandLogoSize,
): { readonly image: Size; readonly padding: { readonly x: number; readonly y: number } | null } {
  const box = LOGO_BOXES[size];
  const padding = logo.ground === "dark" ? DARK_PADDING[size] : null;
  const room = padding
    ? { width: box.width - 2 * padding.x, height: box.height - 2 * padding.y }
    : box;
  return { image: fitLogo(logo, room, { raster: logo.format !== "svg" }), padding };
}

/**
 * The brand's logo if it can be read at this size, else null.
 *
 * Null for a brand with no logo, and for a logo whose name would come out
 * smaller than its own recorded `minHeight` in this box — a stacked lockup in
 * a line of text, say. A logo nobody can read identifies nothing; the
 * placement shows the name instead.
 */
export function legibleBrandLogo(
  keyOrSlug: string | null | undefined,
  size: BrandLogoSize,
): BrandLogoAsset | null {
  const logo = brandLogoFor(keyOrSlug);
  if (!logo) return null;
  const { image } = brandLogoLayout(logo, size);
  return image.height >= (logo.minHeight ?? MIN_HEIGHT) ? logo : null;
}

export function BrandLogo({
  brand,
  size,
  fallback = "text",
  decorative = false,
  inline = false,
  eager = false,
  className = "",
}: {
  /** `slug` finds the logo; `name` is the display name, used as `alt`. */
  readonly brand: { readonly slug: string; readonly name: string };
  readonly size: BrandLogoSize;
  /**
   * With no logo: the name in text in the same box (`text`, so a row of tiles
   * stays even), an empty reserved box (`blank`, so names beside it align), or
   * nothing at all (`none`, where the name is already printed next to it).
   */
  readonly fallback?: BrandLogoFallback;
  /**
   * Set where the brand's name is printed right beside the logo inside the
   * same link: the image then takes `alt=""` so a screen reader does not say
   * the name twice.
   */
  readonly decorative?: boolean;
  /** Hug the logo instead of reserving the whole box (a line of text). */
  readonly inline?: boolean;
  /** Above the fold (the brand page header). */
  readonly eager?: boolean;
  readonly className?: string;
}) {
  const box = LOGO_BOXES[size];
  const logo = legibleBrandLogo(brand.slug, size);

  // The box: fixed so a row of tiles stays even whatever each one holds.
  const frame = inline
    ? `flex w-fit max-w-full shrink-0 items-center ${className}`
    : `flex shrink-0 items-center justify-center ${className}`;
  const frameStyle = inline ? undefined : { width: box.width, height: box.height };

  // No logo, or none that can be read at this size.
  if (!logo) {
    if (fallback === "none") return null;
    if (fallback === "blank") {
      return <span aria-hidden data-brand-logo="none" className={frame} style={frameStyle} />;
    }
    return (
      <span
        data-brand-logo="text"
        aria-hidden={decorative || undefined}
        className={`${frame} max-w-full overflow-hidden text-center font-display leading-tight font-semibold text-ink-700 ${TEXT_CLASS[size]}`}
        style={inline ? undefined : { ...frameStyle, maxWidth: "100%" }}
      >
        <span className="line-clamp-2">{brand.name}</span>
      </span>
    );
  }

  const { image, padding } = brandLogoLayout(logo, size);
  const img = (
    // A plain <img> on purpose; see the comment at the top of this file.
    <img
      src={logo.file}
      alt={decorative ? "" : brand.name}
      width={image.width}
      height={image.height}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      className="block max-w-full"
      style={{ height: "auto" }}
    />
  );

  return (
    <span
      data-brand-logo={logo.ground}
      className={frame}
      style={inline ? undefined : { ...frameStyle, maxWidth: "100%" }}
    >
      {padding ? (
        // The dark ground the white-only logos were drawn for: the darkest
        // neutral, hugging the logo, never the whole box.
        <span
          className="inline-flex max-w-full rounded-sm bg-ink-900"
          style={{ padding: `${padding.y}px ${padding.x}px` }}
        >
          {img}
        </span>
      ) : (
        img
      )}
    </span>
  );
}
