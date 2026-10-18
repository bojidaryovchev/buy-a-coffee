"use client";

import { useId } from "react";
import { submitContactMessage } from "@/lib/forms/actions";
import {
  CHECK_FIELDS_MESSAGE,
  IDLE_FORM_STATE,
  contactSchema,
  type FormState,
} from "@/lib/forms/schemas";
import { Button } from "@/components/ui/primitives";
import { HoneypotField } from "@/components/forms/honeypot-field";
import { ConsentCheckbox } from "@/components/forms/consent-checkbox";
import { FieldError } from "@/components/forms/field-error";
import {
  HELPER_CLASS,
  INPUT_CLASS,
  LABEL_CLASS,
  TEXTAREA_CLASS,
} from "@/components/forms/field-styles";
import { useActionForm } from "@/components/forms/use-schema-form";
import { useLocale } from "@/i18n/use-locale";
import { href, routes } from "@/lib/routes";

/**
 * The contact form, and the enquiry form at the foot of the business pages
 * (the same form with its subject filled in).
 *
 * Checked in the browser with `contactSchema`, the schema the action checks
 * with, when the button is pressed (`use-schema-form.ts`); without JavaScript
 * it is a plain POST and the server's answer is drawn in the same places, with
 * what was typed put back.
 */

function SubmitButton({ pending }: { pending: boolean }) {
  return (
    <Button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className="w-full sm:w-auto sm:min-w-40"
    >
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
  error?: string | undefined;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className={LABEL_CLASS}>
        {label}
        {required && (
          <span aria-hidden="true" className="text-critical">
            {" "}
            *
          </span>
        )}
      </label>
      {children}
      <FieldError id={id} message={error} />
    </div>
  );
}

const fieldErrorsOf = (state: FormState) =>
  state.status === "error" ? state.fieldErrors : undefined;

/** What was typed, when the page is drawn from a refusal (no JavaScript). */
const typedIn = (state: FormState): Record<string, string> =>
  state.status === "error" ? (state.values ?? {}) : {};

export function ContactForm({
  defaultSubject,
}: {
  /**
   * Prefills the subject, so a message sent from a page with a purpose of its
   * own (the business sections) arrives already labelled. It stays an ordinary
   * visible field: the visitor can see what will be sent, and change it.
   */
  defaultSubject?: string;
} = {}) {
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
    schema: contactSchema,
    action: submitContactMessage,
    initialState: IDLE_FORM_STATE,
    fieldErrorsOf,
    defaultValuesOf: (drawnWith) => {
      const typed = typedIn(drawnWith);
      return {
        name: typed.name ?? "",
        email: typed.email ?? "",
        phone: typed.phone ?? "",
        subject: typed.subject ?? defaultSubject ?? "",
        message: typed.message ?? "",
        newsletterConsent: typed.newsletterConsent === "on",
      };
    },
  });
  const typed = typedIn(state);
  const locale = useLocale();
  const nameId = useId();
  const emailId = useId();
  const phoneId = useId();
  const subjectId = useId();
  const messageId = useId();

  if (state.status === "success") {
    return (
      <div role="status" className="rounded-md border border-pine-500/40 bg-pine-100 p-5">
        <p className="font-display text-lg font-semibold text-pine-900">Съобщението е изпратено</p>
        <p className="mt-1 text-sm text-ink-700">{state.message}</p>
      </div>
    );
  }

  const formMessage = lineFor(state.status === "error" ? state : undefined, CHECK_FIELDS_MESSAGE);

  return (
    <form {...formProps} action={formAction} className="relative space-y-4">
      <HoneypotField />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={nameId} label="Вашето име" required error={errorOf("name")}>
          <input
            id={nameId}
            {...register("name")}
            type="text"
            required
            autoComplete="name"
            defaultValue={typed.name}
            {...ariaFor("name", nameId)}
            className={INPUT_CLASS}
          />
        </Field>

        <Field id={emailId} label="Имейл" required error={errorOf("email")}>
          <input
            id={emailId}
            {...register("email")}
            type="email"
            required
            inputMode="email"
            autoComplete="email"
            defaultValue={typed.email}
            {...ariaFor("email", emailId)}
            className={INPUT_CLASS}
          />
        </Field>

        <Field id={phoneId} label="Телефон (по избор)" error={errorOf("phone")}>
          <input
            id={phoneId}
            {...register("phone")}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            defaultValue={typed.phone}
            {...ariaFor("phone", phoneId)}
            className={INPUT_CLASS}
          />
        </Field>

        <Field id={subjectId} label="Тема (по избор)" error={errorOf("subject")}>
          <input
            id={subjectId}
            {...register("subject")}
            type="text"
            maxLength={160}
            defaultValue={typed.subject ?? defaultSubject}
            {...ariaFor("subject", subjectId)}
            className={INPUT_CLASS}
          />
        </Field>
      </div>

      <Field id={messageId} label="Съобщение" required error={errorOf("message")}>
        <textarea
          id={messageId}
          {...register("message")}
          required
          rows={6}
          maxLength={4000}
          defaultValue={typed.message}
          {...ariaFor("message", messageId)}
          className={TEXTAREA_CLASS}
        />
      </Field>

      <ConsentCheckbox
        affects="съобщението"
        registration={register("newsletterConsent")}
        defaultChecked={typed.newsletterConsent === "on"}
      />

      <p aria-live="polite" className="min-h-6 text-sm">
        {formMessage && <span className="text-critical">{formMessage}</span>}
      </p>

      <SubmitButton pending={pending} />

      <p className={HELPER_CLASS}>
        Използваме данните ви само за да отговорим на това съобщение. Вижте нашата{" "}
        <a href={href(locale, routes.privacy)} className="underline underline-offset-2">
          политика за поверителност
        </a>
        .
      </p>
    </form>
  );
}
