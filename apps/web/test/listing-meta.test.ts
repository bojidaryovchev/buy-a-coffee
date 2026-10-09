import { describe, expect, it } from "vitest";
import { brandFacts, brandFactsFor } from "../content/brand-facts";
import { brandDisplayNames } from "../content/brand-names";
import { categoryCopy, categoryNameFor, segmentParagraph } from "../content/category-copy";
import { vendingCopy } from "../content/vending";
import { siteConfig } from "@/config/site";
import {
  cupRangeOf,
  cupRangeOfRanges,
  cupRangePhrase,
  uniformPieceCount,
  type CupRangeRow,
} from "@/lib/catalog/cup-range";
import { getArticle } from "@/lib/journal";
import { BREWING_SYSTEMS, type BrewingSystemId } from "@/lib/recommend/systems";
import { targetHref } from "@/lib/routes";
import { breadcrumbJsonLd, categoryCrumbs, listingBreadcrumbs } from "@/lib/seo/json-ld";
import {
  BRANDS_INDEX_META,
  CALLBACK_SENTENCE,
  CATEGORIES_INDEX_META,
  HOME_META,
  PROMOTIONS_META,
  brandDescriptionLead,
  brandFormatWords,
  brandMakes,
  brandTitle,
  brandsIndexIntro,
  capsuleFamilies,
  categoryDescriptionLead,
  categoryHeading,
  categoryTitle,
  fullTitle,
  listOf,
  metaDescription,
  pageTitle,
} from "@/lib/seo/listing-meta";

const NBSP = " ";
/** `Intl` separates the amount from „€“ with a no-break space. */
const plain = (text: string | null) => text?.replaceAll(NBSP, " ") ?? null;

const row = (price: string | null, value: string | null, unit: string | null): CupRangeRow => ({
  price,
  currency: "EUR",
  weightValue: value,
  weightUnit: unit,
});

const systems = (...ids: BrewingSystemId[]) =>
  BREWING_SYSTEMS.filter((system) => ids.includes(system.id));

/* --- Price per cup ------------------------------------------------------- */

describe("the price per cup range", () => {
  it("is the cheapest and the dearest cup, on exact decimals", () => {
    const range = cupRangeOf([
      row("5.60", "16", "pc"), // 0.35
      row("33.25", "100", "pc"), // 0.3325
      row("4.90", "16", "pc"), // 0.30625
    ]);
    expect(range?.cheapest).toEqual({ amount: "0.3063", estimated: false });
    expect(range?.dearest).toEqual({ amount: "0.3500", estimated: false });
    expect(plain(cupRangePhrase(range))).toBe("от 0,31 € до 0,35 € на чаша");
  });

  it("marks a figure derived from weight, each end on its own", () => {
    const range = cupRangeOf([row("13.45", "1000", "g"), row("5.50", "10", "pc")]);
    expect(range?.cheapest.estimated).toBe(true);
    expect(range?.dearest.estimated).toBe(false);
    expect(plain(cupRangePhrase(range))).toBe("от ≈ 0,09 € до 0,55 € на чаша");
  });

  it("is one figure when both ends print the same", () => {
    expect(plain(cupRangePhrase(cupRangeOf([row("12.80", "36", "pc")])))).toBe("0,36 € на чаша");
    expect(
      plain(cupRangePhrase(cupRangeOf([row("12.80", "36", "pc"), row("12.81", "36", "pc")]))),
    ).toBe("0,36 € на чаша");
  });

  it("leaves out what cannot be priced per cup rather than guessing", () => {
    expect(cupRangeOf([])).toBeNull();
    expect(cupRangeOf([row(null, "16", "pc"), row("5.00", null, null)])).toBeNull();
    expect(cupRangeOf([row("0.00", "16", "pc")])).toBeNull();
    // A bottle of syrup is not a number of coffees.
    expect(cupRangeOf([row("5.00", "250", "ml")])).toBeNull();
    expect(cupRangePhrase(null)).toBeNull();
  });

  it("never ranks another currency against the shop's", () => {
    const range = cupRangeOf([
      { ...row("1.00", "100", "pc"), currency: "BGN" },
      row("5.00", "10", "pc"),
    ]);
    expect(range?.cheapest.amount).toBe("0.5000");
  });

  it("does not compare amounts as text", () => {
    // "10.00" < "9.00" as strings; 1.00 a cup is not cheaper than 0.90.
    const range = cupRangeOf([row("10.00", "10", "pc"), row("9.00", "10", "pc")]);
    expect(range?.cheapest.amount).toBe("0.9000");
    expect(range?.dearest.amount).toBe("1.0000");
  });

  it("merges the ranges of a page that lists from two reads", () => {
    const a = cupRangeOf([row("5.00", "10", "pc"), row("6.00", "10", "pc")]);
    const b = cupRangeOf([row("13.45", "1000", "g")]);
    const merged = cupRangeOfRanges([a, null, b]);
    expect(merged?.cheapest).toEqual(b?.cheapest);
    expect(merged?.dearest).toEqual(a?.dearest);
    expect(cupRangeOfRanges([null, null])).toBeNull();
    expect(cupRangeOfRanges([])).toBeNull();
  });

  it("names a pack size only when every pack on the page has it", () => {
    expect(uniformPieceCount([row("30", "100.0000", "pc"), row("33", "100.0000", "pc")])).toBe(100);
    expect(uniformPieceCount([row("30", "100", "pc"), row("5", "10", "pc")])).toBeNull();
    expect(uniformPieceCount([row("30", "100", "pc"), row("13", "1000", "g")])).toBeNull();
    expect(uniformPieceCount([row("30", null, null)])).toBeNull();
    expect(uniformPieceCount([])).toBeNull();
  });
});

