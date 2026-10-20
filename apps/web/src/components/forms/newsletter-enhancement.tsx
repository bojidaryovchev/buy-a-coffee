"use client";

import { memo, useLayoutEffect, useMemo, useState } from "react";
import type { NewsletterBehaviour } from "@/components/forms/newsletter-view";
import { useSchemaForm } from "@/components/forms/use-schema-form";
import { CHECK_EMAIL_MESSAGE, newsletterSchema, type FormState } from "@/lib/forms/schemas";

/**
 * The newsletter form's react-hook-form behaviour, fetched only when the band
 * nears the screen or the form is touched (`newsletter-form.tsx`).
 *
 * Everything that makes it worth fetching is here: react-hook-form, its zod
 * resolver and `newsletterSchema`, with zod under them — some 25 KB with
 * brotli (October 2026) that every page used to load before it could paint,
 * and that a page now fetches only when it asks for this. The check is
 * the one every form on the site makes (`use-schema-form.ts`): the schema the
 * server action validates with, when the button is pressed, and nothing sent
 * until it passes.
 *
 * It draws nothing itself. The plain form is already on the screen, perhaps
 * with someone typing in it, and redrawing it would replace the field under
 * their fingers. So this hands its behaviour — `register`'s handlers, the
 * submit handler, what to show under the field — to the form that owns the
 * view, which spreads it onto the elements it already has. The answer state
 * stays that form's too, so an answer the plain form received is the one
 * drawn here, and the analytics event fires in one place.
 */

export interface NewsletterEnhancementProps {
  /**
   * The answer on the screen: the server's last, unless a press of the plain
   * form has put it out of date since (`refused`).
   */
  state: FormState;
  formAction: (formData: FormData) => void;
  /** `useActionState`'s pending flag. */
  sending: boolean;
  source: string;
  /**
   * The plain form was pressed and refused, by its own check or the server's,
   * before this took over. Read once, when it does.
   */
  pressed: boolean;
  /** The plain form's own refusal, under the field when this took over. Read once. */
  refused: string | undefined;
  /** Called after every render with the behaviour for the view. */
  onBehaviour: (behaviour: NewsletterBehaviour) => void;
}

/* Memoised: the form re-renders when it is handed a behaviour, and this must
   not answer that with another one. It renders when its own form state
   changes (react-hook-form's errors, a press) or the server answers. */
export const NewsletterEnhancement = memo(function NewsletterEnhancement({
  state,
  formAction,
  sending,
  source,
  pressed,
  refused,
  onBehaviour,
}: NewsletterEnhancementProps) {
  // What the plain form left on the screen, as it was at the takeover.
  const [left] = useState({ pressed, refused });
  /* One object per answer, which `useSchemaForm` reads as "the server spoke".
     Before any, the plain form's own refusal is drawn the same way, so that
     react-hook-form clears it when it is put right, as it would its own. */
  const serverErrors = useMemo(() => {
    if (state.status === "error") return state.fieldErrors;
    return left.refused ? { email: left.refused } : undefined;
  }, [state, left]);
  /* `useSchemaForm` moves focus to the errors it is drawn with, but not to
     these: its focus effect runs before the view has handed it the `<form>`
     (its ref reaches the element in the render this component's layout
     effect causes), so an answer already on the screen leaves focus where the
     person put it. `newsletter-form.test.ts` holds that. */
  const {
    form: { register },
    formProps,
    pending,
    errorOf,
    lineFor,
  } = useSchemaForm({
    schema: newsletterSchema,
    send: formAction,
    sending,
    serverErrors,
    /* The address has no default: the field may already hold what someone
       typed, and react-hook-form, given none, takes the field's value as it
       finds it instead of writing one over it. */
    defaultValues: { source },
    // A refused press of the plain form counts as one here.
    pressedBefore: left.pressed,
  });

  const behaviour: NewsletterBehaviour = {
    enhanced: true,
    onSubmit: formProps.onSubmit,
    formRef: formProps.ref,
    emailField: register("email"),
    sourceField: register("source"),
    pending,
    emailError: errorOf("email"),
    /* One line under the field: the field's own message when it has one, else
       the form's (a refusal of the whole request, such as the rate limit). */
    formMessage: lineFor(state.status === "error" ? state : undefined, CHECK_EMAIL_MESSAGE),
  };

  // Before the browser paints, so the view never shows a stale answer.
  useLayoutEffect(() => onBehaviour(behaviour));

  return null;
});
