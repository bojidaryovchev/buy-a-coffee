import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/*
 * `@/lib/db` opens a pool the moment it is imported and throws when there is
 * no `DATABASE_URL`. The selection is pure and the fact lookup reads no rows,
 * so the module is replaced by an inert stand-in. The same rules against a
 * real catalog are `beans-sections.db.test.ts`.
 */
vi.mock("@/lib/db", () => ({ db: {} }));

import { brandFacts, brandFactsFor } from "../content/brand-facts";
import { categoryCopy, sectionText, segmentParagraph } from "../content/category-copy";
import { ListingSections } from "@/components/catalog/listing-sections";
import { withSectionFacts, type BeansSectionsView } from "@/lib/catalog/beans-section-queries";
import {
  BEANS_SECTION_IDS,
  ITALIAN_SECTION_MAX,
  ITALIAN_SECTION_MIN,
  selectBeansSections,
  type BeansSectionRow,
} from "@/lib/catalog/beans-sections";
import type { ProductCardView } from "@/lib/catalog/types";
import {
  categoryDescriptionLead,
  categoryHeading,
  categoryTitle,
  fullTitle,
} from "@/lib/seo/listing-meta";
import { KEYWORD_MAP, carries, carriesIgnoringPunctuation } from "./keyword-map";

/**
 * The beans listing's two sections by use (research `09`, T2.2): what each
 * shows, the words over them, the brand record the Italian one reads, and
 * what the sections must leave alone on a page that is under measurement.
 */

/* --- Fixtures ------------------------------------------------------------ */

const BEANS = ["kafe-na-zarna", "kafe-na-zyrna"];

let sequence = 0;

/** A bag of beans on sale: 1 kg at 20,00 €, of a brand that is not Italian. */
function row(overrides: Partial<BeansSectionRow> = {}): BeansSectionRow {
  sequence += 1;
  return {
    id: `p-${String(sequence).padStart(3, "0")}`,
    name: `Кафе на зърна Test ${sequence} 1кг.`,
    brandSlug: `brand-${sequence}`,
    brandSourceKey: `brand-${sequence}`,
    price: "20.00",
    weightValue: "1000.0000",
    weightUnit: "g",
    availability: "in_stock",
    attributes: {},
    categoryKeys: BEANS,
    italianBrand: false,
    brandName: `Brand ${sequence}`,
    ...overrides,
  };
}

/** A pack of an Italian brand, named as the page writes it. */
const italian = (name: string, price: string, overrides: Partial<BeansSectionRow> = {}) =>
  row({
    price,
    brandSlug: name.toLowerCase().replace(/[^a-z]+/g, ""),
    brandSourceKey: name.toLowerCase().replace(/[^a-z]+/g, ""),
    brandName: name,
    italianBrand: true,
    ...overrides,
  });

const italianIds = (rows: readonly BeansSectionRow[]) =>
  selectBeansSections(rows).italian?.map((item) => item.id) ?? null;

/* --- The Italian section ------------------------------------------------- */

