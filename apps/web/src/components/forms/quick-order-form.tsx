"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import { useFormStatus } from "react-dom";
import { submitOrderInquiry } from "@/lib/forms/actions";
import { IDLE_FORM_STATE } from "@/lib/forms/schemas";
import { Button } from "@/components/ui/primitives";
import { HoneypotField } from "@/components/forms/honeypot-field";
import { useAnalytics } from "@/components/analytics-provider";

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
 */
function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending || disabled} className="w-full sm:w-auto sm:min-w-40">
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
  const phoneId = useId();
  const nameId = useId();
  const quantityId = useId();
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

  if (state.status === "success") {
    return (
      <div
        id={statusId}
        role="status"
        className="rounded-md border border-pine-500/40 bg-pine-100 p-5"
      >
        <p className="font-display text-lg font-semibold text-pine-900">Заявката е получена</p>
        <p className="mt-1 text-sm text-pine-900/80">{state.message}</p>
      </div>
    );
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      className="rounded-md border border-line bg-paper-raised p-5"
      onFocus={() => analytics.track({ name: "quick_order_started", productSlug })}
    >
      <input type="hidden" name="productSlug" value={productSlug} />
      <HoneypotField />

      <p className="font-display text-base font-semibold text-ink-900">Поръчка на една стъпка</p>
      <p className="mt-1 text-sm text-ink-500">
        Оставете номер и ще ви се обадим, за да потвърдим поръчката и да уговорим доставката. Без регистрация.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
        <div>
          <label htmlFor={phoneId} className="mb-1 block text-sm font-medium">
            Телефонен номер <span className="text-critical">*</span>
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
            className="h-12 w-full rounded-sm border border-line-strong bg-paper px-3 text-base outline-none focus:border-pine-700 aria-[invalid]:border-critical"
          />
          {phoneError && (
            <p id={`${phoneId}-error`} className="mt-1 text-xs text-critical">
              {phoneError}
            </p>
          )}
        </div>

        <div className="flex items-end">
          <SubmitButton disabled={disabled} />
        </div>
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer text-sm text-pine-700 underline-offset-4 hover:underline">
          Добавете име или бележка (по избор)
        </summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={nameId} className="mb-1 block text-sm font-medium">
              Вашето име
            </label>
            <input
              id={nameId}
              name="customerName"
              type="text"
              autoComplete="name"
              maxLength={120}
              className="h-11 w-full rounded-sm border border-line-strong bg-paper px-3 text-base outline-none focus:border-pine-700"
            />
          </div>
          <div>
            <label htmlFor={quantityId} className="mb-1 block text-sm font-medium">
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
              className="h-11 w-full rounded-sm border border-line-strong bg-paper px-3 text-base outline-none focus:border-pine-700"
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={`${nameId}-notes`} className="mb-1 block text-sm font-medium">
              Бележка
            </label>
            <textarea
              id={`${nameId}-notes`}
              name="notes"
              rows={3}
              maxLength={1000}
              className="w-full rounded-sm border border-line-strong bg-paper px-3 py-2 text-base outline-none focus:border-pine-700"
            />
          </div>
        </div>
      </details>

      <p aria-live="polite" id={statusId} className="mt-3 min-h-5 text-sm">
        {state.status === "error" && <span className="text-critical">{state.message}</span>}
      </p>

      <p className="mt-1 text-xs text-ink-500">
        Използваме номера ви само за да се свържем с вас за тази поръчка. Вижте нашата{" "}
        <a href="/privacy" className="underline underline-offset-2">
          политика за поверителност
        </a>
        .
      </p>
    </form>
  );
}
