"use client";

import { useEffect, useId, useRef, useState } from "react";
import { submitCartOrder } from "@/lib/forms/actions";
import {
  CHECK_FIELDS_MESSAGE,
  IDLE_FORM_STATE,
  cartOrderSchema,
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
 * The cart's order form: a phone number for everything in the cart.
 *
 * The quick order's fields and rules (`QuickOrderForm`), with the lines in
 * place of the one product: a hidden field holding the cart as JSON, product
 * ids and quantities only. The schema is the action's (`cartOrderSchema`), so
 * the browser and the server refuse the same things in the same words.
 *
 * Unlike the quick order this form needs JavaScript — the cart it sends is in
 * the browser — and it is only drawn on the cart page, which says so when the
 * script is not there.
 *
 * It tells the page two things and leaves the rest to it: that the order went
 * through (`onPlaced`, with the server's answer: the page then shows the
 * reference and empties the cart), and that the server refused the cart itself
 * (`onCartRefused`: a product went out of stock or was withdrawn since the page
 * asked; the page asks again and shows which).
 */

const fieldErrorsOf = (state: FormState) =>
  state.status === "error" ? state.fieldErrors : undefined;

/** The fields inside the disclosure. */
const OPTIONAL_FIELDS = ["customerName", "email", "notes"] as const;

export interface CartOrderLine {
  readonly productId: string;
  readonly quantity: number;
}

export function CartOrderForm({
  lines,
  onPlaced,
  onCartRefused,
}: {
  /** The lines that can be ordered, as the cart holds them now. */
  readonly lines: readonly CartOrderLine[];
  readonly onPlaced: (answer: { message: string; reference?: string }) => void;
  readonly onCartRefused: () => void;
}) {
  const linesJson = JSON.stringify(
    lines.map(({ productId, quantity }) => ({ productId, quantity })),
  );
  const {
    state,
    formAction,
    form: { register, setValue },
    formProps,
    pending,
    errorOf,
    ariaFor,
    lineFor,
  } = useActionForm({
    schema: cartOrderSchema,
    action: submitCartOrder,
    initialState: IDLE_FORM_STATE,
    fieldErrorsOf,
    defaultValuesOf: () => ({
      lines: linesJson,
      phone: "",
      customerName: "",
      email: "",
      notes: "",
      newsletterConsent: false,
    }),
  });
  const locale = useLocale();
  const analytics = useAnalytics();
  const phoneId = useId();
  const nameId = useId();
  const emailId = useId();
  const notesId = useId();

  /* The hidden field is written by the page, not typed, so react-hook-form is
     told each time the cart changes; the browser check reads its value. */
  useEffect(() => {
    setValue("lines", linesJson);
  }, [linesJson, setValue]);

  const units = lines.reduce((sum, line) => sum + line.quantity, 0);
  /* Each answer from the server is acted on once, however often the lines
     around it change afterwards. */
  const handled = useRef<FormState>(state);
  useEffect(() => {
    if (state === handled.current || state.status === "idle") return;
    handled.current = state;
    analytics.track({
      name: "cart_order_submitted",
      lineCount: lines.length,
      unitCount: units,
      outcome: state.status === "success" ? "success" : "error",
    });
    if (state.status === "success") {
      onPlaced({ message: state.message, reference: state.reference });
    } else if (!state.fieldErrors || state.fieldErrors.lines) {
      // Refused for the cart, not for a field: the page asks what it holds now.
      onCartRefused();
    }
  }, [state, analytics, lines.length, units, onPlaced, onCartRefused]);

  /* Decided once, as in the quick order: an error inside the disclosure when
     the page is drawn opens it, and correcting it does not snap it shut. */
  const [optionalOpen] = useState(() => OPTIONAL_FIELDS.some((name) => errorOf(name)));

  /* The lines have no field to stand under; their message is the form's line. */
  const formMessage =
    errorOf("lines") ?? lineFor(state.status === "error" ? state : undefined, CHECK_FIELDS_MESSAGE);

  return (
    <form
      {...formProps}
      action={formAction}
      className="relative rounded-md border border-line bg-paper-raised p-4 sm:p-5"
    >
      <input type="hidden" {...register("lines")} value={linesJson} />
      <HoneypotField />

      <h2 className="font-display text-lg font-semibold text-ink-900">Изпратете заявката</h2>
      <p className="mt-1 text-sm text-ink-500">
        Оставете номер и ще ви се обадим, за да потвърдим наличността, крайната сума и доставката.
        Без регистрация и без плащане на сайта.
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
            {...ariaFor("phone", phoneId)}
            className={INPUT_CLASS}
          />
          <FieldError id={phoneId} message={errorOf("phone")} />
        </div>

        <Button
          type="submit"
          variant="accent"
          size="lg"
          disabled={pending || lines.length === 0}
          aria-busy={pending || undefined}
          className="w-full"
        >
          {pending ? "Изпраща се…" : "Изпрати заявката"}
        </Button>
      </div>

      <details className="group mt-3" open={optionalOpen || undefined}>
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
        <div className="mt-1 grid gap-3">
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
              {...ariaFor("customerName", nameId)}
              className={INPUT_COMPACT_CLASS}
            />
            <FieldError id={nameId} message={errorOf("customerName")} />
          </div>
          <div>
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
              {...ariaFor("email", emailId, `${emailId}-helper`)}
              className={INPUT_COMPACT_CLASS}
            />
            <p id={`${emailId}-helper`} className="mt-1 text-xs text-ink-500">
              Ако го напишете, ще ви изпратим потвърждение със заявката.
            </p>
            <FieldError id={emailId} message={errorOf("email")} />
          </div>
          <ConsentCheckbox
            affects="поръчката"
            needsEmail
            registration={register("newsletterConsent")}
          />
          <div>
            <label htmlFor={notesId} className={LABEL_CLASS}>
              Бележка
            </label>
            <textarea
              id={notesId}
              {...register("notes")}
              rows={3}
              maxLength={1000}
              {...ariaFor("notes", notesId)}
              className={TEXTAREA_CLASS}
            />
            <FieldError id={notesId} message={errorOf("notes")} />
          </div>
        </div>
      </details>

      <p aria-live="polite" className="mt-3 min-h-6 text-sm">
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
