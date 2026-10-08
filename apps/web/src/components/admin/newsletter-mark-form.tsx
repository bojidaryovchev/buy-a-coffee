"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { addToNewsletter, type NewsletterMarkState } from "@/lib/admin-actions";
import { OPERATOR_CONSENT_BASES, consentSourceLabel } from "@/lib/forms/consent";

/**
 * "Add to the newsletter", on an enquiry or a message.
 *
 * The choice of how consent was given has no default and is required: the
 * radios start unselected, the browser will not submit without one, and the
 * action refuses a missing or unknown value anyway. An enquiry on its own is
 * not consent to marketing, and the line above the choices says so where the
 * operator reads it.
 *
 * Radios rather than a select: three options, one tap each on a phone.
 */

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 rounded-sm border border-line-strong bg-paper-raised px-4 py-2 text-sm font-medium text-ink-900 transition-colors hover:bg-paper-sunken disabled:cursor-not-allowed disabled:text-ink-500"
    >
      {pending ? "Записва се…" : "Запиши в бюлетина"}
    </button>
  );
}

export function NewsletterMarkForm({
  recordId,
  kind,
  email,
  current,
}: {
  recordId: string;
  kind: "order" | "contact";
  email: string;
  /** Where this address already stands, if it is on the list at all. */
  current: { consentAt: Date; consentSource: string | null; unsubscribedAt: Date | null } | null;
}) {
  const [state, action] = useActionState<NewsletterMarkState, FormData>(addToNewsletter, {});

  const stamp = (at: Date) => at.toISOString().slice(0, 16).replace("T", " ");

  if (current && !current.unsubscribedAt) {
    return (
      <section
        aria-labelledby={`nl-${recordId}`}
        className="mt-6 rounded-md border border-line bg-paper-raised p-5"
      >
        <h2 id={`nl-${recordId}`} className="text-sm font-semibold text-ink-900">
          Бюлетин
        </h2>
        <p className="mt-1 text-sm text-ink-700">
          {email} е в списъка от {stamp(current.consentAt)} UTC.{" "}
          {consentSourceLabel(current.consentSource)}.
        </p>
      </section>
    );
  }

  if (current?.unsubscribedAt) {
    return (
      <section
        aria-labelledby={`nl-${recordId}`}
        className="mt-6 rounded-md border border-line bg-paper-raised p-5"
      >
        <h2 id={`nl-${recordId}`} className="text-sm font-semibold text-ink-900">
          Бюлетин
        </h2>
        <p className="mt-1 text-sm text-ink-700">
          {email} се е отписал на {stamp(current.unsubscribedAt)} UTC. От панела не се връща — само
          човекът може да се запише отново, от формата на сайта.
        </p>
      </section>
    );
  }

  if (state.done) {
    return (
      <section
        aria-labelledby={`nl-${recordId}`}
        className="mt-6 rounded-md border border-pine-500/40 bg-pine-100 p-5"
      >
        <h2 id={`nl-${recordId}`} className="text-sm font-semibold text-ink-900">
          Бюлетин
        </h2>
        <p role="status" className="mt-1 text-sm text-ink-700">
          {state.done === "subscribed"
            ? `${email} е записан в бюлетина със съгласието, което посочихте.`
            : `${email} вече е в списъка; първото съгласие остава в сила.`}
        </p>
      </section>
    );
  }

  return (
    <form
      action={action}
      aria-labelledby={`nl-${recordId}`}
      className="mt-6 rounded-md border border-line bg-paper-raised p-5"
    >
      <input type="hidden" name="recordId" value={recordId} />
      <input type="hidden" name="kind" value={kind} />

      <h2 id={`nl-${recordId}`} className="text-sm font-semibold text-ink-900">
        Добави в бюлетина
      </h2>
      <p className="mt-1 text-sm text-ink-700">
        Заявката или съобщението не са съгласие за реклама. Записвайте само човек, който ви е казал,
        че го желае, и посочете как.
      </p>

      <fieldset className="mt-3">
        <legend className="text-sm font-medium text-ink-900">
          Как е дадено съгласието за {email}?{" "}
          <span aria-hidden="true" className="text-critical">
            *
          </span>
        </legend>
        <div className="mt-1 flex flex-col">
          {Object.entries(OPERATOR_CONSENT_BASES).map(([value, label]) => (
            <label
              key={value}
              className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink-900"
            >
              <input
                type="radio"
                name="basis"
                value={value}
                required
                className="size-5 accent-pine-900"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      {state.error && (
        <p role="alert" className="mt-2 text-sm text-critical">
          {state.error}
        </p>
      )}

      <div className="mt-3">
        <Submit />
      </div>
    </form>
  );
}
