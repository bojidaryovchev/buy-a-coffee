// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHECK_EMAIL_MESSAGE,
  EMAIL_MESSAGES,
  newsletterSchema,
  toFieldErrors,
  type FormState,
} from "@/lib/forms/schemas";

/*
 * The newsletter band's form, which every page gets without its check: a
 * plain form until react-hook-form and zod are fetched and take it over
 * (`components/forms/newsletter-form.tsx`). What the takeover must not do —
 * replace the field, lose what was typed, move focus, change what is on the
 * screen, happen while a press is on its way — is checked here, on the
 * elements themselves; `newsletter-form-arrival.test.ts` picks the moment the
 * check arrives, or makes it never arrive, and `e2e/newsletter.spec.ts`
 * checks the same in a browser, with the network. The check itself, once in,
 * is `form-validation.test.ts`.
 */

const actions = vi.hoisted(() => ({ subscribeToNewsletter: vi.fn() }));
vi.mock("@/lib/forms/actions", () => actions);

const analytics = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("@/lib/analytics", () => analytics);

import { AnalyticsProvider } from "@/components/analytics-provider";
import { APPROACH_MARGIN, NewsletterForm, emailProblem } from "@/components/forms/newsletter-form";

/** An IntersectionObserver the test moves: jsdom has none, and nothing scrolls. */
class FakeObserver {
  static made: FakeObserver[] = [];
  targets: Element[] = [];
  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    FakeObserver.made.push(this);
  }
  observe(target: Element) {
    this.targets.push(target);
  }
  unobserve() {}
  disconnect() {
    this.targets = [];
  }
  takeRecords() {
    return [];
  }
  /** The form comes within the margin, or (with `false`) is reported outside it. */
  report(isIntersecting = true) {
    const entries = this.targets.map((target) => ({ target, isIntersecting }));
    this.callback(entries as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
  }
}

const RATE_LIMITED: FormState = {
  status: "error",
  message: "Твърде много опити. Моля, изчакайте малко и опитайте отново.",
};
const BAD_ADDRESS: FormState = {
  status: "error",
  message: CHECK_EMAIL_MESSAGE,
  fieldErrors: { email: EMAIL_MESSAGES.format },
  values: { email: "ivan@example" },
};
/* An answer a test holds back. Settled after every test whatever happened:
   React keeps one async action pending at a time across the whole page, and
   one left hanging would hold every later test's answer too. */
let release: (state: FormState) => void = () => {};

beforeEach(() => {
  FakeObserver.made = [];
  actions.subscribeToNewsletter.mockReset();
  actions.subscribeToNewsletter.mockResolvedValue({ status: "idle" });
  analytics.track.mockReset();
});
afterEach(() => {
  release({ status: "idle" });
  release = () => {};
  cleanup();
  vi.unstubAllGlobals();
});

/** The band's form, with something focusable outside it. */
function drawForm() {
  render(
    createElement(
      AnalyticsProvider,
      null,
      createElement("button", { type: "button" }, "Навън"),
      createElement(NewsletterForm, { source: "footer" }),
    ),
  );
}

const field = () => screen.getByLabelText("Имейл адрес") as HTMLInputElement;
const formOf = (element: Element) => element.closest("form") as HTMLFormElement;
const enhanced = () => formOf(field()).hasAttribute("data-enhanced");

/** The form's button, by what it is rather than what it says: its label changes while it sends. */
const button = () =>
  formOf(field()).querySelector<HTMLButtonElement>('button[type="submit"]') as HTMLButtonElement;

async function press() {
  await act(async () => {
    fireEvent.click(button());
  });
}

/** Long enough for the enhancement to be fetched and offered, had it been asked for. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)));

/** The FormData the action was called with: `(state, formData)`. */
const sent = (call = 0) => actions.subscribeToNewsletter.mock.calls[call]?.[1] as FormData;

