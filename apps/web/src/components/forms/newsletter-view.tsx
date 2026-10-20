import Link from "next/link";
import { useId, type ComponentPropsWithRef, type FormEvent, type Ref, type RefObject } from "react";
import type { FormState } from "@/lib/forms/form-state";
import { Button } from "@/components/ui/primitives";
import { HoneypotField } from "@/components/forms/honeypot-field";
import { INPUT_CLASS } from "@/components/forms/field-styles";
import { useLocale } from "@/i18n/use-locale";
import { href, routes } from "@/lib/routes";

/**
 * What the newsletter form looks like, and nothing of how it behaves.
 *
 * Two things drive it: the plain form every page starts with, and the
 * react-hook-form version that takes over when the band nears the screen
 * (`newsletter-form.tsx`). Both draw through this one view, rendered in one
 * place, so they cannot drift apart; and the takeover changes the props of
 * elements already on the page rather than the elements, so the field the
 * person is typing in stays the same field, with its text, focus and caret.
 */

const SUBMIT_LABEL = "Абонирай ме";
const PENDING_LABEL = "Изпраща се…";

/** A field's name, ref and handlers: the bare name, or react-hook-form's `register`. */
export type FieldBinding = Pick<
  ComponentPropsWithRef<"input">,
  "name" | "ref" | "onChange" | "onBlur"
>;

/** How the form behaves at the moment: before the takeover, or after it. */
export interface NewsletterBehaviour {
  /** react-hook-form has taken the form over (`data-enhanced` on the `<form>`). */
  readonly enhanced: boolean;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  /** The enhanced form's own hold on the `<form>`, which it moves focus with. */
  readonly formRef?: RefObject<HTMLFormElement | null> | undefined;
  readonly emailField: FieldBinding;
  readonly sourceField: FieldBinding;
  /** From the press until the server has answered. */
  readonly pending: boolean;
  /** The message under the field, from the browser's check or the server's. */
  readonly emailError: string | undefined;
  /** The form's line when the field has none (a refusal of the whole request). */
  readonly formMessage: string | undefined;
}

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

/**
 * The field sits beside the button only where the form has room for both and
 * a whole address (`@md`, 28rem of form, decided by the form's own width
 * rather than the window's); narrower, they stack and each takes the full
 * width. Under them, one line for the answer, then the consent line, which
 * describes the field. Success replaces the form with the server's sentence.
 */
export function NewsletterView({
  source,
  state,
  formAction,
  formRef,
  behaviour,
}: {
  source: string;
  state: FormState;
  /** The server action, through `useActionState`: what the form posts without a script. */
  formAction: (formData: FormData) => void;
  formRef: Ref<HTMLFormElement>;
  behaviour: NewsletterBehaviour;
}) {
  const emailId = useId();
  const consentId = `${emailId}-consent`;
  const locale = useLocale();

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

  const { emailError, formMessage } = behaviour;
  const describedBy = [emailError ? `${emailId}-error` : null, consentId].filter(Boolean).join(" ");

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={behaviour.onSubmit}
      action={formAction}
      data-enhanced={behaviour.enhanced ? "" : undefined}
      className="@container relative"
    >
      <input type="hidden" {...behaviour.sourceField} value={source} />
      <HoneypotField />

      <label htmlFor={emailId} className="sr-only">
        Имейл адрес
      </label>
      <div className="flex flex-col gap-2 @md:flex-row">
        <input
          id={emailId}
          {...behaviour.emailField}
          type="email"
          required
          autoComplete="email"
          placeholder="Вашият имейл адрес"
          defaultValue={state.status === "error" ? state.values?.email : undefined}
          aria-invalid={emailError ? true : undefined}
          aria-describedby={describedBy}
          inputMode="email"
          className={`${INPUT_CLASS} min-w-0 @md:flex-1`}
        />
        <SubmitButton pending={behaviour.pending} />
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
