"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import { useFormStatus } from "react-dom";
import { subscribeToNewsletter } from "@/lib/forms/actions";
import { IDLE_FORM_STATE } from "@/lib/forms/schemas";
import { Button } from "@/components/ui/primitives";
import { HoneypotField } from "@/components/forms/honeypot-field";
import { INPUT_CLASS } from "@/components/forms/field-styles";
import { useAnalytics } from "@/components/analytics-provider";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} aria-busy={pending || undefined} className="shrink-0">
      {pending ? "…" : "Абонирай ме"}
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
    <form ref={formRef} action={formAction} className="relative">
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
          placeholder="name@example.com"
          aria-invalid={emailError ? true : undefined}
          aria-describedby={emailError ? `${emailId}-error` : undefined}
          inputMode="email"
          className={`${INPUT_CLASS} min-w-0 flex-1`}
        />
        <SubmitButton />
      </div>

      <p aria-live="polite" className="mt-1.5 min-h-4 text-sm">
        {emailError && (
          <span id={`${emailId}-error`} className="text-critical">
            {emailError}
          </span>
        )}
        {state.status === "error" && !emailError && (
          <span className="text-critical">{state.message}</span>
        )}
      </p>
    </form>
  );
}
