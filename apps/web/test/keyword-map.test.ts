import { describe, expect, it } from "vitest";
import { brandFactsFor } from "../content/brand-facts";
import { landingCopy, machineBrandNames, type LandingFacts } from "../content/landing-copy";
import { vendingCopy } from "../content/vending";
import { siteConfig } from "@/config/site";
import { MACHINE_BRANDS } from "@/content/machines";
import { LANDING_IDS, LANDING_PATHS, type LandingId } from "@/lib/catalog/landings";
import { BREWING_SYSTEMS, type BrewMethod, type BrewingSystemId } from "@/lib/recommend/systems";
import {
  BRANDS_INDEX_META,
  CATEGORIES_INDEX_META,
  HOME_META,
  PROMOTIONS_META,
  brandTitle,
  categoryHeading,
  categoryTitle,
} from "@/lib/seo/listing-meta";
import {
  KEYWORD_MAP,
  carries,
  carriesIgnoringPunctuation,
  hasEveryWord,
  phrases,
} from "./keyword-map";

/**
 * One page owns each search term (`docs/seo.md` §1).
 *
 * Every title and `h1` the listing, brand, index, landing and machine-brand
 * pages can produce is built here, from the same functions the pages call, and
 * held against the table in `keyword-map.ts`: a head term stands in the title
 * or heading of its owner and of nobody else.
 *
 * The catalog below is a fixture with the shape of the real one — the eight
 * categories by their keys, the twenty brands with the systems each is stocked
 * in — so the test needs no database and still exercises every wording a real
 * page gets. The four landing listings are built in every wording their facts
 * can give them (one system or several, one pack size or mixed), and every
 * machine brand in the machine database has its page here. The product and
 * journal pages are other files' business: an article's title is the question
 * people type (§9), which may contain a listing's term on purpose.
 */

/* --- The catalog's shape ------------------------------------------------- */

const category = (sourceKey: string, slug: string, name: string) => ({ sourceKey, slug, name });

const CAPSULE_SYSTEMS = [
  category("nespresso", "nespresso", "Nespresso"),
  category("dolce-gusto", "dolce-gusto", "Dolce Gusto"),
  category("a-modo-mio", "a-modo-mio", "A Modo Mio"),
  category("caffitaly", "caffitaly", "Caffitaly"),
  category("lavazza-blue", "lavazza-blue", "Lavazza Blue"),
];

const systems = (...ids: BrewingSystemId[]) =>
  BREWING_SYSTEMS.filter((system) => ids.includes(system.id));

const BRANDS = [
  { slug: "3bourbons", name: "3 Bourbons", systems: systems("ese-pod") },
  { slug: "amann", name: "Amann", systems: systems("beans") },
  { slug: "biancaffe", name: "Biancaffè", systems: systems("beans") },
  {
    slug: "bianchi",
    name: "Bianchi",
    systems: systems("dolce-gusto", "ese-pod", "nespresso-original"),
  },
  { slug: "borbone", name: "Borbone", systems: systems("dolce-gusto", "beans") },
  { slug: "caffitaly", name: "Caffitaly", systems: systems("caffitaly") },
  { slug: "elia", name: "Elia", systems: systems("ese-pod", "beans") },
  { slug: "este", name: "Este", systems: systems("beans") },
  { slug: "eurocaf", name: "Eurocaf", systems: systems("beans") },
  { slug: "foodness", name: "Foodness", systems: systems("dolce-gusto") },
  { slug: "illy", name: "illy", systems: systems("ese-pod", "beans", "nespresso-original") },
  { slug: "julius-meinl", name: "Julius Meinl", systems: systems("beans") },
  { slug: "kimbo", name: "Kimbo", systems: systems("ese-pod", "beans") },
  {
    slug: "lavazza",
    name: "Lavazza",
    systems: systems("a-modo-mio", "ese-pod", "beans", "lavazza-blue", "nespresso-original"),
  },
  {
    slug: "lollocafe",
    name: "Lollo Caffè",
    systems: systems("dolce-gusto", "ese-pod", "beans", "lavazza-blue", "nespresso-original"),
  },
  {
    slug: "molini",
    name: "Molini",
    systems: systems("dolce-gusto", "ese-pod", "beans", "nespresso-original"),
  },
  {
    slug: "rema-caffe",
    name: "Rema Caffè",
    systems: systems("dolce-gusto", "ese-pod", "nespresso-original"),
  },
  { slug: "tezzoro", name: "Tezzoro", systems: systems("beans") },
  { slug: "vandino", name: "Vandino", systems: systems("beans") },
  { slug: "vergnano", name: "Vergnano", systems: systems("beans") },
];