describe("the Italian section", () => {
  it("is absent from an empty catalog, and so is the other", () => {
    expect(selectBeansSections([])).toEqual({ italian: null, automatic: null });
  });

  it("lists one pack per Italian brand: the brand's lowest price per kilogram", () => {
    const a1 = italian("Alfa", "21.00");
    const a2 = italian("Alfa", "19.00");
    const b1 = italian("Beta", "18.00");
    const c1 = italian("Gamma", "25.00");
    const c2 = italian("Gamma", "11.00", { weightValue: "500.0000" }); // 22,00 € / kg
    expect(italianIds([a1, a2, b1, c1, c2])).toEqual([a2.id, b1.id, c2.id]);
    const perKg = selectBeansSections([a1, a2, b1, c1, c2]).italian?.map((item) =>
      Number(item.perKg),
    );
    expect(perKg).toEqual([19, 18, 22]);
  });

  it("orders the brands by name, case aside, and not by price", () => {
    const rows = [
      italian("Vergnano", "10.00"),
      italian("illy", "39.20"),
      italian("Biancaffè", "16.90"),
      italian("Kimbo", "24.60"),
      italian("Excelsior", "18.50"),
    ];
    expect(italianIds(rows)).toEqual(
      ["Biancaffè", "Excelsior", "illy", "Kimbo", "Vergnano"].map(
        (name) => rows.find((entry) => entry.brandName === name)!.id,
      ),
    );
  });

  it("lets a brand's cheapest pack stand for it whatever its name says, Vending included", () => {
    // Regression: Moreno's vending blend is its cheapest per kilogram, and the
    // sentence „с най-ниската цена за килограм при нея“ must hold of it.
    const vending = italian("Moreno", "15.50", { name: "Кафе на зърна Moreno Vending 1кг." });
    const bar = italian("Moreno", "20.00", { name: "Кафе на зърна Moreno Espresso Bar 1кг." });
    const rows = [bar, vending, italian("Lollo Caffè", "16.50"), italian("Borbone", "19.00")];
    expect(italianIds(rows)).toEqual([rows[3]!.id, rows[2]!.id, vending.id]);
  });

  it("lists every Italian brand up to the cap, the first by name", () => {
    expect(ITALIAN_SECTION_MAX).toBe(12);
    const names = Array.from(
      { length: ITALIAN_SECTION_MAX + 3 },
      (_, index) => `Brand ${String.fromCharCode(79 - index)}`,
    ); // O, N, M, … — given in reverse order
    const rows = names.map((name, index) => italian(name, `${15 + index}.00`));
    const listed = italianIds(rows)!;
    expect(listed).toHaveLength(ITALIAN_SECTION_MAX);
    const byName = [...rows].sort((a, b) => a.brandName!.localeCompare(b.brandName!));
    expect(listed).toEqual(byName.slice(0, ITALIAN_SECTION_MAX).map((entry) => entry.id));
  });

  it("is absent with fewer than three Italian brands, however many packs they have", () => {
    expect(ITALIAN_SECTION_MIN).toBe(3);
    const two = [
      italian("Alfa", "20.00"),
      italian("Alfa", "21.00"),
      italian("Beta", "22.00"),
      italian("Beta", "23.00"),
    ];
    expect(italianIds(two)).toBeNull();
    expect(italianIds([...two, italian("Gamma", "24.00")])).toHaveLength(3);
  });

  it("leaves out every brand that is not recorded as Italian", () => {
    const rows = [
      italian("Alfa", "20.00"),
      italian("Beta", "21.00"),
      italian("Gamma", "22.00"),
      row({ price: "5.00" }),
      row({ price: "6.00", brandSlug: "molini", brandName: "Molini" }),
    ];
    expect(italianIds(rows)).toEqual(rows.slice(0, 3).map((entry) => entry.id));
  });

  it("needs a brand to group by: a product with none is no brand's pack", () => {
    const rows = [
      italian("Alfa", "20.00"),
      italian("Beta", "21.00"),
      row({ price: "10.00", brandSlug: null, brandSourceKey: null, italianBrand: true }),
    ];
    expect(italianIds(rows)).toBeNull();
  });

  it.each([
    ["sold out", { availability: "out_of_stock" }],
    ["without a price", { price: null }],
    ["without a pack weight", { weightValue: null }],
    ["sold by the piece", { weightUnit: "pcs" }],
    ["not coffee beans", { categoryKeys: ["dolce-gusto"] }],
    ["filed under no category", { categoryKeys: [] }],
    ["instant coffee filed under beans", { name: "Разтворимо кафе Test 0.500кг." }],
  ] as const)("never lists a pack %s", (_label, overrides) => {
    const base = [italian("Alfa", "20.00"), italian("Beta", "21.00"), italian("Gamma", "22.00")];
    // The cheapest pack of a listed brand, and the only pack of another.
    const odd = [
      italian("Alfa", "10.00", overrides as Partial<BeansSectionRow>),
      italian("Delta", "10.00", overrides as Partial<BeansSectionRow>),
    ];
    expect(italianIds([...base, ...odd])).toEqual(base.map((entry) => entry.id));
  });

  it("still lists a pack whose availability is unknown, which can be asked about", () => {
    const unknown = italian("Alfa", "10.00", { availability: "unknown" });
    const rows = [
      unknown,
      italian("Alfa", "12.00"),
      italian("Beta", "11.00"),
      italian("Gamma", "12.00"),
    ];
    expect(italianIds(rows)?.[0]).toBe(unknown.id);
  });

  it("breaks an equal price per kilogram by the supplier's name, then by id", () => {
    const later = italian("Biancaffè", "16.90", {
      id: "p-900",
      name: "Кафе на зърна Espressia Capri 1кг.",
    });
    const earlier = italian("Biancaffè", "16.90", {
      id: "p-901",
      name: "Кафе на зърна Biancaffe Intenso 1кг.",
    });
    const rest = [italian("Borbone", "18.00"), italian("Excelsior", "19.00")];
    expect(italianIds([later, earlier, ...rest])?.[0]).toBe(earlier.id);

    const same = { name: "Кафе на зърна Same 1кг." };
    const x = italian("Alfa", "14.00", { id: "p-b", ...same });
    const y = italian("Alfa", "14.00", { id: "p-a", ...same });
    expect(italianIds([x, y, ...rest])?.[0]).toBe("p-a");
  });

  it("gives the same answer whatever order the catalog arrives in", () => {
    const rows = [
      italian("Alfa", "14.00", { name: "B" }),
      italian("Alfa", "14.00", { name: "A" }),
      italian("Beta", "13.00"),
      italian("Gamma", "20.00"),
      italian("gamma", "19.00", { brandSlug: "gamma-two", brandSourceKey: "gamma-two" }),
      row({ attributes: { aromas: "yes" } }),
    ];
    const expected = selectBeansSections(rows);
    for (const shuffled of [[...rows].reverse(), [...rows.slice(3), ...rows.slice(0, 3)]]) {
      expect(selectBeansSections(shuffled)).toEqual(expected);
    }
  });
});

