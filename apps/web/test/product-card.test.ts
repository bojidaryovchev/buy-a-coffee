// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ProductCard, ProductGrid } from "@/components/catalog/product-card";
import { RecommendationCard } from "@/components/wizard/recommendation-card";
import { WizardNotice } from "@/components/wizard/wizard-ui";
import type { ProductCardView } from "@/lib/catalog/types";
import type { ScoredRecommendation } from "@/lib/recommend/score";

vi.mock("next/image", async () => {
  const React = await import("react");
  return {
    default: React.forwardRef<HTMLImageElement, Record<string, unknown>>(function Img(props, ref) {
      const { fill: _fill, priority: _priority, ...rest } = props;
      return React.createElement("img", { ref, ...rest });
    }),
  };
});

const INTERACTIVE = "a, button, input, select, textarea, summary, [tabindex], [role='button']";

const product = (overrides: Partial<ProductCardView> = {}): ProductCardView => ({
  id: "p1",
  slug: "kapsuli-dg-bianchi-gusto-forte-16-br",
  name: "Капсули DG Bianchi Gusto Forte Espresso 16 бр.",
  price: { amount: "5.60", currency: "EUR", formatted: "5,60 €" },
  oldPrice: null,
  discountPercent: null,
  availability: "in_stock",
  weight: "16 бр.",
  intensity: "10 от 12",
  systemId: "dolce-gusto",
  servingPrice: { formatted: "0,35 € на чаша", estimated: false },
  brand: { slug: "bianchi", name: "Bianchi" },
  image: { url: "/media/catalog/a.jpg", alt: "Кутия Bianchi Gusto Forte", width: 800, height: 800 },
  shortDescription: null,
  ...overrides,
});

/** The server-rendered card, parsed, so structure is asserted on a real tree. */
function card(overrides: Partial<ProductCardView> = {}, props: Record<string, unknown> = {}) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    createElement(ProductCard, { locale: "bg", product: product(overrides), ...props }),
  );
  return host;
}

const text = (node: Element | null) => node?.textContent?.replace(/\s+/g, " ").trim() ?? "";

