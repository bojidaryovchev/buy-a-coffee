import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  deriveProductFacts,
  findArabicaShare,
  findOriginPhrase,
  findRoastPhrase,
} from "../src/parsers/productFacts.ts";
import { parseCharacteristics, parseProductPage } from "../src/parsers/productPage.ts";
import * as cheerio from "cheerio";

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/kafezona",
);
const parse = (name: string) =>
  parseProductPage(readFileSync(path.join(FIXTURES, `product-${name}.html`), "utf8"));

/** A product page in the shape the source uses now, around the given content. */
function page(options: { detail?: string; content?: string; related?: string }): string {
  return `<html><body><main>
    <div><a href="/">Магазин</a></div>
    <section>
      <h1>Тестов продукт</h1>
      <ul>${options.detail ?? "<li>Наличност: В наличност</li><li>Тегло: 1 кг.</li>"}</ul>
      <span>€10.00</span>
    </section>
    ${options.content ? `<section><div>${options.content}</div></section>` : ""}
    <section><h2>СВЪРЗАНИ ПРОДУКТИ</h2>${options.related ?? ""}</section>
  </main></body></html>`;
}

describe("product code (sku)", () => {
  it('reads the code printed after "Код:"', () => {
    expect(parse("lavazza-super-crema").sku).toBe("00011");
    expect(parse("amann-cascada").sku).toBe("00072");
  });

  it("keeps leading zeros, because the code is a string", () => {
    expect(parse("eurocaf-rosso-fuoco").sku).toBe("00001");
  });

  it("is null when the page prints no code", () => {
    const result = parseProductPage(page({}));
    expect(result.sku).toBeNull();
    expect(result.attributes.code).toBeUndefined();
  });

  it("is null when the page prints two different codes", () => {
    const result = parseProductPage(
      page({ detail: "<li>Код: 00011</li><li>Код: 00012</li><li>Тегло: 1 кг.</li>" }),
    );
    expect(result.sku).toBeNull();
  });

  it("is null for an empty or garbled code", () => {
    expect(parseProductPage(page({ detail: "<li>Код: </li>" })).sku).toBeNull();
    expect(parseProductPage(page({ detail: "<li>Код: 00 11 ; drop</li>" })).sku).toBeNull();
  });

  it("is the same code on the desktop and the mobile copy", () => {
    // Both copies are in the HTML; the code must not turn "ambiguous".
    const html = readFileSync(path.join(FIXTURES, "product-caffitaly-intenso.html"), "utf8");
    expect(html.match(/Код: 00112/g)?.length).toBeGreaterThanOrEqual(2);
    expect(parse("caffitaly-intenso").sku).toBe("00112");
  });
});

