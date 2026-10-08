import { useId } from "react";
import Link from "next/link";

/**
 * The newsletter consent box on the order and contact forms.
 *
 * Unticked, never `required`, and not pre-selected by anything: a pre-ticked or
 * mandatory box is not consent. The server reads it as "ticked" only when the
 * browser sends it, and an order or a message does not depend on it.
 *
 * A native checkbox inside its label, so the whole line is the tap target and
 * it works with no JavaScript. `accent-pine-900` colours the native control
 * instead of replacing it, which keeps its keyboard and screen-reader
 * behaviour and the global focus ring.
 */
export function ConsentCheckbox({
  affects,
  needsEmail = false,
}: {
  /** What the customer might fear ticking it would change. */
  affects: "поръчката" | "съобщението";
  /** Say so when the box only works if an address was given. */
  needsEmail?: boolean;
}) {
  const id = useId();
  const helperId = `${id}-helper`;

  return (
    <div>
      <label
        htmlFor={id}
        className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm text-ink-900"
      >
        <input
          id={id}
          name="newsletterConsent"
          type="checkbox"
          aria-describedby={helperId}
          className="mt-0.5 size-5 shrink-0 cursor-pointer accent-pine-900"
        />
        <span>
          Искам да получавам новини и предложения по имейл. Мога да се отпиша по всяко време.
        </span>
      </label>
      <p id={helperId} className="text-xs text-ink-500">
        Не е задължително и не влияе на {affects}.
        {needsEmail ? " Важи, ако сте написали имейл." : ""} Вижте{" "}
        <Link href="/privacy" className="underline underline-offset-2">
          политиката за поверителност
        </Link>
        .
      </p>
    </div>
  );
}