/* --- Every page this wave titles ----------------------------------------- */

interface Page {
  /** The row of §1 this page is, or null for a page that owns no term. */
  readonly owner: string | null;
  readonly id: string;
  readonly title: string;
  readonly h1: string;
}

const listingPage = (
  owner: string,
  keys: ReturnType<typeof category>,
  facts: Parameters<typeof categoryTitle>[1] = {},
): Page => ({
  owner,
  id: owner,
  title: categoryTitle(keys, facts),
  h1: categoryHeading(keys),
});

const [nespresso, dolceGusto, aModoMio, caffitaly, lavazzaBlue] = CAPSULE_SYSTEMS as [
  ReturnType<typeof category>,
  ReturnType<typeof category>,
  ReturnType<typeof category>,
  ReturnType<typeof category>,
  ReturnType<typeof category>,
];

/* --- The landing listings and the machine pages --------------------------- */

const landingFacts = (
  systemIds: readonly BrewingSystemId[],
  commonPack: string | null = null,
): LandingFacts => {
  const listed = systems(...systemIds);
  const methods: readonly BrewMethod[] = ["capsule", "pod", "beans"];
  return {
    count: listed.length * 2,
    systems: listed,
    methods: methods.filter((method) => listed.some((system) => system.method === method)),
    cupRange: null,
    commonPack,
    currency: "EUR",
  };
};

/** Each landing with the facts the catalog gives it today, then the edge cases. */
const LANDING_VARIANTS: Readonly<Record<LandingId, readonly LandingFacts[]>> = {
  lavazzaCapsules: [
    landingFacts(["lavazza-blue", "a-modo-mio", "nespresso-original"]),
    landingFacts(["lavazza-blue", "a-modo-mio", "nespresso-original", "dolce-gusto", "caffitaly"]),
    landingFacts(["lavazza-blue"]),
    landingFacts([]),
  ],
  lavazzaBeans: [landingFacts(["beans"], "1 кг"), landingFacts(["beans"])],
  decaf: [
    landingFacts(["nespresso-original", "dolce-gusto", "lavazza-blue", "ese-pod", "beans"]),
    landingFacts(["nespresso-original"]),
    landingFacts(["ese-pod", "beans"]),
    landingFacts([]),
  ],
  cheapest: [
    landingFacts(BREWING_SYSTEMS.map((system) => system.id)),
    landingFacts(["nespresso-original"]),
    landingFacts(["beans"]),
    landingFacts(["ese-pod"]),
  ],
};

const landingOwner = (id: LandingId): string => LANDING_PATHS[id].slice(1);

const LANDING_PAGES: readonly Page[] = LANDING_IDS.flatMap((id) =>
  LANDING_VARIANTS[id].map((facts, index) => ({
    owner: landingOwner(id),
    id: index === 0 ? landingOwner(id) : `${landingOwner(id)} (variant ${index})`,
    title: landingCopy[id].title(facts),
    h1: landingCopy[id].h1,
  })),
);

/** Only Tchibo's page owns a term; every other machine brand's must take nobody's. */
const MACHINE_PAGES: readonly Page[] = MACHINE_BRANDS.map((brand) => {
  const id = `za-kafemashina/${brand.slug}`;
  return {
    owner: KEYWORD_MAP.some((entry) => entry.page === id) ? id : null,
    id,
    ...machineBrandNames(brand),
  };
});

const PAGES: readonly Page[] = [
  { owner: "home", id: "home", title: HOME_META.title, h1: siteConfig.tagline },
  listingPage("kafe-kapsuli", category("kafe-kapsuli", "kapsuli", "Кафе капсули"), {
    children: CAPSULE_SYSTEMS,
  }),
  listingPage("nespresso-kapsuli", nespresso),
  listingPage("dolce-gusto-kapsuli", dolceGusto),
  listingPage("lavazza-a-modo-mio-kapsuli", aModoMio),
  listingPage("caffitaly-kapsuli", caffitaly),
  // Both wordings of the Lavazza Blue title: with one pack size, and without.
  listingPage("lavazza-blue-kapsuli", lavazzaBlue, { uniformPieceCount: 100 }),
  { ...listingPage("lavazza-blue-kapsuli", lavazzaBlue), id: "lavazza-blue-kapsuli (mixed packs)" },
  listingPage("kafe-na-zarna", category("kafe-na-zyrna", "kafe-na-zarna", "Кафе на зърна")),
  listingPage("kafe-dozi", category("kafe-dozi", "kafe-dozi", "Кафе дози")),
  { owner: "marki", id: "marki", title: BRANDS_INDEX_META.title, h1: BRANDS_INDEX_META.name },
  {
    owner: "promotsii",
    id: "promotsii",
    title: PROMOTIONS_META.title,
    h1: PROMOTIONS_META.name,
  },
  {
    owner: "kafe-za-vending-mashini",
    id: "kafe-za-vending-mashini",
    title: vendingCopy.metaTitle,
    h1: vendingCopy.title,
  },
  {
    owner: null,
    id: "kategorii",
    title: CATEGORIES_INDEX_META.title,
    h1: CATEGORIES_INDEX_META.name,
  },
  ...BRANDS.map((brand) => ({
    owner: null,
    id: `marki/${brand.slug}`,
    title: brandTitle(brand, brand.systems),
    h1: brand.name,
  })),
  ...LANDING_PAGES,
  ...MACHINE_PAGES,
];

