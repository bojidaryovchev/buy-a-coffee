import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The cross-links component sits beside its catalog read; only its markup is used here.
vi.mock("@/lib/db", () => ({ db: {} }));

import { RelatedLandingsList } from "@/components/catalog/related-landings";
import { ROUTE_SEGMENTS, SLUGS } from "@/i18n/slugs";
import {
  CHEAPEST_PER_SYSTEM,
  LANDING_IDS,
  LANDING_PATHS,
  NO_FLAVOURS,
  NO_LANDINGS,
  flavoursInName,
  isDecaf,
  isFlavoured,
  landingAvailability,
  landingForSegment,
  selectLanding,
  selectSystem,
  type LandingRow,
} from "@/lib/catalog/landings";
import { resolveProductFormat } from "@/lib/catalog/fallback-copy";
import { withDrawnCards } from "@/lib/catalog/landing-queries";
import type { ProductCardView } from "@/lib/catalog/types";
import {
  brandFormatLink,
  relatedLandingLinks,
  type RelatedLink,
} from "@/lib/catalog/related-landings";
import { BREWING_SYSTEMS } from "@/lib/recommend/systems";
import { href, isReservedSlug } from "@/lib/routes";
import { DESCRIPTION_LIMIT } from "@/lib/seo/description";
import {
  CALLBACK_SENTENCE,
  FLAVOURED_DRINKS_SENTENCE,
  cheapestGroupNote,
  cupRangeText,
  landingCopy,
  machineBrandCopy,
  machineBrandFeatures,
  machineOwnSystemCopy,
  relatedCopy,
  type LandingFacts,
} from "../content/landing-copy";

/*
 * The five landing listings: what each selects, when each exists, what links
 * to it, and what it says about itself. All of it pure — rows in, a selection
 * out — so the rules are tested here against invented catalogs, and the same
 * rules against the real one in `landings.db.test.ts`.
 */

let serial = 0;
function row(overrides: Partial<LandingRow> & { categoryKeys: readonly string[] }): LandingRow {
  serial += 1;
  return {
    id: `p-${String(serial).padStart(3, "0")}`,
    name: `Продукт ${serial}`,
    brandSlug: "bianchi",
    brandSourceKey: "bianchi",
    price: "5.00",
    weightValue: "10",
    weightUnit: "pc",
    availability: "in_stock",
    attributes: {},
    ...overrides,
  };
}

const lavazza = { brandSlug: "lavazza", brandSourceKey: "lavazza" } as const;

/** A small catalog with every case the rules distinguish. */
const CATALOG: readonly LandingRow[] = [
  row({
    ...lavazza,
    name: "Blue A",
    categoryKeys: ["lavazza-blue"],
    price: "33.25",
    weightValue: "100",
  }),
  row({
    ...lavazza,
    name: "Blue Decaf",
    categoryKeys: ["lavazza-blue"],
    price: "30.00",
    weightValue: "100",
    attributes: { decaf: "yes" },
  }),
  row({ ...lavazza, name: "AMM", categoryKeys: ["a-modo-mio"], price: "12.80", weightValue: "36" }),
  row({ ...lavazza, name: "Nespresso L", categoryKeys: ["nespresso"], price: "4.80" }),
  row({
    ...lavazza,
    name: "Beans L 1",
    categoryKeys: ["kafe-na-zarna", "kafe-na-zyrna"],
    price: "25.05",
    weightValue: "1000",
    weightUnit: "g",
  }),
  row({
    ...lavazza,
    name: "Beans L 2",
    categoryKeys: ["kafe-na-zyrna"],
    price: "20.60",
    weightValue: "1000",
    weightUnit: "g",
  }),
  row({
    ...lavazza,
    name: "ESE L",
    categoryKeys: ["kafe-dozi"],
    price: "31.00",
    weightValue: "100",
  }),
  row({ name: "Nespresso 1", categoryKeys: ["nespresso"], price: "3.00" }),
  row({ name: "Nespresso 2", categoryKeys: ["nespresso"], price: "3.50" }),
  row({ name: "Nespresso 3", categoryKeys: ["nespresso"], price: "4.00" }),
  row({
    name: "Nespresso sold out",
    categoryKeys: ["nespresso"],
    price: "1.00",
    availability: "out_of_stock",
  }),
  row({ name: "Nespresso no price", categoryKeys: ["nespresso"], price: null }),
  row({
    name: "Decaf by name only",
    categoryKeys: ["dolce-gusto"],
    price: "5.60",
    weightValue: "16",
  }),
  row({
    name: "DG decaf",
    categoryKeys: ["dolce-gusto"],
    price: "5.60",
    weightValue: "16",
    attributes: { decaf: "YES" },
  }),
  row({
    name: "Beans decaf",
    categoryKeys: ["kafe-na-zyrna"],
    price: "12.00",
    weightValue: "500",
    weightUnit: "g",
    attributes: { decaf: "yes" },
  }),
  row({ name: "Homeless decaf", categoryKeys: ["aksesoari"], attributes: { decaf: "yes" } }),
  row({ name: "Caffitaly 1", categoryKeys: ["caffitaly"], price: "5.35" }),
];

const names = (ids: readonly string[]) =>
  ids.map((id) => CATALOG.find((entry) => entry.id === id)?.name);