describe("characteristics", () => {
  it("reads the labelled list as label -> value pairs, in page order", () => {
    expect(parse("amann-cascada").characteristics).toEqual([
      { label: "Вкусов профил", value: "шоколад, цветни нотки, лека плодова свежест" },
      { label: "Послевкус", value: "фин, хармоничен и изчистен" },
      { label: "Състав", value: "100% арабика" },
      {
        label: "Произход",
        value: "Finca Flor del Rosario, San Cristóbal Verapaz, Гватемала",
      },
      { label: "Съвместима система", value: "еспресо машина, автоматична кафе машина" },
    ]);
  });

  it("lists each pair once although the page renders the block twice", () => {
    const labels = parse("lavazza-super-crema").characteristics.map((entry) => entry.label);
    expect(labels).toEqual(["Вкусов профил", "Състав", "Произход", "Послевкус", "Съвместимост"]);
  });

  it("covers every label seen on the source", () => {
    const seen = new Set(
      ["amann-cascada", "caffitaly-intenso", "lavazza-super-crema", "eurocaf-rosso-fuoco"].flatMap(
        (name) => parse(name).characteristics.map((entry) => entry.label),
      ),
    );
    for (const label of [
      "Вкусов профил",
      "Послевкус",
      "Състав",
      "Произход",
      "Съвместима система",
    ]) {
      expect(seen, label).toContain(label);
    }
  });

  it("reads characteristics written as bare paragraphs instead of a list", () => {
    expect(parse("illy-classico").characteristics).toEqual([
      { label: "Вкусов профил", value: "карамел, флорални нотки, фина цитрусова свежест" },
      {
        label: "Послевкус",
        value: "фин и хармоничен, с лека сладост и чист, продължителен завършек",
      },
      { label: "Състав", value: "100% селектирани арабика зърна от различни региони" },
      { label: "Подходящо за", value: "Еспресо машина, мока, автоматична кафе машина" },
    ]);
  });

  it("splits two pairs the source packed into one list item", () => {
    // The real markup of /dg-molini-napoli-16/: a stray dash, a typo in a
    // label, and "Произход" inside the "Съвместими капсули" item.
    const pairs = parse("dg-molini-napoli").characteristics;
    expect(pairs.find((entry) => entry.label === "Съвместими капсули")?.value).toBe("Dolce Gusto®");
    expect(pairs.find((entry) => entry.label === "Произход")?.value).toBe("Африка, Азия");
    expect(pairs.find((entry) => entry.label === "Състав")?.value).toBe("100% робуста");
  });

  it("skips flags that have a bold label but no value", () => {
    const labels = parse("foodness").characteristics.map((entry) => entry.label);
    expect(labels).toEqual(["Вкусов профил", "Състав", "Съвместимост"]);
  });

  it("is empty when the page has no characteristics heading", () => {
    expect(
      parseProductPage(page({ content: "<h2>За кафето</h2><p>Текст.</p>" })).characteristics,
    ).toEqual([]);
    expect(parseProductPage(page({})).characteristics).toEqual([]);
  });

  it("accepts a colon outside the bold label, and stops at the next heading", () => {
    const html = page({
      content: `<h3>Характеристики</h3>
        <ul><li><strong>Състав</strong>: 100% арабика</li></ul>
        <h3>Друго</h3>
        <ul><li><strong>Произход:</strong> не е част от списъка</li></ul>`,
    });
    expect(parseProductPage(html).characteristics).toEqual([
      { label: "Състав", value: "100% арабика" },
    ]);
  });

  it("never reads a related card", () => {
    const html = page({
      related: `<div><h3>Характеристики</h3><ul><li><strong>Състав:</strong> 100% арабика</li></ul></div>`,
    });
    expect(parseProductPage(html).characteristics).toEqual([]);
  });

  it("works on a bare fragment too", () => {
    const $ = cheerio.load(
      `<div><h3>Характеристики:</h3><p><strong>Произход:</strong> Бразилия</p></div>`,
    );
    expect(parseCharacteristics($, $("div"))).toEqual([{ label: "Произход", value: "Бразилия" }]);
  });
});

describe("arabicaPercent", () => {
  it('reads "100% арабика" from the composition', () => {
    expect(parse("amann-cascada").arabicaPercent).toBe(100);
    expect(parse("illy-classico").arabicaPercent).toBe(100);
  });

  it('reads "70% арабика, 30% робуста"', () => {
    expect(parse("caffitaly-intenso").arabicaPercent).toBe(70);
    expect(parse("rema-intenso").arabicaPercent).toBe(70);
    expect(parse("lollo-terra").arabicaPercent).toBe(40);
  });

  it("reads the arabica figure when robusta is listed first", () => {
    // "80% робуста, 20% арабика": 20 is stated; it is not 100 minus anything.
    expect(parse("bianchi-gold").arabicaPercent).toBe(20);
  });

  it('is null for "100% робуста": arabica is not stated, and 0 would be inferred', () => {
    expect(parse("eurocaf-rosso-fuoco").arabicaPercent).toBeNull();
    expect(parse("dg-molini-napoli").arabicaPercent).toBeNull();
  });

  it("is null when the composition names the species but gives no figure", () => {
    expect(parse("lavazza-super-crema").arabicaPercent).toBeNull();
    expect(parse("lavazza-gusto-forte").arabicaPercent).toBeNull();
  });

  it('is null when the figure is hedged ("около 80%")', () => {
    expect(parse("borbone-superiore").arabicaPercent).toBeNull();
  });

  it("is null for a product that is not coffee", () => {
    expect(parse("foodness").arabicaPercent).toBeNull();
  });

  it("falls back to the page's prose when there is no composition line", () => {
    const html = page({
      content: `<h2>Кафе</h2><p>Този бленд е 100% арабика от Бразилия.</p><h3>Характеристики</h3><ul><li><strong>Вкусов профил:</strong> мед</li></ul>`,
    });
    expect(parseProductPage(html).arabicaPercent).toBe(100);
  });

  it("prefers the labelled composition over prose", () => {
    const html = page({
      content: `<p>Приблизително 50% арабика, казва текстът.</p><h3>Характеристики</h3><ul><li><strong>Състав:</strong> 50% арабика и 50% робуста</li></ul>`,
    });
    expect(parseProductPage(html).arabicaPercent).toBe(50);
  });

  it("does not fall back to prose when the composition itself is hedged", () => {
    const html = page({
      content: `<p>Бленд със 100% арабика.</p><h3>Характеристики</h3><ul><li><strong>Състав:</strong> около 80% арабика</li></ul>`,
    });
    expect(parseProductPage(html).arabicaPercent).toBeNull();
  });

  it("never reads a related card's description", () => {
    const html = page({
      related: `<a href="/x-1/"><img src="/i.jpg" alt="X"><p>Бленд от 100% арабика</p><p>€5.00</p></a>`,
    });
    expect(parseProductPage(html).arabicaPercent).toBeNull();
  });
});