/** A second wording of a page already in the list: one page, not two. */
const isVariant = (page: Page): boolean => /\((mixed packs|variant \d+)\)$/.test(page.id);

const ownerOf = (page: string) => {
  const owner = KEYWORD_MAP.find((entry) => entry.page === page);
  if (!owner) throw new Error(`no row for ${page} in the keyword map`);
  return owner;
};

/**
 * Whether a page's own term is a narrowing of `term`.
 *
 * §1 gives „кафе на зърна“ to the beans listing, and gives the Lavazza beans
 * page „кафе на зърна лаваца“ and the cheapest-per-cup page „евтино кафе на
 * зърна“: two terms that contain the first one whole. A page cannot carry its
 * own term without the words inside it, so the map itself licenses exactly
 * that, and nothing wider: the contained term, only for the page whose own
 * term contains it.
 */
const narrows = (page: Page, term: string): boolean =>
  page.owner !== null &&
  [...ownerOf(page.owner).head, ...(ownerOf(page.owner).twins ?? [])].some((own) =>
    carries(own, term),
  );

/* --- The table itself ---------------------------------------------------- */

describe("the keyword map", () => {
  it("gives each head term to one page", () => {
    const seen = new Map<string, string>();
    for (const owner of KEYWORD_MAP) {
      for (const term of [...owner.head, ...(owner.twins ?? [])]) {
        expect(seen.get(term), `„${term}“ is owned twice`).toBeUndefined();
        seen.set(term, owner.page);
      }
    }
  });

  it("is matched phrase by phrase", () => {
    expect(phrases("Онлайн магазин за кафе: капсули, зърна и дози")).toEqual([
      ["онлайн", "магазин", "за", "кафе"],
      ["капсули"],
      ["зърна", "и", "дози"],
    ]);
    expect(carries("Онлайн магазин за кафе: капсули, зърна и дози", "кафе капсули")).toBe(false);
    expect(carries("Кафе капсули за Nespresso", "кафе капсули")).toBe(true);
    expect(carries("КАФЕ  КАПСУЛИ", "кафе капсули")).toBe(true);
    expect(carries("Капсули за кафе", "кафе капсули")).toBe(false);
  });

  it("lets a page carry the wider term its own term contains, and no other", () => {
    const page = (owner: string): Page => ({ owner, id: owner, title: "", h1: "" });
    expect(narrows(page("kafe-na-zarna-lavazza"), "кафе на зърна")).toBe(true);
    expect(narrows(page("nay-evtino-na-chasha"), "кафе на зърна")).toBe(true);
    // Not the other way round, and not for a page whose term is unrelated.
    expect(narrows(page("kafe-na-zarna"), "кафе на зърна лаваца")).toBe(false);
    expect(narrows(page("lavazza-kapsuli"), "кафе на зърна")).toBe(false);
    expect(narrows(page("bezkofeinovo-kafe"), "кафе капсули")).toBe(false);
    expect(narrows({ ...page("marki/lavazza"), owner: null }, "кафе на зърна")).toBe(false);
    // The only narrowings in the whole map are those two pages' one term.
    const all = KEYWORD_MAP.flatMap((owner) =>
      KEYWORD_MAP.filter((other) => other !== owner).flatMap((other) =>
        [...other.head, ...(other.twins ?? [])]
          .filter((term) => narrows(page(owner.page), term))
          .map((term) => `${owner.page} ⊃ ${term}`),
      ),
    );
    expect(all).toEqual([
      "kafe-na-zarna-lavazza ⊃ кафе на зърна",
      "nay-evtino-na-chasha ⊃ кафе на зърна",
    ]);
  });
});