describe("the routes", () => {
  it("registers each landing as a static segment in both slug tables", () => {
    for (const id of LANDING_IDS) {
      const segment = LANDING_PATHS[id].slice(1);
      expect(ROUTE_SEGMENTS).toContain(segment);
      expect(SLUGS.bg.segments[segment as keyof typeof SLUGS.bg.segments]).toBe(segment);
      expect(SLUGS.en.segments[segment as keyof typeof SLUGS.en.segments]).toMatch(/^[a-z-]+$/);
    }
  });

  it("publishes the slugs the market study chose", () => {
    expect(LANDING_IDS.map((id) => href("bg", LANDING_PATHS[id]))).toEqual([
      "/bg/lavazza-kapsuli",
      "/bg/kafe-na-zarna-lavazza",
      "/bg/bezkofeinovo-kafe",
      "/bg/nay-evtino-na-chasha",
      "/bg/aromatizirano-kafe",
    ]);
    expect(href("en", LANDING_PATHS.flavoured)).toBe("/en/flavoured-coffee");
  });

  it("knows a landing from its segment, for the proxy", () => {
    expect(landingForSegment("bezkofeinovo-kafe")).toBe("decaf");
    expect(landingForSegment("nay-evtino-na-chasha")).toBe("cheapest");
    expect(landingForSegment("aromatizirano-kafe")).toBe("flavoured");
    expect(landingForSegment("konsumativi")).toBeNull();
  });

  it("reserves them, in both languages, so no product or category can take one", () => {
    for (const slug of [
      "lavazza-kapsuli",
      "kafe-na-zarna-lavazza",
      "bezkofeinovo-kafe",
      "nay-evtino-na-chasha",
      "aromatizirano-kafe",
      "lavazza-capsules",
      "decaf-coffee",
      "flavoured-coffee",
    ]) {
      expect(isReservedSlug(slug)).toBe(true);
    }
  });
});

describe("Lavazza capsules", () => {
  const selected = selectLanding("lavazzaCapsules", CATALOG);

  it("groups by system, the two Lavazza makes machines for first", () => {
    expect(selected.groups.map((group) => group.key)).toEqual([
      "lavazza-blue",
      "a-modo-mio",
      "nespresso-original",
    ]);
  });

  it("lists only Lavazza, and only capsules", () => {
    const listed = names(selected.groups.flatMap((group) => group.items.map((item) => item.id)));
    expect(listed).toEqual(["Blue Decaf", "Blue A", "AMM", "Nespresso L"]);
    expect(selected.methods).toEqual(["capsule"]);
  });

  it("finds the brand by its source key when the stored slug has moved", () => {
    const renamed = CATALOG.map((entry) =>
      entry.brandSlug === "lavazza" ? { ...entry, brandSlug: "lavazza-caffe" } : entry,
    );
    expect(selectLanding("lavazzaCapsules", renamed).count).toBe(selected.count);
  });

  it("states the per-cup range of exactly what it lists", () => {
    expect(selected.cupRange).toEqual({
      min: { amount: "0.3000", estimated: false },
      max: { amount: "0.4800", estimated: false },
    });
  });
});

describe("Lavazza beans", () => {
  const selected = selectLanding("lavazzaBeans", CATALOG);

  it("lists the brand's beans, cheapest per cup first, as estimates", () => {
    expect(selected.groups.map((group) => group.key)).toEqual(["beans"]);
    expect(names(selected.groups[0]?.items.map((item) => item.id) ?? [])).toEqual([
      "Beans L 2",
      "Beans L 1",
    ]);
    expect(selected.groups[0]?.items.every((item) => item.estimated)).toBe(true);
    expect(selected.commonPack).toBe("1 кг");
  });

  it("names no common pack when the packs differ", () => {
    const mixed = [
      ...CATALOG,
      row({ ...lavazza, categoryKeys: ["kafe-na-zyrna"], weightValue: "500", weightUnit: "g" }),
    ];
    expect(selectLanding("lavazzaBeans", mixed).commonPack).toBeNull();
  });
});

describe("decaf", () => {
  const selected = selectLanding("decaf", CATALOG);

  it("goes by the product's flag and never by its name", () => {
    const listed = names(selected.groups.flatMap((group) => group.items.map((item) => item.id)));
    expect(listed).toEqual(["DG decaf", "Blue Decaf", "Beans decaf"]);
    expect(listed).not.toContain("Decaf by name only");
    expect(isDecaf(row({ name: "Decaffeinato", categoryKeys: [] }))).toBe(false);
    expect(isDecaf(row({ categoryKeys: [], attributes: { decaf: "no" } }))).toBe(false);
  });

  it("groups in the shop's system order, each group anchored by its system id", () => {
    expect(selected.groups.map((group) => group.key)).toEqual([
      "dolce-gusto",
      "lavazza-blue",
      "beans",
    ]);
    expect(selected.methods).toEqual(["capsule", "beans"]);
  });

  it("leaves out a decaf product filed under no system: a group names a machine", () => {
    expect(selected.count).toBe(3);
  });
});

