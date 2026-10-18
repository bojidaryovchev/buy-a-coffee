"use client";

import Link from "next/link";
import { useActionState, useEffect, useId, useRef } from "react";
import { useFormStatus } from "react-dom";
import { subscribeToNewsletter } from "@/lib/forms/actions";
import { IDLE_FORM_STATE } from "@/lib/forms/schemas";
import { Button } from "@/components/ui/primitives";
import { HoneypotField } from "@/components/forms/honeypot-field";
import { INPUT_CLASS } from "@/components/forms/field-styles";
import { useAnalytics } from "@/components/analytics-provider";
import { useLocale } from "@/i18n/use-locale";
import { href, routes } from "@/lib/routes";

const SUBMIT_LABEL = "Абонирай ме";
const PENDING_LABEL = "Изпраща се…";

function SubmitButton() {
  const { pending } = useFormStatus();
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

/**
 * Newsletter signup.
 *
 * Stores consent locally with a timestamp and the page it came from. Nothing
 * is forwarded to any third party, and no provider is required for the form to
 * work — the subscription is simply a row in our database until the shop
 * connects one.
 *
 * It works before any script runs: a plain form posting to a server action,
 * with the field's own `required` and `type="email"`. The field sits beside
 * the button only where the form has room for both and a whole address
 * (`@md`, 28rem of form, decided by the form's own width rather than the
 * window's); narrower, they stack and each takes the full width.
 */
export function NewsletterForm({ source }: { source: string }) {
  const [state, formAction] = useActionState(subscribeToNewsletter, IDLE_FORM_STATE);
  const emailId = useId();
  const consentId = `${emailId}-consent`;
  const formRef = useRef<HTMLFormElement>(null);
  const analytics = useAnalytics();
  const locale = useLocale();

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
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

  const emailError = state.status === "error" ? state.fieldErrors?.email : undefined;
  const describedBy = [emailError ? `${emailId}-error` : null, consentId].filter(Boolean).join(" ");

  return (
    <form ref={formRef} action={formAction} className="@container relative">
      <input type="hidden" name="source" value={source} />
      <HoneypotField />

      <label htmlFor={emailId} className="sr-only">
        Имейл адрес
      </label>
      <div className="flex flex-col gap-2 @md:flex-row">
        <input
          id={emailId}
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="Вашият имейл адрес"
          aria-invalid={emailError ? true : undefined}
          aria-describedby={describedBy}
          inputMode="email"
          className={`${INPUT_CLASS} min-w-0 @md:flex-1`}
        />
        <SubmitButton />
      </div>

      <p aria-live="polite" className="mt-1.5 min-h-5 text-sm">
        {emailError && (
          <span id={`${emailId}-error`} className="text-critical">
            {emailError}
          </span>
        )}
        {state.status === "error" && !emailError && (
          <span className="text-critical">{state.message}</span>
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
