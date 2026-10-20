// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CART_STORAGE_KEY, parseCart, serializeCart } from "@/lib/cart/cart";
import type { CartProductView } from "@/lib/cart/view";

/*
 * The cart's controls in a browser (jsdom): the card's „Добави“, the product
 * page's panel, the header's count, the notice, the stepper, and the cart page
 * with the server's answer stood in for. The order action is a spy; what it
 * does with a submission is `cart-order.integration.test.ts`, and the whole
 * round trip is `e2e/cart.spec.ts`.
 */

const actions = vi.hoisted(() => ({ submitCartOrder: vi.fn() }));
vi.mock("@/lib/forms/actions", () => actions);

/** The page the test is "on", for the notice, which belongs to one page. */
const route = vi.hoisted(() => ({ pathname: "/bg/kafe-kapsuli" }));
/** Where „Поръчай“ sends the browser. */
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ lang: "bg" }),
  usePathname: () => route.pathname,
  useRouter: () => router,
}));

vi.mock("next/image", async () => {
  const React = await import("react");
  return {
    default: React.forwardRef<HTMLImageElement, Record<string, unknown>>(function Img(props, ref) {
      const { fill: _fill, priority: _priority, ...rest } = props;
      return React.createElement("img", { ref, ...rest });
    }),
  };
});

import { AddToCartButton } from "@/components/cart/add-to-cart-button";
import { AddToCartPanel } from "@/components/cart/add-to-cart-panel";
import { CartLink } from "@/components/cart/cart-link";
import { CartNotice } from "@/components/cart/cart-notice";
import { QuantityStepper } from "@/components/cart/quantity-stepper";
import { CartView } from "@/app/(site)/[lang]/kolichka/_components/cart-view";
import { cartStore } from "@/lib/cart/store";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

const stored = () => parseCart(window.localStorage.getItem(CART_STORAGE_KEY));

beforeEach(() => {
  cartStore.clear();
  window.localStorage.clear();
  actions.submitCartOrder.mockReset();
  router.push.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("„Добави“ on a card", () => {
  const button = () =>
    createElement(AddToCartButton, { productId: A, slug: "borbone-rossa", name: "Borbone Rossa" });

  it("is a link to the product's order panel in the server's HTML", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(button());
    expect(host.querySelector("a")?.getAttribute("href")).toBe("/bg/borbone-rossa#order");
    expect(host.querySelector("button")).toBeNull();
  });

  it("is a button once hydrated, and a press puts one in the cart", async () => {
    render(button());
    const control = screen.getByRole("button", { name: "Добави в количката: Borbone Rossa" });
    await act(async () => fireEvent.click(control));
    await act(async () => fireEvent.click(control));
    expect(stored()).toEqual([{ productId: A, slug: "borbone-rossa", quantity: 2 }]);
  });
});

describe("the product page's panel", () => {
  it("adds the chosen quantity, and says how many the cart now holds", async () => {
    render(createElement(AddToCartPanel, { productId: A, slug: "a", name: "Продукт А" }));
    expect(screen.queryByText(/В количката:/)).toBeNull();

    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Един брой повече" })),
    );
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Един брой повече" })),
    );
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: /Добави в количката/ })),
    );

    expect(stored()).toEqual([{ productId: A, slug: "a", quantity: 3 }]);
    expect(screen.getByText(/В количката:/).textContent).toMatch(/3 бр\./);
    expect(screen.getByRole("link", { name: "Към количката" }).getAttribute("href")).toBe(
      "/bg/kolichka",
    );
    // Back to one for the next press.
    expect(screen.getByRole("spinbutton", { name: "Количество" })).toHaveProperty("value", "1");
  });

  it("puts the product in the cart once with „Поръчай“, and opens the cart", async () => {
    render(createElement(AddToCartPanel, { productId: A, slug: "a", name: "Продукт А" }));
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Един брой повече" })),
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Поръчай" })));

    expect(stored()).toEqual([{ productId: A, slug: "a", quantity: 2 }]);
    expect(router.push).toHaveBeenCalledWith("/bg/kolichka");

    // Already in the cart: a second press opens the cart and adds nothing.
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Поръчай" })));
    expect(stored()).toEqual([{ productId: A, slug: "a", quantity: 2 }]);
    expect(router.push).toHaveBeenCalledTimes(2);
  });

  it("is hidden without JavaScript, where the page offers the phone instead", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      createElement(AddToCartPanel, { productId: A, slug: "a", name: "Продукт А" }),
    );
    expect(host.firstElementChild?.className).toContain("noscript:hidden");
  });
});

