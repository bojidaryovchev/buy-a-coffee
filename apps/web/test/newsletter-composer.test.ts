// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveIntent } from "@/lib/newsletter/schemas";

/**
 * The composer's three buttons, in the browser: the action must learn which
 * one was pressed, or a press of "send" (or "test") is quietly read as
 * "save". With a modern browser the pressed button is in the form data; with
 * an older Safari it is not, and the hidden `intentChosen` field carries it.
 * Both paths are driven here, through the real component and the real
 * `useSchemaForm`, to the action's `FormData`.
 */

const actions = vi.hoisted(() => ({ submitNewsletter: vi.fn(async () => ({})) }));
vi.mock("@/lib/newsletter/actions", () => actions);
vi.mock("@vercel/blob/client", () => ({ upload: vi.fn() }));

const { NewsletterComposer } = await import("@/components/admin/newsletter-composer");

const campaign = {
  id: "6f1c2b9e-3a47-4d8e-9b1a-2c3d4e5f6a7b",
  version: "4",
  subject: "Новите кафета",
  preheader: "",
  body: "Здравейте,\n\nНови кафета.",
  attachments: [],
};

function draw() {
  render(
    createElement(NewsletterComposer, {
      campaign,
      activeCount: 3,
      sender: "Buy a Coffee <info@buy-a-coffee.com>",
      testRecipient: "owner@example.org",
      canSend: true,
      canUpload: false,
    }),
  );
}

/** The form data the action was last called with. */
async function sent(): Promise<FormData> {
  await waitFor(() => expect(actions.submitNewsletter).toHaveBeenCalled());
  const calls = actions.submitNewsletter.mock.calls as unknown as [unknown, FormData][];
  return calls.at(-1)![1];
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("<html></html>", { status: 200 })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("which button the action is told about", () => {
  it("is the pressed one, as the browser posts it", async () => {
    draw();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Изпрати пробно" }));
    });
    const data = await sent();
    expect(resolveIntent(data)).toBe("test");
    expect(data.get("version")).toBe(campaign.version);
  });

  it("is still the pressed one when the browser leaves the button out (old Safari)", async () => {
    /* Safari before 15.4 reports no submitter at all, and before 16.4 leaves
       it out of the form data. Simulated here as both: the click runs its
       handler but submits nothing, and a bare submit event follows. */
    draw();
    const button = screen.getByRole("button", { name: "Изпрати пробно" });
    button.addEventListener("click", (event) => event.preventDefault(), { capture: true });
    const form = button.closest("form")!;
    await act(async () => {
      fireEvent.click(button);
    });
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    const data = await sent();
    expect(data.get("intent")).toBeNull();
    expect(data.get("intentChosen")).toBe("test");
    expect(resolveIntent(data)).toBe("test");
  });

  it("is save when nothing else was pressed", async () => {
    draw();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Запази черновата" }));
    });
    expect(resolveIntent(await sent())).toBe("save");
  });
});
