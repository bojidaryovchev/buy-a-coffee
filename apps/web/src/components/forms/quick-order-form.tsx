"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import { useFormStatus } from "react-dom";
import { submitOrderInquiry } from "@/lib/forms/actions";
import { IDLE_FORM_STATE } from "@/lib/forms/schemas";
import { Button } from "@/components/ui/primitives";
import { HoneypotField } from "@/components/forms/honeypot-field";
import { ConsentCheckbox } from "@/components/forms/consent-checkbox";
import {
  ERROR_CLASS,
  INPUT_CLASS,
  INPUT_COMPACT_CLASS,
  LABEL_CLASS,
  TEXTAREA_CLASS,
} from "@/components/forms/field-styles";
import { useAnalytics } from "@/components/analytics-provider";
import { useLocale } from "@/i18n/use-locale";
import { href, routes } from "@/lib/routes";

/**
 * Quick order.
 *
 * The reference storefront has no cart and no checkout: ordering is a single
 * phone number and the shop calls back. This reproduces that functional intent
 * with our own UI, our own endpoint and our own database.
 *
 * Accessibility details that matter here:
 *   - the error is tied to the input with `aria-describedby` and `aria-invalid`
 *   - the result message is a live region, so it is announced
 *   - the submit button reports its pending state rather than silently doing
 *     nothing on a slow connection
 *
 * Safe to render more than once on a page, and inside a `<dialog>`: every id
 * comes from `useId`, nothing looks the form up by a fixed id or name, and it
 * owns its own state. The props are the contract other components rely on —
 * add to them, do not change them.
 */
function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="accent"
      size="lg"
      disabled={pending || disabled}
      aria-busy={pending || undefined}
      className="w-full"
    >
      {pending ? "Изпраща се…" : "Поискай обаждане"}
    </Button>
  );
}

export function QuickOrderForm({
  productSlug,
  disabled = false,
}: {
  productSlug: string;
  disabled?: boolean;
}) {
  const [state, formAction] = useActionState(submitOrderInquiry, IDLE_FORM_STATE);
  const locale = useLocale();
  const phoneId = useId();
  const nameId = useId();
  const emailId = useId();
  const quantityId = useId();
  const notesId = useId();
  const statusId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const analytics = useAnalytics();

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
      analytics.track({ name: "quick_order_submitted", productSlug, outcome: "success" });
    } else if (state.status === "error") {
      analytics.track({ name: "quick_order_submitted", productSlug, outcome: "error" });
    }
  }, [state, analytics, productSlug]);

  const phoneError = state.status === "error" ? state.fieldErrors?.phone : undefined;
  const emailError = state.status === "error" ? state.fieldErrors?.email : undefined;
  const quantityError = state.status === "error" ? state.fieldErrors?.quantity : undefined;
  const notesError = state.status === "error" ? state.fieldErrors?.notes : undefined;
  // A rejected email or note lives inside the closed disclosure; opening it is
  // the only way the person can see what to fix.
  const detailsOpen = Boolean(emailError || quantityError || notesError);

  if (state.status === "success") {
    return (
      <div role="status" className="rounded-md border border-pine-500/40 bg-pine-100 p-5">
        <p className="font-display text-lg font-semibold text-pine-900">Заявката е получена</p>
        <p className="mt-1 text-sm text-ink-700">{state.message}</p>
      </div>
    );
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      className="relative rounded-md border border-line bg-paper-raised p-5"
      onFocus={() => analytics.track({ name: "quick_order_started", productSlug })}
    >
      <input type="hidden" name="productSlug" value={productSlug} />
      <HoneypotField />

      <p className="font-display text-base font-semibold text-ink-900">Поръчка на една стъпка</p>
      <p className="mt-1 text-sm text-ink-500">
        Оставете номер и ще ви се обадим, за да потвърдим поръчката и да уговорим доставката. Без
        регистрация.
      </p>

      <div className="mt-4 grid gap-3">
        <div>
          <label htmlFor={phoneId} className={LABEL_CLASS}>
            Телефонен номер{" "}
            <span aria-hidden="true" className="text-critical">
              *
            </span>
          </label>
          <input
            id={phoneId}
            name="phone"
            type="tel"
            required
            inputMode="tel"
            autoComplete="tel"
            placeholder="0888 123 456"
            aria-invalid={phoneError ? true : undefined}
            aria-describedby={phoneError ? `${phoneId}-error` : undefined}
            className={INPUT_CLASS}
          />
          {phoneError && (
            <p id={`${phoneId}-error`} className={ERROR_CLASS}>
              {phoneError}
            </p>
          )}
        </div>

        <SubmitButton disabled={disabled} />
      </div>

      <details className="mt-3" open={detailsOpen || undefined}>
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm text-pine-700 underline-offset-4 hover:underline">
          Добавете име, имейл или бележка (по избор)
        </summary>
        <div className="mt-1 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={nameId} className={LABEL_CLASS}>
              Вашето име
            </label>
            <input
              id={nameId}
              name="customerName"
              type="text"
              autoComplete="name"
              maxLength={120}
              className={INPUT_COMPACT_CLASS}
            />
          </div>
          <div>
            <label htmlFor={quantityId} className={LABEL_CLASS}>
              Количество
            </label>
            <input
              id={quantityId}
              name="quantity"
              type="number"
              min={1}
              max={99}
              defaultValue={1}
              inputMode="numeric"
              aria-invalid={quantityError ? true : undefined}
              aria-describedby={quantityError ? `${quantityId}-error` : undefined}
              className={INPUT_COMPACT_CLASS}
            />
            {quantityError && (
              <p id={`${quantityId}-error`} className={ERROR_CLASS}>
                {quantityError}
              </p>
            )}
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={emailId} className={LABEL_CLASS}>
              Имейл
            </label>
            <input
              id={emailId}
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              maxLength={254}
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? `${emailId}-error` : undefined}
              className={INPUT_COMPACT_CLASS}
            />
            {emailError && (
              <p id={`${emailId}-error`} className={ERROR_CLASS}>
                {emailError}
              </p>
            )}
          </div>
          <div className="sm:col-span-2">
            <ConsentCheckbox affects="поръчката" needsEmail />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={notesId} className={LABEL_CLASS}>
              Бележка
            </label>
            <textarea
              id={notesId}
              name="notes"
              rows={3}
              maxLength={1000}
              aria-invalid={notesError ? true : undefined}
              aria-describedby={notesError ? `${notesId}-error` : undefined}
              className={TEXTAREA_CLASS}
            />
            {notesError && (
              <p id={`${notesId}-error`} className={ERROR_CLASS}>
                {notesError}
              </p>
            )}
          </div>
        </div>
      </details>

      <p aria-live="polite" id={statusId} className="mt-3 min-h-6 text-sm">
        {state.status === "error" && <span className="text-critical">{state.message}</span>}
      </p>

      <p className="mt-1 text-xs text-ink-500">
        Използваме номера ви само за да се свържем с вас за тази поръчка. Вижте нашата{" "}
        <a href={href(locale, routes.privacy)} className="underline underline-offset-2">
          политика за поверителност
        </a>
        .
      </p>
    </form>
  );
}
