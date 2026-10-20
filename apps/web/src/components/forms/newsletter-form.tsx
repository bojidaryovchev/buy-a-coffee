"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ComponentType,
  type FormEvent,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";
import { useAnalytics } from "@/components/analytics-provider";
import type { NewsletterEnhancementProps } from "@/components/forms/newsletter-enhancement";
import { NewsletterView, type NewsletterBehaviour } from "@/components/forms/newsletter-view";
import { subscribeToNewsletter } from "@/lib/forms/actions";
import { IDLE_FORM_STATE, type FormState } from "@/lib/forms/form-state";

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
 * under the field. With the script, the same schema checks it in the browser
 * when the button is pressed, and nothing is sent until it passes
 * (`use-schema-form.ts`), as on every form of the site.
 *
 * That check is react-hook-form and zod, and the band is on almost every page,
 * below the fold. Loaded with the page, they were in every page's first
 * script, which a phone downloads before it can paint. So the page gets this
 * module, which knows no zod, and the check comes later, in two steps:
 *
 *   - Until then the form is the plain one, driven from here: a press sends
 *     the form to the action as the browser would have posted it, and the
 *     server's answer is drawn where the browser's would be. Nothing is lost
 *     by pressing early; the server checks every address anyway.
 *   - The check is fetched when the band comes within a screen and a half of
 *     the viewport, or the form is first touched — focus, a pointer, a key —
 *     whichever is first (`useEnhancement`), and then takes the form over
 *     (`newsletter-enhancement.tsx`) between two things the person does,
 *     never while a press is on its way.
 *
 * The takeover redraws nothing. Both forms draw through one view
 * (`newsletter-view.tsx`), rendered here, at the same place in the tree; the
 * enhancement only hands it different handlers. The field someone is typing
 * in stays the same element, so its text, its focus and its caret are simply
 * not touched — an email field has no selection API, so a caret could not be
 * put back if it were lost — and nothing on the page moves. The answer state
 * is this component's, so an answer already on the screen is still the one
 * shown after, and `newsletter_submitted` fires from here, whichever form
 * reached the server.
 */
export function NewsletterForm({ source }: { source: string }) {
  const [state, formAction, sending] = useActionState(subscribeToNewsletter, IDLE_FORM_STATE);
  const analytics = useAnalytics();

  useEffect(() => {
    if (state.status === "success") {
      analytics.track({ name: "newsletter_submitted", outcome: "success" });
    } else if (state.status === "error") {
      analytics.track({ name: "newsletter_submitted", outcome: "error" });
    }
  }, [state, analytics]);

  const form = useRef<HTMLFormElement | null>(null);
  const [transitionPending, startTransition] = useTransition();
  const pending = sending || transitionPending;
  /* Set on the press, before the transition has rendered, and cleared when the
     answer is in: a double press sends once, and the takeover waits. */
  const inFlight = useRef(false);
  const canTakeOver = useCallback(() => !inFlight.current, []);
  const { Enhancement, retry } = useEnhancement(form, canTakeOver);
  const [enhanced, setEnhanced] = useState<NewsletterBehaviour | null>(null);
  const plain = enhanced === null;

  // The answer is in: the next press may send, and a held takeover may go.
  useEffect(() => {
    if (pending) return;
    inFlight.current = false;
    retry();
  }, [pending, state, retry]);

  /* The plain form's half of what `useSchemaForm` does with an answer: focus
     goes to the field the server refused. Also on the first render, for a
     page drawn from a refusal posted before the script ran. */
  useEffect(() => {
    if (!plain || state.status !== "error" || !state.fieldErrors?.email) return;
    const field = form.current?.elements.namedItem("email");
    if (field instanceof HTMLInputElement) field.focus();
  }, [state, plain]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current || pending) return;
    inFlight.current = true;
    // What the browser would have posted, honeypot and hidden fields included.
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  };

  const behaviour: NewsletterBehaviour = enhanced ?? {
    enhanced: false,
    onSubmit,
    emailField: { name: "email" },
    sourceField: { name: "source" },
    pending,
    ...answerLines(state),
  };

  /* The `<form>` is this component's, for the triggers, and after the
     takeover the enhancement's too, which moves focus with it. */
  const enhancedForm = enhanced?.formRef;
  const formRef = useCallback(
    (node: HTMLFormElement | null) => {
      form.current = node;
      if (enhancedForm) enhancedForm.current = node;
    },
    [enhancedForm],
  );

  return (
    <>
      <NewsletterView
        source={source}
        state={state}
        formAction={formAction}
        formRef={formRef}
        behaviour={behaviour}
      />
      {Enhancement ? (
        <Enhancement
          state={state}
          formAction={formAction}
          sending={sending}
          source={source}
          onBehaviour={setEnhanced}
        />
      ) : null}
    </>
  );
}

