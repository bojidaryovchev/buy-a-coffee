// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHECK_EMAIL_MESSAGE, EMAIL_MESSAGES, type FormState } from "@/lib/forms/schemas";

/*
 * The newsletter band's check as the network delivers it: late, at a moment
 * the test picks, or not at all (`components/forms/newsletter-form.tsx`).
 *
 * Each test is a page load of its own (`vi.resetModules`): the form's module
 * remembers what it has fetched, and given up on, for as long as the page
 * lives. The enhancement's module is the real one behind a gate; the gate is
 * how long the network takes, and `offline` makes every fetch fail. Counting
 * the fetches is counting what a browser would request.
 */

const actions = vi.hoisted(() => ({ subscribeToNewsletter: vi.fn() }));
vi.mock("@/lib/forms/actions", () => actions);

const network = {
  fetches: 0,
  offline: false,
  arrived: Promise.resolve() as Promise<void>,
};

const loadForm = () => import("@/components/forms/newsletter-form");
let loaded: Awaited<ReturnType<typeof loadForm>>;

/* An answer a test holds back, settled after every test whatever happened:
   React keeps one async action pending at a time, and one left hanging would
   hold the next test's too. */
let release: (state: FormState) => void = () => {};

beforeEach(async () => {
  vi.resetModules();
  network.fetches = 0;
  network.offline = false;
  network.arrived = Promise.resolve();
  // Registered anew for each page load, so no fetch is remembered from the last.
  vi.doMock("@/components/forms/newsletter-enhancement", async (importOriginal) => {
    network.fetches += 1;
    if (network.offline) throw new Error("offline");
    await network.arrived;
    return importOriginal();
  });
  actions.subscribeToNewsletter.mockReset();
  actions.subscribeToNewsletter.mockResolvedValue({ status: "idle" });
  loaded = await loadForm();
});
afterEach(() => {
  release({ status: "idle" });
  release = () => {};
  cleanup();
  vi.unstubAllGlobals();
});

/** Hold the enhancement back until the returned function lets it through. */
function holdTheCheck(): () => Promise<void> {
  let arrive = () => {};
  network.arrived = new Promise<void>((resolve) => (arrive = resolve));
  return () => act(async () => arrive());
}

/** The band's form, with something focusable outside it. */
function drawForm() {
  render(
    createElement(
      "div",
      null,
      createElement("button", { type: "button" }, "Навън"),
      createElement(loaded.NewsletterForm, { source: "footer" }),
    ),
  );
}

const field = () => screen.getByLabelText("Имейл адрес") as HTMLInputElement;
const formOf = (element: Element) => element.closest("form") as HTMLFormElement;
const enhanced = () => formOf(field()).hasAttribute("data-enhanced");
/** The form as drawn, without the one attribute that tells the two apart. */
const drawn = () => formOf(field()).outerHTML.replace(' data-enhanced=""', "");
const outside = () => screen.getByRole("button", { name: "Навън" });