describe("findArabicaShare", () => {
  const value = (text: string) => findArabicaShare(text);

  it("accepts the spellings the source uses", () => {
    expect(value("100% арабика")).toEqual({ kind: "value", value: 100 });
    expect(value("100 % арабика")).toEqual({ kind: "value", value: 100 });
    expect(value("100% Арабика")).toEqual({ kind: "value", value: 100 });
    expect(value("70% арабика / 30% робуста")).toEqual({ kind: "value", value: 70 });
    expect(value("бленд от 40% арабика и 60% робуста")).toEqual({ kind: "value", value: 40 });
    expect(value("20% колумбийска арабика")).toEqual({ kind: "value", value: 20 });
    expect(value("50% ароматна арабика и 50% робуста")).toEqual({ kind: "value", value: 50 });
  });

  it("reads a word typed with a Latin letter among Cyrillic ones", () => {
    // The source's own copy: "100% арaбика" with a Latin "a".
    expect(value("100% арaбика")).toEqual({ kind: "value", value: 100 });
    expect(value("100% арaбика").kind).toBe("value");
  });

  it("accepts a decimal figure", () => {
    expect(value("12,5% арабика")).toEqual({ kind: "value", value: 12.5 });
  });

  it("calls estimates, bounds and ranges ambiguous", () => {
    for (const text of [
      "около 80% арабика",
      "приблизително 50% арабика",
      "над 60% арабика",
      "до 30% арабика",
      "минимум 70% арабика",
      "70-80% арабика",
      "~50% арабика",
    ]) {
      expect(value(text), text).toEqual({ kind: "ambiguous" });
    }
  });

  it("calls two different figures a contradiction", () => {
    expect(value("100% арабика. Състав: 70% арабика")).toEqual({ kind: "ambiguous" });
  });

  it("accepts the same figure said twice", () => {
    expect(value("100% арабика — да, 100% арабика")).toEqual({ kind: "value", value: 100 });
  });

  it("finds nothing in text that states no figure for arabica", () => {
    expect(value("100% робуста")).toEqual({ kind: "none" });
    expect(value("арабика и робуста")).toEqual({ kind: "none" });
    expect(value("висок процент арабика")).toEqual({ kind: "none" });
    expect(value("")).toEqual({ kind: "none" });
  });

  it("rejects an impossible share", () => {
    expect(value("150% арабика")).toEqual({ kind: "ambiguous" });
  });
});

describe("origin", () => {
  it('is the labelled "Произход", word for word', () => {
    expect(parse("amann-cascada").origin).toBe(
      "Finca Flor del Rosario, San Cristóbal Verapaz, Гватемала",
    );
    expect(parse("eurocaf-rosso-fuoco").origin).toBe("Уганда и Индия");
    expect(parse("bianchi-gold").origin).toBe("Индия, Колумбия");
    expect(parse("dg-molini-napoli").origin).toBe("Африка, Азия");
  });

  it("is the labelled sentence even when it is a sentence", () => {
    expect(parse("borbone-superiore").origin).toBe(
      "отгледано, изпечено и пакетирано в Неапол, Италия",
    );
  });

  it('is read from "с произход от …" when there is no labelled origin', () => {
    // /caffitaly-espresso-intenso-10/ has no "Произход" line.
    expect(
      parse("caffitaly-intenso").characteristics.some((entry) => entry.label === "Произход"),
    ).toBe(false);
    expect(parse("caffitaly-intenso").origin).toBe("Южна Америка и Индия");
  });

  it("is null when the page says nothing about origin", () => {
    expect(parse("lollo-terra").origin).toBeNull();
    expect(parse("rema-intenso").origin).toBeNull();
    expect(parse("foodness").origin).toBeNull();
    expect(parse("illy-classico").origin).toBeNull();
  });

  it("is null when the prose phrase could be the start of a longer list", () => {
    expect(findOriginPhrase("бленд с произход от Индия, Уганда и Колумбия.")).toEqual({
      kind: "ambiguous",
    });
    expect(findOriginPhrase("с произход от Уганда и Индия, изпечена средно тъмно.")).toEqual({
      kind: "ambiguous",
    });
  });

  it("is null when the prose names two different origins", () => {
    expect(findOriginPhrase("с произход от Бразилия. Друго кафе с произход от Перу.")).toEqual({
      kind: "ambiguous",
    });
  });

  it("is null when a labelled origin is repeated with different values", () => {
    const facts = deriveProductFacts({
      characteristics: [
        { label: "Произход", value: "Бразилия" },
        { label: "Произход", value: "Перу" },
      ],
      prose: [],
    });
    expect(facts.origin).toBeNull();
  });
});

