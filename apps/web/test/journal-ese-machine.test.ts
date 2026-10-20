import { describe, expect, it } from "vitest";
import { ARTICLES } from "../content/journal";
import { ESE_MACHINE_SLUG, podMachines } from "../content/journal/articles/ese-machine";
import { rangeText } from "../content/journal/articles/cup-cost";
import type { Block, Inline } from "../content/journal/blocks";
import { categoryCopyFor } from "../content/category-copy";
import { siteConfig } from "@/config/site";
import { MACHINE_BRANDS, allMachineModels, getMachineModel } from "@/content/machines";
import { STRENGTH_LABELS } from "@/lib/catalog/attributes";
import {
  EMPTY_JOURNAL_FIGURES,
  computeJournalFigures,
  type JournalFigures,
} from "@/lib/catalog/journal-figures";
import { collectLinks, getArticle, plainText, summariseArticle } from "@/lib/journal";
import { getBrewingSystem, getUnsupportedSystem } from "@/lib/recommend/systems";
import { targetHref, type RouteTarget } from "@/lib/routes";
import { DESCRIPTION_LIMIT } from "@/lib/seo/description";
import { TITLE_LIMIT, fullTitle, titleLength } from "@/lib/seo/title";
import { FIXTURE_FIGURES, row } from "./journal-fixtures";
import { KEYWORD_MAP, carries, carriesIgnoringPunctuation } from "./keyword-map";

/**
 * The ESE-machine guide (research `09`, T2.3), held to what it promises.
 *
 * `journal-content.test.ts` holds every article to the journal's rules; this
 * holds this one to its own: the search term it is written for and nobody
 * else's, no machine that the machine database does not say takes pods, no
 * figure that the catalog did not compute, and the links that make it the way
 * into the pods listing.
 */

const article = getArticle(ESE_MACHINE_SLUG)!;

/** A catalog of pods unlike the fixture's, so a figure typed to match it would show. */
const POD_FIGURES: JournalFigures = computeJournalFigures(
  [
    row({
      category: "kafe-dozi",
      price: "7.20",
      weightValue: "18",
      strength: "weak",
      intensity: "7 от 9",
    }),
    row({
      category: "kafe-dozi",
      price: "30.00",
      weightValue: "150",
      strength: "strong",
      intensity: "10 от 12",
    }),
    row({
      category: "kafe-dozi",
      price: "36.00",
      weightValue: "100",
      strength: "strong",
      intensity: "9 от 10",
    }),
    row({
      category: "kafe-dozi",
      price: "13.50",
      weightValue: "50",
      strength: "medium",
      intensity: "8 от 13",
    }),
    row({
      category: "nespresso",
      price: "3.90",
      weightValue: "10",
      strength: "weak",
      intensity: "5 от 12",
    }),
  ],
  "EUR",
);

const VARIANTS = [
  ["the pod catalog", POD_FIGURES],
  ["the journal fixture", FIXTURE_FIGURES],
  ["no catalog", EMPTY_JOURNAL_FIGURES],
] as const;

const text = (figures: JournalFigures) => plainText(article.body(figures));

/** Every link in a body, with its words. */
function links(blocks: readonly Block[]): Array<{ href: RouteTarget; text: string }> {
  const found: Array<{ href: RouteTarget; text: string }> = [];
  const walk = (content: readonly Inline[]) => {
    for (const node of content) {
      if (typeof node !== "string" && node.type === "link") {
        found.push({ href: node.href, text: node.text });
      }
    }
  };
  for (const block of blocks) {
    if (block.type === "paragraph" || block.type === "callout") walk(block.content);
    if (block.type === "list") block.items.forEach(walk);
    if (block.type === "table") block.rows.forEach((cells) => cells.forEach(walk));
    if (block.type === "action") {
      for (const entry of block.links) found.push({ href: entry.href, text: entry.label });
    }
  }
  return found;
}

const bg = (target: RouteTarget) => targetHref("bg", target);

