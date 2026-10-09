import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/*
 * The enquiry form binds to the real server action, and the action module
 * opens a database pool on import. Rendering needs neither, so both are
 * replaced; what the action does with a submission is covered by
 * `forms.test.ts` and by the action's own source.
 */
vi.mock("@/lib/forms/actions", () => ({
  submitContactMessage: async () => ({ status: "idle" }),
}));

// The listing toolbar asks for the App Router, which only exists inside Next.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  useParams: () => ({ lang: "bg" }),
}));

import { BusinessSectionView } from "@/app/(site)/[lang]/_components/business-section";
import { parseCatalogQuery } from "@/lib/catalog/filters";
import type { ProductCardView, ProductListResult } from "@/lib/catalog/types";
import type { SectionListing } from "@/lib/catalog/vending";
import { consumablesCopy, vendingCopy, type BusinessSectionCopy } from "../content/vending";

/**
 * The two business pages, rendered to HTML without a database.
 *
 * The rule under test is the one the brief puts first: these pages show what
 * the catalog holds and nothing else. So a section with nothing behind it must
 * be absent from the markup — not present and empty — and the copy must not
 * make an offer the catalog cannot back.
 */

const query = parseCatalogQuery({});

function product(overrides: Partial<ProductCardView> = {}): ProductCardView {
  return {
    id: "p-1",
    slug: "test-vending-blend",
    name: "Кафе на зърна Test Vending Blend 1кг.",
    price: { amount: "20.00", currency: "EUR", formatted: "20,00 €" },
    oldPrice: null,
    discountPercent: null,
    availability: "in_stock",
    weight: "1 кг.",
    intensity: null,
    systemId: null,
    servingPrice: null,
    brand: { slug: "test", name: "TEST" },
    image: null,
    shortDescription: null,
    ...overrides,
  };
}

function listing(items: readonly ProductCardView[]): SectionListing {
  const result: ProductListResult = {
    items,
    total: items.length,
    page: 1,
    pageSize: 24,
    pageCount: 1,
    facets: { systems: [], brands: [], strengths: [], decaf: [], aromas: [], categories: [] },
  };
  return {
    category: { slug: "seeded", name: "Seeded", productCount: items.length },
    result,
  };
}

function render(props: {
  copy: BusinessSectionCopy;
  path: string;
  listing?: SectionListing | null;
  blends?: readonly ProductCardView[];
}): string {
  return renderToStaticMarkup(
    createElement(BusinessSectionView, {
      locale: "bg",
      copy: props.copy,
      path: props.path,
      query,
      listing: props.listing ?? null,
      ...(props.blends ? { blends: props.blends } : {}),
    }),
  );
}

/** Heading levels in document order, e.g. [1, 2, 3, 3, 2]. */
function headingLevels(html: string): number[] {
  return [...html.matchAll(/<h([1-6])[\s>]/g)].map((match) => Number(match[1]));
}

function expectSoundOutline(html: string): void {
  const levels = headingLevels(html);
  expect(levels.filter((level) => level === 1)).toHaveLength(1);
  expect(levels[0]).toBe(1);
  levels.forEach((level, index) => {
    // A heading may go one level deeper than the one before it, never two.
    if (index > 0) expect(level - (levels[index - 1] ?? 0)).toBeLessThanOrEqual(1);
  });
}

describe("vending page", () => {
  it("omits both product sections when the catalog has nothing for them", () => {
    const html = render({ copy: vendingCopy, path: "/kafe-za-vending-mashini" });

    expect(html).not.toContain(vendingCopy.blends?.heading);
    expect(html).not.toContain(vendingCopy.listing.heading);
    // No grid, no card, no filter panel, no ItemList for products that are not there.
    expect(html).not.toContain("<article");
    expect(html).not.toContain("Филтри");
    expect(html).not.toContain("ld-itemlist");
    // It says so instead, and still offers the enquiry.
    expect(html).toContain(vendingCopy.nothingListed);
    expect(html).toContain(vendingCopy.enquiry.heading);
    expectSoundOutline(html);
  });

  it("shows the blends, and only the blends, when that is what the catalog has", () => {
    const html = render({
      copy: vendingCopy,
      path: "/kafe-za-vending-mashini",
      blends: [product()],
    });

    expect(html).toContain(vendingCopy.blends?.heading);
    expect(html).toContain('href="/bg/test-vending-blend"');
    expect(html).toContain("20,00 €");
    expect(html).not.toContain(vendingCopy.listing.heading);
    expect(html).not.toContain(vendingCopy.nothingListed);
    expect(html).toContain("ld-itemlist");
    expectSoundOutline(html);
  });

  it("shows the category listing when the catalog has one", () => {
    const html = render({
      copy: vendingCopy,
      path: "/kafe-za-vending-mashini",
      listing: listing([product({ id: "p-2", slug: "from-category", name: "From category" })]),
      blends: [product()],
    });

    expect(html).toContain(vendingCopy.listing.heading);
    expect(html).toContain('href="/bg/from-category"');
    expect(html).toContain(vendingCopy.blends?.heading);
    // Sorting and filtering stay on this page rather than leaving for the category.
    expect(html).toContain('action="/bg/kafe-za-vending-mashini"');
    expectSoundOutline(html);
  });
});

