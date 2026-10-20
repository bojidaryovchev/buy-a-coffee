import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/*
 * `@/lib/db` opens a pool the moment it is imported and throws when there is
 * no `DATABASE_URL`. The selection is pure and the fact lookup reads no rows,
 * so the module is replaced by an inert stand-in. The same rules against a
 * real catalog are `beans-sections.db.test.ts`.
 */
vi.mock("@/lib/db", () => ({ db: {} }));

import { categoryCopy, segmentParagraph } from "../content/category-copy";
import { ListingSections } from "@/components/catalog/listing-sections";
import { withSectionFacts, type BeansSectionView } from "@/lib/catalog/beans-section-queries";
import {
  BEANS_SECTION_IDS,
  BEANS_SECTION_MAX,
  BEANS_SECTION_MIN,
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
 * The beans listing's two sections by use (research `09`, T2.2): which
 * products each lists, the words over them, and what the sections must leave
 * alone on a page that is under measurement.
 */

/* --- Fixtures ------------------------------------------------------------ */

const BEANS = ["kafe-na-zarna", "kafe-na-zyrna"];

let sequence = 0;

/** A bag of beans on sale: 1 kg at 20,00 €, of no Italian brand, not a machine blend. */
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
    machineBlend: false,
    ...overrides,
  };
}

const blend = (price: string, overrides: Partial<BeansSectionRow> = {}) =>
  row({ price, machineBlend: true, ...overrides });

const italian = (brand: string, price: string, overrides: Partial<BeansSectionRow> = {}) =>
  row({ price, brandSlug: brand, brandSourceKey: brand, italianBrand: true, ...overrides });

const section = (rows: readonly BeansSectionRow[], id: "italian" | "automatic") =>
  selectBeansSections(rows).find((entry) => entry.id === id) ?? null;

const ids = (rows: readonly BeansSectionRow[], id: "italian" | "automatic") =>
  section(rows, id)?.items.map((item) => item.id) ?? null;

/* --- The selection ------------------------------------------------------- */