describe("the header's cart", () => {
  const link = () =>
    createElement(CartLink, {
      href: "/bg/kolichka",
      label: "Количка",
      count: { one: "{count} брой", many: "{count} броя" },
    });

  it("is sent with no count, which only the browser knows", () => {
    window.localStorage.setItem(
      CART_STORAGE_KEY,
      serializeCart([{ productId: A, slug: "a", quantity: 3 }]),
    );
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(link());
    expect(host.textContent).toBe("Количка");
  });

  it("counts units, and says them to a screen reader", async () => {
    render(link());
    expect(screen.getByRole("link").textContent).toBe("Количка");
    await act(async () => {
      cartStore.add({ productId: A, slug: "a", name: "А" }, 2);
      cartStore.add({ productId: B, slug: "b", name: "Б" });
    });
    expect(screen.getByRole("link", { name: "Количка, 3 броя" }).getAttribute("href")).toBe(
      "/bg/kolichka",
    );
    expect(screen.getByText("3").getAttribute("aria-hidden")).toBe("true");
  });
});

describe("the notice", () => {
  it("answers an add with the product and the way to the cart, and goes on Escape", async () => {
    render(createElement(CartNotice));
    const region = screen.getByRole("status");
    expect(region.textContent).toBe("");

    await act(
      async () => void cartStore.add({ productId: A, slug: "a", name: "Lavazza Crema" }, 2),
    );
    expect(region.textContent).toContain("Добавено в количката");
    expect(region.textContent).toContain("2 × Lavazza Crema");
    expect(within(region).getByRole("link", { name: "Към количката" }).getAttribute("href")).toBe(
      "/bg/kolichka",
    );

    await act(async () => fireEvent.keyDown(document, { key: "Escape" }));
    expect(region.textContent).toBe("");
  });

  it("stays on the page it was raised on", async () => {
    const { rerender } = render(createElement(CartNotice));
    await act(async () => void cartStore.add({ productId: A, slug: "a", name: "А" }));
    expect(screen.getByRole("status").textContent).toContain("Добавено");

    // A client-side navigation keeps the frame, and so the notice, mounted.
    route.pathname = "/bg/kolichka";
    try {
      rerender(createElement(CartNotice));
      expect(screen.getByRole("status").textContent).toBe("");
    } finally {
      route.pathname = "/bg/kafe-kapsuli";
    }
  });

  it("goes by itself after a few seconds", async () => {
    vi.useFakeTimers();
    try {
      render(createElement(CartNotice));
      await act(async () => void cartStore.add({ productId: A, slug: "a", name: "А" }));
      expect(screen.getByRole("status").textContent).toContain("Добавено");
      await act(async () => void vi.advanceTimersByTime(6500));
      expect(screen.getByRole("status").textContent).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the quantity stepper", () => {
  it("steps within 1 and 99, and brings a typed number within them on leaving the field", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      createElement(QuantityStepper, { value: 1, onChange, label: "Количество" }),
    );
    expect(screen.getByRole("button", { name: "Един брой по-малко" })).toHaveProperty(
      "disabled",
      true,
    );

    const field = screen.getByRole("spinbutton", { name: "Количество" });
    fireEvent.change(field, { target: { value: "250" } });
    fireEvent.blur(field);
    expect(onChange).toHaveBeenLastCalledWith(99);

    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);
    // An empty field is not a quantity: nothing changes.
    expect(onChange).toHaveBeenCalledTimes(1);

    rerender(createElement(QuantityStepper, { value: 99, onChange, label: "Количество" }));
    expect(screen.getByRole("button", { name: "Един брой повече" })).toHaveProperty(
      "disabled",
      true,
    );
  });
});

/* -- the cart page --------------------------------------------------------- */

const product = (overrides: Partial<CartProductView> & { id: string }): CartProductView => ({
  slug: `p-${overrides.id.slice(0, 4)}`,
  name: "Продукт — капсули, 10 бр.",
  title: "Продукт",
  detail: "Капсули, 10 бр.",
  image: null,
  price: { amount: "5.00", currency: "EUR", formatted: "5,00 €" },
  oldPrice: null,
  discountPercent: null,
  promotion: null,
  priceEndsAt: null,
  servingPrice: "0,50 € на чаша",
  availability: "in_stock",
  blocked: null,
  ...overrides,
});

