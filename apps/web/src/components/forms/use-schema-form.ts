"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type RefObject,
} from "react";
import {
  useForm,
  type DefaultValues,
  type FieldErrors,
  type FieldValues,
  type Path,
  type Resolver,
  type UseFormReturn,
} from "react-hook-form";
import type { z } from "zod";

/**
 * Every form on the site, in the browser: react-hook-form validating with the
 * very schema the server action validates with, on top of a form that is a
 * plain POST to that action.
 *
 * How the pieces fit:
 *
 *   - The `<form>` keeps `action={…}` pointing at the server action and gets
 *     `noValidate`. Before the script runs (or without one) the browser posts
 *     it like any form, the server validates, and the page comes back drawn
 *     from the action's answer: errors under the fields, what was typed back
 *     in them. `noValidate` means the browser's own bubbles never show — in
 *     the browser's language and style, ahead of ours.
 *   - With the script, `onSubmit` takes over: the whole form is validated with
 *     the schema, and only a valid form is sent, as the same `FormData` the
 *     browser would have posted (honeypot and hidden fields included), to the
 *     same action. The server's answer still decides: its field errors land in
 *     the same places as the browser's, and its form-level message in the
 *     form's line.
 *   - Validation runs when the button is pressed (`mode: "onSubmit"`), and
 *     after that a field re-checks as it is corrected (`reValidateMode:
 *     "onChange"`), so an error goes away the moment it is fixed.
 *   - Focus goes to the first invalid field, in the order the page shows them,
 *     opening a closed `<details>` that hides it (the order form's optional
 *     fields), whether the browser or the server found the problem.
 *   - Sending is one at a time: a second press while the first is on its way
 *     sends nothing, and the button says so (`pending`).
 *
 * Sending by hand rather than through `<form action>` has one more effect:
 * React does not reset the fields when the action returns, so a refused form
 * keeps what was typed. A form that is kept after success clears itself.
 */

/** A field's message from the server, by field name. */
export type ServerFieldErrors = Readonly<Record<string, string>> | undefined;

type AnySchema = z.ZodType<FieldValues, z.ZodTypeDef, FieldValues>;

export interface SchemaForm<S extends AnySchema> {
  form: UseFormReturn<z.input<S>, unknown, z.output<S>>;
  /** On the `<form>`, with `noValidate`. */
  formProps: {
    ref: RefObject<HTMLFormElement | null>;
    noValidate: true;
    onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  };
  /** True from the press until the server has answered. */
  pending: boolean;
  /** The message under `name`, from the browser's check or the server's. */
  errorOf: (name: Path<z.input<S>>) => string | undefined;
  /**
   * `aria-invalid` and `aria-describedby` for the field whose error paragraph
   * has the id `${id}-error`; `also` adds ids the field is always described by.
   */
  ariaFor: (
    name: Path<z.input<S>>,
    id: string,
    also?: string,
  ) => { "aria-invalid"?: true; "aria-describedby"?: string };
  /**
   * The form's result line. `answer` is the server's last refusal, if any;
   * `refused` is the line for a press the browser refused. Each lasts until it
   * is out of date: the browser's while a field is still wrong, a refusal of
   * fields until they are put right, and either until the next press.
   */
  lineFor: (
    answer: { message: string; fieldErrors?: unknown } | undefined,
    refused: string,
  ) => string | undefined;
}

/**
 * Put the cursor in the first of `names` that the person can type in, in page
 * order. A hidden field cannot take it; one inside a closed `<details>` can,
 * once the disclosure is opened.
 */
function focusFirst(form: HTMLFormElement | null, names: readonly string[]): void {
  if (!form || names.length === 0) return;
  const wanted = new Set(names);
  for (const element of Array.from(form.elements)) {
    if (!(
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
    )) {
      continue;
    }
    if (!wanted.has(element.name) || element.type === "hidden") continue;
    for (let details = element.closest("details"); details;) {
      details.open = true;
      details = details.parentElement?.closest("details") ?? null;
    }
    element.focus();
    return;
  }
}

function asFieldErrors(messages: ServerFieldErrors): FieldErrors | undefined {
  if (!messages) return undefined;
  const errors: FieldErrors = {};
  for (const [name, message] of Object.entries(messages)) {
    errors[name] = { type: "server", message };
  }
  return errors;
}

/**
 * The core: a schema, something to send a valid form to, and what the server
 * last said about the fields.
 *
 * `serverErrors` must keep its identity until the server answers again
 * (memoise it on the action's state); a new object is read as a new answer,
 * and focus moves to it.
 */
