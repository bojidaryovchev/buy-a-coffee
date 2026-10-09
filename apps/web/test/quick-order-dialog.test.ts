// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { QuickOrderControl } from "@/components/catalog/quick-order-control";
import { QuickOrderDialog } from "@/components/catalog/quick-order-dialog";

/*
 * The real form posts to a server action; what matters here is that the dialog
 * mounts exactly one, for the right product.
 */
vi.mock("@/components/forms/quick-order-form", async () => {
  const React = await import("react");
  return {
    QuickOrderForm: ({ productSlug }: { productSlug: string }) =>
      React.createElement(
        "form",
        { "data-testid": "order-form", "data-slug": productSlug },
        React.createElement("input", { name: "website", tabIndex: -1 }),
        React.createElement("input", { name: "phone", type: "tel" }),
        React.createElement("button", { type: "submit" }, "Поискай обаждане"),
      ),
  };
});

/* `next/dynamic` resolves on a later tick; the test wants the module now. */
vi.mock("next/dynamic", async () => {
  const dialog = await import("@/components/catalog/quick-order-dialog");
  return { default: () => dialog.QuickOrderDialog };
});

beforeAll(() => {
  /*
   * jsdom has the element but not the modal behaviour. These stand-ins do what
   * the browser does that the component relies on: `open`, and a `close` event.
   */
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
  // jsdom lays nothing out, so every element reports no boxes.
  HTMLElement.prototype.getClientRects = function getClientRects() {
    return [{}] as unknown as DOMRectList;
  };
});

afterEach(() => {
  cleanup();
  document.documentElement.style.overflow = "";
});

const NAME = "Капсули DG Bianchi Gusto Forte Espresso 16 бр.";
const SLUG = "kapsuli-dg-bianchi-gusto-forte-16-br";

const control = () => render(createElement(QuickOrderControl, { slug: SLUG, name: NAME }));
/** The control for a product, found by the name a screen reader would speak. */
const linkFor = (name: string) =>
  screen.getByRole("link", {
    name: (accessibleName) =>
      accessibleName.replace(/\s+/g, " ").replace(" :", ":") === `Бърза поръчка: ${name}`,
  });
const link = () => linkFor(NAME);

describe("QuickOrderControl", () => {
  it("is a labelled link to the order form, with nothing mounted behind it", () => {
    control();
    expect(link().getAttribute("href")).toBe(`/bg/${SLUG}#order`);
    expect(document.querySelector("dialog")).toBeNull();
    expect(screen.queryByTestId("order-form")).toBeNull();
  });

  it("opens the form for that product in a dialog on a plain click", () => {
    control();
    const notPrevented = fireEvent.click(link());
    expect(notPrevented).toBe(false);
    const dialog = document.querySelector("dialog")!;
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(screen.getAllByTestId("order-form")).toHaveLength(1);
    expect(screen.getByTestId("order-form").getAttribute("data-slug")).toBe(SLUG);
  });

  it("leaves a click that asks for a new tab to the browser", () => {
    control();
    /*
     * jsdom cannot follow a link, so this listener stops it trying — after
     * noting whether the control had already claimed the click for itself.
     */
    const claimed: boolean[] = [];
    const afterControl = (event: MouseEvent) => {
      claimed.push(event.defaultPrevented);
      event.preventDefault();
    };
    document.addEventListener("click", afterControl);
    for (const modifier of [
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { button: 1 },
    ]) {
      fireEvent.click(link(), modifier);
      expect(document.querySelector("dialog")).toBeNull();
    }
    document.removeEventListener("click", afterControl);
    expect(claimed).toEqual([false, false, false, false]);
  });

  it("unmounts the dialog when it closes and returns focus to the control", () => {
    control();
    fireEvent.click(link());
    act(() => document.querySelector("dialog")!.close());
    expect(document.querySelector("dialog")).toBeNull();
    expect(screen.queryByTestId("order-form")).toBeNull();
    expect(document.activeElement).toBe(link());
  });

  it("mounts one form at a time across several cards", () => {
    render(
      createElement(
        "div",
        null,
        createElement(QuickOrderControl, { slug: "a", name: "Първо" }),
        createElement(QuickOrderControl, { slug: "b", name: "Второ" }),
        createElement(QuickOrderControl, { slug: "c", name: "Трето" }),
      ),
    );
    expect(screen.queryAllByTestId("order-form")).toHaveLength(0);
    fireEvent.click(linkFor("Второ"));
    expect(screen.getAllByTestId("order-form")).toHaveLength(1);
    expect(screen.getByTestId("order-form").getAttribute("data-slug")).toBe("b");
  });
});

describe("QuickOrderDialog", () => {
  const open = (onClose = vi.fn()) => {
    render(createElement(QuickOrderDialog, { slug: SLUG, name: NAME, onClose }));
    return { dialog: document.querySelector("dialog")!, onClose };
  };

  it("opens as a modal named by a heading that names the product", () => {
    const { dialog } = open();
    expect(dialog.hasAttribute("open")).toBe(true);
    const heading = document.getElementById(dialog.getAttribute("aria-labelledby")!)!;
    expect(heading.tagName).toBe("H2");
    expect(heading.textContent).toContain("Бърза поръчка");
    expect(heading.textContent).toContain(NAME);
  });

  it("stops the page behind it scrolling, and lets it go again", () => {
    open();
    expect(document.documentElement.style.overflow).toBe("hidden");
    cleanup();
    expect(document.documentElement.style.overflow).toBe("");
  });

  it("has a labelled close button that closes it", () => {
    const { onClose } = open();
    fireEvent.click(screen.getByRole("button", { name: "Затвори" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("reports a close the browser made, as Escape does", () => {
    const { dialog, onClose } = open();
    act(() => dialog.close());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on a click on the backdrop, not on a click inside", () => {
    const { dialog, onClose } = open();
    const phone = dialog.querySelector<HTMLInputElement>("input[name=phone]")!;
    fireEvent.mouseDown(phone);
    fireEvent.click(phone);
    expect(onClose).not.toHaveBeenCalled();

    // A drag that starts in a field and ends on the backdrop is not a close.
    fireEvent.mouseDown(phone);
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(dialog);
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps Tab inside, wrapping at both ends and skipping the honeypot", () => {
    const { dialog } = open();
    const close = screen.getByRole("button", { name: "Затвори" });
    const submit = screen.getByRole("button", { name: "Поискай обаждане" });

    submit.focus();
    expect(fireEvent.keyDown(dialog, { key: "Tab" })).toBe(false);
    expect(document.activeElement).toBe(close);

    expect(fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(submit);

    // In the middle, the browser's own order is left alone.
    dialog.querySelector<HTMLInputElement>("input[name=phone]")!.focus();
    expect(fireEvent.keyDown(dialog, { key: "Tab" })).toBe(true);
  });
});