/* --- The automatic-machine section --------------------------------------- */

describe("the automatic-machine section", () => {
  it("lists no products, and is there while any coffee beans are on sale", () => {
    expect(selectBeansSections([row()]).automatic).toEqual({ flavoured: false });
    expect(selectBeansSections([row({ categoryKeys: ["dolce-gusto"] })]).automatic).toBeNull();
    expect(
      selectBeansSections([row({ name: "Разтворимо кафе Test 0.200кг." })]).automatic,
    ).toBeNull();
  });

  it("knows when a flavoured coffee is among the beans, sold out or not", () => {
    for (const aromas of ["yes", "YES", " yes "]) {
      expect(selectBeansSections([row(), row({ attributes: { aromas } })]).automatic).toEqual({
        flavoured: true,
      });
    }
    expect(
      selectBeansSections([
        row(),
        row({ attributes: { aromas: "yes" }, availability: "out_of_stock" }),
      ]).automatic?.flavoured,
    ).toBe(true);
    // Not beans: a flavoured capsule says nothing about the beans page.
    expect(
      selectBeansSections([
        row(),
        row({ attributes: { aromas: "yes" }, categoryKeys: ["nespresso"] }),
      ]).automatic?.flavoured,
    ).toBe(false);
    expect(selectBeansSections([row({ attributes: { aromas: "no" } })]).automatic?.flavoured).toBe(
      false,
    );
  });
});

/* --- The facts handed in -------------------------------------------------- */

describe("withSectionFacts", () => {
  const plain = (brandSlug: string | null, brandSourceKey: string | null = brandSlug) =>
    row({ brandSlug, brandSourceKey, italianBrand: false, brandName: null });

  it("reads Italian from the brand record, by the brand's stored slug", () => {
    for (const slug of ["lavazza", "kimbo", "illy", "borbone", "vergnano", "vandino", "moreno"]) {
      expect(withSectionFacts(plain(slug)).italianBrand, slug).toBe(true);
    }
    for (const slug of ["elia", "este", "tezzoro", "julius-meinl", "eurocaf", "molini", "amann"]) {
      expect(withSectionFacts(plain(slug)).italianBrand, slug).toBe(false);
    }
    expect(withSectionFacts(plain(null)).italianBrand).toBe(false);
  });

  it("names the brand as the page writes it, from its source key", () => {
    expect(withSectionFacts(plain("lollocafe")).brandName).toBe("Lollo Caffè");
    expect(withSectionFacts(plain("biancaffe")).brandName).toBe("Biancaffè");
    expect(withSectionFacts(plain("illy")).brandName).toBe("illy");
    expect(withSectionFacts(plain("moreno", "cafe-moreno")).brandName).toBe("Moreno");
    expect(withSectionFacts(plain(null)).brandName).toBeNull();
  });
});