describe("the ESE-machine guide: where it is and what it is called", () => {
  it("is published at the slug research 09 gives it, and listed", () => {
    expect(ESE_MACHINE_SLUG).toBe("kafemashina-za-dozi-ese");
    expect(ARTICLES).toContain(article);
    expect(bg(summariseArticle(article).href)).toBe("/bg/blog/kafemashina-za-dozi-ese");
  });

  it("has a title within sixty characters and a meta description within 160", () => {
    expect(titleLength(fullTitle(article.title))).toBeLessThanOrEqual(TITLE_LIMIT);
    const meta = summariseArticle(article).metaDescription;
    expect([...meta].length).toBeLessThanOrEqual(DESCRIPTION_LIMIT);
    expect([...meta].length).toBeGreaterThanOrEqual(70);
  });

  /* `docs/seo.md` §1: the page carries its own head term, and nobody else's. */
  it("owns „кафемашина за хартиени дози“ in its title, which is also its h1", () => {
    const own = KEYWORD_MAP.find((entry) => entry.page === `blog/${ESE_MACHINE_SLUG}`);
    expect(own?.head).toEqual(["кафемашина за хартиени дози"]);
    // The page's h1 is the article's title (`blog/[slug]/page.tsx`).
    expect(carries(article.title, "кафемашина за хартиени дози")).toBe(true);
  });

  it("carries no other page's head term, read either way", () => {
    for (const owner of KEYWORD_MAP) {
      if (owner.page === `blog/${ESE_MACHINE_SLUG}`) continue;
      for (const term of [...owner.head, ...(owner.twins ?? [])]) {
        expect(carriesIgnoringPunctuation(article.title, term), `${term} (${owner.page})`).toBe(
          false,
        );
      }
    }
    // Nor the pods listing's other terms, which a reader would take for its name.
    for (const term of ["кафе дози", "ese капсули", "ese дози", "хартиени дози кафе"]) {
      expect(carriesIgnoringPunctuation(article.title, term), term).toBe(false);
    }
  });

  it("is the one article every blog row of the keyword map names", () => {
    for (const owner of KEYWORD_MAP.filter((entry) => entry.page.startsWith("blog/"))) {
      const listed = getArticle(owner.page.slice("blog/".length));
      expect(listed, owner.page).not.toBeNull();
      expect(carries(listed!.title, owner.head[0]!), owner.page).toBe(true);
    }
  });
});

describe("the ESE-machine guide: machines", () => {
  const MODELS = allMachineModels();
  const bare = (name: string) => name.replace(/\s*\(.*\)$/, "");
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mentions = (said: string, name: string) =>
    new RegExp(`(?<![\\p{L}\\p{N}])${escape(name)}(?![\\p{L}\\p{N}])`, "u").test(said);

  it.each(VARIANTS)(
    "names no machine the database does not say takes pods, with %s",
    (_, figures) => {
      const said = text(figures);
      const named = MODELS.filter(({ model }) => mentions(said, bare(model.name)));
      expect(named.length).toBeGreaterThan(0);
      for (const { brand, model } of named) {
        expect(model.system, `${brand.name} ${model.name}`).toBe("ese-pod");
      }
    },
  );

  it("names every model the database says takes pods, and links its brand's page", () => {
    const blocks = article.body(EMPTY_JOURNAL_FIGURES);
    const said = plainText(blocks);
    const linked = new Set(links(blocks).map((entry) => bg(entry.href)));
    const pods = MODELS.filter(({ model }) => model.system === "ese-pod");
    expect(pods.length).toBeGreaterThan(0);
    for (const { brand, model } of pods) {
      expect(said, model.name).toContain(model.name);
      expect(linked, brand.slug).toContain(`/bg/za-kafemashina/${brand.slug}`);
    }
    expect(podMachines().map(({ brand }) => brand.slug)).toEqual(
      MACHINE_BRANDS.filter((brand) => brand.models.some((m) => m.system === "ese-pod")).map(
        (brand) => brand.slug,
      ),
    );
  });

  it("counts the models and brands it lists from the database", () => {
    const models = MODELS.filter(({ model }) => model.system === "ese-pod");
    const brands = new Set(models.map(({ brand }) => brand.slug));
    expect(text(EMPTY_JOURNAL_FIGURES)).toContain(
      `дози ESE приемат ${models.length} модела на ${brands.size} марки`,
    );
  });

  /* The one typed sentence that names models says what their notes say. */
  it("says only of models whose entries say so that they take ground coffee too", () => {
    expect(text(EMPTY_JOURNAL_FIGURES)).toContain(
      "така работят De'Longhi Dedica и ръчните модели на Gaggia",
    );
    const dedica = getMachineModel("delonghi-dedica");
    expect(dedica?.model.system).toBe("ese-pod");
    expect(dedica?.model.note).toMatch(/мляно кафе/);
    const gaggia = MACHINE_BRANDS.find((brand) => brand.slug === "gaggia")!;
    expect(gaggia.summary).toMatch(/Ръчните модели с цедка работят с мляно кафе и с дози ESE/);
    const gaggiaPods = gaggia.models.filter((model) => model.system === "ese-pod");
    expect(gaggiaPods.length).toBeGreaterThan(0);
    for (const model of gaggiaPods) expect(model.name).toMatch(/ръчна с цедка/);
  });

  it("names Dolce Gusto NEO as a system with paper pods, not as an ESE machine", () => {
    const neo = getUnsupportedSystem("dolce-gusto-neo");
    expect(neo?.name).toBe("Dolce Gusto NEO");
    expect(neo?.explanation).toMatch(/хартиени дози/);
    expect(text(EMPTY_JOURNAL_FIGURES)).toContain("Дозите ESE не са за тях, а дози NEO нямаме.");
    // No NEO machine is said anywhere to take ESE pods.
    expect(MODELS.filter(({ model }) => model.system === "dolce-gusto-neo").length).toBeGreaterThan(
      0,
    );
  });

  it("describes the pod as the shop's own system entry does", () => {
    // 44 mm across, the paper wider than the coffee: `systems.ts` and the standard agree.
    expect(getBrewingSystem("ese-pod")?.recognise).toMatch(/44 мм/);
    expect(getBrewingSystem("ese-pod")?.recognise).toMatch(/хартиеният ръб около него е по-широк/);
  });
});