describe("selectBeansSections", () => {
  it("lists nothing from an empty catalog", () => {
    expect(selectBeansSections([])).toEqual([]);
  });

  it("lists nothing when no row satisfies either rule", () => {
    expect(selectBeansSections([row(), row(), row(), row()])).toEqual([]);
  });

  it("gives the sections in page order: Italian, then automatic", () => {
    const rows = [
      blend("13.00"),
      blend("14.00"),
      blend("15.00"),
      italian("a", "16.00"),
      italian("b", "17.00"),
      italian("c", "18.00"),
    ];
    expect(selectBeansSections(rows).map((entry) => entry.id)).toEqual(["italian", "automatic"]);
    expect(BEANS_SECTION_IDS).toEqual(["italian", "automatic"]);
  });

  describe("the automatic-machine section", () => {
    it("lists the machine blends only, lowest price per kilogram first", () => {
      const a = blend("15.50");
      const b = blend("13.45");
      const c = blend("14.20");
      const other = row({ price: "10.00" });
      expect(ids([a, b, c, other], "automatic")).toEqual([b.id, c.id, a.id]);
    });

    it("orders by price per kilogram, not by the price of the pack", () => {
      // 500 g at 9,00 € is 18,00 € a kilogram: dearer than a kilogram at 17,00 €.
      const half = blend("9.00", { weightValue: "500.0000" });
      const kilo = blend("17.00");
      const quarter = blend("4.00", { weightValue: "250.0000" }); // 16,00 € / kg
      expect(ids([half, kilo, quarter], "automatic")).toEqual([quarter.id, kilo.id, half.id]);
      const perKg = section([half, kilo, quarter], "automatic")?.items.map((item) => item.perKg);
      expect(perKg?.map(Number)).toEqual([16, 17, 18]);
    });

    it("stops at the cap, keeping the cheapest per kilogram", () => {
      const rows = Array.from({ length: BEANS_SECTION_MAX + 3 }, (_, index) =>
        blend(`${30 - index}.00`),
      );
      const listed = ids(rows, "automatic")!;
      expect(listed).toHaveLength(BEANS_SECTION_MAX);
      expect(listed).toEqual(
        rows
          .slice(-BEANS_SECTION_MAX)
          .reverse()
          .map((entry) => entry.id),
      );
    });

    it("is absent below the minimum, present at it", () => {
      expect(BEANS_SECTION_MIN).toBe(3);
      expect(ids([blend("10.00"), blend("11.00")], "automatic")).toBeNull();
      expect(ids([blend("10.00"), blend("11.00"), blend("12.00")], "automatic")).toHaveLength(3);
    });

    it("keeps several blends of one brand: the rule is the blend, not the brand", () => {
      const rows = [
        blend("13.45", { brandSlug: "elia" }),
        blend("14.20", { brandSlug: "elia" }),
        blend("14.80", { brandSlug: "elia" }),
      ];
      expect(ids(rows, "automatic")).toEqual(rows.map((entry) => entry.id));
    });
  });

  describe("the Italian section", () => {
    it("lists one pack per Italian brand, the brand's lowest per kilogram", () => {
      const a1 = italian("a", "21.00");
      const a2 = italian("a", "19.00");
      const b1 = italian("b", "18.00");
      const c1 = italian("c", "25.00");
      const c2 = italian("c", "11.00", { weightValue: "500.0000" }); // 22,00 € / kg
      expect(ids([a1, a2, b1, c1, c2], "italian")).toEqual([b1.id, a2.id, c2.id]);
    });

    it("leaves out every brand that is not recorded as Italian", () => {
      const rows = [
        italian("a", "20.00"),
        italian("b", "21.00"),
        italian("c", "22.00"),
        row({ price: "5.00" }),
        row({ price: "6.00", brandSlug: "rema-caffe" }),
      ];
      expect(ids(rows, "italian")).toEqual(rows.slice(0, 3).map((entry) => entry.id));
    });

    it("stops at the cap, keeping the brands whose lowest price per kilogram is lowest", () => {
      const rows = Array.from({ length: BEANS_SECTION_MAX + 4 }, (_, index) =>
        italian(`brand-${index}`, `${15 + index}.00`),
      );
      expect(ids(rows, "italian")).toEqual(
        rows.slice(0, BEANS_SECTION_MAX).map((entry) => entry.id),
      );
    });

    it("is absent with fewer than three Italian brands, however many packs they have", () => {
      const rows = [
        italian("a", "20.00"),
        italian("a", "21.00"),
        italian("b", "22.00"),
        italian("b", "23.00"),
      ];
      expect(ids(rows, "italian")).toBeNull();
    });

    it("needs a brand to group by: a product with none is no brand's pack", () => {
      const rows = [
        italian("a", "20.00"),
        italian("b", "21.00"),
        row({ price: "10.00", brandSlug: null, brandSourceKey: null, italianBrand: true }),
      ];
      expect(ids(rows, "italian")).toBeNull();
    });
  });

  describe("ties", () => {
    it("breaks an equal price per kilogram by the supplier's name, then by id", () => {
      const later = italian("a", "16.90", {
        id: "p-900",
        name: "Кафе на зърна Espressia Capri 1кг.",
      });
      const earlier = italian("a", "16.90", {
        id: "p-901",
        name: "Кафе на зърна Biancaffe Intenso 1кг.",
      });
      const rest = [italian("b", "18.00"), italian("c", "19.00")];
      // One per brand: of the two at 16,90 € the name that sorts first stands for it.
      expect(ids([later, earlier, ...rest], "italian")).toEqual([
        earlier.id,
        ...rest.map((entry) => entry.id),
      ]);

      const same = { name: "Кафе на зърна Same 1кг." };
      const x = blend("14.00", { id: "p-b", ...same });
      const y = blend("14.00", { id: "p-a", ...same });
      const z = blend("14.00", { id: "p-c", ...same });
      expect(ids([x, y, z], "automatic")).toEqual(["p-a", "p-b", "p-c"]);
    });

    it("gives the same answer whatever order the catalog arrives in", () => {
      const rows = [
        blend("14.00", { name: "B" }),
        blend("14.00", { name: "A" }),
        blend("13.00"),
        blend("15.00"),
        italian("a", "20.00"),
        italian("b", "20.00"),
        italian("c", "20.00"),
        italian("a", "19.00"),
        italian("d", "20.00", { weightValue: "1000" }),
      ];
      const expected = selectBeansSections(rows);
      for (const shuffled of [[...rows].reverse(), [...rows.slice(4), ...rows.slice(0, 4)]]) {
        expect(selectBeansSections(shuffled)).toEqual(expected);
      }
    });
  });

  describe("what neither section lists", () => {
    const listedAnywhere = (rows: readonly BeansSectionRow[]) =>
      selectBeansSections(rows).flatMap((entry) => entry.items.map((item) => item.id));

    it.each([
      ["sold out", { availability: "out_of_stock" }],
      ["without a price", { price: null }],
      ["without a pack weight", { weightValue: null }],
      ["sold by the piece", { weightUnit: "pcs" }],
      ["not coffee beans", { categoryKeys: ["dolce-gusto"] }],
      ["filed under no category", { categoryKeys: [] }],
      ["instant coffee filed under beans", { name: "Разтворимо кафе Test Vending 0.500кг." }],
    ] as const)("a product %s", (_label, overrides) => {
      const base = [
        blend("20.00"),
        blend("21.00"),
        blend("22.00"),
        italian("a", "22.00"),
        italian("b", "23.00"),
        italian("d", "24.00"),
      ];
      // The cheapest of all, so either section would list it first if it could.
      const odd = [
        blend("10.00", overrides as Partial<BeansSectionRow>),
        italian("c", "10.00", overrides as Partial<BeansSectionRow>),
      ];
      const listed = listedAnywhere([...base, ...odd]);
      expect(listed).toEqual(listedAnywhere(base));
      expect(listed).toHaveLength(base.length);
      for (const entry of odd) expect(listed).not.toContain(entry.id);
    });

    it("still lists a pack whose availability is unknown, which can be asked about", () => {
      const unknown = blend("10.00", { availability: "unknown" });
      expect(ids([unknown, blend("11.00"), blend("12.00")], "automatic")?.[0]).toBe(unknown.id);
    });
  });

  describe("one section per product", () => {
    it("leaves an Italian machine blend to the automatic section; its brand's next pack stands in", () => {
      const italianBlend = italian("moreno", "15.50", { machineBlend: true });
      const nextPack = italian("moreno", "20.00");
      const rows = [
        italianBlend,
        nextPack,
        blend("13.45"),
        blend("14.20"),
        italian("lollo", "16.50"),
        italian("borbone", "19.00"),
      ];
      expect(ids(rows, "automatic")).toContain(italianBlend.id);
      expect(ids(rows, "italian")).toEqual([rows[4]!.id, rows[5]!.id, nextPack.id]);

      const sections = selectBeansSections(rows);
      const all = sections.flatMap((entry) => entry.items.map((item) => item.id));
      expect(new Set(all).size).toBe(all.length);
    });

    it("lets the blend stand for its brand while the automatic section is not shown", () => {
      const italianBlend = italian("moreno", "15.50", { machineBlend: true });
      const rows = [
        italianBlend,
        italian("moreno", "20.00"),
        italian("lollo", "16.50"),
        italian("borbone", "19.00"),
      ];
      expect(ids(rows, "automatic")).toBeNull();
      expect(ids(rows, "italian")?.[0]).toBe(italianBlend.id);
    });
  });
});