describe("consumables page", () => {
  it("lists nothing and says so while the catalog holds no consumables", () => {
    const html = render({ copy: consumablesCopy, path: "/konsumativi" });

    expect(html).not.toContain(consumablesCopy.listing.heading);
    expect(html).not.toContain("<article");
    expect(html).not.toContain("ld-itemlist");
    expect(html).toContain(consumablesCopy.nothingListed);
    expect(html).toContain(consumablesCopy.explainer?.heading);
    expectSoundOutline(html);
  });

  it("never shows vending blends, even if handed some", () => {
    const html = render({ copy: consumablesCopy, path: "/konsumativi", blends: [product()] });

    expect(html).not.toContain("test-vending-blend");
    expect(html).toContain(consumablesCopy.nothingListed);
  });

  it("shows the category listing, and drops the disclaimer, once products arrive", () => {
    const html = render({
      copy: consumablesCopy,
      path: "/konsumativi",
      listing: listing([product({ slug: "paper-cups", name: "Seeded consumable" })]),
    });

    expect(html).toContain(consumablesCopy.listing.heading);
    expect(html).toContain('href="/bg/paper-cups"');
    expect(html).not.toContain(consumablesCopy.nothingListed);
    expectSoundOutline(html);
  });
});

describe.each([
  ["/kafe-za-vending-mashini", vendingCopy],
  ["/konsumativi", consumablesCopy],
] as const)("enquiry form on %s", (path, copy) => {
  const html = render({ copy, path });

  it("is the contact form, with its honeypot, and arrives labelled", () => {
    // One form: the contact form. Not a second pipeline.
    expect(html.match(/<form/g)).toHaveLength(1);
    expect(html).toMatch(/<input[^>]*name="website"/);
    expect(html).toMatch(
      /<input[^>]*name="email"[^>]*required|<input[^>]*required[^>]*name="email"/,
    );
    expect(html).toMatch(/<textarea[^>]*name="message"/);

    const subject = html.match(/<input[^>]*name="subject"[^>]*>/)?.[0] ?? "";
    expect(subject).toContain(`value="${copy.enquiry.subject}"`);
    // Prefilled, not hidden: the visitor sees what is sent.
    expect(subject).toContain('type="text"');
  });

  it("offers the phone number beside the form", () => {
    expect(html).toMatch(/href="tel:\+\d+"/);
  });

  it("has a breadcrumb trail ending on this page", () => {
    expect(html).toContain("ld-breadcrumbs");
    expect(html).toMatch(new RegExp(`aria-current="page"[^>]*>${copy.title}<`));
  });
});

/**
 * The honesty constraint, as far as a test can hold it.
 *
 * A test cannot judge whether a sentence is fair. It can refuse the specific
 * things these pages have no data for: a price in the prose, a delivery time,
 * a discount, a contract, servicing, a claim of stock. If a later edit needs
 * one of these words for an honest reason, the edit should also change this
 * list and say why.
 */
describe("copy makes no offer the catalog cannot back", () => {
  const flatten = (value: unknown): string[] =>
    typeof value === "string"
      ? [value]
      : value && typeof value === "object"
        ? Object.values(value).flatMap(flatten)
        : [];

  const forbidden: ReadonlyArray<[RegExp, string]> = [
    [/€|\bлв\b|\bEUR\b|\bBGN\b/iu, "a price or currency"],
    [/\d+\s*%/u, "a percentage"],
    [/отстъпк|намален|промоци|безплатн/iu, "a discount or something free"],
    [/\d+\s*(?:час|дни|ден|работн)/iu, "a delivery or reply time"],
    [/в рамките на/iu, "a time promise"],
    [/на склад|в наличност|имаме налични|разполагаме/iu, "a claim of stock"],
    [/договор|абонамент/iu, "a contract"],
    [/сервиз|ремонт|монтаж|гаранци/iu, "servicing or a guarantee"],
    [/под наем|наем/iu, "machine rental"],
  ];

  it.each([
    ["vending", vendingCopy],
    ["consumables", consumablesCopy],
  ] as const)("%s", (_name, copy) => {
    for (const text of flatten(copy)) {
      for (const [pattern, label] of forbidden) {
        expect(pattern.test(text), `${label} in: ${text}`).toBe(false);
      }
    }
  });

  it("the consumables copy states outright that nothing is listed", () => {
    expect(consumablesCopy.nothingListed).toMatch(/няма консумативи/u);
    expect(consumablesCopy.nothingListed).toMatch(/не обещаваме наличност/u);
  });
});
