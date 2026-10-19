// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { insertBlockLine } from "@/components/admin/newsletter-edits";
import type { PickerProduct } from "@/lib/newsletter/picker";
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

function draw(overrides: Partial<typeof campaign> = {}) {
  render(
    createElement(NewsletterComposer, {
      campaign: { ...campaign, ...overrides },
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

/**
 * The two routes the composer fetches from: the preview (the letter, and what
 * its product blocks resolved to; or a failure) and the product search.
 */
let previewBlocks: unknown[] = [];
let previewFails = false;
let searchResults: PickerProduct[] = [];
const fetched: { url: string; signal: AbortSignal | null }[] = [];

beforeEach(() => {
  previewBlocks = [];
  previewFails = false;
  searchResults = [];
  fetched.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      fetched.push({ url: String(input), signal: init?.signal ?? null });
      if (String(input).startsWith("/api/admin/newsletter/products")) {
        return Response.json({ products: searchResults });
      }
      if (previewFails)
        return new Response("Продуктите не можаха да бъдат прочетени", { status: 503 });
      return Response.json({ html: "<html></html>", blocks: previewBlocks });
    }),
  );
});

const bodyField = () => screen.getByRole("textbox", { name: "Текст" }) as HTMLTextAreaElement;

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

describe("putting products in the text", () => {
  it("writes a block line where the cursor is, on a line of its own", () => {
    const text = "Здравейте,\nново кафе.";
    const at = "Здравейте,".length;
    expect(insertBlockLine("[[промоции]]")(text, at, at)).toEqual({
      text: "Здравейте,\n\n[[промоции]]\n\nново кафе.",
      selectionStart: "Здравейте,\n\n[[промоции]]\n\n".length,
      selectionEnd: "Здравейте,\n\n[[промоции]]\n\n".length,
    });
    expect(insertBlockLine("[[промоции]]")("", 0, 0).text).toBe("[[промоции]]\n\n");
    expect(insertBlockLine("[[промоции]]")("Текст\n\n", 7, 7).text).toBe(
      "Текст\n\n[[промоции]]\n\n",
    );
    // A selection is replaced.
    expect(insertBlockLine("[[промоции]]")("а ТОВА б", 2, 6).text).toBe("а\n\n[[промоции]]\n\nб");
  });

  it("puts the reductions in with one press", async () => {
    draw({ body: "Здравейте,\n\nДо скоро." });
    const field = bodyField();
    field.setSelectionRange("Здравейте,".length, "Здравейте,".length);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Промоции" }));
    });
    expect(field.value).toBe("Здравейте,\n\n[[промоции]]\n\nДо скоро.");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Нови продукти" }));
    });
    expect(field.value).toContain("[[нови-продукти]]");
  });

  it("finds products, takes the ones chosen in order, and writes them as one line", async () => {
    searchResults = [
      {
        slug: "lavazza-oro-1kg",
        title: "Lavazza Qualità Oro",
        detail: "Кафе на зърна, 1 кг",
        price: "27,90 €",
        oldPrice: null,
        image: null,
        soldOut: false,
      },
      {
        slug: "lavazza-rossa-1kg",
        title: "Lavazza Qualità Rossa",
        detail: "Кафе на зърна, 1 кг",
        price: "19,90 €",
        oldPrice: "22,90 €",
        image: null,
        soldOut: false,
      },
    ];
    draw({ body: "" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Продукти…" }));
    });
    const search = screen.getByRole("searchbox", { name: "Търсене" });
    await act(async () => {
      fireEvent.change(search, { target: { value: "lavazza" } });
    });
    await waitFor(() =>
      expect(fetched.map((call) => call.url)).toContain("/api/admin/newsletter/products?q=lavazza"),
    );
    await screen.findByText("Lavazza Qualità Rossa");
    expect(screen.getByText("22,90 €")).toBeTruthy();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Избери: Lavazza Qualità Rossa, Кафе на зърна, 1 кг" }),
      );
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Избери: Lavazza Qualità Oro, Кафе на зърна, 1 кг" }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Вмъкни 2 продукта" }));
    });
    expect(bodyField().value).toBe("[[продукти: lavazza-rossa-1kg, lavazza-oro-1kg]]\n\n");
    expect(screen.queryByRole("searchbox", { name: "Търсене" })).toBeNull();
  });

  it("asks the search route, not an action, and drops the request for a term it has moved on from", async () => {
    draw({ body: "" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Продукти…" }));
    });
    const search = screen.getByRole("searchbox", { name: "Търсене" });
    await act(async () => {
      fireEvent.change(search, { target: { value: "lav" } });
    });
    await waitFor(() => expect(fetched.some((call) => call.url.endsWith("?q=lav"))).toBe(true));
    const first = fetched.find((call) => call.url.endsWith("?q=lav"))!;
    await act(async () => {
      fireEvent.change(search, { target: { value: "lavazza" } });
    });
    expect(first.signal?.aborted).toBe(true);
    // Nothing waits on the form's action while it searches.
    expect(actions.submitNewsletter).not.toHaveBeenCalled();
  });
});

describe("before sending", () => {
  it("says what may send the letter to spam, and says it again in the confirmation", async () => {
    draw({ body: "Голямо намаление!\n\n[[промоции]]", preheader: "" });
    previewBlocks = [{ token: "[[промоции]]", kind: "sale", products: [], missing: [] }];
    const panel = screen.getByRole("region", { name: "Преди изпращане" });
    expect(panel.textContent).toContain("Малко текст");
    expect(panel.textContent).toContain("Няма въведение");

    // The preview answers: the reductions block is empty.
    await waitFor(() => expect(panel.textContent).toContain("Блокът [[промоции]] е празен"), {
      timeout: 2000,
    });
    expect(panel.textContent).toContain("няма продукти с намалена цена");

    const confirmation = screen.getByText(/^Преди да изпратите:/);
    expect(confirmation.textContent).toContain("3 забележки");
    // Advice: the send button is still there to press.
    expect(
      (screen.getByRole("button", { name: "Да, изпрати до 3", hidden: true }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("forgets what the products resolved to when a preview fails, rather than speak from an old one", async () => {
    previewBlocks = [{ token: "[[промоции]]", kind: "sale", products: [], missing: [] }];
    draw({ body: "Голямо намаление!\n\n[[промоции]]" });
    const panel = screen.getByRole("region", { name: "Преди изпращане" });
    await waitFor(() => expect(panel.textContent).toContain("Блокът [[промоции]] е празен"), {
      timeout: 2000,
    });

    previewFails = true;
    await act(async () => {
      fireEvent.change(bodyField(), { target: { value: "Голямо намаление!\n\n[[промоции: 2]]" } });
    });
    await screen.findByText(/Прегледът не можа да се обнови/, undefined, { timeout: 2000 });
    expect(panel.textContent).not.toContain("е празен");
  });

  it("lists two identical block lines as two notes, without a key warning", async () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => undefined);
    draw({ body: "Текст\n\n[[промоций]]\n\n[[промоций]]" });
    const panel = screen.getByRole("region", { name: "Преди изпращане" });
    expect(panel.textContent?.match(/Блокът \[\[промоций\]\] не е разпознат/g)).toHaveLength(2);
    expect(warn.mock.calls.flat().join(" ")).not.toMatch(/same key/);
    warn.mockRestore();
  });

  it("says there is nothing to worry about when there is not", () => {
    draw({
      preheader: "Три нови марки на зърна.",
      body: "Здравейте! ".repeat(30),
    });
    const panel = screen.getByRole("region", { name: "Преди изпращане" });
    expect(panel.textContent).toContain("Няма забележки.");
  });
});
