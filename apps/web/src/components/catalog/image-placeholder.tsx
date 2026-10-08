/**
 * What a packshot well shows when the product has no photograph.
 *
 * A line drawing of a coffee pack on the sunken tone, with the words "Няма
 * снимка". Deliberately not a white box, which reads as a photograph that
 * failed to load, and deliberately not another product's picture or a stock
 * photograph of coffee, either of which would be a claim about the product.
 * Specified in DESIGN.md, "Image placeholder".
 *
 * It fills its parent, which must be positioned and carry the aspect ratio —
 * the same box the photograph would have filled, so nothing moves.
 *
 * Decorative: the product's name is already the heading beside it.
 */
export function ImagePlaceholder({
  label = true,
  className,
}: {
  /**
   * Whether to print "Няма снимка" under the drawing. Leave it out where the
   * well is under 96 px wide (typeahead rows, thumbnails): the words would not
   * fit, and the row already names the product. `"from-sm"` prints them only
   * from the `sm` breakpoint, for a well that is that narrow on a phone alone.
   */
  readonly label?: boolean | "from-sm";
  readonly className?: string;
}) {
  return (
    <span
      className={[
        "absolute inset-0 flex flex-col items-center justify-center gap-2 bg-paper-sunken",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <svg
        aria-hidden
        viewBox="0 0 40 48"
        className="w-2/5 text-line-strong"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      >
        {/* The folded top of a bag, its body, and a label. */}
        <path d="M9 4h22v6H9z" vectorEffect="non-scaling-stroke" />
        <path
          d="M10 10l-3 6v26a2 2 0 002 2h22a2 2 0 002-2V16l-3-6"
          vectorEffect="non-scaling-stroke"
        />
        <rect x="13" y="22" width="14" height="13" rx="1" vectorEffect="non-scaling-stroke" />
        <path d="M20 25.5c-2.4 1.6-2.4 4.4 0 6" vectorEffect="non-scaling-stroke" />
      </svg>
      {label && (
        <span
          className={
            label === "from-sm" ? "hidden text-2xs text-ink-500 sm:inline" : "text-2xs text-ink-500"
          }
        >
          Няма снимка
        </span>
      )}
    </span>
  );
}