describe("cheapest per cup", () => {
  const selected = selectLanding("cheapest", CATALOG);
  const nespresso = selected.groups.find((group) => group.key === "nespresso-original");

  it(`shows at most ${CHEAPEST_PER_SYSTEM} per system, lowest price per cup first`, () => {
    expect(names(nespresso?.items.map((item) => item.id) ?? [])).toEqual([
      "Nespresso 1",
      "Nespresso 2",
      "Nespresso 3",
    ]);
    for (const group of selected.groups) {
      expect(group.items.length).toBeLessThanOrEqual(CHEAPEST_PER_SYSTEM);
    }
  });

  it("never calls a sold-out or unpriced product the cheapest", () => {
    const listed = names(selected.groups.flatMap((group) => group.items.map((item) => item.id)));
    expect(listed).not.toContain("Nespresso sold out");
    expect(listed).not.toContain("Nespresso no price");
    // Four priced and orderable Nespresso products were in the running.
    expect(nespresso?.poolSize).toBe(4);
  });

  it("covers every system that has something to order, in the shop's order", () => {
    expect(selected.groups.map((group) => group.key)).toEqual(
      BREWING_SYSTEMS.map((system) => system.id),
    );
  });

  it("leaves nothing out that is cheaper than something shown", () => {
    const perCup = (price: string, cups: number) => Number(price) / cups;
    for (const group of selected.groups) {
      const shown = new Set(group.items.map((item) => item.id));
      const dearestShown = Math.max(...group.items.map((item) => Number(item.perCup)));
      const left = CATALOG.filter(
        (entry) =>
          !shown.has(entry.id) &&
          entry.availability !== "out_of_stock" &&
          entry.price !== null &&
          entry.weightUnit === "pc" &&
          entry.categoryKeys.some((key) => group.system.categorySlugs.includes(key)),
      );
      for (const entry of left) {
        expect(perCup(entry.price as string, Number(entry.weightValue))).toBeGreaterThanOrEqual(
          dearestShown,
        );
      }
    }
  });

  it("breaks a tie by name, so the order is the same on every render", () => {
    const tied = [
      row({ name: "Б", categoryKeys: ["caffitaly"] }),
      row({ name: "А", categoryKeys: ["caffitaly"] }),
      row({ name: "Г", categoryKeys: ["caffitaly"] }),
      row({ name: "В", categoryKeys: ["caffitaly"] }),
    ];
    const group = selectLanding("cheapest", tied).groups[0];
    expect(group?.items.map((item) => tied.find((entry) => entry.id === item.id)?.name)).toEqual([
      "А",
      "Б",
      "В",
    ]);
    expect(group?.poolSize).toBe(4);
  });
});

/**
 * A catalog for the flavoured page: the reference catalog's shapes (twenty
 * flavoured packs over Nespresso, Dolce Gusto, Caffitaly and ESE), cut down,
 * with every case its rule tells apart.
 */
const FLAVOURED_CATALOG: readonly LandingRow[] = [
  row({
    name: "Капсули Nespresso Rema Caffè Hazelnut 10 бр.",
    categoryKeys: ["nespresso"],
    price: "4.60",
    attributes: { decaf: "no", aromas: "yes" },
  }),
  row({
    name: "Капсули Nespresso Caramel 10 бр.",
    categoryKeys: ["nespresso"],
    price: "4.00",
    // The filter lower-cases, so this is flavoured too.
    attributes: { aromas: "YES" },
  }),
  row({
    name: "Капсули DG Irish Cream 16 бр.",
    categoryKeys: ["dolce-gusto"],
    price: "5.60",
    weightValue: "16",
    attributes: { aromas: "yes" },
  }),
  row({
    name: "Капсули DG Caramel 16 бр.",
    categoryKeys: ["dolce-gusto"],
    price: "5.90",
    weightValue: "16",
    attributes: { aromas: "yes" },
  }),
  row({
    // Decaf and flavoured both: it stands on both pages.
    name: "Капсули DG Mermaid Latte 10 бр.",
    categoryKeys: ["dolce-gusto"],
    price: "6.65",
    attributes: { decaf: "yes", aromas: "yes" },
  }),
  row({
    // Its name says hazelnut; its record says it is not flavoured.
    name: "Капсули DG Кафе лешник 16 бр.",
    categoryKeys: ["dolce-gusto"],
    price: "1.00",
    weightValue: "16",
    attributes: { aromas: "no" },
  }),
  row({
    // A name and no flag at all.
    name: "Капсули DG Hazelnut Crema 16 бр.",
    categoryKeys: ["dolce-gusto"],
    price: "1.00",
    weightValue: "16",
  }),
  row({
    // PostgreSQL's `lower()` trims nothing, so the filter does not find this.
    name: "Капсули DG Padded 16 бр.",
    categoryKeys: ["dolce-gusto"],
    price: "1.00",
    weightValue: "16",
    attributes: { aromas: " yes" },
  }),
  row({
    name: "Капсули Caffitaly Espresso Nocciola 10 бр.",
    categoryKeys: ["caffitaly"],
    price: "6.00",
    attributes: { aromas: "yes" },
  }),
  row({
    // Sold out is still listed, as on the decaf page; only the cheapest page drops it.
    name: "Капсули Caffitaly Espresso Panettone 10 бр.",
    categoryKeys: ["caffitaly"],
    price: "5.35",
    availability: "out_of_stock",
    attributes: { aromas: "yes" },
  }),
  row({
    name: "Дозети Lollo caffe Amaretto 18бр.",
    categoryKeys: ["kafe-dozi"],
    price: "6.84",
    weightValue: "18",
    attributes: { aromas: "yes" },
  }),
  row({
    name: "Дозети Rema Caffe Hazelnut лешник 100бр.",
    categoryKeys: ["kafe-dozi"],
    price: "36.00",
    weightValue: "100",
    attributes: { aromas: "yes" },
  }),
  row({
    // Filed under no system: no group can hold it.
    name: "Сироп Hazelnut 700 мл",
    categoryKeys: ["aksesoari"],
    price: "8.00",
    attributes: { aromas: "yes" },
  }),
  row({ name: "Капсули Nespresso Ristretto 10 бр.", categoryKeys: ["nespresso"], price: "3.00" }),
  row({
    name: "Кафе на зърна 1 кг",
    categoryKeys: ["kafe-na-zyrna"],
    price: "20.00",
    weightValue: "1000",
    weightUnit: "g",
    attributes: { aromas: "no" },
  }),
];

const flavouredNames = (ids: readonly string[]) =>
  ids.map((id) => FLAVOURED_CATALOG.find((entry) => entry.id === id)?.name);