/* --- Titles -------------------------------------------------------------- */

const key = (sourceKey: string, name: string, slug = sourceKey) => ({ sourceKey, slug, name });

const CHILDREN = [
  key("nespresso", "Nespresso"),
  key("dolce-gusto", "Dolce Gusto"),
  key("a-modo-mio", "A Modo Mio"),
  key("caffitaly", "Caffitaly"),
  key("lavazza-blue", "Lavazza Blue"),
];

describe("category titles and headings", () => {
  it("uses the wording of the market study", () => {
    expect(categoryTitle(key("dolce-gusto", "Dolce Gusto"))).toBe(
      "Капсули за Dolce Gusto (Долче Густо) — цена на чаша",
    );
    expect(categoryHeading(key("dolce-gusto", "Dolce Gusto"))).toBe("Капсули за Dolce Gusto");
    expect(categoryTitle(key("nespresso", "Nespresso"))).toBe(
      "Капсули за Nespresso (Неспресо) — цена на чаша",
    );
    expect(categoryHeading(key("nespresso", "Nespresso"))).toBe("Капсули, съвместими с Nespresso");
    expect(categoryTitle(key("kafe-na-zyrna", "Кафе на зърна", "kafe-na-zarna"))).toBe(
      "Кафе на зърна — цена за кг и на чаша",
    );
    expect(categoryTitle(key("kafe-dozi", "Кафе дози"))).toBe(
      "Кафе дози ESE (хартиени дози 44 мм)",
    );
    expect(categoryHeading(key("kafe-dozi", "Кафе дози"))).toBe("Кафе дози ESE");
  });

  it("names the capsule families that are on sale, each once", () => {
    const parent = key("kafe-kapsuli", "Кафе капсули", "kapsuli");
    expect(capsuleFamilies(CHILDREN)).toEqual(["Nespresso", "Dolce Gusto", "Lavazza", "Caffitaly"]);
    expect(categoryTitle(parent, { children: CHILDREN })).toBe(
      "Кафе капсули за Nespresso, Dolce Gusto, Lavazza и Caffitaly",
    );
    // A system that sells out leaves the title with the menu.
    expect(categoryTitle(parent, { children: CHILDREN.slice(0, 2) })).toBe(
      "Кафе капсули за Nespresso и Dolce Gusto",
    );
    expect(categoryTitle(parent, { children: [] })).toBe("Кафе капсули");
    expect(categoryDescriptionLead(parent, { children: [] })).toBe("Кафе капсули");
    // A subcategory nobody has written about is named as the catalog names it.
    expect(capsuleFamilies([...CHILDREN.slice(0, 1), key("vertuo", "Vertuo")])).toEqual([
      "Nespresso",
      "Vertuo",
    ]);
  });

  it("puts a pack size in a title only from the catalog", () => {
    const blue = key("lavazza-blue", "Lavazza Blue");
    expect(categoryTitle(blue, { uniformPieceCount: 100 })).toBe(
      "Капсули Lavazza Blue (Лаваца Блу) — 100 бр., цена на чаша",
    );
    expect(categoryTitle(blue, { uniformPieceCount: 50 })).toContain("50 бр.");
    expect(categoryTitle(blue, { uniformPieceCount: null })).toBe(
      "Капсули Lavazza Blue (Лаваца Блу) — цена на чаша",
    );
    // No typed figure in any title: digits come only from `{pack}`, or are the
    // size of an ESE pod, which is the format's own definition.
    for (const [sourceKey, copy] of Object.entries(categoryCopy)) {
      expect(copy.title.replace("44 мм", ""), sourceKey).not.toMatch(/\d/);
      expect((copy.titleWithPack ?? "").replace("{pack}", ""), sourceKey).not.toMatch(/\d/);
      expect(copy.description.replace("44 мм", ""), sourceKey).not.toMatch(/\d/);
    }
  });

  it("falls back to the stored name for a category nobody has written about", () => {
    const tea = key("chay", "Чай");
    expect(categoryTitle(tea)).toBe("Чай");
    expect(categoryHeading(tea)).toBe("Чай");
    expect(categoryDescriptionLead(tea)).toBe("Чай");
    expect(categoryNameFor(tea)).toBe("Чай");
  });

  it("says „за“ or „съвместими с“ a system, never „оригинални“", () => {
    for (const sourceKey of ["nespresso", "dolce-gusto", "lavazza-blue", "a-modo-mio"]) {
      const copy = categoryCopy[sourceKey];
      expect(copy?.h1, sourceKey).toMatch(/ за |съвместими с /u);
    }
    for (const [sourceKey, copy] of Object.entries(categoryCopy)) {
      for (const text of [copy.name, copy.h1, copy.title, copy.description]) {
        expect(text, sourceKey).not.toMatch(/оригинал|!/iu);
        expect(text, sourceKey).toBe(text.trim());
      }
    }
  });
});

