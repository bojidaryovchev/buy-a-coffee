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
  NO_LANDINGS,
  isDecaf,
  landingAvailability,
  landingForSegment,
  selectLanding,
  selectSystem,
  type LandingRow,
} from "@/lib/catalog/landings";
import { relatedLandingLinks, type RelatedLink } from "@/lib/catalog/related-landings";
import { BREWING_SYSTEMS } from "@/lib/recommend/systems";
import { href, isReservedSlug } from "@/lib/routes";
import {
  CALLBACK_SENTENCE,
  cheapestGroupNote,
  cupRangeText,
  landingCopy,
  machineBrandCopy,
  machineBrandFeatures,
  relatedCopy,
  type LandingFacts,
} from "../content/landing-copy";

/*
 * The four landing listings: what each selects, when each exists, what links
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
    ]);
  });

  it("knows a landing from its segment, for the proxy", () => {
    expect(landingForSegment("bezkofeinovo-kafe")).toBe("decaf");
    expect(landingForSegment("nay-evtino-na-chasha")).toBe("cheapest");
    expect(landingForSegment("konsumativi")).toBeNull();
  });

  it("reserves them, in both languages, so no product or category can take one", () => {
    for (const slug of [
      "lavazza-kapsuli",
      "kafe-na-zarna-lavazza",
      "bezkofeinovo-kafe",
      "nay-evtino-na-chasha",
      "lavazza-capsules",
      "decaf-coffee",
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

  it("puts the per-cup range and the phone callback in every description", () => {
    for (const id of LANDING_IDS) {
      const description = landingCopy[id].description(facts());
      expect(description).toMatch(/[Оо]т 0,33\s€ до 0,48\s€ на чаша\./);
      expect(description.endsWith(CALLBACK_SENTENCE)).toBe(true);
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
      "Капсули за Tchibo Cafissimo (Чибо Кафисимо) — пасват капсулите Caffitaly",
    );
    expect(machineBrandFeatures.tchibo?.h1).toBe("Капсули за Tchibo Cafissimo");
    expect(machineBrandCopy.title("Krups", true)).toBe(
      "Капсули и кафе за кафемашини Krups — кой модел какво приема",
    );
    expect(machineBrandCopy.h1("Krups")).toBe("Кафемашини Krups: какво им пасва");
    // A maker of bean-to-cup machines only is not promised capsules.
    expect(machineBrandCopy.title("Jura", false)).toBe(
      "Кафе за кафемашини Jura — кой модел какво приема",
    );
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