describe("the ESE-machine guide: figures", () => {
  /*
   * With no catalog, every numeral left in the text is one the article may
   * type: the standard's two (44 mm, 7 g), the machine database's (its counts
   * and the models' own names), and the shop's phone number. A price or a
   * product count among them would have been typed by hand.
   */
  it("types no figure the catalog should have given it", () => {
    const said = text(EMPTY_JOURNAL_FIGURES);
    expect(said).not.toMatch(/€|EUR|лв/);
    expect(said).not.toMatch(/\d+[.,]\d{2}\b/);

    const models = allMachineModels().filter(({ model }) => model.system === "ese-pod");
    const allowed = new Set([
      "44",
      "7",
      String(models.length),
      String(new Set(models.map(({ brand }) => brand.slug)).size),
      ...models.flatMap(({ model }) => model.name.match(/\d+/g) ?? []),
      ...(siteConfig.contact.phone.match(/\d+/g) ?? []),
    ]);
    const numerals = said.match(/\d+/g) ?? [];
    expect(numerals.filter((numeral) => !allowed.has(numeral))).toEqual([]);
  });

  it("quotes the product count and the pack sizes the catalog has", () => {
    const summary = POD_FIGURES.formats?.byMethod.pod;
    expect(summary?.products).toBe(4);
    expect(text(POD_FIGURES)).toContain(
      "В момента в категорията има 4 продукта, в кутии от 18 до 150 броя.",
    );
  });

  it("quotes the price per cup the catalog computes, exact, with no sign of an estimate", () => {
    const range = POD_FIGURES.cupCost?.byMethod.pod;
    expect(range).toBeTruthy();
    expect(text(POD_FIGURES)).toContain(
      `В момента дозите в каталога ни излизат ${rangeText(range!)} на чаша.`,
    );
    expect(rangeText(range!)).not.toContain("≈");
  });

  it("tabulates the shop's strength steps with the catalog's counts and prices", () => {
    const blocks = article.body(POD_FIGURES);
    const tables = blocks.filter((block) => block.type === "table");
    expect(tables).toHaveLength(1);
    const rows = tables[0]!.type === "table" ? tables[0]!.rows : [];
    expect(
      rows.map((cells) => cells.map((cell) => plainText([{ type: "paragraph", content: cell }]))),
    ).toEqual(
      (POD_FIGURES.pods?.strengths ?? []).map((step) => [
        STRENGTH_LABELS[step.key]!.toLocaleLowerCase("bg"),
        String(step.products),
        step.perCup ? rangeText(step.perCup) : "—",
      ]),
    );
    expect(rows).toHaveLength(3);
  });

  it("names the intensity scales the pods are declared on", () => {
    expect(POD_FIGURES.pods?.scales).toEqual([9, 10, 12, 13]);
    expect(text(POD_FIGURES)).toContain(
      "при дозите в каталога ни се срещат скали до 9, 10, 12 и 13.",
    );
  });

  it("makes each point without its figure when the catalog cannot be read", () => {
    const blocks = article.body(EMPTY_JOURNAL_FIGURES);
    expect(blocks.some((block) => block.type === "table")).toBe(false);
    const said = plainText(blocks);
    expect(said).toContain("При дозите цената на чаша е точна");
    expect(said).toContain("скалите на различните марки не са еднакви");
  });
});

describe("the ESE-machine guide: links", () => {
  it.each(VARIANTS)("ends at the pods listing, linked by its head term, with %s", (_, figures) => {
    const blocks = article.body(figures);
    const toPods = links(blocks).filter((entry) => bg(entry.href) === "/bg/kafe-dozi");
    // In the list of machines, in the closing sentence, and as the button.
    expect(toPods.map((entry) => entry.text)).toEqual([
      "кафе дози",
      "кафе дози",
      "Към кафе дозите",
    ]);
    const last = blocks[blocks.length - 1]!;
    expect(last.type).toBe("action");
    expect(last.type === "action" && bg(last.links[0]!.href)).toBe("/bg/kafe-dozi");
  });

  it("links the machine finder, and each article and listing it leans on", () => {
    const linked = new Set(collectLinks(article.body(EMPTY_JOURNAL_FIGURES)).map(bg));
    for (const path of [
      "/bg/za-kafemashina",
      "/bg/kafe-na-zarna",
      "/bg/blog/vidove-kapsuli-za-kafe",
      "/bg/blog/kolko-struva-edna-chasha-kafe",
      "/bg/blog/kak-se-chete-intenzivnostta-na-kafeto",
    ]) {
      expect(linked, path).toContain(path);
    }
  });

  /* `docs/seo.md` §13.4: the pods listing links one article, this one. */
  it("is the article the pods listing links", () => {
    expect(categoryCopyFor({ slug: "kafe-dozi", sourceKey: "kafe-dozi" })?.article).toBe(
      ESE_MACHINE_SLUG,
    );
  });
});
