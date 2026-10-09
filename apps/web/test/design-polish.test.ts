// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * The design loose ends: the product gallery, the search field, the wizard's
 * answer chips and the wizard's analytics event. Each is rendered as the
 * server sends it, because what has to hold is what a visitor gets before —
 * or without — any script.
 */

const track = vi.fn();
vi.mock("@/components/analytics-provider", () => ({
  useAnalytics: () => ({ track }),
}));

// The interactive search field asks for the App Router, which only exists inside Next.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ lang: "bg" }),
}));

import { ProductGallery } from "@/components/catalog/product-gallery";
import { SearchField } from "@/components/catalog/search-field";
import { SearchFieldFallback } from "@/components/catalog/search-field-fallback";
import { bg } from "@/i18n/dictionaries/bg";
import { AnswerSummary } from "@/components/wizard/wizard-ui";
import { WizardAnalytics } from "@/components/wizard/wizard-analytics";
import type { ProductImageView } from "@/lib/catalog/types";

afterEach(() => {
  cleanup();
  track.mockReset();
});

function image(index: number, alt = ""): ProductImageView {
  return { url: `/media/catalog/p-${index}.jpg`, alt, width: 800, height: 800 };
}

const tags = (markup: string, tag: string) =>
  markup.match(new RegExp(`<${tag}\\b[^>]*>`, "g")) ?? [];

describe("product gallery", () => {
  const images = [image(1, "Пакет отпред"), image(2), image(3)];
  const markup = renderToStaticMarkup(
    createElement(ProductGallery, { images, productName: "Кафе Тест 1 кг" }),
  );

  it("puts every photograph in the markup, so all of them load with JavaScript off", () => {
    const srcs = tags(markup, "img").map((tag) => tag.match(/src="([^"]+)"/)?.[1] ?? "");
    for (const index of [1, 2, 3]) {
      // Each image twice: the well, and its thumbnail.
      expect(srcs.filter((src) => src.includes(`p-${index}.jpg`))).toHaveLength(2);
    }
  });

  it("lets every image be reached without a script: a thumbnail links to its anchor", () => {
    const ids = [...markup.matchAll(/<figure\b[^>]*\bid="([^"]+)"/g)].map((match) => match[1]);
    expect(ids).toHaveLength(3);
    const hrefs = [...markup.matchAll(/<a\b[^>]*href="#([^"]+)"/g)].map((match) => match[1]);
    expect(hrefs).toEqual(ids);
    // The scroller is a horizontal snap row a phone swipes and a keyboard scrolls.
    expect(markup).toMatch(/role="region"[^>]*tabindex="0"[^>]*snap-x snap-mandatory/);
  });

  it("names the thumbnails 'Снимка i от n' and marks the first as current", () => {
    const thumbs = tags(markup, "a");
    expect(thumbs.map((tag) => tag.match(/aria-label="([^"]+)"/)?.[1])).toEqual([
      "Снимка 1 от 3",
      "Снимка 2 от 3",
      "Снимка 3 от 3",
    ]);
    expect(thumbs[0]).toContain('aria-current="true"');
    expect(thumbs[0]).toContain("border-2 border-pine-700");
    expect(thumbs[1]).not.toContain("aria-current");
    for (const tag of thumbs) expect(tag).toContain("h-16 w-16");
    // Thumbnails are the desktop's; a phone swipes instead.
    expect(markup).toContain("hidden flex-wrap gap-2 md:flex");
  });

  it("prints the phone's '1 / 3' counter under each image, hidden from md up", () => {
    const counters = [...markup.matchAll(/<figcaption\b[^>]*>([^<]*)<\/figcaption>/g)].map(
      (match) => match[1]!.replace(/<!-- -->/g, ""),
    );
    expect(counters).toEqual(["1 / 3", "2 / 3", "3 / 3"]);
    expect(markup).toMatch(/<figcaption[^>]*md:hidden/);
  });

  it("uses the stored alt text, else the product name, and preloads the first image only", () => {
    const wells = tags(markup, "img").filter((tag) => !tag.includes('alt=""'));
    expect(wells.map((tag) => tag.match(/alt="([^"]*)"/)?.[1])).toEqual([
      "Пакет отпред",
      "Кафе Тест 1 кг",
      "Кафе Тест 1 кг",
    ]);
    const preloaded = tags(markup, "img").filter((tag) => !tag.includes('loading="lazy"'));
    expect(preloaded).toHaveLength(1);
    expect(preloaded[0]).toContain("p-1.jpg");
  });

  it("shows one plain well, with no controls, for a single photograph", () => {
    const single = renderToStaticMarkup(
      createElement(ProductGallery, { images: [image(1)], productName: "Кафе" }),
    );
    expect(tags(single, "img")).toHaveLength(1);
    expect(single).not.toContain("<a ");
    expect(single).not.toContain("figcaption");
  });

  it("shows the image placeholder when there is no photograph", () => {
    const none = renderToStaticMarkup(
      createElement(ProductGallery, { images: [], productName: "Кафе" }),
    );
    expect(none).not.toContain("<img");
    expect(none).toContain("Няма снимка");
    expect(none).toContain("bg-paper-sunken");
  });
});

