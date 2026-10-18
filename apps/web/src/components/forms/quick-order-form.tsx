"use client";

import { useEffect, useId, useState } from "react";
import { submitOrderInquiry } from "@/lib/forms/actions";
import {
  CHECK_FIELDS_MESSAGE,
  IDLE_FORM_STATE,
  orderInquirySchema,
  type FormState,
} from "@/lib/forms/schemas";
import { Button } from "@/components/ui/primitives";
import { HoneypotField } from "@/components/forms/honeypot-field";
import { ConsentCheckbox } from "@/components/forms/consent-checkbox";
import { FieldError } from "@/components/forms/field-error";
import {
  INPUT_CLASS,
  INPUT_COMPACT_CLASS,
  LABEL_CLASS,
  TEXTAREA_CLASS,
} from "@/components/forms/field-styles";
import { useActionForm } from "@/components/forms/use-schema-form";
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
 * Checked in the browser with `orderInquirySchema`, the schema the action
 * checks with, when the button is pressed (`use-schema-form.ts`). Without
 * JavaScript it is a plain POST, and the server's answer is drawn in the same
 * places.
 *
 * Accessibility details that matter here:
 *   - the error is tied to the input with `aria-describedby` and `aria-invalid`
 *   - focus goes to the first invalid field, opening the optional fields when
 *     that is where it is
 *   - the result message is a live region, so it is announced
 *   - the submit button reports its pending state rather than silently doing
 *     nothing on a slow connection
 *
 * Safe to render more than once on a page, and inside a `<dialog>`: every id
 * comes from `useId`, nothing looks the form up by a fixed id or name, and it
 * owns its own state. The props are the contract other components rely on —
 * add to them, do not change them.
 */
function SubmitButton({ pending, disabled }: { pending: boolean; disabled: boolean }) {
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

const fieldErrorsOf = (state: FormState) =>
  state.status === "error" ? state.fieldErrors : undefined;

/** What was typed, when the page is drawn from a refusal (no JavaScript). */
const typedIn = (state: FormState): Record<string, string> =>
  state.status === "error" ? (state.values ?? {}) : {};

/** The fields inside the disclosure. */
const OPTIONAL_FIELDS = ["customerName", "quantity", "email", "notes"] as const;

export function QuickOrderForm({
  productSlug,
  disabled = false,
}: {
  productSlug: string;
  disabled?: boolean;
}) {
  const {
    state,
    formAction,
    form: { register },
    formProps,
    pending,
    errorOf,
    ariaFor,
    lineFor,
  } = useActionForm({
    schema: orderInquirySchema,
    action: submitOrderInquiry,
    initialState: IDLE_FORM_STATE,
    fieldErrorsOf,
    defaultValuesOf: (drawnWith) => {
      const typed = typedIn(drawnWith);
      return {
        productSlug,
        phone: typed.phone ?? "",
        customerName: typed.customerName ?? "",
        /* A field holds text, whatever the schema makes of it: the box shows
           what was typed, and the schema's `coerce` reads it as a number. */
        quantity: (typed.quantity ?? "1") as unknown as number,
        email: typed.email ?? "",
        notes: typed.notes ?? "",
        newsletterConsent: typed.newsletterConsent === "on",
      };
    },
  });
  const typed = typedIn(state);
  const locale = useLocale();
  const phoneId = useId();
  const nameId = useId();
  const emailId = useId();
  const quantityId = useId();
  const notesId = useId();
  const statusId = useId();
  const analytics = useAnalytics();

  useEffect(() => {
    if (state.status === "success") {
      analytics.track({ name: "quick_order_submitted", productSlug, outcome: "success" });
    } else if (state.status === "error") {
      analytics.track({ name: "quick_order_submitted", productSlug, outcome: "error" });
    }
  }, [state, analytics, productSlug]);

  /* A rejected email or note lives inside the disclosure. When the page is
     drawn with one (the server's answer, without JavaScript) it is drawn open;
     with JavaScript, moving focus to the field opens it. Decided once, so that
     correcting the field does not snap the disclosure shut under the cursor. */
  const [optionalOpen] = useState(() => OPTIONAL_FIELDS.some((name) => errorOf(name)));

  const formMessage = lineFor(state.status === "error" ? state : undefined, CHECK_FIELDS_MESSAGE);

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
      {...formProps}
      action={formAction}
      className="relative rounded-md border border-line bg-paper-raised p-5"
      onFocus={() => analytics.track({ name: "quick_order_started", productSlug })}
    >
      <input type="hidden" {...register("productSlug")} value={productSlug} />
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
            {...register("phone")}
            type="tel"
            required
            inputMode="tel"
            autoComplete="tel"
            placeholder="Напр. 0888 123 456"
            defaultValue={typed.phone}
            {...ariaFor("phone", phoneId)}
            className={INPUT_CLASS}
          />
          <FieldError id={phoneId} message={errorOf("phone")} />
        </div>

        <SubmitButton pending={pending} disabled={disabled} />
      </div>

      <details className="group mt-3" open={optionalOpen || undefined}>
        {/*
          A disclosure says that it opens: a chevron that turns when it does.
          The label may take two lines in the narrow column beside the delivery
          block, so it wraps between words and keeps „(по избор)“ whole.
        */}
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm text-pine-700 underline-offset-4 hover:underline [&::-webkit-details-marker]:hidden">
          <svg
            aria-hidden
            viewBox="0 0 16 16"
            className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>
            Добавете име, имейл или бележка <span className="whitespace-nowrap">(по избор)</span>
          </span>
        </summary>
        <div className="mt-1 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={nameId} className={LABEL_CLASS}>
              Вашето име
            </label>
            <input
              id={nameId}
              {...register("customerName")}
              type="text"
              autoComplete="name"
              maxLength={120}
              defaultValue={typed.customerName}
              {...ariaFor("customerName", nameId)}
              className={INPUT_COMPACT_CLASS}
            />
            <FieldError id={nameId} message={errorOf("customerName")} />
          </div>
          <div>
            <label htmlFor={quantityId} className={LABEL_CLASS}>
              Количество
            </label>
            <input
              id={quantityId}
              {...register("quantity")}
              type="number"
              min={1}
              max={99}
              defaultValue={typed.quantity ?? 1}
              inputMode="numeric"
              {...ariaFor("quantity", quantityId)}
              className={INPUT_COMPACT_CLASS}
            />
            <FieldError id={quantityId} message={errorOf("quantity")} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={emailId} className={LABEL_CLASS}>
              Имейл
            </label>
            <input
              id={emailId}
              {...register("email")}
              type="email"
              autoComplete="email"
              inputMode="email"
              maxLength={254}
              defaultValue={typed.email}
              {...ariaFor("email", emailId)}
              className={INPUT_COMPACT_CLASS}
            />
            <FieldError id={emailId} message={errorOf("email")} />
          </div>
          <div className="sm:col-span-2">
            <ConsentCheckbox
              affects="поръчката"
              needsEmail
              registration={register("newsletterConsent")}
              defaultChecked={typed.newsletterConsent === "on"}
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={notesId} className={LABEL_CLASS}>
              Бележка
            </label>
            <textarea
              id={notesId}
              {...register("notes")}
              rows={3}
              maxLength={1000}
              defaultValue={typed.notes}
              {...ariaFor("notes", notesId)}
              className={TEXTAREA_CLASS}
            />
            <FieldError id={notesId} message={errorOf("notes")} />
          </div>
        </div>
      </details>

      <p aria-live="polite" id={statusId} className="mt-3 min-h-6 text-sm">
        {formMessage && <span className="text-critical">{formMessage}</span>}
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