/* --- The two facts ------------------------------------------------------- */

describe("withSectionFacts", () => {
  // The flags start false and are worked out again from the name and the brand.
  const plain = (name: string, brandSlug: string | null) => row({ name, brandSlug });

  it("reads Italian from the brand record, by the brand's stored slug", () => {
    for (const slug of ["lavazza", "kimbo", "illy", "borbone", "vergnano", "moreno"]) {
      expect(withSectionFacts(plain("Кафе на зърна X 1кг.", slug)).italianBrand, slug).toBe(true);
    }
    // Bulgarian, Austrian, unestablished, or Italian-sounding and made in Plovdiv.
    for (const slug of ["elia", "este", "tezzoro", "julius-meinl", "eurocaf", "molini", "amann"]) {
      expect(withSectionFacts(plain("Кафе на зърна X 1кг.", slug)).italianBrand, slug).toBe(false);
    }
    expect(withSectionFacts(plain("Кафе на зърна X 1кг.", null)).italianBrand).toBe(false);
  });

  it("reads the machine designation from the name, by the vending page's rule", () => {
    expect(
      withSectionFacts(plain("Кафе на зърна Elia Vending Crema 1кг.", "elia")).machineBlend,
    ).toBe(true);
    expect(
      withSectionFacts(plain("Кафе на зърна Vandino Espresso Aroma 1кг.", "vandino")).machineBlend,
    ).toBe(false);
  });
});

/* --- The words ----------------------------------------------------------- */

const beans = categoryCopy["kafe-na-zyrna"]!;
const sections = beans.sections!;

