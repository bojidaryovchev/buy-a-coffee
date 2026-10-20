import { describe, expect, it } from "vitest";
import { ARTICLES } from "../content/journal";
import {
  ESE_MACHINE_SLUG,
  podMachines,
  podMachinesAlsoGround,
} from "../content/journal/articles/ese-machine";
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
import { getUnsupportedSystem } from "@/lib/recommend/systems";
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
const pod = (price: string, pieces: string, strength: string, intensity: string) =>
  row({ category: "kafe-dozi", price, weightValue: pieces, strength, intensity });

const POD_FIGURES: JournalFigures = computeJournalFigures(
  [
    pod("7.20", "18", "weak", "7 от 9"),
    pod("30.00", "150", "strong", "10 от 12"),
    pod("36.00", "100", "strong", "9 от 10"),
    pod("13.50", "50", "medium", "8 от 13"),
    row({ category: "nespresso", price: "3.90", weightValue: "10", strength: "weak" }),
  ],
  "EUR",
);

/** The same, plus a box sold by weight, whose cups are an estimate. */
const WEIGHED_FIGURES: JournalFigures = computeJournalFigures(
  [
    pod("7.20", "18", "weak", "7 от 9"),
    pod("30.00", "150", "strong", "10 от 12"),
    row({
      category: "kafe-dozi",
      price: "10.00",
      weightValue: "250",
      weightUnit: "g",
      strength: "strong",
    }),
  ],
  "EUR",
);

