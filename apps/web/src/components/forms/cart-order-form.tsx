"use client";

import { useEffect, useId, useRef, useState } from "react";
import { submitCartOrder } from "@/lib/forms/actions";
import {
  CHECK_FIELDS_MESSAGE,
  COURIERS,
  COURIERS_FOR,
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
 * The order form: who the order is for, how to reach them and where it goes,
 * for everything in the cart.
 *
 * A name, a phone number and a delivery (to an address, or to a courier's
 * office) are required, so the call back only confirms the order and never has
 * to ask for a detail. An email and a note stay optional, behind a disclosure.
 * The cart travels in a hidden field as JSON, product ids and quantities only.
 * The schema is the action's (`cartOrderSchema`), so the browser and the server
 * refuse the same things in the same words.
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
const OPTIONAL_FIELDS = ["email", "notes"] as const;

/** The two ways to receive an order, in the order they are offered. */
const DELIVERY_CHOICES = [
  { value: "address", label: "До адрес" },
  { value: "office", label: "До офис или автомат" },
] as const;

/** The mark after a required field's label; the field itself carries `required`. */
function Required() {
  return (
    <span aria-hidden="true" className="text-critical">
      *
    </span>
  );
}

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
    form: { register, setValue, watch },
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
      firstName: "",
      lastName: "",
      phone: "",
      deliveryMethod: "address",
      deliveryCourier: "",
      deliveryCity: "",
      deliveryPostcode: "",
      deliveryAddress: "",
      deliveryOffice: "",
      email: "",
      notes: "",
      newsletterConsent: false,
    }),
  });
  const locale = useLocale();
  const analytics = useAnalytics();
  const firstNameId = useId();
  const lastNameId = useId();
  const phoneId = useId();
  const methodId = useId();
  const courierId = useId();
  const cityId = useId();
  const postcodeId = useId();
  const addressId = useId();
  const officeId = useId();
  const emailId = useId();
  const notesId = useId();

  /* The hidden field is written by the page, not typed, so react-hook-form is
     told each time the cart changes; the browser check reads its value. */
  useEffect(() => {
    setValue("lines", linesJson);
  }, [linesJson, setValue]);

  /* Which fields the delivery needs follows the choice; the schema requires the
     same ones. */
  const method = watch("deliveryMethod") === "office" ? "office" : "address";
  const toOffice = method === "office";
  const courier = watch("deliveryCourier");
  const boxNow = toOffice && courier === "boxnow";
  /* BOX NOW only delivers to its lockers: a courier the new method does not
     offer is cleared rather than kept and refused on sending. */
  useEffect(() => {
    if (courier && !(COURIERS_FOR[method] as readonly string[]).includes(courier)) {
      setValue("deliveryCourier", "");
    }
  }, [method, courier, setValue]);

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
      className="relative rounded-md border border-line bg-paper-raised p-5 sm:p-6"
    >
      <input type="hidden" {...register("lines")} value={linesJson} />
      <HoneypotField />

      <h2 className="font-display text-lg font-semibold text-ink-900">Изпратете заявката</h2>
      <p className="mt-1 text-sm text-ink-500">
        Попълнете кой поръчва и къде да доставим. Ще ви се обадим само за да потвърдим наличността,
        крайната сума и доставката. Без регистрация и без плащане на сайта.
      </p>

      <div className="mt-5 grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={firstNameId} className={LABEL_CLASS}>
              Име <Required />
            </label>
            <input
              id={firstNameId}
              {...register("firstName")}
              type="text"
              required
              autoComplete="given-name"
              maxLength={60}
              {...ariaFor("firstName", firstNameId)}
              className={INPUT_CLASS}
            />
            <FieldError id={firstNameId} message={errorOf("firstName")} />
          </div>
          <div>
            <label htmlFor={lastNameId} className={LABEL_CLASS}>
              Фамилия <Required />
            </label>
            <input
              id={lastNameId}
              {...register("lastName")}
              type="text"
              required
              autoComplete="family-name"
              maxLength={60}
              {...ariaFor("lastName", lastNameId)}
              className={INPUT_CLASS}
            />
            <FieldError id={lastNameId} message={errorOf("lastName")} />
          </div>
        </div>

        <div>
          <label htmlFor={phoneId} className={LABEL_CLASS}>
            Телефонен номер <Required />
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

        <fieldset>
          <legend className={LABEL_CLASS}>
            Доставка <Required />
          </legend>
          <div className="flex flex-col sm:flex-row sm:gap-6">
            {DELIVERY_CHOICES.map(({ value, label }) => (
              <label
                key={value}
                className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink-900"
              >
                <input
                  type="radio"
                  {...register("deliveryMethod")}
                  value={value}
                  {...ariaFor("deliveryMethod", methodId)}
                  className="size-5 accent-pine-900"
                />
                {label}
              </label>
            ))}
          </div>
          <FieldError id={methodId} message={errorOf("deliveryMethod")} />
        </fieldset>

        <fieldset>
          <legend className={LABEL_CLASS}>
            Куриер <Required />
          </legend>
          <div className="flex flex-wrap gap-x-6">
            {COURIERS_FOR[method].map((value) => (
              <label
                key={value}
                className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink-900"
              >
                <input
                  type="radio"
                  {...register("deliveryCourier")}
                  value={value}
                  {...ariaFor("deliveryCourier", courierId)}
                  className="size-5 accent-pine-900"
                />
                {COURIERS[value]}
              </label>
            ))}
          </div>
          <FieldError id={courierId} message={errorOf("deliveryCourier")} />
        </fieldset>

        <div className={toOffice ? "grid gap-3" : "grid gap-3 sm:grid-cols-[9rem_1fr]"}>
          {!toOffice && (
            <div>
              <label htmlFor={postcodeId} className={LABEL_CLASS}>
                Пощенски код <Required />
              </label>
              <input
                id={postcodeId}
                {...register("deliveryPostcode")}
                type="text"
                required
                inputMode="numeric"
                autoComplete="postal-code"
                maxLength={4}
                placeholder="Напр. 4000"
                {...ariaFor("deliveryPostcode", postcodeId)}
                className={INPUT_CLASS}
              />
              <FieldError id={postcodeId} message={errorOf("deliveryPostcode")} />
            </div>
          )}
          <div>
            <label htmlFor={cityId} className={LABEL_CLASS}>
              Населено място <Required />
            </label>
            <input
              id={cityId}
              {...register("deliveryCity")}
              type="text"
              required
              autoComplete={toOffice ? "off" : "address-level2"}
              maxLength={80}
              placeholder="Напр. Пловдив"
              {...ariaFor("deliveryCity", cityId)}
              className={INPUT_CLASS}
            />
            <FieldError id={cityId} message={errorOf("deliveryCity")} />
          </div>
        </div>

        {toOffice ? (
          <div>
            <label htmlFor={officeId} className={LABEL_CLASS}>
              {boxNow ? "Автомат BOX NOW" : "Офис"} <Required />
            </label>
            <input
              id={officeId}
              {...register("deliveryOffice")}
              type="text"
              required
              autoComplete="off"
              maxLength={200}
              placeholder={boxNow ? "Напр. до Kaufland, ул. Пазарска" : "Напр. Пловдив Център"}
              {...ariaFor("deliveryOffice", officeId, `${officeId}-helper`)}
              className={INPUT_CLASS}
            />
            <p id={`${officeId}-helper`} className="mt-1 text-xs text-ink-500">
              Името или адресът на {boxNow ? "автомата" : "офиса"}, от който ще вземете пратката.
            </p>
            <FieldError id={officeId} message={errorOf("deliveryOffice")} />
          </div>
        ) : (
          <div>
            <label htmlFor={addressId} className={LABEL_CLASS}>
              Адрес <Required />
            </label>
            <input
              id={addressId}
              {...register("deliveryAddress")}
              type="text"
              required
              autoComplete="street-address"
              maxLength={200}
              placeholder="Напр. ул. Иван Вазов 12, ет. 3, ап. 7"
              {...ariaFor("deliveryAddress", addressId)}
              className={INPUT_CLASS}
            />
            <FieldError id={addressId} message={errorOf("deliveryAddress")} />
          </div>
        )}

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
            Добавете имейл или бележка <span className="whitespace-nowrap">(по избор)</span>
          </span>
        </summary>
        <div className="mt-1 grid gap-3">
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
        Използваме данните ви само за тази поръчка: за да ви се обадим и да я доставим. Вижте нашата{" "}
        <a href={href(locale, routes.privacy)} className="underline underline-offset-2">
          политика за поверителност
        </a>
        .
      </p>
    </form>
  );
}