/* --- The brand record ----------------------------------------------------- */

describe("what makes a brand Italian (content/brand-facts.ts)", () => {
  it("records every Italian brand under one standard, saying which way it qualifies", () => {
    for (const [key, facts] of Object.entries(brandFacts)) {
      if (facts.italian === undefined) continue;
      expect(facts.italian, key).toMatch(/^(Company|Town|Own words|Own site): \S/u);
    }
  });

  it("does not call a brand Italian for its name or for where it was roasted", () => {
    for (const slug of [
      "molini",
      "rema-caffe",
      "eurocaf",
      "elia",
      "este",
      "tezzoro",
      "3bourbons",
      "amann",
      "julius-meinl",
      "bianchi",
    ]) {
      expect(brandFactsFor({ slug }).italian, slug).toBeUndefined();
    }
  });
});

/* --- The words ----------------------------------------------------------- */

const beans = categoryCopy["kafe-na-zyrna"]!;
const sections = beans.sections!;

const sentences = (text: string) => text.split(/(?<=[.!?])\s+(?=[А-ЯA-Z„])/u).filter(Boolean);

/** Each section in each state the catalog can put it in. */
const SAID = BEANS_SECTION_IDS.flatMap((id) =>
  [false, true].map(
    (flavoured) => [id, flavoured, sectionText(sections[id], { flavoured })] as const,
  ),
);

