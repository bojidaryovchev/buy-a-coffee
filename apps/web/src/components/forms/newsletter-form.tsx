"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ChangeEvent,
  type ComponentType,
  type FormEvent,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";
import { useAnalytics } from "@/components/analytics-provider";
import type { NewsletterEnhancementProps } from "@/components/forms/newsletter-enhancement";
import { NewsletterView, type NewsletterBehaviour } from "@/components/forms/newsletter-view";
import { subscribeToNewsletter } from "@/lib/forms/actions";
import { EMAIL_MESSAGES, IDLE_FORM_STATE, type FormState } from "@/lib/forms/form-state";

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
 *   - Until then the form is the plain one, driven from here. A press with
 *     the field empty or plainly not an address is refused here, in the
 *     schema's words (`emailProblem`); any other is sent to the action as the
 *     browser would have posted it, and the server's answer is drawn where
 *     the browser's would be. The server checks every address anyway.
 *   - The check is fetched when, the page loaded, the band comes within a
 *     screen and a half of the viewport, or the form is first touched —
 *     focus, a pointer, a key — whichever is first (`useEnhancement`), and
 *     then takes the form over
 *     (`newsletter-enhancement.tsx`) between two things the person does,
 *     never while a press is on its way. If it cannot be fetched, the plain
 *     form stays.
 *
 * The takeover redraws nothing. Both forms draw through one view
 * (`newsletter-view.tsx`), rendered here, at the same place in the tree; the
 * enhancement only hands it different handlers. The field someone is typing
 * in stays the same element, so its text, its focus and its caret are simply
 * not touched — an email field has no selection API, so a caret could not be
 * put back if it were lost — and nothing on the page moves. The answer state
 * is this component's, so an answer already on the screen is still the one
 * shown after, and `newsletter_submitted` fires from here, whichever form
 * reached the server. A refusal on the screen at the takeover clears, from
 * then on, the moment the field is put right, as one would after a press of
 * the enhanced form.
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

  /* The plain form's own refusal of its last press, and the answer that press
     put out of date: from then on the server's last answer is not what is on
     the screen, and it must not come back when the refusal is put right. A
     new answer replaces both. */
  const [refusal, setRefusal] = useState<{
    message: string | undefined;
    over: FormState;
  } | null>(null);
  const ownRefusal = refusal !== null && refusal.over === state ? refusal : null;
  /** The answer on the screen. */
  const shown = ownRefusal ? IDLE_FORM_STATE : state;

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
    emailFieldOf(form.current)?.focus();
  }, [state, plain]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current || pending) return;
    const element = event.currentTarget;
    const field = emailFieldOf(element);
    const problem = emailProblem(field?.value ?? "");
    if (problem) {
      setRefusal({ message: problem, over: state });
      field?.focus();
      return;
    }
    setRefusal(null);
    inFlight.current = true;
    // What the browser would have posted, honeypot and hidden fields included.
    const formData = new FormData(element);
    startTransition(() => formAction(formData));
  };

  // After its own refusal, the field re-checks as it is corrected.
  const recheck = (event: ChangeEvent<HTMLInputElement>) => {
    const message = emailProblem(event.currentTarget.value);
    setRefusal((current) => current && { ...current, message });
  };

  const behaviour: NewsletterBehaviour = enhanced ?? {
    enhanced: false,
    onSubmit,
    emailField: ownRefusal ? { name: "email", onChange: recheck } : { name: "email" },
    sourceField: { name: "source" },
    pending,
    // Nothing old under the field while a press is on its way.
    ...(pending
      ? { emailError: undefined, formMessage: undefined }
      : ownRefusal
        ? { emailError: ownRefusal.message, formMessage: undefined }
        : answerLines(state)),
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
          state={shown}
          formAction={formAction}
          sending={sending}
          source={source}
          pressed={ownRefusal !== null || state.status === "error"}
          refused={ownRefusal?.message}
          onBehaviour={setEnhanced}
        />
      ) : null}
    </>
  );
}

const emailFieldOf = (form: HTMLFormElement | null) => {
  const field = form?.elements.namedItem("email");
  return field instanceof HTMLInputElement ? field : null;
};

/**
 * The plain form's own check, without zod: an address is there, not too long,
 * and has something on each side of an „@“. That spares an empty or plainly
 * broken address a trip to the server, and one of the few tries an hour the
 * server allows. Each refusal is the one `newsletterSchema` makes of the same
 * value, in its words (`EMAIL_MESSAGES`, which the schema uses too); what this
 * lets through, the server checks in full, as the enhanced form does.
 */
