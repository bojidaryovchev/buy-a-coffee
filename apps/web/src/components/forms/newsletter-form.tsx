"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import { useFormStatus } from "react-dom";
import { subscribeToNewsletter } from "@/lib/forms/actions";
import { IDLE_FORM_STATE } from "@/lib/forms/schemas";
import { HoneypotField } from "@/components/forms/honeypot-field";
import { useAnalytics } from "@/components/analytics-provider";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-11 shrink-0 rounded-sm bg-pine-900 px-4 text-sm font-medium text-paper hover:bg-pine-700 disabled:opacity-60"
    >
      {pending ? "…" : "Абонирай ме"}
    </button>
  );
}

/**
 * Newsletter signup.
 *
 * Stores consent locally with a timestamp and the page it came from. Nothing
 * is forwarded to any third party, and no provider is required for the form to
 * work — the subscription is simply a row in our database until the shop
 * connects one.
 */
export function NewsletterForm({ source }: { source: string }) {
  const [state, formAction] = useActionState(subscribeToNewsletter, IDLE_FORM_STATE);
  const emailId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const analytics = useAnalytics();

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
      <p role="status" className="rounded-sm bg-pine-100 px-3 py-2.5 text-sm text-pine-900">
        {state.message}
      </p>
    );
  }

  const emailError = state.status === "error" ? state.fieldErrors?.email : undefined;

  return (
    <form ref={formRef} action={formAction}>
      <input type="hidden" name="source" value={source} />
      <HoneypotField />

      <label htmlFor={emailId} className="sr-only">
        Имейл адрес
      </label>
      <div className="flex gap-2">
        <input
          id={emailId}
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          aria-invalid={emailError ? true : undefined}
          aria-describedby={emailError ? `${emailId}-error` : undefined}
          className="h-11 min-w-0 flex-1 rounded-sm border border-line-strong bg-paper-raised px-3 text-base outline-none focus:border-pine-700 aria-[invalid]:border-critical"
        />
        <SubmitButton />
      </div>

      <p aria-live="polite" className="mt-1.5 min-h-4 text-xs">
        {emailError && (
          <span id={`${emailId}-error`} className="text-critical">
            {emailError}
          </span>
        )}
        {state.status === "error" && !emailError && <span className="text-critical">{state.message}</span>}
      </p>
    </form>
  );
}
