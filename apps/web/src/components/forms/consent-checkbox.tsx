import { useId } from "react";
import Link from "next/link";
import type { UseFormRegisterReturn } from "react-hook-form";
import { useLocale } from "@/i18n/use-locale";
import { href, routes } from "@/lib/routes";

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
 *
 * The form passes its react-hook-form registration, so the box is one of the
 * values the form's schema sees; it is never what makes a form invalid.
 */
export function ConsentCheckbox({
  affects,
  needsEmail = false,
  registration,
  defaultChecked = false,
}: {
  /** What the customer might fear ticking it would change. */
  affects: "поръчката" | "съобщението";
  /** Say so when the box only works if an address was given. */
  needsEmail?: boolean;
  /** `register("newsletterConsent")` from the form. */
  registration: UseFormRegisterReturn<"newsletterConsent">;
  /** Ticked only when the page is drawn again after this person ticked it. */
  defaultChecked?: boolean;
}) {
  const id = useId();
  const helperId = `${id}-helper`;
  const locale = useLocale();

  return (
    <div>
      <label
        htmlFor={id}
        className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm text-ink-900"
      >
        <input
          id={id}
          {...registration}
          type="checkbox"
          defaultChecked={defaultChecked}
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
        <Link href={href(locale, routes.privacy)} className="underline underline-offset-2">
          политиката за поверителност
        </Link>
        .
      </p>
    </div>
  );
}
