"use client";

import Link from "next/link";
import { useEffect, useId } from "react";
import { subscribeToNewsletter } from "@/lib/forms/actions";
import {
  CHECK_EMAIL_MESSAGE,
  IDLE_FORM_STATE,
  newsletterSchema,
  type FormState,
} from "@/lib/forms/schemas";
import { Button } from "@/components/ui/primitives";
import { HoneypotField } from "@/components/forms/honeypot-field";
import { INPUT_CLASS } from "@/components/forms/field-styles";
import { useActionForm } from "@/components/forms/use-schema-form";
import { useAnalytics } from "@/components/analytics-provider";
import { useLocale } from "@/i18n/use-locale";
import { href, routes } from "@/lib/routes";

const SUBMIT_LABEL = "Абонирай ме";
const PENDING_LABEL = "Изпраща се…";

function SubmitButton({ pending }: { pending: boolean }) {
  return (
    <Button type="submit" disabled={pending} aria-busy={pending || undefined} className="shrink-0">
      {/*
        Both labels are laid out in one grid cell and only one is visible, so
        the button is as wide as the longer of the two whichever it shows: it
        does not jump when the form starts submitting (DESIGN.md, "Buttons",
        Pending). A second click while it is disabled sends nothing.
      */}
      <span className="grid">
        <span className={`col-start-1 row-start-1 ${pending ? "invisible" : ""}`}>
          {SUBMIT_LABEL}
        </span>
        <span
          aria-hidden={!pending}
          className={`col-start-1 row-start-1 ${pending ? "" : "invisible"}`}
        >
          {PENDING_LABEL}
        </span>
      </span>
    </Button>
  );
}

const fieldErrorsOf = (state: FormState) =>
  state.status === "error" ? state.fieldErrors : undefined;

/**
 * Newsletter signup.
 *
 * Stores consent locally with a timestamp and the page it came from. Nothing
 * is forwarded to any third party, and no provider is required for the form to
 * work — the subscription is simply a row in our database until the shop
 * connects one.
 *
 * It works before any script runs: a plain form posting to a server action,
 * which checks the address with `newsletterSchema` and answers in the line
 * under the field. With the script, the same schema checks it when the button
 * is pressed, and nothing is sent until it passes (`use-schema-form.ts`). The
 * field sits beside the button only where the form has room for both and a
 * whole address (`@md`, 28rem of form, decided by the form's own width rather
 * than the window's); narrower, they stack and each takes the full width.
 */
export function NewsletterForm({ source }: { source: string }) {
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
    schema: newsletterSchema,
    action: subscribeToNewsletter,
    initialState: IDLE_FORM_STATE,
    fieldErrorsOf,
    defaultValuesOf: (drawnWith) => ({
      email: drawnWith.status === "error" ? (drawnWith.values?.email ?? "") : "",
      source,
    }),
  });
  const emailId = useId();
  const consentId = `${emailId}-consent`;
  const analytics = useAnalytics();
  const locale = useLocale();

  useEffect(() => {
    if (state.status === "success") {
      analytics.track({ name: "newsletter_submitted", outcome: "success" });
    } else if (state.status === "error") {
      analytics.track({ name: "newsletter_submitted", outcome: "error" });
    }
  }, [state, analytics]);

  if (state.status === "success") {
    return (
      <p
        role="status"
        className="rounded-md border border-pine-500 bg-paper-raised px-4 py-3 text-base text-ink-900"
      >
        {state.message}
      </p>
    );
  }

  const emailError = errorOf("email");
  /* One line under the field: the field's own message when it has one, else
     the form's (a refusal of the whole request, such as the rate limit). */
  const formMessage = lineFor(state.status === "error" ? state : undefined, CHECK_EMAIL_MESSAGE);

  return (
    <form {...formProps} action={formAction} className="@container relative">
      <input type="hidden" {...register("source")} value={source} />
      <HoneypotField />

      <label htmlFor={emailId} className="sr-only">
        Имейл адрес
      </label>
      <div className="flex flex-col gap-2 @md:flex-row">
        <input
          id={emailId}
          {...register("email")}
          type="email"
          required
          autoComplete="email"
          placeholder="Вашият имейл адрес"
          defaultValue={state.status === "error" ? state.values?.email : undefined}
          {...ariaFor("email", emailId, consentId)}
          inputMode="email"
          className={`${INPUT_CLASS} min-w-0 @md:flex-1`}
        />
        <SubmitButton pending={pending} />
      </div>

      <p aria-live="polite" className="mt-1.5 min-h-5 text-sm">
        {emailError ? (
          <span id={`${emailId}-error`} className="text-critical">
            {emailError}
          </span>
        ) : (
          formMessage && <span className="text-critical">{formMessage}</span>
        )}
      </p>

      <p id={consentId} className="text-xs text-ink-500">
        Можете да се отпишете по всяко време. Какво пазим и защо — в{" "}
        <Link
          href={href(locale, routes.privacy)}
          className="text-pine-700 underline underline-offset-2 hover:text-pine-900"
        >
          политиката за поверителност
        </Link>
        .
      </p>
    </form>
  );
}