/* --- The pages against it ------------------------------------------------ */

describe("titles and headings follow the keyword map", () => {
  it("covers every existing page that owns a term", () => {
    const covered = new Set(PAGES.map((page) => page.owner));
    for (const page of [
      "home",
      "kafe-kapsuli",
      "dolce-gusto-kapsuli",
      "nespresso-kapsuli",
      "lavazza-blue-kapsuli",
      "lavazza-a-modo-mio-kapsuli",
      "caffitaly-kapsuli",
      "kafe-na-zarna",
      "kafe-dozi",
      "promotsii",
      "marki",
      "kafe-za-vending-mashini",
      "lavazza-kapsuli",
      "kafe-na-zarna-lavazza",
      "bezkofeinovo-kafe",
      "nay-evtino-na-chasha",
      "za-kafemashina/tchibo",
    ]) {
      expect(covered.has(page), page).toBe(true);
    }
  });

  /*
   * In the wording the catalog gives the page today. A landing whose catalog
   * has shrunk says less — the cheapest-per-cup page with no beans on sale
   * does not say „на зърна“ — and that is the page being truthful, so the
   * edge-case wordings are held only to the rule after this one.
   */
  it.each(
    PAGES.filter((page) => page.owner !== null && !/\(variant \d+\)$/.test(page.id)).map(
      (page) => [page.id, page] as const,
    ),
  )("%s carries every word of its own head term", (_id, page) => {
    const own = `${page.title} ${page.h1}`;
    const [first] = ownerOf(page.owner as string).head;
    expect(hasEveryWord(own, first as string), `${own} ≠ ${first}`).toBe(true);
  });

  it.each(PAGES.map((page) => [page.id, page] as const))(
    "%s carries nobody else's head term in its title or h1",
    (_id, page) => {
      for (const owner of KEYWORD_MAP) {
        if (owner.page === page.owner) continue;
        for (const term of [...owner.head, ...(owner.twins ?? [])]) {
          if (narrows(page, term)) continue;
          for (const text of [page.title, page.h1]) {
            expect(carries(text, term), `„${text}“ carries „${term}“ (${owner.page})`).toBe(false);
          }
        }
      }
    },
  );

  /*
   * The stricter reading: straight through the punctuation, as a crawler that
   * ignores a colon would. Two titles fail it, and both are the study's own
   * (§12): „Онлайн магазин за кафе: капсули, зърна и дози“ puts „кафе“ and
   * „капсули“ on either side of a colon, and „Безкофеиново кафе — капсули,
   * дози и зърна“ puts them on either side of a dash. They are listed here, by
   * name, so that a third cannot join them unnoticed. The decaf title names
   * the formats that have a decaf product, so it is listed once per wording:
   * with capsules it reads through to „кафе капсули“, and on a day with no
   * decaf capsule its first format is pods, „кафе дози“.
   */
  const PRESCRIBED: ReadonlyArray<readonly [page: string, term: string]> = [
    ["home", "кафе капсули"],
    ["bezkofeinovo-kafe", "кафе капсули"],
    ["bezkofeinovo-kafe (variant 1)", "кафе капсули"],
    ["bezkofeinovo-kafe (variant 2)", "кафе дози"],
  ];

  it("holds when punctuation is ignored, but for the title the study prescribes", () => {
    const found: Array<readonly [string, string]> = [];
    for (const page of PAGES) {
      for (const owner of KEYWORD_MAP) {
        if (owner.page === page.owner) continue;
        for (const term of [...owner.head, ...(owner.twins ?? [])]) {
          if (narrows(page, term)) continue;
          if ([page.title, page.h1].some((text) => carriesIgnoringPunctuation(text, term))) {
            found.push([page.id, term]);
          }
        }
      }
    }
    expect(found).toEqual(PRESCRIBED);
  });

  /* §1's last column, in the words it uses. */
  it("keeps „без кофеин“ out of every title but the decaf page's own", () => {
    const decaf = landingOwner("decaf");
    expect(PAGES.some((page) => page.owner === decaf)).toBe(true);
    for (const page of PAGES) {
      if (page.owner === decaf) continue;
      expect(`${page.title} ${page.h1}`.toLowerCase(), page.id).not.toMatch(
        /без\s+кофеин|безкофеин|decaf/u,
      );
    }
  });

  it("leaves „лаваца капсули“ to the Lavazza capsules page", () => {
    for (const id of ["marki/lavazza", "lavazza-blue-kapsuli", "lavazza-a-modo-mio-kapsuli"]) {
      const pages = PAGES.filter((page) => page.id.startsWith(id));
      expect(pages.length, id).toBeGreaterThan(0);
      for (const page of pages) {
        for (const term of ["лаваца капсули", "капсули лаваца", "lavazza капсули"]) {
          expect(carriesIgnoringPunctuation(page.title, term), `${page.title} / ${term}`).toBe(
            false,
          );
          expect(carriesIgnoringPunctuation(page.h1, term), `${page.h1} / ${term}`).toBe(false);
        }
      }
    }
  });

  it("leaves „лаваца на зърна“ to the Lavazza beans page", () => {
    const lavazza = PAGES.find((page) => page.id === "marki/lavazza") as Page;
    for (const term of ["лаваца на зърна", "лаваца зърна", "lavazza зърна"]) {
      expect(carriesIgnoringPunctuation(lavazza.title, term), term).toBe(false);
    }
  });

  it("gives „лаваца капсули“ to the Lavazza capsules page in every wording", () => {
    const pages = PAGES.filter((page) => page.owner === landingOwner("lavazzaCapsules"));
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      expect(hasEveryWord(page.title, "лаваца капсули"), page.title).toBe(true);
      // …and never the name of one of the two systems as a phrase of its own,
      // which is what those systems' pages are titled.
      for (const term of ["lavazza blue", "lavazza a modo mio"]) {
        expect(carriesIgnoringPunctuation(page.title, term), `${page.title} / ${term}`).toBe(false);
      }
    }
  });

  it("gives the Tchibo terms to the Tchibo machine page and to no other page", () => {
    const tchibo = PAGES.find((page) => page.id === "za-kafemashina/tchibo") as Page;
    expect(tchibo.owner).toBe("za-kafemashina/tchibo");
    expect(carries(tchibo.title, "tchibo cafissimo")).toBe(true);
    expect(carries(tchibo.h1, "tchibo cafissimo")).toBe(true);
    for (const page of PAGES) {
      if (page === tchibo) continue;
      expect(`${page.title} ${page.h1}`, page.id).not.toMatch(/tchibo|cafissimo|чибо|кафисимо/iu);
    }
    // It says which capsules fit without taking the Caffitaly shelf's term.
    for (const term of ["caffitaly капсули", "капсули caffitaly"]) {
      for (const text of [tchibo.title, tchibo.h1]) {
        expect(carriesIgnoringPunctuation(text, term), `${text} / ${term}`).toBe(false);
      }
    }
  });

  it("gives every machine brand a page here, each with its own title and h1", () => {
    expect(MACHINE_PAGES).toHaveLength(MACHINE_BRANDS.length);
    expect(MACHINE_PAGES.filter((page) => page.owner !== null).map((page) => page.id)).toEqual([
      "za-kafemashina/tchibo",
    ]);
  });

  it("does not give the Caffitaly page the Tchibo machine page's title", () => {
    const page = PAGES.find((entry) => entry.id === "caffitaly-kapsuli") as Page;
    expect(`${page.title} ${page.h1}`).not.toMatch(/tchibo|cafissimo|чибо|кафисимо/iu);
  });

  /* `marki/<brand>` owns „<brand> кафе“ / „кафе <brand>“, for every brand. */
  it("gives each brand's own term to its brand page and to no listing", () => {
    for (const brand of BRANDS) {
      const { cyrillic } = brandFactsFor(brand);
      const names = [brand.name, ...(cyrillic ? [cyrillic] : [])];
      const terms = names.flatMap((name) => [`кафе ${name}`, `${name} кафе`]);

      const own = PAGES.find((page) => page.id === `marki/${brand.slug}`) as Page;
      expect(carries(own.title, `кафе ${brand.name}`), own.title).toBe(true);

      for (const page of PAGES) {
        if (page === own) continue;
        for (const term of terms) {
          expect(carries(page.title, term), `„${page.title}“ carries „${term}“`).toBe(false);
          expect(carries(page.h1, term), `„${page.h1}“ carries „${term}“`).toBe(false);
        }
      }
    }
  });

  it("gives no two pages the same title or the same h1", () => {
    // Two wordings of one page are one page, so only the first counts.
    const pages = PAGES.filter((page) => !isVariant(page));
    expect(new Set(pages.map((page) => page.title)).size).toBe(pages.length);
    expect(new Set(pages.map((page) => page.h1)).size).toBe(pages.length);
  });
});
