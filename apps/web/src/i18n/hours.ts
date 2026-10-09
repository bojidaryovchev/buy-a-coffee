import { siteConfig, type OpeningHoursRange } from "@/config/site";
import type { Dictionary } from "@/i18n/dictionaries/bg";

/**
 * When the phone is answered, in the visitor's language: "Пон–Пет, 9:00–18:00"
 * or "Mon–Fri, 9:00–18:00".
 *
 * The same rule as `formatOpeningHours` in `config/site.ts`, which prints the
 * Bulgarian form everything outside the frame reads; this takes the day names
 * from the dictionary instead. A test holds the Bulgarian outputs together.
 */
export function openingHoursLabel(
  days: Dictionary["hours"]["days"],
  ranges: readonly OpeningHoursRange[] = siteConfig.commerce.openingHours,
): string {
  const time = (value: string) => value.replace(/^0(\d)/, "$1");
  return ranges
    .map((range) => {
      const span =
        range.from === range.to ? days[range.from] : `${days[range.from]}–${days[range.to]}`;
      return `${span}, ${time(range.opens)}–${time(range.closes)}`;
    })
    .join("; ");
}