function serve(products: CartProductView[]) {
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ products })),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/**
 * Fill the order form as a customer would: a name, a number, and a delivery
 * to an address, which is the method chosen to begin with.
 */
async function fillOrder(phone = "0888 123 456") {
  const field = (name: string) => screen.getByRole("textbox", { name });
  await act(async () => {
    fireEvent.change(field("Име"), { target: { value: "Иван" } });
    fireEvent.change(field("Фамилия"), { target: { value: "Петров" } });
    fireEvent.change(field("Телефонен номер"), { target: { value: phone } });
    fireEvent.click(screen.getByRole("radio", { name: "Еконт" }));
    fireEvent.change(field("Пощенски код"), { target: { value: "4000" } });
    fireEvent.change(field("Населено място"), { target: { value: "Пловдив" } });
    fireEvent.change(field("Адрес"), { target: { value: "ул. Иван Вазов 12" } });
  });
}

function fill(lines: Array<{ productId: string; quantity: number }>) {
  window.localStorage.setItem(
    CART_STORAGE_KEY,
    serializeCart(lines.map((line) => ({ ...line, slug: `p-${line.productId.slice(0, 4)}` }))),
  );
  // The store has already read storage in an earlier test; tell it, as another tab would.
  window.dispatchEvent(new StorageEvent("storage", { key: CART_STORAGE_KEY }));
}