const VARIANTS = [
  ["the pod catalog", POD_FIGURES],
  ["a pod sold by weight", WEIGHED_FIGURES],
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

/** The list item that opens with `lead`, as plain text. */
function listItem(blocks: readonly Block[], lead: string): string {
  for (const block of blocks) {
    if (block.type !== "list") continue;
    for (const item of block.items) {
      const said = plainText([{ type: "paragraph", content: item }]);
      if (said.startsWith(lead)) return said;
    }
  }
  throw new Error(`no list item opens with „${lead}“`);
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

  /*
   * `docs/seo.md` §1: the page carries its own head term, and nobody else's.
   * The title is the page's `h1` too (`blog/[slug]/page.tsx`); that the
   * rendered `h1` is this text is `e2e/ese-guide.spec.ts`'s to check.
   */
  it("carries its own head term at the front of its title", () => {
    const own = KEYWORD_MAP.find((entry) => entry.page === `blog/${ESE_MACHINE_SLUG}`);
    expect(own?.head).toEqual(["кафемашина за хартиени дози"]);
    expect(carries(article.title, own!.head[0]!)).toBe(true);
    expect(article.title.toLowerCase().startsWith(own!.head[0]!)).toBe(true);
  });

  it("carries no other page's head term, phrase by phrase or through the punctuation", () => {
    const others = KEYWORD_MAP.filter((owner) => owner.page !== `blog/${ESE_MACHINE_SLUG}`);
    for (const owner of others) {
      for (const term of [...owner.head, ...(owner.twins ?? [])]) {
        expect(carries(article.title, term), `${term} (${owner.page})`).toBe(false);
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

  it("says something other than the pods listing does in a result", () => {
    const meta = summariseArticle(article).metaDescription;
    const listing = categoryCopyFor({ slug: "kafe-dozi", sourceKey: "kafe-dozi" })!.description;
    expect(meta).toMatch(/хартиени/);
    // No run of five words in common with the listing's own description.
    const words = (value: string) =>
      value
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean);
    const mine = words(meta);
    const theirs = words(listing).join(" ");
    for (let at = 0; at + 5 <= mine.length; at += 1) {
      expect(theirs, mine.slice(at, at + 5).join(" ")).not.toContain(
        mine.slice(at, at + 5).join(" "),
      );
    }
  });

  it("is an article for every blog row of the keyword map, each carrying its term", () => {
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
    expect(podMachines().flatMap(({ models }) => models)).toEqual(pods.map(({ model }) => model));
  });

  it("counts the models and brands it lists from the database", () => {
    const models = MODELS.filter(({ model }) => model.system === "ese-pod");
    const brands = new Set(models.map(({ brand }) => brand.slug));
    expect(text(EMPTY_JOURNAL_FIGURES)).toContain(
      `дози ESE приемат ${models.length} модела на ${brands.size} марки:`,
    );
  });

  /*
   * Which pod machines also take ground coffee is the database's `alsoGround`,
   * and the sentence names exactly those: a model left out, or one named
   * without the flag, fails here.
   */
  it("names as taking ground coffee exactly the pod machines flagged for it", () => {
    const item = listItem(article.body(EMPTY_JOURNAL_FIGURES), "Мляното кафе.");
    const flagged = MODELS.filter(({ model }) => model.system === "ese-pod" && model.alsoGround);
    expect(flagged.length).toBeGreaterThan(0);
    expect(podMachinesAlsoGround()).toHaveLength(flagged.length);
    for (const { model } of MODELS.filter(({ model }) => model.system === "ese-pod")) {
      expect(mentions(item, bare(model.name)), model.slug).toBe(model.alsoGround === true);
    }
  });

  it("flags ground coffee only on a machine for pods", () => {
    for (const { model } of MODELS.filter(({ model }) => model.alsoGround)) {
      expect(model.system, model.slug).toBe("ese-pod");
    }
  });

  /*
   * Corrected on 20 October 2026: illy publishes no E.S.E. version of the
   * X7.1, so its old slug now names the Iperespresso machine it is. illy's
   * own pod machine, the Easy, is the one illy model listed for pods.
   */
  it("lists the illy X7.1 as Iperespresso, and the illy Easy for pods", () => {
    expect(getMachineModel("illy-x7")?.model.system).toBe("illy-iperespresso");
    expect(getMachineModel("illy-x7-ese")?.model.slug).toBe("illy-x7");
    const illy = MACHINE_BRANDS.find((brand) => brand.slug === "illy")!;
    expect(illy.models.filter((model) => model.system === "ese-pod").map((m) => m.slug)).toEqual([
      "illy-easy",
    ]);
    const said = text(EMPTY_JOURNAL_FIGURES);
    expect(said).not.toMatch(/X7/);
    expect(said).toContain("illy — Easy (машина за дози)");
  });

  /* The Easy takes a pod from the top: nothing may say every listed machine has a pod filter. */
  it("does not say a pod filter is how every listed machine takes pods", () => {
    const said = text(EMPTY_JOURNAL_FIGURES);
    expect(said).not.toMatch(/При (всички тях|моделите в нашия списък)/);
    expect(said).toContain("При машините с цедка от нашия списък дозите влизат с цедката за дози");
  });

  it("warns that Dolce Gusto NEO's paper pods are another system, by the system's own name", () => {
    const neo = getUnsupportedSystem("dolce-gusto-neo")!;
    const warning = article
      .body(EMPTY_JOURNAL_FIGURES)
      .find((block) => block.type === "callout" && block.title?.includes(neo.name));
    expect(warning?.type === "callout" && warning.tone).toBe("caution");
    // No NEO machine is listed for pods.
    for (const { model } of MODELS.filter(({ model }) => model.system === "dolce-gusto-neo")) {
      expect(text(EMPTY_JOURNAL_FIGURES)).not.toContain(bare(model.name));
    }
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

  it("quotes the product count and the box sizes the catalog has", () => {
    expect(POD_FIGURES.formats?.byMethod.pod?.products).toBe(4);
    expect(text(POD_FIGURES)).toContain(
      "В момента в категорията има 4 продукта, в кутии от 18 до 150 дози.",
    );
  });

  it("quotes the exact price per cup the catalog computes", () => {
    const range = POD_FIGURES.pods?.perCup;
    expect(range).toBeTruthy();
    expect(text(POD_FIGURES)).toContain(
      `В момента дозите в каталога ни излизат ${rangeText(range!)} на чаша.`,
    );
    expect(rangeText(range!)).not.toContain("≈");
  });

  /* A box sold by weight would put „≈“ beside a sentence that says „точна“. */
  it("leaves a pod sold by weight out of its exact prices, and says so", () => {
    const blocks = article.body(WEIGHED_FIGURES);
    const said = plainText(blocks);
    expect(WEIGHED_FIGURES.cupCost?.byMethod.pod?.count).toBe(3);
    expect(WEIGHED_FIGURES.pods?.byWeight).toBe(1);
    expect(said).toContain(
      `излизат ${rangeText(WEIGHED_FIGURES.pods!.perCup!)} на чаша при кутиите с обявен брой дози.`,
    );
    expect(said).toContain("Един продукт е обявен с тегло вместо с брой дози");
    // The only „≈“ is the one the sentence explains; no price carries it.
    expect(said).not.toMatch(/≈\s*\d/);
    const table = blocks.find((block) => block.type === "table");
    expect(table?.type === "table" && table.note).toContain("само за кутиите с обявен брой дози");
  });

  it("tabulates the shop's strength steps with the catalog's counts and prices", () => {
    const tables = article.body(POD_FIGURES).filter((block) => block.type === "table");
    expect(tables).toHaveLength(1);
    const rows = tables[0]!.type === "table" ? tables[0]!.rows : [];
    const cells = rows.map((cellsOfRow) =>
      cellsOfRow.map((cell) => plainText([{ type: "paragraph", content: cell }])),
    );
    expect(cells).toEqual(
      (POD_FIGURES.pods?.strengths ?? []).map((step) => [
        STRENGTH_LABELS[step.key]!.toLocaleLowerCase("bg"),
        String(step.products),
        step.perCup ? rangeText(step.perCup) : "—",
      ]),
    );
    expect(cells).toHaveLength(3);
  });

  /* A small catalog reads as Bulgarian, not as a template with a one in it. */
  it("says one product and one step in words, with no table of one row", () => {
    const blocks = article.body(FIXTURE_FIGURES);
    const said = plainText(blocks);
    expect(FIXTURE_FIGURES.formats?.byMethod.pod?.products).toBe(1);
    expect(said).toContain("В момента в категорията има 1 продукт — кутия от 150 дози.");
    expect(said).toContain("са само на една степен, „средно“: 1 продукт.");
    expect(blocks.some((block) => block.type === "table")).toBe(false);
    expect(said).not.toMatch(/1 броя|1 продукта|приемат 1 /);
  });

  it("opens no sentence with a numeral when several boxes are sold by weight", () => {
    const weighed = (price: string) =>
      row({
        category: "kafe-dozi",
        price,
        weightValue: "250",
        weightUnit: "g",
        strength: "strong",
      });
    const figures = computeJournalFigures(
      [pod("30.00", "150", "strong", "10 от 12"), weighed("10.00"), weighed("11.00")],
      "EUR",
    );
    const said = text(figures);
    expect(said).toContain("С тегло вместо с брой дози са обявени 2 продукта");
    expect(said).not.toMatch(/(^|\. )\d/m);
  });

  /* „защото кутиите са с различен брой дози“ only when the catalog shows boxes of two sizes. */
  it("says the boxes differ in size only when they do", () => {
    const differ = "защото кутиите са с различен брой дози";
    expect(POD_FIGURES.formats?.byMethod.pod?.packs.length).toBeGreaterThan(1);
    expect(text(POD_FIGURES)).toContain(differ);
    const sameSize = computeJournalFigures(
      [pod("13.50", "50", "medium", "8 от 10"), pod("15.50", "50", "strong", "9 от 10")],
      "EUR",
    );
    expect(sameSize.formats?.byMethod.pod?.packs).toEqual(["50"]);
    expect(text(sameSize)).not.toContain(differ);
    expect(text(FIXTURE_FIGURES)).not.toContain(differ);
    expect(text(EMPTY_JOURNAL_FIGURES)).not.toContain(differ);
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
    for (const figures of [POD_FIGURES, FIXTURE_FIGURES]) {
      // Every heading is there with or without the catalog.
      const headings = (all: readonly Block[]) =>
        all.flatMap((block) => (block.type === "heading" ? [block.text] : []));
      expect(headings(blocks)).toEqual(headings(article.body(figures)));
    }
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