describe("before the check is fetched", () => {
  it("is a plain form: the press goes to the server, whose answer lands under the field", async () => {
    actions.subscribeToNewsletter.mockResolvedValue(BAD_ADDRESS);
    drawForm();
    fireEvent.change(field(), { target: { value: "ivan@example" } });
    await press();

    expect(actions.subscribeToNewsletter).toHaveBeenCalledTimes(1);
    expect(Object.fromEntries(sent())).toMatchObject({
      email: "ivan@example",
      source: "footer",
      website: "",
    });
    await waitFor(() => expect(field().getAttribute("aria-invalid")).toBe("true"));
    expect(screen.getByText(EMAIL_MESSAGES.format).id).toBe(`${field().id}-error`);
    expect(field().getAttribute("aria-describedby")).toBe(
      `${field().id}-error ${field().id}-consent`,
    );
    expect(document.activeElement).toBe(field());
    expect(enhanced()).toBe(false);
  });

  it("refuses an empty or a plainly broken address itself, in the schema's words", async () => {
    drawForm();
    await press();
    expect(actions.subscribeToNewsletter).not.toHaveBeenCalled();
    expect(field().getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText(EMAIL_MESSAGES.missing).id).toBe(`${field().id}-error`);
    expect(document.activeElement).toBe(field());
    expect(enhanced()).toBe(false);

    // It re-checks as the field is corrected, as the check would.
    fireEvent.change(field(), { target: { value: "ivan" } });
    expect(screen.getByText(EMAIL_MESSAGES.format)).toBeTruthy();
    fireEvent.change(field(), { target: { value: "ivan@example.com" } });
    expect(field().getAttribute("aria-invalid")).toBeNull();
    expect(screen.queryByText(EMAIL_MESSAGES.format)).toBeNull();

    fireEvent.change(field(), { target: { value: "ivan@" } });
    await press();
    expect(screen.getByText(EMAIL_MESSAGES.format)).toBeTruthy();
    expect(actions.subscribeToNewsletter).not.toHaveBeenCalled();
  });

  it("says what the schema says of anything it refuses, so the two cannot differ", () => {
    for (const value of ["", "   ", "ivan", "ivan@", "@example.com", `${"x".repeat(300)}`]) {
      const parsed = newsletterSchema.safeParse({ email: value });
      expect(parsed.success, value).toBe(false);
      expect(emailProblem(value), value).toBe(toFieldErrors(parsed.error!).email);
    }
    // What it lets through, the server and the check judge in full.
    expect(emailProblem("ivan@example")).toBeUndefined();
  });

  it("clears an old answer from under the field while a press is on its way", async () => {
    actions.subscribeToNewsletter.mockResolvedValueOnce(BAD_ADDRESS);
    drawForm();
    fireEvent.change(field(), { target: { value: "ivan@example" } });
    await press();
    await waitFor(() => expect(screen.getByText(EMAIL_MESSAGES.format)).toBeTruthy());

    actions.subscribeToNewsletter.mockImplementation(
      () => new Promise<FormState>((resolve) => (release = resolve)),
    );
    fireEvent.change(field(), { target: { value: "ivan@example.com" } });
    await press();
    expect(button().disabled).toBe(true);
    expect(screen.queryByText(EMAIL_MESSAGES.format)).toBeNull();
    expect(field().getAttribute("aria-invalid")).toBeNull();

    await act(async () => release(RATE_LIMITED));
    await waitFor(() => expect(screen.getByText(RATE_LIMITED.message)).toBeTruthy());
  });

  it("is not fetched while the form is far from the screen and untouched", async () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    drawForm();
    // The page has loaded (jsdom's has); nearness is watched after a pause.
    await waitFor(() => expect(FakeObserver.made).toHaveLength(1));
    const [observer] = FakeObserver.made;
    expect(observer?.targets).toEqual([formOf(field())]);
    expect(observer?.options?.rootMargin).toBe(APPROACH_MARGIN);

    observer?.report(false);
    await settle();
    expect(enhanced()).toBe(false);

    observer?.report(true);
    await waitFor(() => expect(enhanced()).toBe(true));
    // Asked once: the observer is done with.
    expect(observer?.targets).toEqual([]);
  });

  it("watches for the band nearing only once the page has loaded, and is fetched on a touch before", async () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const readyState = vi.spyOn(document, "readyState", "get").mockReturnValue("interactive");
    try {
      drawForm();
      await settle();
      await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
      expect(FakeObserver.made).toHaveLength(0);

      readyState.mockReturnValue("complete");
      act(() => void window.dispatchEvent(new Event("load")));
      await waitFor(() => expect(FakeObserver.made).toHaveLength(1));
      expect(enhanced()).toBe(false);
    } finally {
      readyState.mockRestore();
    }
    cleanup();
    FakeObserver.made = [];

    // A touch does not wait for the load.
    const loading = vi.spyOn(document, "readyState", "get").mockReturnValue("interactive");
    try {
      drawForm();
      fireEvent.focusIn(field());
      await waitFor(() => expect(enhanced()).toBe(true));
      expect(FakeObserver.made).toHaveLength(0);
    } finally {
      loading.mockRestore();
    }
  });

  it.each([
    ["focus", (element: Element) => fireEvent.focusIn(element)],
    ["a pointer", (element: Element) => fireEvent.pointerDown(element)],
    ["a key", (element: Element) => fireEvent.keyDown(element, { key: "a" })],
  ])("is fetched on the first %s in the form", async (_name, touch) => {
    drawForm();
    await settle();
    expect(enhanced()).toBe(false);
    touch(field());
    await waitFor(() => expect(enhanced()).toBe(true));
  });
});