describe("the cart page", () => {
  it("says an empty cart is empty, and points back to the shelves", async () => {
    render(createElement(CartView, { locale: "bg" }));
    expect(await screen.findByRole("heading", { name: "Количката е празна" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Към каталога" }).getAttribute("href")).toBe(
      "/bg/kategorii",
    );
  });

  it("asks the server for its products by id and adds up what can be ordered", async () => {
    const fetch = serve([
      product({
        id: A,
        title: "Lavazza",
        price: { amount: "19.90", currency: "EUR", formatted: "19,90 €" },
      }),
      product({ id: B, title: "Kimbo", price: null }),
      product({ id: C, title: "Borbone", blocked: "out_of_stock", availability: "out_of_stock" }),
    ]);
    render(createElement(CartView, { locale: "bg" }));
    fill([
      { productId: A, quantity: 2 },
      { productId: B, quantity: 1 },
      { productId: C, quantity: 1 },
    ]);

    expect(await screen.findByRole("link", { name: "Lavazza" })).toBeTruthy();
    expect(String(fetch.mock.calls[0]?.[0])).toBe(`/api/cart?ids=${[A, B, C].sort().join(",")}`);

    // Two of the three can be ordered; the third says why it cannot.
    expect(screen.getByText("В момента е изчерпан и няма да влезе в заявката.")).toBeTruthy();
    expect(screen.getByText(/1 продукт няма да влезе в заявката/)).toBeTruthy();
    const sum = screen.getByLabelText("Сума и поръчка");
    expect(sum.textContent).toMatch(/39,80\s€/);
    expect(sum.textContent).toContain("(3 бр.)");
    expect(sum.textContent).toContain("Без 1 продукт с цена при запитване");
  });

  it("draws a reduced line as its card does, and says what the reductions save", async () => {
    serve([
      product({
        id: A,
        title: "Lavazza",
        price: { amount: "8.95", currency: "EUR", formatted: "8,95 €" },
        oldPrice: { amount: "9.95", currency: "EUR", formatted: "9,95 €" },
        discountPercent: 10,
        // The end of 15 November in Sofia (EET, UTC+2).
        promotion: { label: "Есенни дни", endsAt: "2026-11-15T22:00:00.000Z" },
        priceEndsAt: "2026-11-15T22:00:00.000Z",
      }),
      product({
        id: B,
        title: "Kimbo",
        // The source's own struck price never reaches the cart (`toCartProductView`).
        price: { amount: "4.00", currency: "EUR", formatted: "4,00 €" },
      }),
      product({
        id: C,
        title: "Borbone",
        price: { amount: "3.00", currency: "EUR", formatted: "3,00 €" },
      }),
    ]);
    render(createElement(CartView, { locale: "bg" }));
    fill([
      { productId: A, quantity: 2 },
      { productId: B, quantity: 1 },
      { productId: C, quantity: 1 },
    ]);
    const row = (await screen.findByRole("link", { name: "Lavazza" })).closest("li")!;

    expect(row.textContent).toMatch(/Намалена цена 8,95\s€ за брой/);
    const struck = within(row).getByText(/^9,95\s€$/);
    expect(struck.className).toContain("line-through");
    expect(row.textContent).toContain("Стара цена");
    expect(within(row).getByText("−10%")).toBeTruthy();
    expect(row.textContent).toMatch(/Есенни дни · до 15 ноември/);
    // No timer: a date.
    expect(row.textContent).not.toMatch(/остава|ч\.|мин/);

    const plain = screen.getByRole("link", { name: "Borbone" }).closest("li")!;
    expect(plain.textContent).not.toContain("Стара цена");
    expect(screen.getByRole("link", { name: "Kimbo" }).closest("li")!.textContent).not.toContain(
      "до ",
    );

    const sum = screen.getByLabelText("Сума и поръчка");
    // 2 × 8,95 + 4,00 + 3,00 — the reduced prices are what is charged.
    expect(sum.textContent).toMatch(/24,90\s€/);
    // (9,95 − 8,95) × 2: the shop's own reduction, and only that.
    expect(sum.textContent).toMatch(/Спестявате\s*2,00\s€/);
  });

  it("says nothing of savings when nothing is reduced", async () => {
    serve([product({ id: A, title: "Lavazza" })]);
    render(createElement(CartView, { locale: "bg" }));
    fill([{ productId: A, quantity: 1 }]);
    await screen.findByRole("link", { name: "Lavazza" });
    expect(screen.getByLabelText("Сума и поръчка").textContent).not.toContain("Спестявате");
  });

  it("removes a line, and changes a quantity without asking the server again", async () => {
    const fetch = serve([product({ id: A, title: "Lavazza" }), product({ id: B, title: "Kimbo" })]);
    render(createElement(CartView, { locale: "bg" }));
    fill([
      { productId: A, quantity: 1 },
      { productId: B, quantity: 1 },
    ]);
    await screen.findByRole("link", { name: "Lavazza" });

    await act(async () =>
      fireEvent.click(screen.getAllByRole("button", { name: "Един брой повече" })[0]!),
    );
    expect(stored()[0]?.quantity).toBe(2);
    await act(async () =>
      fireEvent.click(screen.getAllByRole("button", { name: /^Премахни/ })[1]!),
    );
    expect(stored().map((line) => line.productId)).toEqual([A]);
    expect(screen.queryByRole("link", { name: "Kimbo" })).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("sends the orderable lines, then shows the reference and empties the cart", async () => {
    serve([
      product({ id: A, title: "Lavazza", name: "Lavazza — кафе на зърна, 1 кг" }),
      product({ id: C, title: "Borbone", blocked: "unavailable" }),
    ]);
    actions.submitCartOrder.mockResolvedValue({
      status: "success",
      message: "Благодарим ви. Ще ви се обадим утре, в работно време.",
      reference: "A1B2C3D4",
    });
    render(createElement(CartView, { locale: "bg" }));
    fill([
      { productId: A, quantity: 2 },
      { productId: C, quantity: 1 },
    ]);
    await screen.findByRole("link", { name: "Lavazza" });

    await fillOrder();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Изпрати заявката" })),
    );

    await waitFor(() => expect(actions.submitCartOrder).toHaveBeenCalledTimes(1));
    const sent = actions.submitCartOrder.mock.calls[0]?.find(
      (arg: unknown) => arg instanceof FormData,
    ) as FormData;
    // Ids, quantities and the price each line showed, and only what can be ordered.
    expect(JSON.parse(String(sent.get("lines")))).toEqual([
      { productId: A, quantity: 2, price: "5.00" },
    ]);
    expect(sent.get("phone")).toBe("0888 123 456");
    expect(sent.get("firstName")).toBe("Иван");
    expect(sent.get("deliveryCourier")).toBe("econt");

    expect(await screen.findByRole("heading", { name: "Заявката е получена" })).toBeTruthy();
    expect(screen.getByText("A1B2C3D4")).toBeTruthy();
    expect(screen.getByText(/Ще ви се обадим утре/)).toBeTruthy();
    expect(screen.getByText("Lavazza — кафе на зърна, 1 кг")).toBeTruthy();
    expect(window.localStorage.getItem(CART_STORAGE_KEY)).toBeNull();
  });

  it("asks the server again when the action refuses the cart itself", async () => {
    const fetch = serve([product({ id: A, title: "Lavazza" })]);
    actions.submitCartOrder.mockResolvedValue({
      status: "error",
      message:
        "Вече не можем да приемем поръчка за Lavazza. Прегледайте количката и изпратете отново.",
    });
    render(createElement(CartView, { locale: "bg" }));
    fill([{ productId: A, quantity: 1 }]);
    await screen.findByRole("link", { name: "Lavazza" });

    await fillOrder();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Изпрати заявката" })),
    );
    expect(await screen.findByText(/Вече не можем да приемем поръчка за Lavazza/)).toBeTruthy();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });

  it("shows the new price when the action says the prices changed, and sends that one next", async () => {
    // The promotion ended between the page's answer and the press.
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            products: [
              product({
                id: A,
                title: "Lavazza",
                price: { amount: "8.95", currency: "EUR", formatted: "8,95 €" },
                oldPrice: { amount: "9.95", currency: "EUR", formatted: "9,95 €" },
                discountPercent: 10,
                promotion: { label: null, endsAt: "2026-10-20T22:00:00.000Z" },
                priceEndsAt: "2026-10-20T22:00:00.000Z",
              }),
            ],
          }),
        ),
      )
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            products: [
              product({
                id: A,
                title: "Lavazza",
                price: { amount: "9.95", currency: "EUR", formatted: "9,95 €" },
              }),
            ],
          }),
        ),
      );
    vi.stubGlobal("fetch", fetch);
    actions.submitCartOrder.mockResolvedValue({
      status: "error",
      message: "Цените се промениха — прегледайте количката и изпратете отново.",
    });
    render(createElement(CartView, { locale: "bg" }));
    fill([{ productId: A, quantity: 1 }]);
    await screen.findByRole("link", { name: "Lavazza" });

    await fillOrder();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Изпрати заявката" })),
    );
    const firstSent = actions.submitCartOrder.mock.calls[0]?.find(
      (arg: unknown) => arg instanceof FormData,
    ) as FormData;
    expect(JSON.parse(String(firstSent.get("lines")))).toEqual([
      { productId: A, quantity: 1, price: "8.95" },
    ]);

    expect(await screen.findByText(/Цените се промениха/)).toBeTruthy();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const row = (await screen.findByRole("link", { name: "Lavazza" })).closest("li")!;
    await waitFor(() => expect(row.textContent).toMatch(/9,95\s€ за брой/));
    expect(row.textContent).not.toContain("Стара цена");

    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Изпрати заявката" })),
    );
    await waitFor(() => expect(actions.submitCartOrder).toHaveBeenCalledTimes(2));
    const secondSent = actions.submitCartOrder.mock.calls[1]?.find(
      (arg: unknown) => arg instanceof FormData,
    ) as FormData;
    expect(JSON.parse(String(secondSent.get("lines")))).toEqual([
      { productId: A, quantity: 1, price: "9.95" },
    ]);
  });

  it("asks again when the page is looked at again, or comes back from the history", async () => {
    const fetch = serve([product({ id: A, title: "Lavazza" })]);
    render(createElement(CartView, { locale: "bg" }));
    fill([{ productId: A, quantity: 1 }]);
    await screen.findByRole("link", { name: "Lavazza" });
    expect(fetch).toHaveBeenCalledTimes(1);

    await act(async () => void document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    // A page shown on first load is not a return; one restored from the history is.
    const shown = (persisted: boolean) => {
      const event = new Event("pageshow") as PageTransitionEvent;
      Object.defineProperty(event, "persisted", { value: persisted });
      return event;
    };
    await act(async () => void window.dispatchEvent(shown(false)));
    expect(fetch).toHaveBeenCalledTimes(2);
    await act(async () => void window.dispatchEvent(shown(true)));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  });

  it("asks again just after the first promotion in the cart ends", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const endsAt = new Date(Date.now() + 60_000).toISOString();
      const fetch = serve([
        product({ id: A, title: "Lavazza", priceEndsAt: endsAt }),
        product({
          id: B,
          title: "Kimbo",
          priceEndsAt: new Date(Date.now() + 3_600_000).toISOString(),
        }),
      ]);
      render(createElement(CartView, { locale: "bg" }));
      fill([
        { productId: A, quantity: 1 },
        { productId: B, quantity: 1 },
      ]);
      await screen.findByRole("link", { name: "Lavazza" });
      expect(fetch).toHaveBeenCalledTimes(1);

      await act(async () => void vi.advanceTimersByTime(55_000));
      expect(fetch).toHaveBeenCalledTimes(1);
      await act(async () => void vi.advanceTimersByTime(10_000));
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks again at the end even when the answer names the same end", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      // The server's clock a moment behind: the promotion still prices the line.
      const endsAt = new Date(Date.now() + 60_000).toISOString();
      const fetch = serve([product({ id: A, title: "Lavazza", priceEndsAt: endsAt })]);
      render(createElement(CartView, { locale: "bg" }));
      fill([{ productId: A, quantity: 1 }]);
      await screen.findByRole("link", { name: "Lavazza" });

      await act(async () => void vi.advanceTimersByTime(63_000));
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      // The same end, now past by the browser's clock: asked again 30 s later.
      await act(async () => void vi.advanceTimersByTime(31_000));
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the cart and what was typed when asking again in the background fails, and tries again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const answer = () =>
        new Response(JSON.stringify({ products: [product({ id: A, title: "Lavazza" })] }));
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(answer())
        // Back to the tab: the limiter says wait seven seconds.
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: "rate_limited" }), {
            status: 429,
            headers: { "retry-after": "7" },
          }),
        )
        // The first quiet retry: the network is gone.
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValue(answer());
      vi.stubGlobal("fetch", fetch);
      render(createElement(CartView, { locale: "bg" }));
      fill([{ productId: A, quantity: 1 }]);
      await screen.findByRole("link", { name: "Lavazza" });
      await act(async () =>
        fireEvent.change(screen.getByRole("textbox", { name: "Име" }), {
          target: { value: "Иван" },
        }),
      );

      await act(async () => void document.dispatchEvent(new Event("visibilitychange")));
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      // Still the cart, the form and the name, with no alarm.
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByRole("link", { name: "Lavazza" })).toBeTruthy();
      expect((screen.getByRole("textbox", { name: "Име" }) as HTMLInputElement).value).toBe("Иван");

      // Not before the seven seconds the server asked for.
      await act(async () => void vi.advanceTimersByTime(6_000));
      expect(fetch).toHaveBeenCalledTimes(2);
      await act(async () => void vi.advanceTimersByTime(2_000));
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
      expect(screen.queryByRole("alert")).toBeNull();

      // Twice failed: ten seconds, then an answer, and the form untouched.
      await act(async () => void vi.advanceTimersByTime(9_000));
      expect(fetch).toHaveBeenCalledTimes(3);
      await act(async () => void vi.advanceTimersByTime(2_000));
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
      expect(screen.queryByRole("alert")).toBeNull();
      expect((screen.getByRole("textbox", { name: "Име" }) as HTMLInputElement).value).toBe("Иван");
    } finally {
      vi.useRealTimers();
    }
  });

  it("says it could not load the cart when asking again after a refusal fails", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ products: [product({ id: A, title: "Lavazza" })] })),
      )
      .mockResolvedValue(new Response("{}", { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    actions.submitCartOrder.mockResolvedValue({
      status: "error",
      message: "Цените се промениха — прегледайте количката и изпратете отново.",
    });
    render(createElement(CartView, { locale: "bg" }));
    fill([{ productId: A, quantity: 1 }]);
    await screen.findByRole("link", { name: "Lavazza" });
    await fillOrder();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Изпрати заявката" })),
    );
    // The refusal asks out loud: a failure then is said, with the products kept.
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/Продуктите ви са запазени/)).toBeTruthy();
  });

  it("says when it could not load the products, and keeps them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 503 })),
    );
    render(createElement(CartView, { locale: "bg" }));
    fill([{ productId: A, quantity: 1 }]);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/Продуктите ви са запазени/)).toBeTruthy();
    expect(stored()).toHaveLength(1);
  });
});