describe("roast", () => {
  it('is read from "изпечена средно тъмно"', () => {
    expect(parse("eurocaf-rosso-fuoco").roast).toBe("средно тъмно");
  });

  it('is read from "Тъмното изпичане" and "Тъмно изпичане"', () => {
    expect(parse("lollo-terra").roast).toBe("тъмно");
    expect(parse("rema-intenso").roast).toBe("тъмно");
  });

  it("is null when the page says nothing about roast", () => {
    expect(parse("amann-cascada").roast).toBeNull();
    expect(parse("lavazza-super-crema").roast).toBeNull();
    expect(parse("bianchi-gold").roast).toBeNull();
    expect(parse("foodness").roast).toBeNull();
  });

  it('is null when the level is relative ("леко по-светло средно изпичане")', () => {
    expect(parse("borbone-superiore").roast).toBeNull();
    expect(findRoastPhrase("с по-тъмно изпичане")).toEqual({ kind: "ambiguous" });
  });

  it("is null when the page states two different levels", () => {
    expect(findRoastPhrase("средно изпичане за еспресо, тъмно изпичане за мока")).toEqual({
      kind: "ambiguous",
    });
  });

  it("recognises each level the source uses", () => {
    expect(findRoastPhrase("светло изпичане")).toEqual({ kind: "value", value: "светло" });
    expect(findRoastPhrase("средно изпичане")).toEqual({ kind: "value", value: "средно" });
    expect(findRoastPhrase("средно-тъмно изпичане")).toEqual({
      kind: "value",
      value: "средно тъмно",
    });
    expect(findRoastPhrase("изпечено тъмно")).toEqual({ kind: "value", value: "тъмно" });
  });

  it("does not take a flavour description for a roast", () => {
    expect(findRoastPhrase("тъмен шоколад и препечени ядки")).toEqual({ kind: "none" });
    expect(findRoastPhrase("бавно и деликатно изпичане")).toEqual({ kind: "none" });
  });

  it("prefers a labelled roast over prose", () => {
    const facts = deriveProductFacts({
      characteristics: [{ label: "Изпичане", value: "Средно" }],
      prose: ["Тъмно изпичане."],
    });
    expect(facts.roast).toBe("средно");
  });
});

describe("the structured result", () => {
  it("returns sku, characteristics and the derived facts together", () => {
    const result = parse("caffitaly-intenso");
    expect(result).toMatchObject({
      sku: "00112",
      arabicaPercent: 70,
      origin: "Южна Америка и Индия",
      roast: null,
      priceText: "€5.35",
      weightText: "10 бр.",
    });
    expect(result.characteristics.map((entry) => entry.label)).toEqual([
      "Вкусов профил",
      "Състав",
      "Съвместимост",
    ]);
  });

  it("returns nulls and an empty list for a page with none of it", () => {
    const result = parseProductPage("<html><body><p>hello</p></body></html>");
    expect(result).toMatchObject({
      sku: null,
      characteristics: [],
      arabicaPercent: null,
      origin: null,
      roast: null,
    });
  });

  it("keeps full confidence on every product fixture", () => {
    for (const name of [
      "lavazza-super-crema",
      "caffitaly-intenso",
      "amann-cascada",
      "eurocaf-rosso-fuoco",
      "bianchi-gold",
      "borbone-superiore",
      "illy-classico",
      "dg-molini-napoli",
      "lollo-terra",
      "lavazza-gusto-forte",
      "foodness",
      "rema-intenso",
    ]) {
      expect(parse(name).confidence, name).toBe(1);
      expect(parse(name).priceText, name).toMatch(/^€\d+\.\d{2}$/);
      expect(parse(name).sku, name).toMatch(/^\d{5}$/);
    }
  });
});
