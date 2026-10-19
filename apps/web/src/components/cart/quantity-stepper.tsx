"use client";

import { useState } from "react";
import { MAX_QUANTITY, MIN_QUANTITY, clampQuantity } from "@/lib/cart/cart";
import { cx } from "@/components/ui/primitives";

/**
 * A quantity: one less, the number, one more.
 *
 * The number can be typed as well as stepped — an office ordering forty boxes
 * should not press „+“ thirty-nine times. What is typed is held as text while
 * the field has focus and only becomes the quantity on leaving it (or on
 * Enter), brought within 1 to 99, so a half-typed "4" on the way to "40" never
 * reaches the cart and an empty field never becomes zero.
 *
 * Each button is a 44 px square below `lg` and 40 px from it, like every other
 * control a finger can hit; the field is 16 px text, so a phone does not zoom
 * into it. At the bounds the button is disabled rather than silently doing
 * nothing.
 */
export function QuantityStepper({
  value,
  onChange,
  label,
  className,
}: {
  readonly value: number;
  readonly onChange: (quantity: number) => void;
  /** Names the field and the group: "Количество" or "Количество: {product}". */
  readonly label: string;
  readonly className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = (text: string) => {
    setDraft(null);
    const typed = Number.parseInt(text, 10);
    if (Number.isFinite(typed)) onChange(clampQuantity(typed));
  };

  const step = (by: number) => onChange(clampQuantity(value + by));

  const BUTTON =
    "inline-flex min-h-11 w-11 shrink-0 items-center justify-center text-ink-700 transition-colors hover:bg-paper-sunken hover:text-ink-900 disabled:cursor-not-allowed disabled:bg-paper-sunken disabled:text-ink-500 lg:min-h-10 lg:w-10";

  return (
    <div
      role="group"
      aria-label={label}
      className={cx(
        "inline-flex items-stretch overflow-hidden rounded-sm border border-line-strong bg-paper-raised",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={value <= MIN_QUANTITY}
        aria-label="Един брой по-малко"
        className={BUTTON}
      >
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <path d="M3.5 8h9" />
        </svg>
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={MIN_QUANTITY}
        max={MAX_QUANTITY}
        aria-label={label}
        value={draft ?? String(value)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          commit(event.currentTarget.value);
        }}
        className="w-12 [appearance:textfield] border-x border-line-strong bg-paper-raised text-center text-input text-ink-900 tabular-nums focus:border-pine-700 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        type="button"
        onClick={() => step(1)}
        disabled={value >= MAX_QUANTITY}
        aria-label="Един брой повече"
        className={BUTTON}
      >
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <path d="M3.5 8h9M8 3.5v9" />
        </svg>
      </button>
    </div>
  );
}
