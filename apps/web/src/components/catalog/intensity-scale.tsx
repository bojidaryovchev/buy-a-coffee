import type { CSSProperties } from "react";
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
    size === "page"
      ? "text-sm whitespace-nowrap text-ink-900 tabular-nums"
      : "text-2xs whitespace-nowrap text-ink-500 tabular-nums";

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
    /*
     * On the product page the numeral may drop under the track: in the facts
     * table's value column on a 320 px phone (about 140 px) the 120 px track
     * and „9 от 12“ do not fit on one line. The card's row is a fixed 16 px
     * and its 64 px track always leaves room, so it never wraps.
     */
    <span
      className={`inline-flex items-center gap-x-2 ${size === "page" ? "flex-wrap gap-y-1" : ""}`}
    >
      {/*
        The card's track is 56 px below a 360 px screen and 64 px above it: in
        a 320 px phone's card, 64 px left „12 от 13“ too little room and it
        broke onto a second line. Every card on a screen still draws the same
        track, so the filled lengths stay comparable.
      */}
      <span
        aria-hidden
        className={`flex shrink-0 gap-px ${size === "page" ? "w-30" : "w-14 min-[360px]:w-16"}`}
      >
        {segments.map((filled, index) => (
          <span
            key={index}
            /*
             * A filled segment pours in, one after another, the first time
             * the track scrolls into view (`.intensity-fill` in globals.css;
             * DESIGN.md, "Motion"). Its fill is drawn by `::after`, over the
             * empty segment's grey; where scroll-driven animation is not
             * supported, or less motion is asked for, it is simply full.
             */
            style={filled ? ({ "--i": index } as CSSProperties) : undefined}
            className={[
              "h-1.5 flex-1",
              filled ? "intensity-fill" : "bg-line",
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
