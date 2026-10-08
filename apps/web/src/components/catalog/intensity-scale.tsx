import { parseIntensity } from "@/lib/catalog/attributes";

/**
 * Intensity, shown on the scale the brand declared it on.
 *
 * The source states intensity out of 5, 9, 10, 12 or 13 depending on the
 * brand, so a bare "8" means different things on two cards. This component
 * exists so a customer can never read it that way: the scale's own maximum is
 * always shown twice — as the number of segments, and as text. Specified in
 * DESIGN.md, "Intensity scale".
 *
 * The track is the same width whatever the scale. The filled length is
 * therefore `value / max` of one fixed width on every product, which is the
 * part that is comparable, while the segment count shows which scale was used.
 *
 * Renders nothing when there is no intensity, and the raw text alone when it
 * does not parse: an unrecognised value should look unprocessed, not vanish.
 */
export function IntensityScale({
  raw,
  size = "card",
}: {
  /** The attribute as stored, e.g. "8 от 12". */
  readonly raw: string | null | undefined;
  /** `card`: 64 px track. `page`: 120 px track, for the product page. */
  readonly size?: "card" | "page";
}) {
  if (!raw?.trim()) return null;

  const numeral =
    size === "page" ? "text-sm text-ink-900 tabular-nums" : "text-2xs text-ink-500 tabular-nums";

  const reading = parseIntensity(raw);
  if (!reading) {
    return (
      <span className={numeral}>
        <span className="sr-only">Интензивност </span>
        {raw.trim()}
      </span>
    );
  }

  const segments = Array.from({ length: reading.max }, (_, index) => index < reading.value);

  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className={`flex shrink-0 gap-px ${size === "page" ? "w-30" : "w-16"}`}>
        {segments.map((filled, index) => (
          <span
            key={index}
            className={[
              "h-1.5 flex-1",
              filled ? "bg-pine-700" : "bg-line",
              index === 0 ? "rounded-l-xs" : "",
              index === segments.length - 1 ? "rounded-r-xs" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          />
        ))}
      </span>
      <span className={numeral}>
        <span className="sr-only">Интензивност </span>
        {reading.value} от {reading.max}
      </span>
    </span>
  );
}