describe("flavoured", () => {
  const selected = selectLanding("flavoured", FLAVOURED_CATALOG);
  const listed = flavouredNames(
    selected.groups.flatMap((group) => group.items.map((item) => item.id)),
  );

  it("decides by the record's flag exactly as the listings' filter does", () => {
    // `lower(attributes->>'aromas') = 'yes'`, and nothing else.
    const rule = (value: string | undefined) =>
      isFlavoured(
        row({
          categoryKeys: [],
          ...(value === undefined ? {} : { attributes: { aromas: value } }),
        }),
      );
    expect(rule("yes")).toBe(true);
    expect(rule("YES")).toBe(true);
    expect(rule("Yes")).toBe(true);
    expect(rule(" yes")).toBe(false);
    expect(rule("no")).toBe(false);
    expect(rule("")).toBe(false);
    expect(rule(undefined)).toBe(false);
    // A name proves nothing.
    expect(isFlavoured(row({ name: "Кафе с вкус на лешник", categoryKeys: ["nespresso"] }))).toBe(
      false,
    );
  });

  it("lists exactly the products flagged flavoured that stand in a system", () => {
    const expected = FLAVOURED_CATALOG.filter(
      (entry) =>
        entry.attributes.aromas?.toLowerCase() === "yes" &&
        resolveProductFormat(entry.categoryKeys, entry.name).system !== null,
    ).map((entry) => entry.name);
    expect(new Set(listed)).toEqual(new Set(expected));
    expect(listed).toHaveLength(expected.length);
    expect(selected.count).toBe(9);
  });

  it("never reads a name: a pack called hazelnut without the flag stays out", () => {
    expect(listed).not.toContain("Капсули DG Кафе лешник 16 бр.");
    expect(listed).not.toContain("Капсули DG Hazelnut Crema 16 бр.");
    expect(listed).not.toContain("Капсули DG Padded 16 бр.");
  });

  it("leaves out a flavoured product filed under no system, as the decaf page does", () => {
    expect(listed).not.toContain("Сироп Hazelnut 700 мл");
  });

  it("keeps a sold-out pack, and a decaf one, as the decaf page keeps its own", () => {
    expect(listed).toContain("Капсули Caffitaly Espresso Panettone 10 бр.");
    expect(listed).toContain("Капсули DG Mermaid Latte 10 бр.");
  });

  it("groups by system in the shop's order, each group cheapest per cup first", () => {
    expect(selected.groups.map((group) => group.key)).toEqual([
      "nespresso-original",
      "dolce-gusto",
      "caffitaly",
      "ese-pod",
    ]);
    expect(
      selected.groups.map((group) => flavouredNames(group.items.map((item) => item.id))),
    ).toEqual([
      ["Капсули Nespresso Caramel 10 бр.", "Капсули Nespresso Rema Caffè Hazelnut 10 бр."],
      [
        "Капсули DG Irish Cream 16 бр.",
        "Капсули DG Caramel 16 бр.",
        "Капсули DG Mermaid Latte 10 бр.",
      ],
      ["Капсули Caffitaly Espresso Panettone 10 бр.", "Капсули Caffitaly Espresso Nocciola 10 бр."],
      ["Дозети Rema Caffe Hazelnut лешник 100бр.", "Дозети Lollo caffe Amaretto 18бр."],
    ]);
    for (const group of selected.groups) {
      const cups = group.items.map((item) => Number(item.perCup));
      expect(cups, group.key).toEqual([...cups].sort((a, b) => a - b));
      expect(group.poolSize).toBe(group.items.length);
    }
    expect(selected.methods).toEqual(["capsule", "pod"]);
  });

  it("knows which of the searched flavours it lists, from the labels of what it lists", () => {
    expect(selected.flavours).toEqual({ named: ["hazelnut", "caramel"], others: true });
    // Only what is listed counts: the unflagged hazelnut packs name nothing.
    const caramelOnly = FLAVOURED_CATALOG.filter(
      (entry) => !/hazelnut|nocciola|лешник/i.test(entry.name) || !isFlavoured(entry),
    );
    expect(selectLanding("flavoured", caramelOnly).flavours.named).toEqual(["caramel"]);
    expect(selectLanding("flavoured", []).flavours).toEqual(NO_FLAVOURS);
  });

  it("reads a flavour off a supplier's name as a whole word, in the pack's languages", () => {
    expect(flavoursInName("Капсули Caffitaly Espresso Nocciola 10 бр.")).toEqual(["hazelnut"]);
    expect(flavoursInName("Дозети Rema Caffe Hazelnut лешник 100бр.")).toEqual(["hazelnut"]);
    expect(flavoursInName("Дозети Rema Caffe Caramel карамел 100бр.")).toEqual(["caramel"]);
    expect(flavoursInName("Caramel & Hazelnut")).toEqual(["hazelnut", "caramel"]);
    // A dessert with a caramel top is not caramel, and a longer word is not the word.
    expect(flavoursInName("Капсули DG Rema Caffè Creme Brulee 16 бр.")).toEqual([]);
    expect(flavoursInName("Caramelised Hazelnuts")).toEqual([]);
  });

  it("names in its title only the flavours of the cards actually drawn, as it counts them", () => {
    const card = (id: string) => ({ id }) as unknown as ProductCardView;
    const ids = selected.groups.flatMap((group) => group.items.map((item) => item.id));
    const all = withDrawnCards(selected, new Map(ids.map((id) => [id, card(id)])));
    expect(all.count).toBe(selected.count);
    expect(all.flavours).toEqual(selected.flavours);

    // Every hazelnut pack left the catalog between the two reads: no card, no „лешник“.
    const hazelnut = new Set(
      FLAVOURED_CATALOG.filter((entry) => flavoursInName(entry.name).includes("hazelnut")).map(
        (entry) => entry.id,
      ),
    );
    const drawn = withDrawnCards(
      selected,
      new Map(ids.filter((id) => !hazelnut.has(id)).map((id) => [id, card(id)])),
    );
    expect(drawn.count).toBe(
      selected.count - [...hazelnut].filter((id) => ids.includes(id)).length,
    );
    expect(drawn.flavours).toEqual({ named: ["caramel"], others: true });
    expect(
      landingCopy.flavoured.title({
        count: drawn.count,
        systems: [],
        methods: drawn.methods,
        cupRange: null,
        commonPack: null,
        currency: "EUR",
        flavours: drawn.flavours,
      }),
    ).toBe("Ароматизирано кафе с вкус на карамел и други");

    // Nothing drawn at all: nothing named.
    expect(withDrawnCards(selected, new Map()).flavours).toEqual(NO_FLAVOURS);
  });

  it("exists only while something is flagged, and says which groups a link may name", () => {
    const available = landingAvailability(FLAVOURED_CATALOG);
    expect(available.counts.flavoured).toBe(9);
    expect(available.groups.flavoured).toEqual([
      "nespresso-original",
      "dolce-gusto",
      "caffitaly",
      "ese-pod",
    ]);
    expect(available.members?.flavoured).toHaveLength(9);

    const unflagged = FLAVOURED_CATALOG.map((entry) => ({ ...entry, attributes: {} }));
    expect(landingAvailability(unflagged).counts.flavoured).toBe(0);
    expect(selectLanding("flavoured", unflagged).groups).toEqual([]);
    // Flagged, but in no system: still no page.
    const homeless = FLAVOURED_CATALOG.filter((entry) => entry.categoryKeys.includes("aksesoari"));
    expect(landingAvailability(homeless).counts.flavoured).toBe(0);
    // And the other landings do not move with it.
    expect(landingAvailability(CATALOG).counts.flavoured).toBe(0);
    expect(landingAvailability(CATALOG).counts.decaf).toBe(3);
  });
});

