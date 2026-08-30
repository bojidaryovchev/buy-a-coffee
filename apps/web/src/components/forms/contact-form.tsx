"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import { useFormStatus } from "react-dom";
import { submitContactMessage } from "@/lib/forms/actions";
import { IDLE_FORM_STATE } from "@/lib/forms/schemas";
import { Button } from "@/components/ui/primitives";
import { HoneypotField } from "@/components/forms/honeypot-field";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full sm:w-auto">
      {pending ? "Изпраща се…" : "Изпрати съобщение"}
    </Button>
  );
}

function Field({
  id,
  label,
  error,
  required,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label} {required && <span className="text-critical">*</span>}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs text-critical">
          {error}
        </p>
      )}
    </div>
  );
}

export function ContactForm() {
  const [state, formAction] = useActionState(submitContactMessage, IDLE_FORM_STATE);
  const nameId = useId();
  const emailId = useId();
  const phoneId = useId();
  const subjectId = useId();
  const messageId = useId();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state]);

  if (state.status === "success") {
    return (
      <div role="status" className="rounded-md border border-pine-500/40 bg-pine-100 p-5">
        <p className="font-display text-lg font-semibold text-pine-900">Съобщението е изпратено</p>
        <p className="mt-1 text-sm text-pine-900/80">{state.message}</p>
      </div>
    );
  }

  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const inputClass =
    "h-11 w-full rounded-sm border border-line-strong bg-paper-raised px-3 text-base outline-none focus:border-pine-700 aria-[invalid]:border-critical";

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <HoneypotField />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={nameId} label="Вашето име" required {...(errors.name ? { error: errors.name } : {})}>
          <input
            id={nameId}
            name="name"
            type="text"
            required
            autoComplete="name"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? `${nameId}-error` : undefined}
            className={inputClass}
          />
        </Field>

        <Field id={emailId} label="Имейл" required {...(errors.email ? { error: errors.email } : {})}>
          <input
            id={emailId}
            name="email"
            type="email"
            required
            autoComplete="email"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? `${emailId}-error` : undefined}
            className={inputClass}
          />
        </Field>

        <Field id={phoneId} label="Телефон (по избор)" {...(errors.phone ? { error: errors.phone } : {})}>
          <input
            id={phoneId}
            name="phone"
            type="tel"
            autoComplete="tel"
            aria-invalid={errors.phone ? true : undefined}
            aria-describedby={errors.phone ? `${phoneId}-error` : undefined}
            className={inputClass}
          />
        </Field>

        <Field id={subjectId} label="Тема (по избор)">
          <input id={subjectId} name="subject" type="text" maxLength={160} className={inputClass} />
        </Field>
      </div>

      <Field id={messageId} label="Съобщение" required {...(errors.message ? { error: errors.message } : {})}>
        <textarea
          id={messageId}
          name="message"
          required
          rows={6}
          maxLength={4000}
          aria-invalid={errors.message ? true : undefined}
          aria-describedby={errors.message ? `${messageId}-error` : undefined}
          className="w-full rounded-sm border border-line-strong bg-paper-raised px-3 py-2 text-base outline-none focus:border-pine-700 aria-[invalid]:border-critical"
        />
      </Field>

      <p aria-live="polite" className="min-h-5 text-sm">
        {state.status === "error" && <span className="text-critical">{state.message}</span>}
      </p>

      <SubmitButton />

      <p className="text-xs text-ink-500">
        Използваме данните ви само за да отговорим на това съобщение. Вижте нашата{" "}
        <a href="/privacy" className="underline underline-offset-2">
          политика за поверителност
        </a>
        .
      </p>
    </form>
  );
}