const sentences = (text: string) => text.split(/(?<=[.!?])\s+(?=[А-ЯA-Z„])/u).filter(Boolean);

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

  it.each(BEANS_SECTION_IDS)("%s: one to three sentences, trimmed", (id) => {
    const { text } = sections[id];
    expect(text).toBe(text.trim());
    expect(sentences(text).length, text).toBeGreaterThanOrEqual(1);
    expect(sentences(text).length, text).toBeLessThanOrEqual(3);
    expect(text.length).toBeLessThan(450);
  });

  it.each(BEANS_SECTION_IDS)(
    "%s: names no figure, price, count, product or brand that could go stale",
    (id) => {
      const { heading, text } = sections[id];
      for (const words of [heading, text]) {
        expect(words).not.toMatch(/\d|€|лв\.|EUR|BGN/u);
        expect(words).not.toMatch(
          /lavazza|kimbo|illy|borbone|vergnano|biancaff|lollo|vandino|moreno|excelsior|elia|este|rema|molini/iu,
        );
      }
    },
  );

  it.each(BEANS_SECTION_IDS)("%s: links each phrase it names, once, where it stands", (id) => {
    const { text, links = [] } = sections[id];
    for (const link of links) {
      expect(text.split(link.phrase).length - 1, link.phrase).toBe(1);
    }
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
          // „кафе на зърна“ is ours; the two pages whose terms contain it are
          // narrowings, and neither of their terms is in these headings.
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
    for (const id of BEANS_SECTION_IDS) {
      const { heading, text } = sections[id];
      // Letters only; punctuation such as „ “ — is outside the question.
      const letters = `${heading} ${text}`.match(/\p{L}/gu) ?? [];
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

const view = (id: "italian" | "automatic", titles: readonly string[]): BeansSectionView => ({
  id,
  products: titles.map((title, index) => ({
    card: card(`${id}-${index}`, title),
    perKilogram: `${16 + index},50 € / кг`,
  })),
});

const render = (views: readonly BeansSectionView[]) =>
  renderToStaticMarkup(ListingSections({ locale: "bg", copy: sections, sections: views }) ?? "");

describe("ListingSections", () => {
  it("draws each section's heading, words and products, in the order given", () => {
    const html = render([
      view("italian", ["Vandino Espresso Bar", "Lollo Caffè Nero", "Excelsior Sapphire"]),
      view("automatic", ["Elia Vending Intenso", "Elia Vending Crema", "Moreno Vending"]),
    ]);
    const headings = [...html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/g)].map((match) => match[1]);
    expect(headings).toEqual([
      "Италианско кафе на зърна",
      "Кафе на зърна за автоматична кафемашина",
    ]);
    expect(html).toContain('href="/bg/italian-0-kafe-na-zarna-1-kg"');
    expect(html).toContain("Vandino Espresso Bar, 1 кг");
    expect(html).toContain("16,50 € / кг");
    expect(html).toContain('href="/bg/marki"');
    expect(html).toContain('href="/bg/kafe-za-vending-mashini"');
    expect(html.indexOf("Vandino")).toBeLessThan(html.indexOf("Lollo"));
    // Each section is labelled by its own heading.
    for (const id of ["italian", "automatic"]) {
      expect(html).toContain(`aria-labelledby="listing-section-${id}"`);
      expect(html).toContain(`id="listing-section-${id}"`);
    }
  });

  it("draws only the sections it is given", () => {
    const html = render([view("automatic", ["A", "B", "C"])]);
    expect(html).not.toContain("Италианско кафе на зърна");
    expect(html).toContain("Кафе на зърна за автоматична кафемашина");
  });

  it("draws nothing at all when there is nothing to list", () => {
    expect(ListingSections({ locale: "bg", copy: sections, sections: [] })).toBeNull();
    expect(
      ListingSections({
        locale: "bg",
        copy: sections,
        sections: [{ id: "italian", products: [] }],
      }),
    ).toBeNull();
  });

  it("names the pack in the link, so two sizes of one coffee read apart", () => {
    const html = render([
      {
        id: "automatic",
        products: [
          { card: card("a", "Same Blend", { weight: "500 г" }), perKilogram: null },
          { card: card("b", "Same Blend"), perKilogram: null },
          { card: card("c", "Other", { weight: null }), perKilogram: null },
        ],
      },
    ]);
    expect(html).toContain("Same Blend, 500 г");
    expect(html).toContain("Same Blend, 1 кг");
    expect(html).toContain(">Other</a>");
  });
});