export function useSchemaForm<S extends AnySchema>({
  schema,
  send,
  sending,
  serverErrors,
  defaultValues,
}: {
  schema: S;
  /** Called in a transition with the form's `FormData`, only when it is valid. */
  send: (formData: FormData) => void | Promise<void>;
  /**
   * The action's own pending flag, when it has one (`useActionState`). Its
   * presence also says that `send` returns before the answer does.
   */
  sending?: boolean;
  serverErrors?: ServerFieldErrors;
  defaultValues?: DefaultValues<z.input<S>>;
}): SchemaForm<S> {
  const errors = useMemo(() => asFieldErrors(serverErrors), [serverErrors]);
  const form = useForm<z.input<S>, unknown, z.output<S>>({
    resolver: zodResolver(schema) as unknown as Resolver<z.input<S>, unknown, z.output<S>>,
    mode: "onSubmit",
    reValidateMode: "onChange",
    // Ours, below: react-hook-form's cannot open a closed <details>.
    shouldFocusError: false,
    ...(defaultValues ? { defaultValues } : {}),
    // Drawn into the first render, so the server's HTML carries them too.
    ...(errors ? { errors: errors as FieldErrors<z.input<S>> } : {}),
  });

  const formRef = useRef<HTMLFormElement>(null);
  const [transitionPending, startTransition] = useTransition();
  const pending = Boolean(sending) || transitionPending;
  const [refusedHere, setRefusedHere] = useState(false);

  /* Set on the press, before validation (which is asynchronous), and cleared
     when the answer is in: a double click sends once even before the button
     has re-rendered as disabled. */
  const inFlight = useRef(false);
  useEffect(() => {
    if (!pending) inFlight.current = false;
  }, [pending]);
  // The answer is in: the next press may send.
  useEffect(() => {
    inFlight.current = false;
    if (errors) focusFirst(formRef.current, Object.keys(errors));
  }, [errors]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current || pending) return;
    inFlight.current = true;
    const element = event.currentTarget;
    /* The button that was pressed, read now: the event is gone by the time
       validation (asynchronous) is done. */
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    void form.handleSubmit(
      () => {
        setRefusedHere(false);
        /* What the browser would have posted, honeypot and hidden fields
           included — and, like the browser, the name and value of the button
           that was pressed, for a form with more than one (the newsletter
           composer's save, test and send). */
        const formData = new FormData(element, submitter);
        /* Safari 15.4 to 16.3 report the submitter but leave it out of the
           form data; add it, as the browser would have posted it. (Older ones
           report none at all, which is why a form whose buttons mean different
           things also keeps the choice in a hidden field.) */
        if (
          (submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement) &&
          submitter.name &&
          !formData.has(submitter.name)
        ) {
          formData.append(submitter.name, submitter.value);
        }
        startTransition(async () => {
          try {
            await send(formData);
          } finally {
            // An action with state of its own has only been queued here; the
            // effects above clear the flag when its answer arrives.
            if (sending === undefined) inFlight.current = false;
          }
        });
      },
      (found) => {
        inFlight.current = false;
        setRefusedHere(true);
        focusFirst(element, Object.keys(found));
      },
    )(event);
  };

  const { errors: shown } = form.formState;
  const fieldsInvalid = Object.keys(shown).length > 0;
  const errorOf = (name: Path<z.input<S>>): string | undefined => {
    const message = (shown as Record<string, { message?: unknown } | undefined>)[name]?.message;
    return typeof message === "string" ? message : undefined;
  };

  return {
    form,
    formProps: { ref: formRef, noValidate: true, onSubmit },
    pending,
    errorOf,
    ariaFor: (name, id, also) => {
      const invalid = Boolean(errorOf(name));
      const describedBy = [invalid ? `${id}-error` : null, also ?? null].filter(Boolean).join(" ");
      return {
        ...(invalid ? { "aria-invalid": true as const } : {}),
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
      };
    },
    lineFor: (answer, refused) => {
      if (refusedHere) return fieldsInvalid ? refused : undefined;
      if (!answer) return undefined;
      if (answer.fieldErrors && !fieldsInvalid) return undefined;
      return answer.message;
    },
  };
}

/**
 * A form whose action answers with state (`useActionState`): the server's
 * answer, its pending flag and its field errors wired into `useSchemaForm`.
 *
 * `fieldErrorsOf` reads the field messages off a state; pass a function
 * defined once, outside the component, so the errors keep their identity
 * between answers. `defaultValuesOf` turns the state the page was drawn with
 * into the fields' starting values — which, without JavaScript, is how a
 * refused form comes back with what was typed in it.
 */
export function useActionForm<S extends AnySchema, State>({
  schema,
  action,
  initialState,
  fieldErrorsOf,
  defaultValuesOf,
}: {
  schema: S;
  action: (state: Awaited<State>, formData: FormData) => State | Promise<State>;
  initialState: Awaited<State>;
  fieldErrorsOf: (state: Awaited<State>) => ServerFieldErrors;
  defaultValuesOf?: (state: Awaited<State>) => DefaultValues<z.input<S>>;
}): SchemaForm<S> & { state: Awaited<State>; formAction: (formData: FormData) => void } {
  const [state, formAction, sending] = useActionState(action, initialState);
  const serverErrors = useMemo(() => fieldErrorsOf(state), [state, fieldErrorsOf]);
  // Read once, by react-hook-form, on the first render.
  const defaultValues = defaultValuesOf?.(state);
  const schemaForm = useSchemaForm({
    schema,
    send: formAction,
    sending,
    serverErrors,
    ...(defaultValues ? { defaultValues } : {}),
  });
  return { ...schemaForm, state, formAction };
}