describe("the sections' copy", () => {
  it("heads each section in the words the searches use", () => {
    expect(sections.italian.heading).toBe("Италианско кафе на зърна");
    expect(sections.automatic.heading).toBe("Кафе на зърна за автоматична кафемашина");
  });

  it("is written for the beans listing only", () => {
    const withSections = Object.entries(categoryCopy)
      .filter(([, copy]) => copy.sections !== undefined)
      .map(([key]) => key);
    expect(withSections).toEqual(["kafe-na-zyrna"]);
    expect(Object.keys(sections).sort()).toEqual([...BEANS_SECTION_IDS].sort());
  });

  it.each(SAID)("%s (flavoured: %s): one to three sentences, trimmed", (_id, _flavoured, text) => {
    expect(text).toBe(text.trim());
    expect(sentences(text).length, text).toBeGreaterThanOrEqual(1);
    expect(sentences(text).length, text).toBeLessThanOrEqual(3);
    expect(text.length).toBeLessThan(450);
  });

  it("says every bean suits an automatic machine only while no flavoured bean is on sale", () => {
    const every = "Затова всяко кафе на зърна от тази страница става за нея";
    expect(sectionText(sections.automatic, { flavoured: false })).toContain(every);
    expect(sectionText(sections.automatic, { flavoured: true })).not.toContain(every);
    expect(sectionText(sections.automatic, { flavoured: true })).not.toMatch(/всяко/u);
    // The Italian section says the same in both states.
    expect(sectionText(sections.italian, { flavoured: true })).toBe(
      sectionText(sections.italian, { flavoured: false }),
    );
  });

  it("makes no claim about vending blends, and none that vending machines grind", () => {
    for (const [, , text] of SAID) {
      expect(text).not.toMatch(/vending/iu);
      expect(text).not.toMatch(/вендинг автомати, които/u);
    }
    expect(sectionText(sections.automatic, { flavoured: false })).toContain(
      "вендинг автоматите на зърна",
    );
  });

  it("says what the Italian list is: by brand name, one pack each, the lowest per kilogram", () => {
    const text = sectionText(sections.italian, { flavoured: false });
    expect(text).toContain("Марките са подредени по име");
    expect(text).toContain("с по една опаковка от всяка");
    expect(text).toContain("с най-ниската цена за килограм при нея");
    expect(text).toContain("изпечено в Италия");
  });

  it.each(SAID)(
    "%s (flavoured: %s): names no figure, price, count, product or brand that could go stale",
    (id, _flavoured, text) => {
      for (const words of [sections[id].heading, text]) {
        expect(words).not.toMatch(/\d|€|лв\.|EUR|BGN/u);
        expect(words).not.toMatch(
          /lavazza|kimbo|illy|borbone|vergnano|biancaff|lollo|vandino|moreno|excelsior|elia|este|rema|molini/iu,
        );
      }
    },
  );

  it.each(SAID)("%s (flavoured: %s): links each phrase it names, once", (id, _flavoured, text) => {
    const links = sections[id].links ?? [];
    for (const link of links) expect(text.split(link.phrase).length - 1, link.phrase).toBe(1);
    const linked = segmentParagraph(text, links).filter((segment) => typeof segment !== "string");
    expect(linked).toHaveLength(links.length);
  });

  it("points to the owner of each cluster it mentions, by the owner's head term", () => {
    expect(sections.italian.links).toEqual([{ phrase: "марки кафе", to: "/marki" }]);
    expect(sections.automatic.links).toEqual([
      { phrase: "кафе за вендинг машини", to: "/kafe-za-vending-mashini" },
    ]);
    // Never the machine finder: a system's listing links to it once, from its lead.
    for (const id of BEANS_SECTION_IDS) {
      for (const link of sections[id].links ?? []) expect(link.to).not.toBe("/za-kafemashina");
    }
  });

  it("carries no other page's head term in a heading, and the page's own in both", () => {
    for (const id of BEANS_SECTION_IDS) {
      const { heading } = sections[id];
      expect(carries(heading, "кафе на зърна"), heading).toBe(true);
      for (const owner of KEYWORD_MAP) {
        if (owner.page === "kafe-na-zarna") continue;
        for (const term of [...owner.head, ...(owner.twins ?? [])]) {
          expect(carriesIgnoringPunctuation(heading, term), `${heading} / ${term}`).toBe(false);
        }
      }
    }
    // The searches T2.2 names are this page's to answer, not anybody's head term.
    const owned = new Set(KEYWORD_MAP.flatMap((owner) => [...owner.head, ...(owner.twins ?? [])]));
    for (const term of [
      "италианско кафе на зърна",
      "италианско кафе",
      "кафе за кафеавтомат",
      "кафе на зърна за кафеавтомат",
      "кафе на зърна за автоматична кафемашина",
    ]) {
      expect(owned.has(term), term).toBe(false);
    }
    const beansRow = KEYWORD_MAP.find((owner) => owner.page === "kafe-na-zarna");
    expect(beansRow?.also).toContain("италианско кафе на зърна");
  });

  it("uses no letter the self-hosted faces might not draw: Cyrillic, ASCII and Latin-1 only", () => {
    for (const [id, , text] of SAID) {
      // Letters only; punctuation such as „ “ — is outside the question.
      const letters = `${sections[id].heading} ${text}`.match(/\p{L}/gu) ?? [];
      const foreign = letters.filter((letter) => {
        const code = letter.codePointAt(0)!;
        return code > 0xff && !(code >= 0x400 && code <= 0x45f);
      });
      expect(foreign, id).toEqual([]);
    }
  });
});

/* --- What the sections leave alone ---------------------------------------- */

/*
 * The beans page is a stage-one page of Milestone 1 (research `09`, T1.1):
 * its title, heading and lead are being measured, and the title and canonical
 * are frozen. The sections add to the page below the products and change none
 * of the four. The values are written out, as they stand on the page today.
 */
describe("the beans page's head, unchanged", () => {
  const keys = { sourceKey: "kafe-na-zyrna", slug: "kafe-na-zarna", name: "Кафе на зърна" };

  it("keeps its title, heading and description lead", () => {
    expect(categoryTitle(keys)).toBe("Кафе на зърна — цена за кг и на чаша");
    expect(fullTitle(categoryTitle(keys))).toBe(
      "Кафе на зърна — цена за кг и на чаша | Buy a Coffee",
    );
    expect(categoryHeading(keys)).toBe("Кафе на зърна");
    expect(categoryDescriptionLead(keys)).toBe(
      "Кафе на зърна с цена за килограм до всяка опаковка",
    );
  });

  it("keeps the T1.1 lead word for word", () => {
    expect(beans.lead).toBe(
      "Кафе на зърна за автоматични кафемашини с вградена мелачка и за собствена мелачка у дома. Под всяка опаковка е цената на чаша, а на страницата на продукта и цената за 1 кг, така че сравнявате пакети с различен размер по едно и също мерило. Зърната се мелят точно преди кафето, затова тук избирате само вкус и опаковка.",
    );
  });

  it("keeps its introduction's heading and paragraphs", () => {
    expect(beans.heading).toBe("За кого е кафето на зърна");
    expect(beans.paragraphs).toHaveLength(3);
  });
});

