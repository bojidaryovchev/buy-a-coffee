// @vitest-environment jsdom
import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { act, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * The header's controls as a visitor on a slow phone meets them: drawn by the
 * server, then hydrated where they stand.
 *
 * The search field's typeahead arrives after the page (`lib/after-load.ts`),
 * held back here behind a gate so the test decides when. What has to hold in
 * between is that the field takes text — before hydration, and while the
 * typeahead is on its way — and never loses a character of it. The menu has
 * nothing to wait for: it opens on the first tap.
 */

const held = vi.hoisted(() => {
  let open = () => {};
  const promise = new Promise<void>((resolve) => (open = resolve));
  return { typeahead: { promise, open: () => open() }, params: new URLSearchParams() };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, prefetch: () => undefined }),
  // Stable between renders, as the router's is while the address stays put.
  useSearchParams: () => held.params,
  usePathname: () => "/bg",
}));

/*
 * A stand-in typeahead with one row for any term: enough to see the field
 * become a combobox, open its list and name it.
 */
vi.mock("@/components/catalog/search-suggestions", async () => {
  await held.typeahead.promise;
  const answer = (term: string) => ({ term, products: [], brands: [], categories: [], total: 1 });
  return {
    suggestionLinks: () => ({ results: (term: string) => `/bg/tarsene?q=${term}` }),
    suggestionOptions: (suggestions: { term: string }, term: string) =>
      suggestions.term === term ? [`/bg/tarsene?q=${term}`] : [],
    fetchSuggestions: (term: string, onResult: (s: ReturnType<typeof answer>) => void) => {
      onResult(answer(term));
      return () => undefined;
    },
    SuggestionPanel: ({ id, expanded }: { id: string; expanded: boolean }) =>
      expanded ? createElement("ul", { id, role: "listbox" }) : null,
  };
});

import { SearchField } from "@/components/catalog/search-field";
import { MobileNav } from "@/components/layout/mobile-nav";
import { buildNavigation } from "@/components/layout/navigation";
import { bg as dict } from "@/i18n/dictionaries/bg";
import { BUSINESS_SECTIONS } from "@/lib/catalog/business-sections";

let root: Root | null = null;
let recoverable: unknown[] = [];

function unmount() {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
}

afterEach(() => {
  unmount();
  recoverable = [];
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

const field = (props: { initialQuery?: string } = {}) =>
  createElement(SearchField, { locale: "bg", copy: dict.search, ...props });

/** Let the typeahead arrive, as a pointer on the way to a field asks it to. */
async function typeaheadHere() {
  held.typeahead.open();
  const host = await serve(field());
  fireEvent.pointerDown(host.querySelector("input")!);
  await settle();
  expect(host.querySelector("input")!.getAttribute("role")).toBe("combobox");
  unmount();
}

describe("the search field", () => {
  it("is drawn by the server as a plain search form, not yet a combobox", () => {
    const markup = renderToString(field());
    expect(markup).toMatch(/<form role="search"[^>]*action="\/bg\/tarsene" method="get"/);
    expect(markup).toContain('name="q"');
    expect(markup).not.toContain("combobox");
    expect(markup).not.toContain("aria-controls");
  });

  it("is drawn with the query it is handed, so the search page shows it before any script", async () => {
    expect(renderToString(field({ initialQuery: "lavazza" }))).toContain('value="lavazza"');
    const host = await serve(field({ initialQuery: "lavazza" }));
    expect(recoverable).toEqual([]);
    expect(host.querySelector("input")!.value).toBe("lavazza");
  });

  it("keeps the same input, and every character, while its typeahead arrives", async () => {
    const host = await serve(field(), (page) => {
      // Typed before the page hydrated.
      page.querySelector("input")!.value = "ла";
    });
    expect(recoverable).toEqual([]);
    const input = host.querySelector("input")!;
    expect(input.value).toBe("ла");
    // Not here yet. (Were it, this test would be testing nothing; it fails
    // instead.)
    expect(input.getAttribute("role")).toBeNull();

    // Reaching for the field asks for the typeahead; typing goes on meanwhile.
    fireEvent.pointerDown(input);
    act(() => input.focus());
    fireEvent.change(input, { target: { value: "лав" } });
    fireEvent.change(input, { target: { value: "лава" } });
    expect(input.getAttribute("role")).toBeNull();

    held.typeahead.open();
    await settle();

    expect(host.querySelector("input")).toBe(input);
    expect(input.value).toBe("лава");
    expect(document.activeElement).toBe(input);
    // And from now on it is the typeahead's combobox, with the list for what
    // was typed while it was on its way.
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    const listbox = document.querySelector('[role="listbox"]')!;
    expect(listbox).not.toBeNull();
    expect(input.getAttribute("aria-controls")).toBe(listbox.id);

    // Closed, the list leaves the page, and the field stops naming it.
    fireEvent.keyDown(input, { key: "Escape" });
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.getAttribute("aria-controls")).toBeNull();
  });

  it("keeps text typed before hydration when the typeahead is already here", async () => {
    await typeaheadHere();
    // The typeahead renders right after hydration — the render that would
    // write an empty value over the text.
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

    unmount();
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

  it("opens the drawer on the first tap, at once", async () => {
    const host = await serve(nav());
    const trigger = host.querySelector("a")!;

    // No waiting and no settling: the drawer is in the page the moment the
    // tap has been handled.
    act(() => void fireEvent.click(trigger));
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(dialog.id);
    expect(dialog.contains(document.activeElement)).toBe(true);

    act(() => void fireEvent.keyDown(document, { key: "Escape" }));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });
});
