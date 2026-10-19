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
vi.mock("next/navigation", () => ({
  useParams: () => ({ lang: "bg" }),
  usePathname: () => route.pathname,
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

  it("is hidden without JavaScript, where the quick order below is the panel", () => {
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

    fireEvent.change(screen.getByLabelText(/Телефонен номер/), {
      target: { value: "0888 123 456" },
    });
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Изпрати заявката" })),
    );

    await waitFor(() => expect(actions.submitCartOrder).toHaveBeenCalledTimes(1));
    const sent = actions.submitCartOrder.mock.calls[0]?.find(
      (arg: unknown) => arg instanceof FormData,
    ) as FormData;
    // Ids and quantities only, and only what can be ordered.
    expect(JSON.parse(String(sent.get("lines")))).toEqual([{ productId: A, quantity: 2 }]);
    expect(sent.get("phone")).toBe("0888 123 456");

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

    fireEvent.change(screen.getByLabelText(/Телефонен номер/), {
      target: { value: "0888 123 456" },
    });
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Изпрати заявката" })),
    );
    expect(await screen.findByText(/Вече не можем да приемем поръчка за Lavazza/)).toBeTruthy();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
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