const BRAND_FIXTURES = [
  { slug: "lavazza", name: "Lavazza", systems: systems("beans", "ese-pod", "nespresso-original") },
  { slug: "bianchi", name: "Bianchi", systems: systems("dolce-gusto", "ese-pod") },
  { slug: "kimbo", name: "Kimbo", systems: systems("beans", "ese-pod") },
  { slug: "amann", name: "Amann", systems: systems("beans") },
  { slug: "3bourbons", name: "3 Bourbons", systems: systems("ese-pod") },
];

describe("brand titles", () => {
  it("leads with the brand as it is searched, then the formats in stock", () => {
    const [, bianchi, kimbo] = BRAND_FIXTURES;
    expect(brandTitle(bianchi!, bianchi!.systems)).toBe("Кафе Bianchi (Бианчи): капсули и дози");
    expect(brandTitle(kimbo!, kimbo!.systems)).toBe("Кафе Kimbo (Кимбо): зърна и дози");
  });

  it("keeps a format away from the name when that brand's format has its own page", () => {
    const [lavazza] = BRAND_FIXTURES;
    expect(brandFormatWords(lavazza!, lavazza!.systems)).toEqual(["дози", "зърна", "капсули"]);
    expect(brandTitle(lavazza!, lavazza!.systems)).toBe(
      "Кафе Lavazza (Лаваца): дози, зърна и капсули",
    );
  });

  it("writes one alphabet for a brand with no measured Cyrillic spelling", () => {
    const [, , , amann] = BRAND_FIXTURES;
    expect(brandTitle(amann!, amann!.systems)).toBe("Кафе Amann: зърна — цена на чаша");
    expect(brandDescriptionLead(amann!, amann!.systems)).toBe("Кафе Amann: зърна");
  });

  it("names a brand with nothing in stock and no more", () => {
    expect(brandTitle({ slug: "kimbo", name: "Kimbo" }, [])).toBe("Кафе Kimbo (Кимбо)");
    expect(brandDescriptionLead({ slug: "new", name: "New" }, [])).toBe("Кафе New");
  });

  it("finds a brand's facts by slug, however the slug is punctuated", () => {
    expect(brandFactsFor({ slug: "rema-caffe" }).cyrillic).toBe("Рема");
    expect(brandFactsFor({ slug: "remacaffe" }).cyrillic).toBe("Рема");
    expect(brandFactsFor({ slug: "unknown" })).toEqual({});
  });

  it("records facts only for brands the shop spells, and evidence for every Italian one", () => {
    for (const [sourceKey, facts] of Object.entries(brandFacts)) {
      expect(Object.keys(brandDisplayNames), sourceKey).toContain(sourceKey);
      if (facts.italian !== undefined) expect(facts.italian.length, sourceKey).toBeGreaterThan(20);
      if (facts.cyrillic !== undefined) expect(facts.cyrillic, sourceKey).toMatch(/^[А-Я][а-я]+$/u);
    }
  });
});

