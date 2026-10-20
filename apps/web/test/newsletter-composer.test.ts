// @vitest-environment jsdom
import { createElement } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { insertBlockLine } from "@/components/admin/newsletter-edits";
import type { PickerProduct } from "@/lib/newsletter/picker";
import { resolveIntent } from "@/lib/newsletter/schemas";

/**
 * The composer in the browser, through the real component and the real
 * `useSchemaForm`, to the action's `FormData`.
 *
 * Its three buttons: the action must learn which one was pressed, or a press
 * of "send" (or "test") is quietly read as "save". With a modern browser the
 * pressed button is in the form data; with an older Safari it is not, and the
 * hidden `intentChosen` field carries it. Its blocks: products drawn as
 * products, taken out and added, automatic blocks frozen into lists, blocks
 * moved — and always the body string posted, which is all the action reads.
 * Its test copy, to the address typed. And the notes before sending.
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

describe("putting products in the letter", () => {
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

  it("opens on the blocks, and posts the body they make", async () => {
    draw({ body: "Здравейте,\n\nДо скоро." });
    expect(screen.queryByRole("textbox", { name: "Текст" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Markdown" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Промоции" }));
    });
    // An automatic block, drawn as one; the preview has not answered for it yet.
    expect(screen.getByRole("heading", { name: "Промоции · автоматично" })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Запази черновата" }));
    });
    expect((await sent()).get("body")).toBe("Здравейте,\n\nДо скоро.\n\n[[промоции]]");
  });

  it("puts the reductions in at the cursor in the Markdown view", async () => {
    draw({ body: "Здравейте,\n\nДо скоро." });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Markdown" }));
    });
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
    // Back to the blocks: the body is read again, line for line.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Markdown" }));
    });
    expect(screen.getAllByRole("heading", { name: /автоматично$/ })).toHaveLength(2);
  });

  it("finds products, adds the ones chosen as a block, and takes one out again", async () => {
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
      fireEvent.click(screen.getByRole("button", { name: "Добави 2 продукта" }));
    });
    expect(screen.queryByRole("searchbox", { name: "Търсене" })).toBeNull();
    // Drawn as products at once, from what the search showed, in the order chosen.
    const block = screen.getByRole("listitem", { name: "Избрани продукти" });
    expect(
      Array.from(block.querySelectorAll("[data-product]")).map((row) =>
        row.getAttribute("data-product"),
      ),
    ).toEqual(["lavazza-rossa-1kg", "lavazza-oro-1kg"]);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Махни: Lavazza Qualità Rossa, Кафе на зърна, 1 кг" }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Запази черновата" }));
    });
    expect((await sent()).get("body")).toBe("[[продукти: lavazza-oro-1kg]]");
  });

  it("shows what an automatic block would draw now, and freezes it into a list", async () => {
    previewBlocks = [
      {
        token: "[[нови-продукти]]",
        kind: "new",
        products: [
          { slug: "nov-1", title: "Kimbo Aroma", detail: "Кафе на зърна, 1 кг", price: "18,90 €" },
          { slug: "nov-2", title: "Vergnano Gran Aroma", detail: null, price: "21,40 €" },
        ],
        missing: [],
      },
    ];
    draw({ body: "Здравейте,\n\n[[нови-продукти]]" });
    await screen.findByText("Kimbo Aroma", undefined, { timeout: 2000 });
    // Read-only: nothing to take out of a block the catalog fills.
    expect(screen.queryByRole("button", { name: /^Махни: Kimbo/ })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Замени с избраните" }));
    });
    expect(
      screen.getByRole("button", { name: "Махни: Kimbo Aroma, Кафе на зърна, 1 кг" }),
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Запази черновата" }));
    });
    expect((await sent()).get("body")).toBe("Здравейте,\n\n[[продукти: nov-1, nov-2]]");
  });

  it("freezes the reductions into a list of reductions, still checked at the send", async () => {
    previewBlocks = [
      {
        token: "[[промоции]]",
        kind: "sale",
        products: [
          { slug: "minus-1", title: "Eurocaf", detail: null, price: "8,00 €", oldPrice: "10,00 €" },
        ],
        missing: [],
      },
    ];
    draw({ body: "Здравейте,\n\n[[промоции]]" });
    await screen.findByText("Eurocaf", undefined, { timeout: 2000 });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Замени с избраните" }));
    });
    expect(screen.getByRole("heading", { name: "Промоции · избрани" })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Запази черновата" }));
    });
    expect((await sent()).get("body")).toBe("Здравейте,\n\n[[промоции: minus-1]]");
  });

  it("moves a block and takes one out, keeping the text apart", async () => {
    draw({ body: "Първо.\n\n[[промоции]]\n\nПоследно." });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Промоции · автоматично: премести нагоре" }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Промоции · автоматично: махни блока" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Запази черновата" }));
    });
    expect((await sent()).get("body")).toBe("Първо.\n\nПоследно.");
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

describe("before the script runs", () => {
  it("is a plain field the browser posts, and what was typed in it survives the swap to blocks", async () => {
    const element = createElement(NewsletterComposer, {
      campaign: { ...campaign, body: "Старо." },
      activeCount: 3,
      sender: "Buy a Coffee <info@buy-a-coffee.com>",
      testRecipient: "owner@example.org",
      canSend: true,
      canUpload: false,
    });
    const container = document.createElement("div");
    container.innerHTML = renderToString(element);
    document.body.appendChild(container);
    const field = container.querySelector("textarea#body") as HTMLTextAreaElement;
    expect(field.getAttribute("name")).toBe("body");
    // The owner types before the script has run.
    field.value = "Написано преди скрипта.\n\n[[промоции]]";

    let root: ReturnType<typeof hydrateRoot> | undefined;
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await act(async () => {
        root = hydrateRoot(container, element, {
          onRecoverableError: (error) => console.error("recoverable", error),
        });
      });
      // Hydrated, not drawn again from scratch: no mismatch.
      expect(errors.mock.calls.flat().join(" ")).not.toMatch(/hydrat|recoverable/i);
      // The blocks took over, from what was typed rather than what was drawn.
      expect(screen.getByRole("heading", { name: "Промоции · автоматично" })).toBeTruthy();
      expect((screen.getByRole("textbox", { name: "Текст" }) as HTMLTextAreaElement).value).toBe(
        "Написано преди скрипта.",
      );
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Запази черновата" }));
      });
      expect((await sent()).get("body")).toBe("Написано преди скрипта.\n\n[[промоции]]");
    } finally {
      errors.mockRestore();
      await act(async () => root?.unmount());
      container.remove();
    }
  });
});

describe("a test copy", () => {
  it("goes to the owner's address unless another is typed, and is refused for a bad one", async () => {
    draw();
    const address = screen.getByRole("textbox", { name: "Пробно писмо до" }) as HTMLInputElement;
    expect(address.value).toBe("owner@example.org");
    await act(async () => {
      fireEvent.change(address, { target: { value: "не-е-адрес" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Изпрати пробно" }));
    });
    expect(actions.submitNewsletter).not.toHaveBeenCalled();
    expect(screen.getByText(/Това не е имейл адрес/)).toBeTruthy();

    await act(async () => {
      fireEvent.change(address, { target: { value: "Colleague@Example.org" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Изпрати пробно" }));
    });
    const data = await sent();
    expect(resolveIntent(data)).toBe("test");
    expect(data.get("testTo")).toBe("Colleague@Example.org");
  });
});

describe("before sending", () => {
  it("says what may send the letter to spam, and says it again in the confirmation", async () => {
    draw({ body: "Голямо намаление!\n\n[[промоции]]", preheader: "" });
    previewBlocks = [{ token: "[[промоции]]", kind: "sale", products: [], missing: [] }];
    const panel = screen.getByRole("region", { name: "Преди изпращане" });
    expect(panel.textContent).toContain("Малко текст");
    expect(panel.textContent).toContain("Няма въведение");

    // The preview answers: the reductions block is empty — a warning, not a stop.
    await waitFor(
      () => expect(panel.textContent).toContain("Секцията „Промоции“ е празна и няма да се покаже"),
      { timeout: 2000 },
    );
    expect(panel.textContent).toContain("няма продукти с намалена цена");
    expect(
      Array.from(panel.querySelectorAll("li")).some((item) =>
        item.textContent?.includes("Спира изпращането"),
      ),
    ).toBe(false);

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
    await waitFor(() => expect(panel.textContent).toContain("е празна"), { timeout: 2000 });

    previewFails = true;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Markdown" }));
    });
    await act(async () => {
      fireEvent.change(bodyField(), { target: { value: "Голямо намаление!\n\n[[промоции: 2]]" } });
    });
    await screen.findByText(/Прегледът не можа да се обнови/, undefined, { timeout: 2000 });
    expect(panel.textContent).not.toContain("е празна");
  });

  it("lists two identical block lines as two notes, without a key warning", async () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => undefined);
    draw({ body: "Текст\n\n[[промоций]]\n\n[[промоций]]" });
    const panel = screen.getByRole("region", { name: "Преди изпращане" });
    expect(panel.textContent?.match(/Блокът \[\[промоций\]\] не е разпознат/g)).toHaveLength(2);
    expect(warn.mock.calls.flat().join(" ")).not.toMatch(/same key/);
    warn.mockRestore();
  });

  it("says what stops the send first, and what only shortens the letter after it", async () => {
    previewBlocks = [
      {
        token: "[[продукти: ima, nyama]]",
        kind: "picked",
        products: [{ slug: "ima", title: "Има", detail: null }],
        missing: ["nyama"],
      },
      { token: "[[промоции]]", kind: "sale", products: [], missing: [] },
    ];
    draw({
      preheader: "Три нови марки на зърна.",
      body: `${"Здравейте! ".repeat(30)}\n\n[[продукти: ima, nyama]]\n\n[[промоции]]`,
    });
    const panel = screen.getByRole("region", { name: "Преди изпращане" });
    await waitFor(() => expect(panel.textContent).toContain("Непознат продукт"), { timeout: 2000 });
    const titles = Array.from(panel.querySelectorAll("li")).map((item) => item.textContent ?? "");
    expect(titles[0]).toMatch(/^Спира изпращането.*Непознат продукт/);
    expect(titles[1]).toContain("Секцията „Промоции“ е празна");
    // The row in its block says the same.
    expect(
      screen.getByText("Няма продукт с този адрес — изпращането няма да започне."),
    ).toBeTruthy();
  });

  it("warns when a letter went out less than a month ago", () => {
    render(
      createElement(NewsletterComposer, {
        campaign,
        activeCount: 3,
        sender: "Buy a Coffee <info@buy-a-coffee.com>",
        testRecipient: "owner@example.org",
        canSend: true,
        canUpload: false,
        lastLetterAt: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    );
    const panel = screen.getByRole("region", { name: "Преди изпращане" });
    expect(panel.textContent).toContain("Последното писмо е изпратено преди 12 дни");
    expect(panel.textContent).toContain("не повече от веднъж месечно");
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