export function emailProblem(value: string): string | undefined {
  const address = value.trim();
  if (address === "") return EMAIL_MESSAGES.missing;
  if (address.length > 254) return EMAIL_MESSAGES.long;
  const at = address.indexOf("@");
  if (at < 1 || at === address.length - 1) return EMAIL_MESSAGES.format;
  return undefined;
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

/**
 * Fetches of the enhancement a page load makes at most. After that many
 * failures the plain form stays in charge, which it can be for good.
 */
export const MAX_ATTEMPTS = 3;
/** The wait before the second fetch; the third waits twice as long. */
export const RETRY_AFTER_MS = 2_000;

let enhancement: Promise<Enhancement> | undefined;
let attempts = 0;

/**
 * The enhancement's module, fetched once per page load whichever trigger
 * asks first. A failed fetch is forgotten, so a later one may ask again, up
 * to `MAX_ATTEMPTS` in all.
 */
function loadEnhancement(): Promise<Enhancement> {
  if (!enhancement) {
    attempts += 1;
    enhancement = import("@/components/forms/newsletter-enhancement").then(
      (module) => module.NewsletterEnhancement,
      (error: unknown) => {
        enhancement = undefined;
        throw error;
      },
    );
  }
  return enhancement;
}

const FIRST_TOUCH = ["focusin", "pointerdown", "keydown"] as const;

/**
 * Run `then` once the page has loaded and the main thread has had an idle
 * moment, as the scroll-driven motion waits (`motion-gate.tsx`, DESIGN.md,
 * "The Quiet Load Rule"). Returns what calls it off.
 */
function afterQuietLoad(then: () => void): () => void {
  let idle: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (typeof window.requestIdleCallback === "function") {
      idle = window.requestIdleCallback(then, { timeout: 2000 });
    } else {
      timer = setTimeout(then, 200);
    }
  };
  if (document.readyState === "complete") schedule();
  else window.addEventListener("load", schedule, { once: true });
  return () => {
    window.removeEventListener("load", schedule);
    if (idle !== undefined) window.cancelIdleCallback(idle);
    clearTimeout(timer);
  };
}

/**
 * Fetch the enhancement when it is about to be needed, and hand it over when
 * it is safe to.
 *
 * Needed: the form comes within `APPROACH_MARGIN` of the viewport, or it gets
 * focus, a pointer or a key — and if focus got there before the page's script
 * did, at once. Nearness is watched only once the page has loaded and had an
 * idle moment (`afterQuietLoad`): on a short page the band is near from the
 * start, and its check must not be fetched while the page itself still is. A
 * touch does not wait. A band hidden on its page (`NewsletterBandOff`) never
 * comes near, and is never touched, so there it is never fetched. A failed fetch is
 * asked again only by focus coming to the form, after `RETRY_AFTER_MS` (then
 * twice that), and not after `MAX_ATTEMPTS`: offline, a person typing would
 * otherwise ask with every key.
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
    let backoff: ReturnType<typeof setTimeout> | undefined;
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
        () => {
          if (!live || attempts >= MAX_ATTEMPTS) return;
          backoff = setTimeout(() => arm(["focusin"], false), RETRY_AFTER_MS * 2 ** (attempts - 1));
        },
      );
    };

    const arm = (events: readonly string[], nearing: boolean) => {
      const listening = new AbortController();
      for (const type of events) element.addEventListener(type, load, { signal: listening.signal });
      let observer: IntersectionObserver | undefined;
      const watchNearing = () => {
        if (typeof IntersectionObserver !== "function") return;
        observer = new IntersectionObserver(
          (entries) => {
            if (entries.some((entry) => entry.isIntersecting)) load();
          },
          { rootMargin: APPROACH_MARGIN },
        );
        observer.observe(element);
      };
      const stopWaiting = nearing ? afterQuietLoad(watchNearing) : () => {};
      disarm = () => {
        listening.abort();
        stopWaiting();
        observer?.disconnect();
      };
    };

    // A page load that has given up on it leaves the plain form in charge.
    const givenUp = attempts >= MAX_ATTEMPTS && !enhancement;
    if (!givenUp && element.contains(document.activeElement)) load();
    else if (!givenUp) arm(FIRST_TOUCH, true);

    return () => {
      live = false;
      clearTimeout(timer);
      clearTimeout(backoff);
      disarm();
      retryRef.current = () => {};
    };
  }, [form, canTakeOver]);

  const retry = useCallback(() => retryRef.current(), []);
  return { Enhancement, retry };
}
