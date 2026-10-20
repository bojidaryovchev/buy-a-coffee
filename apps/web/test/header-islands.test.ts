// @vitest-environment jsdom
import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { act, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * The header's two heavy controls arrive after the page: the search field's
 * typeahead and the mobile drawer are fetched on the first idle moment after
 * `load`, or the moment the visitor reaches for them (`lib/after-load.ts`).
 * What has to hold is what a visitor on a slow phone does in between: type
 * into the field, tap the menu. Each module is held back here behind a gate,
 * so the test decides when it "arrives".
 */

const held = vi.hoisted(() => {
  const gate = () => {
    let open = () => {};
    const promise = new Promise<void>((resolve) => (open = resolve));
    return { promise, open: () => open() };
  };
  return { typeahead: gate(), drawer: gate(), params: new URLSearchParams() };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, prefetch: () => undefined }),
  // Stable between renders, as the router's is while the address stays put.
  useSearchParams: () => held.params,
  usePathname: () => "/bg",
}));

vi.mock("@/components/catalog/search-suggestions", async () => {
  await held.typeahead.promise;
  return {
    suggestionLinks: () => ({}),
    suggestionOptions: () => [],
    fetchSuggestions: () => () => undefined,
    SuggestionPanel: () => null,
  };
});

vi.mock("@/components/layout/mobile-drawer", async () => {
  await held.drawer.promise;
  return {
    MobileDrawer: ({ id, onClose }: { id: string; onClose: () => void }) =>
      createElement(
        "div",
        { role: "dialog", id },
        createElement("button", { type: "button", onClick: onClose }, "Затвори"),
      ),
  };
});

import { SearchField } from "@/components/catalog/search-field";
import { MobileNav } from "@/components/layout/mobile-nav";
import { buildNavigation } from "@/components/layout/navigation";
import { bg as dict } from "@/i18n/dictionaries/bg";
import { BUSINESS_SECTIONS } from "@/lib/catalog/business-sections";

let root: Root | null = null;
let recoverable: unknown[] = [];

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  recoverable = [];
  document.body.innerHTML = "";
  held.params = new URLSearchParams();
});

/** Lets a resolved import and the renders it schedules land. */
const settle = () =>
  act(async () => {
    for (let turn = 0; turn < 5; turn += 1) await new Promise((r) => setTimeout(r, 0));
  });

/**
 * Put the server's HTML in the page, let `beforeHydration` act on it as a
 * visitor would, then hydrate it, as the browser does.
 */
async function serve(element: ReactElement, beforeHydration?: (host: HTMLElement) => void) {
  const host = document.createElement("div");
  host.innerHTML = renderToString(element);
  document.body.append(host);
  beforeHydration?.(host);
  await act(async () => {
    root = hydrateRoot(host, element, { onRecoverableError: (error) => recoverable.push(error) });
  });
  return host;
}

describe("the search field", () => {
  const field = () => createElement(SearchField, { locale: "bg", copy: dict.search });

  it("is drawn by the server as a plain search form, a combobox only once it has a list", () => {
    const markup = renderToString(field());
    expect(markup).toMatch(/<form role="search"[^>]*action="\/bg\/tarsene" method="get"/);
    expect(markup).toContain('name="q"');
    expect(markup).not.toContain("combobox");
  });

  it("keeps the same input, and every character, while its typeahead arrives", async () => {
    const host = await serve(field(), (page) => {
      // Typed before the page hydrated.
      page.querySelector("input")!.value = "ла";
    });
    expect(recoverable).toEqual([]);
    const input = host.querySelector("input")!;
    expect(input.value).toBe("ла");
    expect(input.getAttribute("role")).toBeNull();

    // Reaching for the field asks for the typeahead; typing goes on meanwhile.
    fireEvent.pointerDown(input);
    act(() => input.focus());
    fireEvent.change(input, { target: { value: "лав" } });
    fireEvent.change(input, { target: { value: "лава" } });

    held.typeahead.open();
    await settle();

    expect(host.querySelector("input")).toBe(input);
    expect(input.value).toBe("лава");
    expect(document.activeElement).toBe(input);
    // And from now on it is the typeahead's combobox.
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.getAttribute("aria-controls")).toMatch(/.+/);
  });

  it("keeps text typed before hydration when the typeahead is already here", async () => {
    // The typeahead arrived in the previous test, so it renders right after
    // hydration — the render that would write an empty value over the text.
    const host = await serve(field(), (page) => {
      page.querySelector("input")!.value = "кафе";
    });
    await settle();
    const input = host.querySelector("input")!;
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.value).toBe("кафе");
  });

  it("takes the query from the address only into a field nobody has typed in", async () => {
    held.params = new URLSearchParams("q=lavazza");
    const untouched = await serve(field());
    await settle();
    expect(untouched.querySelector("input")!.value).toBe("lavazza");

    act(() => root?.unmount());
    root = null;
    const typed = await serve(field(), (page) => {
      page.querySelector("input")!.value = "illy";
    });
    await settle();
    expect(typed.querySelector("input")!.value).toBe("illy");
  });
});

describe("the menu trigger", () => {
  const nav = () =>
    createElement(MobileNav, {
      navigation: buildNavigation([], {
        locale: "bg",
        labels: dict.nav,
        sections: BUSINESS_SECTIONS,
      }),
      copy: { drawer: dict.drawer, nav: dict.nav },
      hours: "",
    });

  it("is a link to the categories in the server's HTML, and a button once hydrated", async () => {
    expect(renderToString(nav())).not.toContain('role="button"');
    const host = await serve(nav());
    expect(recoverable).toEqual([]);
    const trigger = host.querySelector("a")!;
    expect(trigger.getAttribute("href")).toBe("/bg/kategorii");
    expect(trigger.getAttribute("role")).toBe("button");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens on the first tap, even before the drawer's code has arrived", async () => {
    const host = await serve(nav());
    const trigger = host.querySelector("a")!;

    // The finger lands (the fetch starts), lifts (the click), and only then
    // does the drawer arrive.
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    held.drawer.open();
    await settle();

    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(dialog.id);

    await act(async () => fireEvent.click(dialog.querySelector("button")!));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
});