async function press() {
  await act(async () => {
    fireEvent.click(formOf(field()).querySelector('button[type="submit"]') as HTMLButtonElement);
  });
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
const FORGED_SOURCE: FormState = {
  status: "error",
  message: CHECK_EMAIL_MESSAGE,
  fieldErrors: { source: "Презаредете страницата и опитайте отново." },
};

describe("an answer on the screen when the check arrives", () => {
  it.each([
    ["a refused address", BAD_ADDRESS, EMAIL_MESSAGES.format],
    ["a refusal of the whole request", RATE_LIMITED, RATE_LIMITED.message],
    ["a refused hidden field", FORGED_SOURCE, CHECK_EMAIL_MESSAGE],
  ])("stays as it was, %s, and focus stays where it was put", async (_name, answer, line) => {
    const arrive = holdTheCheck();
    actions.subscribeToNewsletter.mockResolvedValue(answer);
    drawForm();
    const before = field();
    // Pressing touches the form, which asks for the check.
    fireEvent.pointerDown(before);
    fireEvent.change(before, { target: { value: "ivan@example" } });
    await press();
    await waitFor(() => expect(screen.getByText(line)).toBeTruthy());
    expect(network.fetches).toBe(1);
    expect(enhanced()).toBe(false);
    const shown = drawn();
    act(() => outside().focus());

    await arrive();
    await waitFor(() => expect(enhanced()).toBe(true));
    expect(drawn()).toBe(shown);
    expect(field()).toBe(before);
    expect(document.activeElement).toBe(outside());
  });

  it.each([
    ["the server's", "ivan@example", EMAIL_MESSAGES.format],
    ["the plain form's own", "ivan", EMAIL_MESSAGES.format],
  ])(
    "goes the moment the field is put right after it, if it was %s refusal",
    async (_whose, typed, message) => {
      const arrive = holdTheCheck();
      actions.subscribeToNewsletter.mockResolvedValue(BAD_ADDRESS);
      drawForm();
      fireEvent.pointerDown(field());
      fireEvent.change(field(), { target: { value: typed } });
      await press();
      await waitFor(() => expect(screen.getByText(message)).toBeTruthy());
      expect(enhanced()).toBe(false);
      const shown = drawn();

      await arrive();
      await waitFor(() => expect(enhanced()).toBe(true));
      // The takeover itself puts nothing right.
      expect(drawn()).toBe(shown);

      fireEvent.change(field(), { target: { value: "ivan@example.com" } });
      await waitFor(() => expect(field().getAttribute("aria-invalid")).toBeNull());
      expect(screen.queryByText(message)).toBeNull();
      expect(field().getAttribute("aria-describedby")).toBe(`${field().id}-consent`);
      // Put right in the browser: nothing more was sent.
      expect(actions.subscribeToNewsletter).toHaveBeenCalledTimes(typed === "ivan" ? 0 : 1);
    },
  );
});

describe("a check that cannot be fetched", () => {
  /** Let a failed fetch's rejection, and what it schedules, run. */
  async function settle() {
    await vi.dynamicImportSettled();
    for (let tick = 0; tick < 20; tick += 1) await Promise.resolve();
  }
  /** Every way the form asks for the check on first touch, at once. */
  function touchEveryWay() {
    fireEvent.keyDown(field(), { key: "a" });
    fireEvent.pointerDown(field());
    fireEvent.focusIn(field());
  }

  it("is asked for three times at most, after a wait and on focus only, and the plain form stays", async () => {
    const { MAX_ATTEMPTS, RETRY_AFTER_MS } = loaded;
    expect(MAX_ATTEMPTS).toBe(3);
    network.offline = true;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      drawForm();
      touchEveryWay();
      await settle();
      expect(network.fetches).toBe(1);

      // While it waits, nothing asks: not a key, a pointer, or focus.
      touchEveryWay();
      await settle();
      expect(network.fetches).toBe(1);

      vi.advanceTimersByTime(RETRY_AFTER_MS);
      // Then only focus does.
      fireEvent.keyDown(field(), { key: "a" });
      fireEvent.pointerDown(field());
      await settle();
      expect(network.fetches).toBe(1);
      fireEvent.focusIn(field());
      await settle();
      expect(network.fetches).toBe(2);

      // The second wait is twice the first.
      vi.advanceTimersByTime(RETRY_AFTER_MS);
      fireEvent.focusIn(field());
      await settle();
      expect(network.fetches).toBe(2);
      vi.advanceTimersByTime(RETRY_AFTER_MS);
      fireEvent.focusIn(field());
      await settle();
      expect(network.fetches).toBe(3);

      // And after the third, never again on this page.
      vi.advanceTimersByTime(60 * 60_000);
      touchEveryWay();
      await settle();
      expect(network.fetches).toBe(3);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }

    // The plain form goes on working.
    expect(enhanced()).toBe(false);
    actions.subscribeToNewsletter.mockResolvedValue({
      status: "success",
      message: "Благодарим ви. Вече сте в списъка.",
    });
    fireEvent.change(field(), { target: { value: "ivan@example.com" } });
    await press();
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Благодарим"));
    expect(actions.subscribeToNewsletter).toHaveBeenCalledTimes(1);
  });

  it("is fetched after a failure if it arrives on a later try", async () => {
    network.offline = true;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      drawForm();
      fireEvent.focusIn(field());
      await settle();
      vi.advanceTimersByTime(loaded.RETRY_AFTER_MS);
    } finally {
      // The takeover's own timer, from here on, is a real one.
      vi.useRealTimers();
    }
    network.offline = false;
    fireEvent.focusIn(field());
    await waitFor(() => expect(enhanced()).toBe(true));
    expect(network.fetches).toBe(2);
  });
});