/* --- The brand index ----------------------------------------------------- */

describe("the brand index", () => {
  it("counts the brands it is given and names the Italian ones", () => {
    const intro = brandsIndexIntro([
      { slug: "lavazza", name: "Lavazza" },
      { slug: "bianchi", name: "Bianchi" },
      { slug: "kimbo", name: "Kimbo" },
      { slug: "brand-new", name: "Brand New" },
    ]);
    expect(intro).toContain("4 марки кафе");
    expect(intro).toContain("Сред тях са италианските Lavazza и Kimbo.");
    expect(intro).not.toContain("Bianchi");
    expect(intro).not.toContain("Brand New");
  });

  it("agrees in number with one brand, one Italian brand, and none", () => {
    expect(brandsIndexIntro([{ slug: "bianchi", name: "Bianchi" }])).toContain(
      "В момента предлагаме 1 марка кафе. Под",
    );
    expect(
      brandsIndexIntro([
        { slug: "bianchi", name: "Bianchi" },
        { slug: "illy", name: "illy" },
      ]),
    ).toContain("Сред тях е италианската illy.");
    expect(
      brandsIndexIntro([
        { slug: "kimbo", name: "Kimbo" },
        { slug: "illy", name: "illy" },
      ]),
    ).toContain("2 марки кафе, всички италиански.");
    expect(brandsIndexIntro([])).toBeNull();
  });

  it("says what a brand makes, capsules by system", () => {
    expect(brandMakes(systems("beans", "ese-pod"))).toBe("зърна, дози ESE");
    expect(brandMakes(systems("dolce-gusto", "nespresso-original"))).toBe(
      "капсули за Nespresso Original и Dolce Gusto",
    );
    expect(brandMakes([])).toBeNull();
  });
});

/* --- Every wording, against the rules of the study ----------------------- */