describe("a whole system's shelf, for the Tchibo page", () => {
  it("is one group, or none", () => {
    expect(selectSystem("caffitaly", CATALOG).count).toBe(1);
    expect(selectSystem("caffitaly", []).groups).toEqual([]);
  });
});

describe("availability: a page exists only while it lists something", () => {
  it("is nothing at all for an empty catalog", () => {
    expect(landingAvailability([])).toEqual(NO_LANDINGS);
    for (const id of LANDING_IDS) {
      expect(NO_LANDINGS.counts[id]).toBe(0);
      expect(selectLanding(id, []).count).toBe(0);
    }
    expect(NO_LANDINGS.lavazzaBrandSlug).toBeNull();
  });

  it("drops each landing separately as its products go", () => {
    const noLavazza = CATALOG.filter((entry) => entry.brandSlug !== "lavazza");
    const available = landingAvailability(noLavazza);
    expect(available.counts.lavazzaCapsules).toBe(0);
    expect(available.counts.lavazzaBeans).toBe(0);
    expect(available.counts.decaf).toBeGreaterThan(0);
    expect(available.counts.cheapest).toBeGreaterThan(0);

    const noDecaf = CATALOG.map((entry) => ({ ...entry, attributes: {} }));
    expect(landingAvailability(noDecaf).counts.decaf).toBe(0);
  });

  it("knows the anchors a link may point at", () => {
    const available = landingAvailability(CATALOG);
    expect(available.groups.decaf).toEqual(["dolce-gusto", "lavazza-blue", "beans"]);
    expect(available.systems["nespresso-original"]).toBe(6);
    expect(available.lavazzaBrandSlug).toBe("lavazza");
  });
});