describe("the takeover", () => {
  it("keeps the very field, with what was typed and the focus, and then checks it", async () => {
    drawForm();
    const before = field();
    // Focus fetches the check; the typing happens before it takes over.
    act(() => before.focus());
    fireEvent.change(before, { target: { value: "ivan@exa" } });
    expect(enhanced()).toBe(false);

    await waitFor(() => expect(enhanced()).toBe(true));
    // Not a copy put back: the same element, so its caret was never touched.
    expect(field()).toBe(before);
    expect(document.activeElement).toBe(before);
    expect(before.value).toBe("ivan@exa");

    // The address is checked in the browser now, and nothing is sent.
    await press();
    expect(field().getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText(EMAIL_MESSAGES.format)).toBeTruthy();
    expect(actions.subscribeToNewsletter).not.toHaveBeenCalled();

    fireEvent.change(before, { target: { value: "ivan@example.com" } });
    await press();
    await waitFor(() => expect(actions.subscribeToNewsletter).toHaveBeenCalledTimes(1));
    expect(sent().get("email")).toBe("ivan@example.com");
    expect(sent().get("source")).toBe("footer");
  });

  it("waits while a press of the plain form is on its way", async () => {
    actions.subscribeToNewsletter.mockImplementation(
      () => new Promise<FormState>((resolve) => (release = resolve)),
    );
    drawForm();
    fireEvent.change(field(), { target: { value: "ivan@example.com" } });
    await press();
    expect(button().disabled).toBe(true);
    expect(button().getAttribute("aria-busy")).toBe("true");

    fireEvent.focusIn(field());
    await settle();
    expect(enhanced()).toBe(false);

    await act(async () => release(RATE_LIMITED));
    await waitFor(() => expect(enhanced()).toBe(true));
    expect(screen.getByText(RATE_LIMITED.message)).toBeTruthy();
    expect(actions.subscribeToNewsletter).toHaveBeenCalledTimes(1);
  });

  /* The takeover runs in a timer of its own and commits in it (`flushSync`):
     without that the swap would be only scheduled, and an Enter in the gap
     would go to the plain form. Here nothing but the timer runs: no act(),
     which would render whatever is scheduled, and React told it is not in a
     test, so it schedules as it does in a browser. */
  it("commits within its own timer's task, so a press right after it is the check's", async () => {
    const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    drawForm();
    // Passes the plain form's check; the schema refuses it.
    fireEvent.change(field(), { target: { value: "ivan@example" } });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      fireEvent.focusIn(field());
      await vi.dynamicImportSettled();
      for (let tick = 0; tick < 100 && vi.getTimerCount() === 0; tick += 1) await Promise.resolve();
      expect(vi.getTimerCount()).toBe(1);
      expect(enhanced()).toBe(false);

      vi.runOnlyPendingTimers();
      expect(enhanced()).toBe(true);
      fireEvent.submit(formOf(field()));
    } finally {
      vi.useRealTimers();
      actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    }
    await waitFor(() => expect(field().getAttribute("aria-invalid")).toBe("true"));
    expect(screen.getByText(EMAIL_MESSAGES.format)).toBeTruthy();
    expect(actions.subscribeToNewsletter).not.toHaveBeenCalled();
  });

  it("does not happen after a success: there is no form left to take over", async () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    actions.subscribeToNewsletter.mockResolvedValue({
      status: "success",
      message: "Благодарим ви. Вече сте в списъка.",
    });
    drawForm();
    fireEvent.change(field(), { target: { value: "ivan@example.com" } });
    await press();
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Благодарим"));

    await waitFor(() => expect(FakeObserver.made).toHaveLength(1));
    FakeObserver.made[0]!.report();
    await settle();
    expect(screen.queryByRole("form")).toBeNull();
    expect(screen.queryByLabelText("Имейл адрес")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Благодарим");
  });
});

describe("newsletter_submitted", () => {
  it("records each answer once, whichever form reached the server", async () => {
    actions.subscribeToNewsletter.mockResolvedValueOnce(BAD_ADDRESS);
    drawForm();
    fireEvent.change(field(), { target: { value: "ivan@example" } });
    await press();
    await waitFor(() => expect(analytics.track).toHaveBeenCalledTimes(1));
    expect(analytics.track).toHaveBeenLastCalledWith({
      name: "newsletter_submitted",
      outcome: "error",
    });

    fireEvent.focusIn(field());
    await waitFor(() => expect(enhanced()).toBe(true));
    // The takeover is not an answer.
    expect(analytics.track).toHaveBeenCalledTimes(1);

    actions.subscribeToNewsletter.mockResolvedValueOnce({
      status: "success",
      message: "Благодарим ви. Вече сте в списъка.",
    });
    fireEvent.change(field(), { target: { value: "ivan@example.com" } });
    await press();
    await waitFor(() => expect(analytics.track).toHaveBeenCalledTimes(2));
    expect(analytics.track).toHaveBeenLastCalledWith({
      name: "newsletter_submitted",
      outcome: "success",
    });
  });
});