/**
 * The server's answer as the plain form shows it: exactly what
 * `useSchemaForm` draws from the same answer on its first render (the
 * field's message, else the form's line), so that the takeover changes
 * nothing on the screen.
 */
export function answerLines(
  state: FormState,
): Pick<NewsletterBehaviour, "emailError" | "formMessage"> {
  if (state.status !== "error") return { emailError: undefined, formMessage: undefined };
  const { fieldErrors } = state;
  const fieldsRefused = fieldErrors !== undefined && Object.keys(fieldErrors).length > 0;
  return {
    emailError: fieldErrors?.email,
    formMessage: fieldErrors && !fieldsRefused ? undefined : state.message,
  };
}

type Enhancement = ComponentType<NewsletterEnhancementProps>;

/**
 * How far from the viewport the band starts fetching the check: a screen and
 * a half above or below. Generous on purpose: a flick on a phone covers a
 * screen in a fraction of a second, and the check (some 25 KB with brotli)
 * should be in before the form is reached, not after it is touched.
 */
export const APPROACH_MARGIN = "150% 0px";

let enhancement: Promise<Enhancement> | undefined;

/**
 * The enhancement's module, fetched once per page load whichever trigger
 * asks first. A failed fetch is forgotten, so a later touch asks again; the
 * plain form works meanwhile.
 */
function loadEnhancement(): Promise<Enhancement> {
  enhancement ??= import("@/components/forms/newsletter-enhancement").then(
    (module) => module.NewsletterEnhancement,
    (error: unknown) => {
      enhancement = undefined;
      throw error;
    },
  );
  return enhancement;
}

/**
 * Fetch the enhancement when it is about to be needed, and hand it over when
 * it is safe to.
 *
 * Needed: the form comes within `APPROACH_MARGIN` of the viewport, or it gets
 * focus, a pointer or a key — and if focus got there before the page's script
 * did, at once. A band hidden on its page (`NewsletterBandOff`) never comes
 * near, and is never touched, so there it is never fetched.
 *
 * Safe: in a task of its own, never inside the event that asked for it — an
 * Enter that is about to submit the form finishes first — and not while a
 * press of the plain form is on its way (`canTakeOver`); `retry` is called
 * again when the answer is in. The check and the swap run in one synchronous
 * stretch (`flushSync`), so nothing the person does can come between them.
 */
function useEnhancement(
  form: RefObject<HTMLFormElement | null>,
  canTakeOver: () => boolean,
): { Enhancement: Enhancement | null; retry: () => void } {
  const [Enhancement, setEnhancement] = useState<Enhancement | null>(null);
  const retryRef = useRef(() => {});

  useEffect(() => {
    const element = form.current;
    if (!element) return;
    let live = true;
    let loaded: Enhancement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disarm = () => {};

    const takeOver = () => {
      timer = undefined;
      // Gone means it was answered with success: nothing left to take over.
      if (!live || !loaded || !element.isConnected || !canTakeOver()) return;
      const component = loaded;
      loaded = null;
      flushSync(() => setEnhancement(() => component));
    };
    retryRef.current = () => {
      if (live && loaded && timer === undefined) timer = setTimeout(takeOver, 0);
    };

    const load = () => {
      disarm();
      loadEnhancement().then(
        (component) => {
          loaded = component;
          retryRef.current();
        },
        // Not the viewport again: offline, that would ask on every frame.
        () => live && arm(false),
      );
    };

    const arm = (nearing: boolean) => {
      const events = new AbortController();
      for (const type of ["focusin", "pointerdown", "keydown"] as const) {
        element.addEventListener(type, load, { signal: events.signal });
      }
      const observer =
        nearing && typeof IntersectionObserver === "function"
          ? new IntersectionObserver(
              (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) load();
              },
              { rootMargin: APPROACH_MARGIN },
            )
          : undefined;
      observer?.observe(element);
      disarm = () => {
        events.abort();
        observer?.disconnect();
      };
    };

    if (element.contains(document.activeElement)) load();
    else arm(true);

    return () => {
      live = false;
      clearTimeout(timer);
      disarm();
      retryRef.current = () => {};
    };
  }, [form, canTakeOver]);

  const retry = useCallback(() => retryRef.current(), []);
  return { Enhancement, retry };
}