describe("titles and descriptions", () => {
  const TITLES = [
    HOME_META.title,
    BRANDS_INDEX_META.title,
    PROMOTIONS_META.title,
    CATEGORIES_INDEX_META.title,
    vendingCopy.metaTitle,
    ...Object.entries(categoryCopy).map(([sourceKey]) =>
      categoryTitle(key(sourceKey, sourceKey), { children: CHILDREN, uniformPieceCount: 100 }),
    ),
    ...BRAND_FIXTURES.map((brand) => brandTitle(brand, brand.systems)),
  ];

  it("ends every title with the shop's name, from configuration", () => {
    expect(pageTitle("Кафе на зърна")).toEqual({
      absolute: `Кафе на зърна | ${siteConfig.name}`,
    });
    expect(fullTitle("x")).toBe(`x | ${siteConfig.name}`);
  });

  it("keeps titles short, without shouting", () => {
    for (const title of TITLES) {
      expect(title, title).not.toMatch(/оригинал|!/iu);
      expect(title, title).toBe(title.trim());
      // The study's own longest rows run to 59 characters before the name.
      expect(title.length, title).toBeLessThanOrEqual(60);
      expect(title.length, title).toBeGreaterThanOrEqual(15);
    }
  });

  it("gives every description a price per cup and the callback, in a snippet's length", () => {
    const range = cupRangeOf([row("13.45", "1000", "g"), row("6.65", "10", "pc")]);
    const leads = [
      HOME_META.description,
      PROMOTIONS_META.description,
      CATEGORIES_INDEX_META.description,
      vendingCopy.metaDescription,
      "187 марки кафе, италиански и други",
      ...Object.entries(categoryCopy).map(([sourceKey]) =>
        categoryDescriptionLead(key(sourceKey, sourceKey), { children: CHILDREN }),
      ),
      ...BRAND_FIXTURES.map((brand) => brandDescriptionLead(brand, brand.systems)),
    ];
    for (const lead of leads) {
      const description = metaDescription(lead, range);
      expect(plain(description), lead).toContain("— от ≈ 0,09 € до 0,67 € на чаша. ");
      expect(description.endsWith(CALLBACK_SENTENCE), lead).toBe(true);
      expect(description.length, description).toBeLessThanOrEqual(155);
      expect(description, lead).not.toMatch(/оригинал|!|\.\./iu);
    }
  });

  it("leaves the range out when the catalog cannot support one", () => {
    expect(metaDescription("Кафе на зърна", null)).toBe(`Кафе на зърна. ${CALLBACK_SENTENCE}`);
    const empty = `${PROMOTIONS_META.descriptionWhenEmpty} ${CALLBACK_SENTENCE}`;
    expect(empty.length).toBeLessThanOrEqual(155);
  });

  it("joins a list the way Bulgarian does", () => {
    expect(listOf([])).toBe("");
    expect(listOf(["A"])).toBe("A");
    expect(listOf(["A", "B"])).toBe("A и B");
    expect(listOf(["A", "B", "C"])).toBe("A, B и C");
  });
});

/* --- Links inside the introductions -------------------------------------- */

