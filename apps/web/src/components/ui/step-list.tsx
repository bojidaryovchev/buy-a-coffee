import type { ReactNode } from "react";
import { cx } from "@/components/ui/primitives";

/**
 * A short sequence of steps in a column of running text: each step's numeral
 * in a 24 px `gold-500` square beside it. The numbers stay — the order is
 * information — and the list is an `<ol>`, so it reads as one.
 *
 * The home page's three steps are laid out across instead
 * (`HowOrderingWorks`); this is the same idea for the delivery page and the
 * Vending and Consumables pages, where a column of prose has no room for it.
 */
export function StepList({
  steps,
  className,
}: {
  readonly steps: readonly ReactNode[];
  readonly className?: string;
}) {
  return (
    <ol className={cx("space-y-4", className)}>
      {steps.map((step, index) => (
        <li key={index} className="flex gap-4">
          <span
            aria-hidden
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-xs bg-gold-500 text-xs font-semibold text-ink-900 tabular-nums"
          >
            {index + 1}
          </span>
          <span className="text-base leading-relaxed text-ink-700">{step}</span>
        </li>
      ))}
    </ol>
  );
}
