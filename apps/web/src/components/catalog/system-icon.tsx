import { cx } from "@/components/ui/primitives";
import { ICON_BOX, systemIconShape } from "./system-icons";

/**
 * The mark that goes before a brewing system's name: our own drawing of the
 * system's capsule (the ESE pod from above, a bean for beans), filled with the
 * system's colour. Specified in DESIGN.md, "System icon"; the shapes are
 * computed in `system-icons.ts` from the machine finder's outlines.
 *
 * Always decorative and never alone: the system's name is beside it, so it is
 * `aria-hidden`. The colour is `--system`, which `data-system` on the element
 * that holds the icon and the name sets (`globals.css`), as for the badge.
 *
 * Heights, on the 20 × 16 grid (width follows):
 *
 * - `sm` 12 px: the small system badge (a card, a typeahead row, a wizard
 *   result). The smallest at which the seven still differ — the nozzle, the
 *   groove, the ring — and no larger, because a card on a 320 px phone has
 *   112 px for the badge and „Кафе на зърна“ must still fit beside it.
 * - `md` 16 px: rows, chips, filters, and the badge on product and listing
 *   pages. The size at which the seven are told apart at a glance at 1x.
 * - `lg` 32 px: the home page's system tiles.
 */
const SIZES = {
  sm: "h-3 w-3.75",
  md: "h-4 w-5",
  lg: "h-8 w-10",
} as const;

export type SystemIconSize = keyof typeof SIZES;

export function SystemIcon({
  systemId,
  size = "md",
  className,
}: {
  readonly systemId: string;
  readonly size?: SystemIconSize;
  readonly className?: string;
}) {
  const shape = systemIconShape(systemId);
  if (!shape) return null;
  return (
    <svg
      aria-hidden
      focusable="false"
      viewBox={`0 0 ${ICON_BOX.width} ${ICON_BOX.height}`}
      data-system-icon={systemId}
      className={cx("shrink-0 fill-(--system)", SIZES[size], className)}
    >
      <path fillRule="evenodd" d={shape.d} />
    </svg>
  );
}