describe("the links between pages that must not compete", () => {
  const available = landingAvailability(CATALOG);
  const links = (subject: Parameters<typeof relatedLandingLinks>[1], from = available) =>
    relatedLandingLinks("bg", subject, from);
  const hrefs = (list: readonly RelatedLink[]) => list.map((link) => link.href);
  const category = (slug: string, sourceKey: string = slug) => ({ category: { slug, sourceKey } });

  it("links the four Lavazza pages to each other, each saying what the others are", () => {
    expect(hrefs(links({ landing: "lavazzaCapsules" }))).toEqual([
      "/bg/lavazza-blue-kapsuli",
      "/bg/lavazza-a-modo-mio-kapsuli",
      "/bg/marki/lavazza",
    ]);
    expect(hrefs(links(category("lavazza-blue"))).slice(0, 3)).toEqual([
      "/bg/lavazza-kapsuli",
      "/bg/lavazza-a-modo-mio-kapsuli",
      "/bg/marki/lavazza",
    ]);
    expect(hrefs(links(category("a-modo-mio"))).slice(0, 3)).toEqual([
      "/bg/lavazza-kapsuli",
      "/bg/lavazza-blue-kapsuli",
      "/bg/marki/lavazza",
    ]);
    expect(hrefs(links({ brand: { slug: "lavazza" } }))).toEqual([
      "/bg/lavazza-kapsuli",
      "/bg/kafe-na-zarna-lavazza",
      "/bg/lavazza-blue-kapsuli",
      "/bg/lavazza-a-modo-mio-kapsuli",
    ]);
    for (const link of links({ brand: { slug: "lavazza" } })) expect(link.note).toBeTruthy();
  });

  it("gives another brand's page nothing", () => {
    expect(links({ brand: { slug: "bianchi" } })).toEqual([]);
  });

  it("uses one anchor for one page, wherever the link is", () => {
    const everywhere = [
      links({ landing: "lavazzaBeans" }),
      links(category("lavazza-blue")),
      links(category("a-modo-mio")),
      links({ brand: { slug: "lavazza" } }),
    ].flat();
    const toCapsules = everywhere.filter((link) => link.href === "/bg/lavazza-kapsuli");
    expect(toCapsules).toHaveLength(4);
    expect(new Set(toCapsules.map((link) => link.label))).toEqual(
      new Set([relatedCopy.lavazzaCapsules.label]),
    );
  });

  it("links Caffitaly and the Tchibo machine page to each other", () => {
    expect(hrefs(links(category("caffitaly")))).toContain("/bg/za-kafemashina/tchibo");
    expect(hrefs(links({ machineBrand: "tchibo" }))).toEqual(["/bg/caffitaly-kapsuli"]);
    expect(links({ machineBrand: "krups" })).toEqual([]);
  });

  it("links every system page to decaf and to cheapest per cup, at its own group", () => {
    for (const system of BREWING_SYSTEMS) {
      const list = links(category(system.categorySlugs[0] ?? "", system.categorySourceKeys[0]));
      const decaf = list.find((link) => link.key === "decaf");
      const cheapest = list.find((link) => link.key === "cheapest");
      const hasGroup = available.groups.decaf.includes(system.id);

      expect(decaf?.href).toBe(`/bg/bezkofeinovo-kafe${hasGroup ? `#${system.id}` : ""}`);
      expect(decaf?.label).toBe(hasGroup ? "Без кофеин в тази система" : "Безкофеиново кафе");
      expect(cheapest?.href).toBe(`/bg/nay-evtino-na-chasha#${system.id}`);
      expect(cheapest?.label).toBe("Най-евтино на чаша");
    }
  });

  it("gives the capsule parent both links, with no anchor", () => {
    expect(hrefs(links(category("kapsuli", "kafe-kapsuli")))).toEqual([
      "/bg/bezkofeinovo-kafe",
      "/bg/nay-evtino-na-chasha",
    ]);
  });

  it("offers a link only while its target exists", () => {
    expect(links(category("lavazza-blue"), NO_LANDINGS)).toEqual([]);
    expect(links({ brand: { slug: "lavazza" } }, NO_LANDINGS)).toEqual([]);
    expect(links({ machineBrand: "tchibo" }, NO_LANDINGS)).toEqual([]);
    // The Tchibo page is our own data and is always there.
    expect(hrefs(links(category("caffitaly"), NO_LANDINGS))).toEqual(["/bg/za-kafemashina/tchibo"]);

    const noDecaf = landingAvailability(CATALOG.map((entry) => ({ ...entry, attributes: {} })));
    expect(links(category("nespresso"), noDecaf).map((link) => link.key)).toEqual(["cheapest"]);
  });

  it("draws nothing for a page with no neighbours, and a nav of links otherwise", () => {
    expect(renderToStaticMarkup(createElement(RelatedLandingsList, { links: [] }))).toBe("");
    const markup = renderToStaticMarkup(
      createElement(RelatedLandingsList, { links: links(category("lavazza-blue")) }),
    );
    expect(markup).toMatch(/^<nav aria-label="Свързани страници"/);
    expect(markup).toContain('href="/bg/lavazza-kapsuli"');
    expect(markup).toContain('href="/bg/bezkofeinovo-kafe#lavazza-blue"');
    expect(markup).not.toMatch(/<h[1-6]/);
  });
});

describe("the copy", () => {
  const systems = (ids: readonly string[]) =>
    ids.map((id) => BREWING_SYSTEMS.find((system) => system.id === id)!);
  const facts = (overrides: Partial<LandingFacts> = {}): LandingFacts => ({
    count: 10,
    systems: systems(["lavazza-blue", "a-modo-mio", "nespresso-original"]),
    methods: ["capsule"],
    cupRange: {
      min: { amount: "0.3325", estimated: false },
      max: { amount: "0.4800", estimated: false },
    },
    commonPack: null,
    currency: "EUR",
    ...overrides,
  });

  it("titles and heads each landing as the study's table does", () => {
    expect(landingCopy.lavazzaCapsules.title(facts())).toBe(
      "Капсули Lavazza (Лаваца): Blue, A Modo Mio и за Nespresso",
    );
    expect(landingCopy.lavazzaCapsules.h1).toBe("Капсули Lavazza");

    expect(landingCopy.lavazzaBeans.title(facts({ commonPack: "1 кг" }))).toBe(
      "Кафе на зърна Lavazza (Лаваца) — 1 кг, цена на чаша",
    );
    expect(landingCopy.lavazzaBeans.h1).toBe("Кафе на зърна Lavazza");

    expect(landingCopy.decaf.title(facts({ methods: ["capsule", "pod", "beans"] }))).toBe(
      "Безкофеиново кафе — капсули, дози и зърна",
    );
    expect(landingCopy.decaf.h1).toBe("Безкофеиново кафе");

    expect(landingCopy.cheapest.title(facts({ methods: ["capsule", "pod", "beans"] }))).toBe(
      "Евтини капсули и кафе на зърна — подредени по цена на чаша",
    );
    expect(landingCopy.cheapest.h1).toBe("Най-евтино на чаша");

    expect(
      landingCopy.flavoured.title(
        facts({ flavours: { named: ["hazelnut", "caramel"], others: true } }),
      ),
    ).toBe("Ароматизирано кафе с вкус на лешник, карамел и други");
    expect(landingCopy.flavoured.h1).toBe("Ароматизирано кафе");
  });

  it("names a flavour in the flavoured title only while the page lists it", () => {
    const title = (named: ("hazelnut" | "caramel")[], others: boolean) =>
      landingCopy.flavoured.title(facts({ flavours: { named, others } }));
    expect(title(["hazelnut", "caramel"], false)).toBe(
      "Ароматизирано кафе с вкус на лешник и карамел",
    );
    expect(title(["hazelnut"], true)).toBe("Ароматизирано кафе с вкус на лешник и други");
    expect(title(["caramel"], false)).toBe("Ароматизирано кафе с вкус на карамел");
    expect(title([], true)).toBe("Ароматизирано кафе по система, с цена на чаша");
    expect(landingCopy.flavoured.title(facts())).toBe(
      "Ароматизирано кафе по система, с цена на чаша",
    );
  });

  it("says which formats the flavoured page has, from the facts, and that ground is not one", () => {
    const both = facts({
      methods: ["capsule", "pod"],
      flavours: { named: ["hazelnut", "caramel"], others: true },
    });
    expect(landingCopy.flavoured.description(both)).toMatch(
      /^Кафе с вкус на лешник, карамел и други — в капсули и дози ESE\. От 0,33\s€ до 0,48\s€ на чаша\./,
    );
    const [first, formats, order] = landingCopy.flavoured.intro({ ...both, count: 20 });
    expect(first).toBe(
      "Тук са 20 продукта с добавен аромат — сред тях кафе с вкус на лешник и на карамел. Някои са напитки без кафе, например мача лате.",
    );
    expect(formats).toBe("Всички са в капсули и дози ESE.");
    expect(order).toContain("капсулата влиза само в машината, за която е направена");

    const withBeans = facts({ methods: ["capsule", "pod", "beans"] });
    expect(landingCopy.flavoured.intro(withBeans)[1]).toBe(
      "Всички са в капсули, дози ESE и на зърна.",
    );
    // One flavour named, no lists of what the shop lacks.
    expect(
      landingCopy.flavoured.intro(
        facts({ count: 4, flavours: { named: ["caramel"], others: true } }),
      )[0],
    ).toMatch(/^Тук са 4 продукта с добавен аромат — сред тях кафе с вкус на карамел\. /);
    expect(landingCopy.flavoured.intro(facts({ count: 4 }))[0]).toMatch(
      /^Тук са 4 продукта с добавен аромат\. Някои са напитки без кафе/,
    );
    expect(landingCopy.flavoured.description(withBeans)).toMatch(
      /^Ароматизирано кафе в капсули, дози ESE и на зърна\./,
    );
    // Pods alone: no capsule sentence, and no flavour named that is not listed.
    const pods = landingCopy.flavoured.intro(facts({ methods: ["pod"], count: 3 }));
    expect(pods.join(" ")).not.toMatch(/капсул|лешник|карамел/);
  });

  it("claims for the flavoured page only what the flag says, never „всичко ароматизирано“", () => {
    const text = [
      ...landingCopy.flavoured.intro(facts({ count: 20 })),
      landingCopy.flavoured.llms,
    ].join(" ");
    // A pack can say hazelnut on its box without the flag; the page lists the flag.
    expect(text).not.toMatch(/всичко ароматизирано|всички ароматизирани/i);
    // Nor does it say what the shop lacks: the group headings show the formats.
    expect(text).not.toMatch(/нямаме|не предлагаме|няма /);
    expect(text).toContain("20 продукта с добавен аромат");
    expect(landingCopy.flavoured.llms).toBe(
      "Кафе и напитки с добавен аромат, разделени по система.",
    );
  });

  it("speaks of one flavoured product in the singular", () => {
    const one = landingCopy.flavoured.intro(
      facts({ count: 1, flavours: { named: ["hazelnut"], others: false } }),
    );
    expect(one[0]).toBe("Тук е 1 продукт с добавен аромат — в капсули, с вкус на лешник.");
    const text = one.join(" ");
    expect(text).not.toMatch(/Тук са|сред тях|Някои|Всички|първа е най-ниската/);
    expect(text).not.toContain(FLAVOURED_DRINKS_SENTENCE);
    expect(one.at(-1)).toBe(
      "Капсулата влиза само в машината, за която е направена, какъвто и да е вкусът ѝ: проверете дали вашата машина е от тази система.",
    );
    // Several, and the plural comes back with the drinks sentence.
    const two = landingCopy.flavoured.intro(facts({ count: 2 })).join(" ");
    expect(two).toContain("Тук са 2 продукта с добавен аромат.");
    expect(two).toContain(FLAVOURED_DRINKS_SENTENCE);
  });

  it("heads each flavoured group by the shelf's own name", () => {
    const heading = (id: string) =>
      landingCopy.flavoured.groupHeading(BREWING_SYSTEMS.find((system) => system.id === id)!);
    expect(heading("nespresso-original")).toBe("Ароматизирани капсули за Nespresso");
    expect(heading("dolce-gusto")).toBe("Ароматизирани капсули за Dolce Gusto");
    expect(heading("caffitaly")).toBe("Ароматизирани капсули Caffitaly");
    expect(heading("ese-pod")).toBe("Ароматизирани дози ESE");
    expect(heading("beans")).toBe("Ароматизирано кафе на зърна");
  });

  it("says in a title only what the page then shows", () => {
    expect(landingCopy.lavazzaCapsules.title(facts({ systems: systems(["lavazza-blue"]) }))).toBe(
      "Капсули Lavazza (Лаваца): Blue",
    );
    expect(landingCopy.lavazzaBeans.title(facts())).toBe(
      "Кафе на зърна Lavazza (Лаваца) — цена на чаша",
    );
    expect(landingCopy.decaf.title(facts({ methods: ["capsule"] }))).toBe(
      "Безкофеиново кафе — капсули",
    );
    expect(landingCopy.cheapest.title(facts({ methods: ["beans"] }))).toBe(
      "Евтино кафе на зърна — подредени по цена на чаша",
    );
  });

  it("puts the per-cup range in every description, and the callback wherever it fits", () => {
    for (const id of LANDING_IDS) {
      const description = landingCopy[id].description(facts());
      expect(description).toMatch(/[Оо]т 0,33\s€ до 0,48\s€ на чаша\./);
      // Left out whole, never cut: only when the description has no room for it.
      if (!description.endsWith(CALLBACK_SENTENCE)) {
        expect([...`${description} ${CALLBACK_SENTENCE}`].length).toBeGreaterThan(
          DESCRIPTION_LIMIT,
        );
      }
      expect([...description].length).toBeLessThanOrEqual(DESCRIPTION_LIMIT);
    }
    expect(machineBrandFeatures.tchibo?.description(facts({ count: 9 }))).toMatch(
      /9 вида капсули Caffitaly\. От 0,33\s€ до 0,48\s€ на чаша\./,
    );
  });

  it("marks an estimated end of the range, and prints a point as one price", () => {
    expect(
      cupRangeText({
        currency: "EUR",
        cupRange: {
          min: { amount: "0.1442", estimated: true },
          max: { amount: "0.3325", estimated: false },
        },
      }),
    ).toMatch(/^от ≈ 0,14\s€ до 0,33\s€ на чаша$/);
    expect(
      cupRangeText({
        currency: "EUR",
        cupRange: {
          min: { amount: "0.3325", estimated: false },
          max: { amount: "0.3325", estimated: false },
        },
      }),
    ).toMatch(/^0,33\s€ на чаша$/);
    expect(cupRangeText({ currency: "EUR", cupRange: null })).toBeNull();
    // With no range the description still ends on the callback, and invents no figure.
    expect(landingCopy.decaf.description(facts({ cupRange: null }))).not.toMatch(/€/);
  });

  it("types no figure into the introductions: each comes from the facts", () => {
    for (const id of LANDING_IDS) {
      const few = landingCopy[id].intro(facts({ count: 3 })).join(" ");
      const many = landingCopy[id].intro(facts({ count: 47 })).join(" ");
      expect(few).not.toContain("47");
      for (const text of [few, many]) {
        expect(text).not.toMatch(/!|оригиналн/i);
        expect(text).not.toMatch(/€/);
      }
    }
    expect(landingCopy.decaf.intro(facts({ count: 47 }))[0]).toContain("47 продукта");
    expect(landingCopy.cheapest.intro(facts()).join(" ")).toContain(
      `до ${CHEAPEST_PER_SYSTEM} продукта`,
    );
  });

  it("says how a cheapest group was chosen, truthfully for a small system", () => {
    expect(cheapestGroupNote(3, 36)).toBe(
      "3 продукта с най-ниска цена на чаша от общо 36 в тази система.",
    );
    expect(cheapestGroupNote(1, 1)).toContain("1 продукт,");
  });

  it("heads Lavazza's own systems and the compatible ones differently", () => {
    const [blue, , nespresso] = facts().systems;
    expect(landingCopy.lavazzaCapsules.groupHeading(blue!)).toBe("Капсули за Lavazza Blue");
    expect(landingCopy.lavazzaCapsules.groupHeading(nespresso!)).toBe(
      "Капсули Lavazza, съвместими с Nespresso Original",
    );
  });

  it("titles the machine pages: Tchibo for Cafissimo, the rest generically", () => {
    expect(machineBrandFeatures.tchibo?.title).toBe(
      "Капсули за Tchibo Cafissimo (Чибо) — формат Caffitaly",
    );
    expect(machineBrandFeatures.tchibo?.h1).toBe("Капсули за Tchibo Cafissimo");
    // K-fee is its own system: nothing here fits it, and the title says so.
    expect(machineOwnSystemCopy["k-fee"]?.title).toBe(
      "Кафемашини K-fee — собствена система капсули, не Caffitaly",
    );
    expect(machineBrandCopy.title("Krups", true)).toBe(
      "Капсули и кафе за кафемашини Krups — какво пасва",
    );
    expect(machineBrandCopy.h1("Krups")).toBe("Кафемашини Krups: какво им пасва");
    // A maker of bean-to-cup machines only is not promised capsules.
    expect(machineBrandCopy.title("Jura", false)).toBe("Кафе за кафемашини Jura — какво пасва");
  });

  it("keeps „капсули Lavazza“ and „без кофеин“ out of every other title", () => {
    const others = [
      landingCopy.lavazzaBeans.title(facts({ commonPack: "1 кг" })),
      landingCopy.decaf.title(facts()),
      landingCopy.cheapest.title(facts()),
      machineBrandCopy.title("Lavazza", true),
      machineBrandFeatures.tchibo?.title ?? "",
    ];
    for (const title of others) expect(title).not.toMatch(/капсули lavazza|лаваца капсули/i);
    for (const title of [
      landingCopy.lavazzaCapsules.title(facts()),
      landingCopy.cheapest.title(facts()),
    ]) {
      expect(title).not.toMatch(/без кофеин|безкофеин/i);
    }
  });
});

describe("the brand × format link on a product page", () => {
  const available = landingAvailability(CATALOG);
  const members = available.members!;

  it("names the Lavazza capsules page for a product it lists, at the product's system", () => {
    const id = members.lavazzaCapsules[0]!;
    const system = available.groups.lavazzaCapsules[0]!;
    const link = brandFormatLink("bg", { id, systemId: system }, available);
    expect(link?.label).toBe("Капсули Lavazza");
    expect(link?.href).toBe(`/bg/lavazza-kapsuli#${system}`);
  });

  it("names the Lavazza beans page for a bag it lists", () => {
    const id = members.lavazzaBeans[0]!;
    const link = brandFormatLink("bg", { id, systemId: "beans" }, available);
    expect(link).toEqual({
      key: "lavazzaBeans",
      href: "/bg/kafe-na-zarna-lavazza",
      label: "Кафе на зърна Lavazza",
    });
  });

  it("is nothing for a product neither page lists", () => {
    expect(
      brandFormatLink("bg", { id: "not-a-lavazza", systemId: "dolce-gusto" }, available),
    ).toBeNull();
  });
});