describe("search field", () => {
  const props = { locale: "bg" as const, copy: bg.search };
  const fallback = renderToStaticMarkup(createElement(SearchFieldFallback, props));
  const live = renderToStaticMarkup(createElement(SearchField, props));

  it("submits to the locale's search page, with no script", () => {
    expect(fallback).toContain('action="/bg/tarsene"');
    expect(live).toContain('action="/bg/tarsene"');
  });

  it("is the same control before and after hydration", () => {
    const shape = (markup: string) =>
      markup
        .replace(/ (id|for|aria-controls)="[^"]*"/g, "")
        .replace(/ (role="combobox"|aria-expanded="false"|aria-autocomplete="list"|value="")/g, "")
        .replace(/ maxLength="\d+"/g, "");
    const liveForm = live.slice(live.indexOf("<form"), live.indexOf("</form>") + 7);
    expect(shape(liveForm).replace(/<form[^>]*>/, "")).toBe(
      shape(fallback).replace(/<form[^>]*>/, ""),
    );
  });

  it.each([
    ["fallback", fallback],
    ["interactive", live],
  ])("%s: grows instead of a fixed height, sets 16 px text, and shows focus", (_, markup) => {
    const box = markup.match(/<div class="([^"]+)"><input/)?.[1] ?? "";
    const input = tags(markup, "input")[0] ?? "";
    expect(box).toContain("min-h-11");
    expect(box).not.toMatch(/(^| )h-11( |$)/);
    // The ring is drawn around the whole box while the field has keyboard focus.
    expect(box).toContain("has-[input:focus-visible]:outline-2");
    expect(box).toContain("has-[input:focus-visible]:outline-pine-700");
    expect(box).toContain("hover:border-ink-500");
    expect(input).toContain("text-input");
    expect(input).not.toMatch(/(^|[" ])text-base( |")/);
    expect(input).not.toMatch(/(^|[" ])outline-none( |")/);
    expect(input).toContain('placeholder="Търсете кафе, марки, капсули…"');
    expect(input).toContain('type="search"');
  });

  it("keeps the typeahead's combobox semantics", () => {
    const input = tags(live, "input")[0] ?? "";
    expect(input).toContain('role="combobox"');
    expect(input).toContain('aria-autocomplete="list"');
    expect(input).toContain('aria-expanded="false"');
    expect(input).toMatch(/aria-controls="[^"]+"/);
    expect(live).toMatch(/<form role="search"[^>]*action="\/bg\/tarsene" method="get"/);
  });
});

describe("wizard answer chips", () => {
  const entries = [
    { label: "Система", value: "Dolce Gusto", href: "/wizard?step=system" },
    { label: "Вкус", value: "Силно", href: "/wizard?system=dolce-gusto&step=taste" },
  ];

  it("are answer chips that keep each link and its accessible name", () => {
    const { container } = render(createElement(AnswerSummary, { entries }));
    const links = [...container.querySelectorAll("a")];
    expect(links.map((link) => link.getAttribute("href"))).toEqual(entries.map((e) => e.href));
    expect(links.map((link) => link.textContent)).toEqual([
      "СистемаDolce Gusto— промяна на отговора",
      "ВкусСилно— промяна на отговора",
    ]);
    for (const link of links) {
      expect(link.className).toContain("min-h-9");
      expect(link.className).toContain("border-line-strong");
      expect(link.className).toContain("hover:border-ink-900");
    }
    expect(container.querySelector("section")?.getAttribute("aria-label")).toBe("Вашите отговори");
  });
});

describe("wizard_completed", () => {
  it("carries the facts the ranking used, within the property cap", () => {
    render(
      createElement(WizardAnalytics, {
        system: "beans",
        taste: "strong",
        volume: null,
        budget: null,
        requirements: [],
        resultCount: 3,
        relaxed: [],
        factsUsed: ["composition", "roast"],
      }),
    );
    expect(track).toHaveBeenCalledOnce();
    const event = track.mock.calls[0]![0] as Record<string, unknown>;
    expect(event.name).toBe("wizard_completed");
    expect(event.factsUsed).toBe("composition,roast");
    expect(Object.keys(event).filter((key) => key !== "name").length).toBeLessThanOrEqual(8);
  });

  it("sends an empty string when no fact was used", () => {
    render(
      createElement(WizardAnalytics, {
        system: "dolce-gusto",
        taste: null,
        volume: null,
        budget: null,
        requirements: [],
        resultCount: 0,
        relaxed: [],
        factsUsed: [],
      }),
    );
    expect((track.mock.calls[0]![0] as Record<string, unknown>).factsUsed).toBe("");
  });
});