/* --- The markup ------------------------------------------------------------ */

function card(
  id: string,
  title: string,
  overrides: Partial<ProductCardView> = {},
): ProductCardView {
  return {
    id,
    slug: `${id}-kafe-na-zarna-1-kg`,
    name: `${title} — кафе на зърна, 1 кг`,
    title,
    price: { amount: "20.00", currency: "EUR", formatted: "20,00 €" },
    oldPrice: null,
    discountPercent: null,
    availability: "in_stock",
    weight: "1 кг",
    intensity: null,
    systemId: "beans",
    servingPrice: null,
    brand: null,
    image: null,
    shortDescription: null,
    ...overrides,
  };
}

const italianView = (titles: readonly string[]) =>
  titles.map((title, index) => ({
    card: card(`italian-${index}`, title),
    perKilogram: `${16 + index},50 € / кг`,
  }));

const render = (view: BeansSectionsView) =>
  renderToStaticMarkup(ListingSections({ locale: "bg", copy: sections, sections: view }) ?? "");

const headingsOf = (html: string) =>
  [...html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/g)].map((match) => match[1]);

describe("ListingSections", () => {
  it("draws the Italian brands with their price per kilogram, then the automatic section", () => {
    const html = render({
      italian: italianView(["Biancaffè Intenso", "Borbone Intenso", "Excelsior Sapphire"]),
      automatic: { flavoured: false },
    });
    expect(headingsOf(html)).toEqual([
      "Италианско кафе на зърна",
      "Кафе на зърна за автоматична кафемашина",
    ]);
    expect(html).toContain('href="/bg/italian-0-kafe-na-zarna-1-kg"');
    expect(html).toContain("Biancaffè Intenso, 1 кг");
    // DESIGN.md, "Price per cup / per kg".
    expect(html).toMatch(
      /<span class="[^"]*font-medium[^"]*text-pine-700[^"]*tabular-nums[^"]*">16,50 € \/ кг<\/span>/u,
    );
    expect(html).toContain('href="/bg/marki"');
    expect(html).toContain('href="/bg/kafe-za-vending-mashini"');
    expect(html).toContain("Затова всяко кафе на зърна");
    expect(html.indexOf("Biancaffè")).toBeLessThan(html.indexOf("Borbone"));
    for (const id of ["italian", "automatic"]) {
      expect(html).toContain(`aria-labelledby="listing-section-${id}"`);
      expect(html).toContain(`id="listing-section-${id}"`);
    }
  });

  it("lists no products under the automatic-machine heading", () => {
    const html = render({ italian: null, automatic: { flavoured: false } });
    expect(headingsOf(html)).toEqual(["Кафе на зърна за автоматична кафемашина"]);
    expect(html).not.toContain("<ul");
    expect(html.match(/<a /g)).toHaveLength(1); // the vending page, and nothing else
  });

  it("drops the sentence about every bean while a flavoured one is on sale", () => {
    const html = render({ italian: null, automatic: { flavoured: true } });
    expect(html).not.toContain("всяко кафе на зърна");
    expect(html).toContain("Автоматичната кафемашина (кафеавтомат) мели зърната сама");
  });

  it("draws nothing at all when neither section is there", () => {
    expect(
      ListingSections({
        locale: "bg",
        copy: sections,
        sections: { italian: null, automatic: null },
      }),
    ).toBeNull();
    expect(
      ListingSections({ locale: "bg", copy: sections, sections: { italian: [], automatic: null } }),
    ).toBeNull();
  });

  it("names the pack in the link, so two sizes of one coffee read apart", () => {
    const html = render({
      italian: [
        { card: card("a", "Same Blend", { weight: "500 г" }), perKilogram: null },
        { card: card("b", "Same Blend"), perKilogram: null },
        { card: card("c", "Other", { weight: null }), perKilogram: null },
      ],
      automatic: null,
    });
    expect(html).toContain("Same Blend, 500 г");
    expect(html).toContain("Same Blend, 1 кг");
    expect(html).toContain(">Other</a>");
  });
});
