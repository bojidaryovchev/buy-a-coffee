import type { ReactNode } from "react";
import { cx } from "@/components/ui/primitives";

/**
 * A short sequence of steps in a column of running text, joined by the curl
 * from the mark (DESIGN.md, "Imagery" and "Motion"): each step's numeral in a
 * 24 px `gold-500` square, the curl running down behind the numerals and
 * drawing itself as the list scrolls into view. The numbers stay — the order
 * is information — and the list is an `<ol>`, so it reads as one.
 *
 * The home page's three steps are laid out across instead
 * (`HowOrderingWorks`); this is the same idea for the delivery page and the
 * Vending and Consumables pages, where a column of prose has no room for it.
 */
export function CurlSteps({
  steps,
  className,
}: {
  readonly steps: readonly ReactNode[];
  readonly className?: string;
}) {
  return (
    <div className={cx("relative", className)}>
      {steps.length > 1 && (
        <svg
          aria-hidden
          viewBox="0 0 24 100"
          preserveAspectRatio="none"
          className="absolute top-3 bottom-3 left-0 h-[calc(100%-1.5rem)] w-6 overflow-visible"
        >
          <path
            d="M12 0C2 14 22 30 12 50S2 86 12 100"
            pathLength={1}
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            className="draw-on-scroll stroke-gold-600"
          />
        </svg>
      )}
      <ol className="relative space-y-4">
        {steps.map((step, index) => (
          <li key={index} className="flex gap-4">
            <span
              aria-hidden
              className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-xs bg-gold-500 text-xs font-semibold text-ink-900 tabular-nums"
            >
              {index + 1}
            </span>
            <span className="text-base leading-relaxed text-ink-700">{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
