import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AvailabilityBadge,
  Badge,
  Button,
  ButtonLink,
  ChipLink,
  EmptyState,
  Pagination,
  ReasonBadge,
  buttonClasses,
} from "@/components/ui/primitives";
import { ImagePlaceholder } from "@/components/catalog/image-placeholder";

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);
const classes = (markup: string) => /class="([^"]*)"/.exec(markup)?.[1]?.split(/\s+/) ?? [];

const VARIANTS = ["primary", "accent", "secondary", "ghost", "danger", "on-pine"] as const;
const SIZES = ["sm", "md", "lg"] as const;

describe("Button", () => {
  it("renders every variant at every size as a real button", () => {
    for (const variant of VARIANTS) {
      for (const size of SIZES) {
        const markup = html(createElement(Button, { variant, size }, "Изпрати"));
        expect(markup).toMatch(/^<button /);
        expect(markup).toContain(">Изпрати</button>");
        expect(classes(markup)).toContain("rounded-sm");
      }
    }
  });

  it("defaults to the primary variant at the middle size", () => {
    const names = classes(html(createElement(Button, null, "Изпрати")));
    expect(names).toContain("bg-pine-900");
    expect(names).toContain("min-h-11");
  });

  it("gives each variant the fill the standard names", () => {
    const of = (variant: (typeof VARIANTS)[number]) => buttonClasses({ variant }).split(/\s+/);
    expect(of("primary")).toEqual(
      expect.arrayContaining(["bg-pine-900", "text-paper", "hover:bg-pine-700"]),
    );
    expect(of("secondary")).toEqual(
      expect.arrayContaining(["border", "border-line-strong", "bg-paper-raised", "text-ink-900"]),
    );
    expect(of("ghost")).toEqual(expect.arrayContaining(["text-ink-700", "hover:bg-paper-sunken"]));
    expect(of("danger")).toEqual(expect.arrayContaining(["bg-critical", "text-paper"]));
    expect(of("on-pine")).toEqual(
      expect.arrayContaining(["border", "border-pine-200", "text-paper", "hover:bg-pine-700"]),
    );
  });

  it("makes the accent gold under ink, semibold, and lighter on hover on pine", () => {
    const names = classes(html(createElement(Button, { variant: "accent" }, "Поръчай")));
    expect(names).toEqual(
      expect.arrayContaining([
        "bg-gold-500",
        "text-ink-900",
        "font-semibold",
        "hover:bg-gold-600",
        "in-[.on-pine]:hover:bg-gold-300",
      ]),
    );
    // Gold is a fill, never text.
    expect(names.some((name) => /^text-gold/.test(name))).toBe(false);
  });

  it("sizes by minimum height and padding, never a fixed height", () => {
    const expected = {
      sm: ["min-h-9", "px-3", "py-1.5", "text-sm"],
      md: ["min-h-11", "px-5", "py-2.5", "text-base"],
      lg: ["min-h-12", "px-6", "py-3", "text-base"],
    } as const;
    for (const size of SIZES) {
      const names = classes(html(createElement(Button, { size }, "Изпрати")));
      expect(names).toEqual(expect.arrayContaining([...expected[size]]));
      expect(names.some((name) => /^h-\d/.test(name))).toBe(false);
    }
  });

  it("shows disabled as a sunken fill with readable text, not as opacity", () => {
    for (const variant of VARIANTS) {
      const markup = html(createElement(Button, { variant, disabled: true }, "Изпрати"));
      const names = classes(markup);
      expect(markup).toContain('disabled=""');
      expect(names).toEqual(
        expect.arrayContaining([
          "disabled:cursor-not-allowed",
          "disabled:bg-paper-sunken",
          "disabled:text-ink-500",
          "disabled:inset-ring-line",
        ]),
      );
      expect(names.some((name) => name.includes("opacity"))).toBe(false);
    }
  });

  it("keeps a caller's classes and attributes", () => {
    const markup = html(
      createElement(Button, { type: "submit", className: "w-full", "aria-busy": true }, "Изпрати"),
    );
    expect(markup).toContain('type="submit"');
    expect(markup).toContain('aria-busy="true"');
    expect(classes(markup)).toContain("w-full");
  });
});

describe("ButtonLink", () => {
  it("renders every variant as a link with the same classes as the button", () => {
    for (const variant of VARIANTS) {
      for (const size of SIZES) {
        const link = html(createElement(ButtonLink, { href: "/categories", variant, size }, "Виж"));
        const button = html(createElement(Button, { variant, size }, "Виж"));
        expect(link).toMatch(/^<a [^>]*href="\/categories"/);
        expect(classes(link)).toEqual(classes(button));
      }
    }
  });
});