describe("ProductCard: what it shows", () => {
  it("shows system, brand, pack, name, intensity, price and price per cup", () => {
    const root = card();
    expect(root.querySelector("[data-system='dolce-gusto']")?.textContent).toBe("Dolce Gusto");
    expect(text(root)).toContain("Bianchi");
    expect(text(root)).toContain("16 бр.");
    expect(text(root.querySelector("h3"))).toBe("Капсули DG Bianchi Gusto Forte Espresso 16 бр.");
    expect(text(root)).toContain("Интензивност 10 от 12");
    expect(text(root)).toContain("5,60 €");
    expect(text(root)).toContain("0,35 € на чаша");
  });

  it("sets the name in the sans face, not the display serif", () => {
    const heading = card().querySelector("h3");
    expect(heading?.className).toContain("font-sans");
    expect(heading?.className).not.toContain("font-display");
    expect(heading?.className).toContain("line-clamp-3");
  });

  it("puts the packshot on a white, unpadded, square well", () => {
    const root = card();
    const well = root.querySelector("article > div");
    expect(well?.className).toContain("aspect-square");
    expect(well?.className).toContain("bg-well");
    expect(well?.className).not.toMatch(/\bp[xy]?-\d/);
    const image = root.querySelector("img");
    expect(image?.getAttribute("alt")).toBe("Кутия Bianchi Gusto Forte");
    expect(image?.className).toBe("object-contain");
  });

  it("marks a reduction with the badge, the old price and words for a screen reader", () => {
    const root = card({
      oldPrice: { amount: "6.60", currency: "EUR", formatted: "6,60 €" },
      discountPercent: 15,
    });
    expect(text(root)).toContain("−15%");
    expect(text(root)).toContain("Намалена цена 5,60 €");
    expect(text(root)).toContain("Стара цена 6,60 €");
    expect(root.querySelector(".line-through")?.textContent).toBe("6,60 €");
    expect(root.innerHTML).toContain("text-clay-600");
  });

  it("shows no reduction when there is none", () => {
    const root = card();
    expect(text(root)).not.toContain("%");
    expect(text(root)).not.toContain("Стара цена");
    expect(root.querySelector(".line-through")).toBeNull();
    expect(root.innerHTML).not.toContain("clay");
  });

  it("shows no reduction badge without a stated percentage", () => {
    const root = card({ oldPrice: { amount: "6.60", currency: "EUR", formatted: "6,60 €" } });
    expect(text(root)).not.toContain("%");
    expect(text(root)).toContain("Стара цена 6,60 €");
  });

  it("says the price is on request rather than printing a zero", () => {
    const root = card({ price: null, servingPrice: null });
    expect(text(root)).toContain("Цена при запитване");
    expect(text(root)).not.toContain("0,00");
    expect(text(root)).not.toContain("на чаша");
  });

  it("marks an estimated price per cup as the data states it", () => {
    const root = card({ servingPrice: { formatted: "≈ 0,12 € на чаша", estimated: true } });
    expect(text(root)).toContain("≈ 0,12 € на чаша");
  });

  it("draws the placeholder, not an image, when there is no photograph", () => {
    const root = card({ image: null });
    expect(root.querySelector("img")).toBeNull();
    expect(text(root)).toContain("Няма снимка");
    expect(root.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("shows availability only when it is not the norm", () => {
    expect(text(card())).not.toContain("В наличност");
    expect(text(card({ availability: "preorder" }))).toContain("По поръчка");
    expect(text(card({ availability: "unknown" }))).toContain("Попитайте ни");
    expect(text(card({ availability: "out_of_stock" }))).toContain("Изчерпан");
  });

  it("uses h2 for the name where the grid sits directly under the h1", () => {
    const root = card({}, { headingLevel: "h2" });
    expect(root.querySelector("h3")).toBeNull();
    expect(root.querySelector("h2 a")).not.toBeNull();
  });
});

describe("ProductCard: equal heights", () => {
  /** The class lists of the body's rows, which is what fixes each row's height. */
  const rows = (root: Element) =>
    Array.from(root.querySelectorAll("article > div:last-child > *")).map((row) =>
      row.className
        .split(/\s+/)
        .filter((name) => /^(h-|min-h-|mt-|pt-)/.test(name))
        .sort()
        .join(" "),
    );

  it("keeps every row's box whatever the product is missing", () => {
    const full = rows(card());
    expect(full).toHaveLength(6);
    for (const missing of [
      { systemId: null },
      { intensity: null },
      { brand: null, weight: null },
      { servingPrice: null },
      { price: null, servingPrice: null },
      { availability: "out_of_stock" as const },
      { systemId: null, intensity: null, brand: null, weight: null, image: null },
    ]) {
      expect(rows(card(missing))).toEqual(full);
    }
  });

  it("gives the optional rows a height of their own", () => {
    const root = card({ systemId: null, intensity: null, servingPrice: null });
    const body = root.querySelector("article > div:last-child")!;
    expect(body.children[0]!.className).toContain("h-5");
    expect(body.children[0]!.textContent).toBe("");
    expect(body.children[3]!.className).toContain("h-4");
    expect(body.children[3]!.textContent).toBe("");
    expect(body.querySelector("p.text-pine-700")?.className).toContain("min-h-[1.125rem]");
  });

  it("pins the price block to the bottom", () => {
    expect(card().querySelector(".mt-auto")).not.toBeNull();
    expect(card().querySelector("article")?.className).toContain("h-full");
  });
});

describe("ProductCard: links and controls", () => {
  it("is one link to the product, stretched over the card", () => {
    const root = card();
    const links = Array.from(root.querySelectorAll("a"));
    expect(links).toHaveLength(2);
    expect(links[0]!.getAttribute("href")).toBe("/bg/kapsuli-dg-bianchi-gusto-forte-16-br");
    expect(links[0]!.className).toContain("after:absolute");
    expect(links[0]!.closest("h3")).not.toBeNull();
  });

  it("nests no interactive element inside another", () => {
    for (const overrides of [{}, { availability: "out_of_stock" as const }, { image: null }]) {
      const root = card(overrides);
      for (const element of Array.from(root.querySelectorAll(INTERACTIVE))) {
        expect(element.querySelector(INTERACTIVE)).toBeNull();
        expect(element.parentElement?.closest(INTERACTIVE)).toBeNull();
      }
      expect(root.querySelector("button")).toBeNull();
    }
  });

  it("server-renders the order control as a link to the form on the product page", () => {
    const control = card().querySelectorAll("a")[1]!;
    expect(control.getAttribute("href")).toBe("/bg/kapsuli-dg-bianchi-gusto-forte-16-br#order");
    expect(text(control)).toBe("Бърза поръчка: Капсули DG Bianchi Gusto Forte Espresso 16 бр.");
    // Above the stretched link, or the click would land on the product link.
    expect(control.className).toContain("relative");
    expect(control.className).toContain("z-10");
    expect(control.className).toContain("min-h-10");
    expect(control.className).not.toContain("gold");
  });

  it("server-renders no dialog and no form", () => {
    const root = card();
    expect(root.querySelector("dialog, form, input")).toBeNull();
  });

  it("offers the order control to everything that can be ordered", () => {
    for (const availability of ["in_stock", "preorder", "unknown"] as const) {
      expect(card({ availability }).querySelector("a[href$='#order']")).not.toBeNull();
    }
    expect(card({ price: null }).querySelector("a[href$='#order']")).not.toBeNull();
  });

  it("gives an out-of-stock product no order control, and a same-sized link instead", () => {
    const root = card({ availability: "out_of_stock" });
    expect(root.querySelector("a[href$='#order']")).toBeNull();
    expect(text(root)).not.toContain("Бърза поръчка");
    const fallback = root.querySelectorAll("a")[1]!;
    expect(fallback.getAttribute("href")).toBe("/bg/kapsuli-dg-bianchi-gusto-forte-16-br");
    expect(text(fallback)).toContain("Виж продукта");
    expect(fallback.className).toBe(card().querySelectorAll("a")[1]!.className);
  });
});

describe("ProductGrid", () => {
  const grid = (props: Record<string, unknown> = {}) => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      createElement(ProductGrid, {
        locale: "bg",
        products: [
          product({ id: "a" }),
          product({ id: "b", slug: "b" }),
          product({ id: "c", slug: "c" }),
        ],
        ...props,
      }),
    );
    return host;
  };

  it("is a list of two columns on a phone, three and four above", () => {
    const list = grid().querySelector("ul")!;
    expect(list.className).toContain("grid-cols-2");
    expect(list.className).toContain("md:grid-cols-3");
    expect(list.className).toContain("lg:grid-cols-4");
    expect(list.querySelectorAll(":scope > li > article")).toHaveLength(3);
  });

  it("can stay at three columns beside a filter rail", () => {
    expect(grid({ columns: 3 }).querySelector("ul")!.className).not.toContain("lg:grid-cols-4");
  });

  it("loads only the first images eagerly", () => {
    const images = Array.from(grid({ priorityCount: 1 }).querySelectorAll("img"));
    expect(images.map((image) => image.getAttribute("loading"))).toEqual([null, "lazy", "lazy"]);
  });
});

describe("RecommendationCard", () => {
  const entry = (overrides: Partial<ScoredRecommendation> = {}): ScoredRecommendation =>
    ({
      product: {
        ...product(),
        attributes: {},
        pricePerServing: "0.35",
        servings: 16,
        servingsEstimated: false,
      },
      score: 1,
      reasons: ["интензивност 10 от 12"],
      caveat: "Съдържа кофеин",
      ...overrides,
    }) as ScoredRecommendation;

  const render = (props: Record<string, unknown> = {}) => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      createElement(RecommendationCard, { locale: "bg", entry: entry(), rank: 1, ...props }),
    );
    return host;
  };

  it("uses a white, unpadded well and names the system", () => {
    const root = render();
    const well = root.querySelector("article > div");
    expect(well?.className).toContain("bg-well");
    expect(well?.className).not.toMatch(/\bp[xy]?-\d/);
    expect(root.querySelector("img")?.className).toBe("object-contain");
    expect(root.querySelector("[data-system='dolce-gusto']")).not.toBeNull();
    expect(text(root)).toContain("№1");
  });

  it("writes a reason as a phrase, not an uppercase label", () => {
    const reason = render().querySelector("li > span")!;
    expect(reason.textContent).toBe("интензивност 10 от 12");
    expect(reason.className).not.toContain("uppercase");
  });

  it("writes the caveat in the caution colour, never clay", () => {
    const root = render();
    expect(text(root)).toContain("Внимание: Съдържа кофеин");
    expect(root.innerHTML).toContain("text-caution");
    expect(root.innerHTML).not.toContain("clay");
  });

  it("sets the name in the sans face", () => {
    expect(render().querySelector("h3")?.className).toContain("font-sans");
  });
});

describe("WizardNotice", () => {
  const notice = (props: Record<string, unknown>) =>
    renderToStaticMarkup(createElement(WizardNotice, { ...props, children: "Текст" }));

  it("uses the caution tokens for a caution, with the title in the caution colour", () => {
    const markup = notice({ tone: "caution", title: "Заглавие" });
    expect(markup).toContain("border-caution");
    expect(markup).toContain("bg-caution-100");
    expect(markup).toContain("text-ink-900");
    expect(markup).toMatch(/<p class="[^"]*text-caution[^"]*">Заглавие/);
    expect(markup).not.toContain("clay");
  });

  it("stays neutral by default", () => {
    const markup = notice({ title: "Заглавие" });
    expect(markup).toContain("bg-paper-sunken");
    expect(markup).not.toContain("caution");
  });
});