describe("links in category introductions", () => {
  it("links each phrase where it stands, once", () => {
    for (const [sourceKey, copy] of Object.entries(categoryCopy)) {
      for (const link of copy.links ?? []) {
        const holding = copy.paragraphs.filter((paragraph) => paragraph.includes(link.phrase));
        expect(holding.length, `${sourceKey}: „${link.phrase}“`).toBe(1);
        expect(holding[0]?.split(link.phrase).length, `${sourceKey}: „${link.phrase}“`).toBe(2);
      }
    }
  });

  it("cuts a paragraph at its phrases, in reading order", () => {
    const first = { phrase: "кафе капсулите", to: "/a" as const };
    const second = { phrase: "кафето на зърна", to: "/b" as const };
    expect(
      segmentParagraph("Разгледайте кафе капсулите или кафето на зърна.", [second, first]),
    ).toEqual(["Разгледайте ", first, " или ", second, "."]);
    expect(segmentParagraph("Нищо за свързване.", [first])).toEqual(["Нищо за свързване."]);
    expect(segmentParagraph("Без връзки.")).toEqual(["Без връзки."]);
  });

  it("resolves every target to a Bulgarian URL that is not this listing's own", () => {
    const own: Readonly<Record<string, string>> = {
      "kafe-kapsuli": "/bg/kafe-kapsuli",
      "lavazza-blue": "/bg/lavazza-blue-kapsuli",
      "a-modo-mio": "/bg/lavazza-a-modo-mio-kapsuli",
      caffitaly: "/bg/caffitaly-kapsuli",
      "kafe-dozi": "/bg/kafe-dozi",
    };
    const targets = Object.entries(categoryCopy).flatMap(([sourceKey, copy]) =>
      (copy.links ?? []).map((link) => [sourceKey, link.phrase, targetHref("bg", link.to)]),
    );
    expect(targets).toEqual([
      ["kafe-kapsuli", "списъка с машини", "/bg/za-kafemashina"],
      ["lavazza-blue", "капсули A Modo Mio", "/bg/lavazza-a-modo-mio-kapsuli"],
      ["caffitaly", "машините Tchibo Cafissimo", "/bg/za-kafemashina/tchibo"],
      ["a-modo-mio", "капсулите за Lavazza Blue", "/bg/lavazza-blue-kapsuli"],
      ["kafe-dozi", "кафе капсулите", "/bg/kafe-kapsuli"],
      ["kafe-dozi", "кафето на зърна", "/bg/kafe-na-zarna"],
    ]);
    for (const [sourceKey, , url] of targets) expect(url).not.toBe(own[sourceKey as string]);
  });

  /* `docs/seo.md` §13.1: one anchor, one URL. */
  it("never uses one phrase for two different pages", () => {
    const byPhrase = new Map<string, string>();
    for (const copy of Object.values(categoryCopy)) {
      for (const link of copy.links ?? []) {
        const url = targetHref("bg", link.to);
        expect(byPhrase.get(link.phrase) ?? url, link.phrase).toBe(url);
        byPhrase.set(link.phrase, url);
      }
    }
  });

  /* §13.4: at most one article per listing, and only one that exists. */
  it("points a listing at an article the journal really has", () => {
    const withArticle = Object.entries(categoryCopy).filter(([, copy]) => copy.article);
    expect(withArticle.map(([sourceKey]) => sourceKey)).toEqual(["kafe-kapsuli"]);
    for (const [sourceKey, copy] of withArticle) {
      expect(getArticle(copy.article), sourceKey).not.toBeNull();
    }
  });
});

/* --- Breadcrumbs --------------------------------------------------------- */

describe("listing breadcrumbs", () => {
  const parent = key("kafe-kapsuli", "Кафе капсули", "kapsuli");
  const dolceGusto = key("dolce-gusto", "Dolce Gusto");

  it("follow the format: Начало › Кафе капсули › Капсули за Dolce Gusto", () => {
    expect(listingBreadcrumbs("bg", categoryCrumbs("bg", dolceGusto, parent))).toEqual([
      { name: "Начало", href: "/bg" },
      { name: "Кафе капсули", href: "/bg/kafe-kapsuli" },
      { name: "Капсули за Dolce Gusto", href: "/bg/dolce-gusto-kapsuli" },
    ]);
  });

  it("have no index page between home and a top-level listing", () => {
    const beans = key("kafe-na-zyrna", "Кафе на зърна", "kafe-na-zarna");
    expect(listingBreadcrumbs("bg", categoryCrumbs("bg", beans))).toEqual([
      { name: "Начало", href: "/bg" },
      { name: "Кафе на зърна", href: "/bg/kafe-na-zarna" },
    ]);
  });

  it("are declared in structured data exactly as they are shown", () => {
    const trail = listingBreadcrumbs("bg", categoryCrumbs("bg", dolceGusto, parent));
    const data = breadcrumbJsonLd(trail) as {
      itemListElement: Array<{ position: number; name: string; item: string }>;
    };
    expect(data.itemListElement.map((item) => item.name)).toEqual(trail.map((step) => step.name));
    expect(data.itemListElement.map((item) => item.position)).toEqual([1, 2, 3]);
    for (const [index, item] of data.itemListElement.entries()) {
      expect(item.item.endsWith(trail[index]?.href ?? "?")).toBe(true);
    }
  });

  it("name a category nobody has written about as the catalog does", () => {
    expect(categoryCrumbs("bg", key("chay", "Чай"))).toEqual([{ name: "Чай", href: "/bg/chay" }]);
  });
});