describe("Badge", () => {
  const tone = (name: string) =>
    classes(html(createElement(Badge, { tone: name as "neutral", children: "Текст" })));

  it("renders every tone with its measured pairing", () => {
    expect(tone("neutral")).toEqual(expect.arrayContaining(["bg-paper-sunken", "text-ink-700"]));
    expect(tone("positive")).toEqual(expect.arrayContaining(["bg-pine-100", "text-pine-900"]));
    expect(tone("caution")).toEqual(expect.arrayContaining(["bg-caution-100", "text-caution"]));
    expect(tone("critical")).toEqual(expect.arrayContaining(["bg-critical-100", "text-critical"]));
    expect(tone("reduction")).toEqual(expect.arrayContaining(["bg-clay-600", "text-paper-raised"]));
  });

  it("keeps the old tone name `accent` as the reduction badge", () => {
    expect(tone("accent")).toEqual(tone("reduction"));
  });

  it("keeps clay for reductions only", () => {
    for (const name of ["neutral", "positive", "caution", "critical"]) {
      expect(tone(name).some((entry) => entry.includes("clay"))).toBe(false);
    }
  });

  it("is a static label: semibold, spaced, uppercase, with a minimum height", () => {
    const markup = html(createElement(Badge, null, "16 бр."));
    expect(markup).toMatch(/^<span /);
    expect(classes(markup)).toEqual(
      expect.arrayContaining([
        "inline-flex",
        "min-h-5",
        "items-center",
        "rounded-xs",
        "px-1.5",
        "text-2xs",
        "font-semibold",
        "tracking-[0.06em]",
        "uppercase",
      ]),
    );
  });

  it("writes a reason in sentence case", () => {
    const markup = html(createElement(ReasonBadge, null, "интензивност 8 от 12"));
    const names = classes(markup);
    expect(markup).toContain(">интензивност 8 от 12<");
    expect(names).toEqual(
      expect.arrayContaining(["bg-pine-100", "text-pine-900", "text-xs", "font-medium"]),
    );
    expect(names).not.toContain("uppercase");
    expect(names.some((name) => name.startsWith("tracking"))).toBe(false);
  });
});

describe("AvailabilityBadge", () => {
  const badge = (availability: string) => html(createElement(AvailabilityBadge, { availability }));

  it("maps every value to its words and tone", () => {
    expect(badge("in_stock")).toContain("В наличност");
    expect(badge("in_stock")).toContain("bg-pine-100");
    expect(badge("preorder")).toContain("По поръчка");
    expect(badge("preorder")).toContain("bg-caution-100");
    expect(badge("unknown")).toContain("Попитайте ни");
    expect(badge("unknown")).toContain("bg-paper-sunken");
  });

  it("shows sold out as neutral: it is not an error", () => {
    const markup = badge("out_of_stock");
    expect(markup).toContain("Изчерпан");
    expect(markup).toContain("bg-paper-sunken");
    expect(markup).not.toContain("critical");
  });

  it("never claims stock for a value it does not know", () => {
    expect(badge("something-new")).toContain("Попитайте ни");
  });
});

describe("ChipLink", () => {
  it("is a link in every kind", () => {
    for (const kind of ["choice", "filter", "answer"] as const) {
      const markup = html(createElement(ChipLink, { href: "/x", kind, children: "Lavazza" }));
      expect(markup).toMatch(/^<a [^>]*href="\/x"/);
      expect(classes(markup)).toEqual(
        expect.arrayContaining(["min-h-9", "rounded-sm", "border", "px-3", "text-sm"]),
      );
      expect(markup).not.toContain("critical");
    }
  });

  it("marks the selected choice for assistive technology and shows its count", () => {
    const markup = html(
      createElement(ChipLink, { href: "/x", selected: true, count: 33, children: "Dolce Gusto" }),
    );
    expect(markup).toContain('aria-current="page"');
    expect(classes(markup)).toEqual(expect.arrayContaining(["bg-pine-900", "text-paper"]));
    expect(markup).toMatch(/text-pine-200[^>]*>33</);
    expect(html(createElement(ChipLink, { href: "/x", children: "Dolce Gusto" }))).not.toContain(
      "aria-current",
    );
  });

  it("says what a filter chip and an answer chip do", () => {
    expect(
      html(createElement(ChipLink, { href: "/x", kind: "filter", children: "Силно" })),
    ).toContain('<span class="sr-only">— премахни филтъра</span>');
    const answer = html(
      createElement(ChipLink, { href: "/x", kind: "answer", label: "Вкус", children: "Силно" }),
    );
    expect(answer).toContain(">Вкус<");
    expect(answer).toContain('<span class="sr-only">— промяна на отговора</span>');
  });
});

describe("EmptyState and Pagination", () => {
  it("renders an empty state with its title, description and action", () => {
    const markup = html(
      createElement(EmptyState, {
        title: "Няма продукти с тези филтри",
        description: "Махнете някой филтър.",
        action: createElement(ButtonLink, { href: "/categories", variant: "secondary" }, "Всички"),
      }),
    );
    expect(markup).toContain("<h2");
    expect(markup).toContain("Няма продукти с тези филтри");
    expect(markup).toContain("Махнете някой филтър.");
    expect(markup).toContain('href="/categories"');
  });

  it("renders pagination as links sized by minimum height", () => {
    const markup = html(
      createElement(Pagination, {
        page: 2,
        pageCount: 3,
        buildHref: (page: number) => `/c?page=${page}`,
      }),
    );
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('rel="prev"');
    expect(markup).toContain('rel="next"');
    expect(markup).not.toMatch(/[" ]h-10[" ]/);
    expect(html(createElement(Pagination, { page: 1, pageCount: 1, buildHref: () => "/" }))).toBe(
      "",
    );
  });
});

describe("ImagePlaceholder", () => {
  it("is a drawing on the sunken tone with the words under it", () => {
    const markup = html(createElement(ImagePlaceholder));
    expect(markup).toContain("bg-paper-sunken");
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("text-line-strong");
    expect(markup).toContain("Няма снимка");
    expect(markup).not.toContain("<img");
  });

  it("drops the words where the well is too small for them", () => {
    expect(html(createElement(ImagePlaceholder, { label: false }))).not.toContain("Няма снимка");
    expect(html(createElement(ImagePlaceholder, { label: "from-sm" }))).toMatch(
      /class="hidden[^"]*sm:inline"[^>]*>Няма снимка/,
    );
  });
});
