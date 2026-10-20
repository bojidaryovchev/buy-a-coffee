import { describe, expect, it } from "vitest";
import {
  COMPATIBILITY_WORDING,
  type CompatibilityRule,
  compatibilitySentences,
  compatibilityProblems,
} from "../src/compatibility-copy.ts";

/*
 * Real sentences, both ways. The rejected ones are what this shop published
 * before the makers' own statements were checked (research `08` §1): the
 * product copy as it stood at 1411017, and the category, article and machine
 * copy before 6fcb6a0 — plus the slips a model writing from a supplier's
 * attributes is likely to make. The accepted ones are the corrected sentences
 * of `apps/web/content/product-copy.ts` and the copy around them; the
 * storefront's own test runs the rules over every entry of that file.
 */

const rulesOf = (text: string | readonly string[]) =>
  [...new Set(compatibilityProblems(text).map((problem) => problem.rule))].sort();

const REJECTED: ReadonlyArray<readonly [string, readonly CompatibilityRule[]]> = [
  // Product copy at 1411017, every sentence the correction replaced.
  ["10 капсули, съвместими с машини Dolce Gusto.", ["dolce-gusto-machines"]],
  ["16 капсули, съвместими с машини Dolce Gusto.", ["dolce-gusto-machines"]],
  ["16 капсули в кутия, съвместими с машини Dolce Gusto.", ["dolce-gusto-machines"]],
  ["16 капсули, съвместими с машини Dolce Gusto, по една на чаша.", ["dolce-gusto-machines"]],
  [
    "50 капсули, съвместими с машини Dolce Gusto; една капсула е една чаша.",
    ["dolce-gusto-machines"],
  ],
  [
    "50 капсули, съвместими с машини Dolce Gusto. Всяка капсула е една чаша, а голямата кутия има смисъл там, където машината се ползва от няколко души.",
    ["dolce-gusto-machines"],
  ],
  [
    "Classico за машини Dolce Gusto: 16 капсули с уравновесения бленд на Lollo Caffè от арабика и робуста, 8 от 10 по интензивност.",
    ["dolce-gusto-machines"],
  ],
  [
    "Капсулите са съвместими с машини Dolce Gusto. Вътре е Argento — бленд от арабика и робуста с печени нотки, наситен аромат и плътно, кремообразно тяло.",
    ["dolce-gusto-machines"],
  ],
  ["10 капсули, съвместими с домашни машини Nespresso.", ["nespresso-home"]],
  ["20 капсули, съвместими с домашни машини Nespresso.", ["nespresso-home"]],
  ["10 капсули за домашни машини Nespresso Original.", ["nespresso-home"]],
  [
    "10 капсули, съвместими с класическите домашни машини Nespresso. За машините Iperespresso на illy нямаме капсули.",
    ["nespresso-home"],
  ],
  [
    "44 капсули са 44 чаши; при по две на ден кутията стига за около три седмици. Съвместими са с домашните машини Nespresso Original.",
    ["nespresso-home"],
  ],
  [
    "Интензивност 10 от 12 при силен характер. Капсулите са съвместими с класическите домашни машини Nespresso Original, не с Vertuo.",
    ["nespresso-home"],
  ],
  // The six Caffitaly entries, which stated Cafissimo without Tchibo's word.
  [
    "Капсулите са 10 и пасват на машини Caffitaly; същият формат приемат и машините Tchibo Cafissimo.",
    ["tchibo-cafissimo"],
  ],
  ["10 капсули, които влизат в машини Caffitaly и Tchibo Cafissimo.", ["tchibo-cafissimo"]],
  ["10 капсули, съвместими с машини Caffitaly и Tchibo Cafissimo.", ["tchibo-cafissimo"]],
  ["10 капсули за Caffitaly и за Tchibo Cafissimo.", ["tchibo-cafissimo"]],
  ["Кутия от 10 капсули за машини Caffitaly и Tchibo Cafissimo.", ["tchibo-cafissimo"]],
  ["10 капсули за машини Caffitaly; форматът става и за Tchibo Cafissimo.", ["tchibo-cafissimo"]],
  // Category, article and machine copy before 6fcb6a0.
  ["Капсули за машини Dolce Gusto", ["dolce-gusto-machines"]],
  [
    "Тук са капсулите за класическите домашни машини Nespresso — системата, която се нарича Nespresso Original.",
    ["nespresso-home"],
  ],
  [
    "Влиза в класическите домашни машини Nespresso. Vertuo също носи името Nespresso, но е отделна система — за нея пише по-долу.",
    ["nespresso-home"],
  ],
  [
    "Капсулите Caffitaly са за машините от едноименната система. Същият формат работи и в машините Tchibo Cafissimo и K-fee.",
    ["k-fee", "tchibo-cafissimo"],
  ],
  [
    "Всички машини Caffitaly приемат един и същ формат. Същият формат работи и в Tchibo Cafissimo и в K-fee: там капсулите не са произведени от производителя на машината, а пасват по размер и форма.",
    ["k-fee", "tchibo-cafissimo"],
  ],
  [
    "Машините Cafissimo използват същия формат капсула като Caffitaly, така че капсулите Caffitaly работят в тях.",
    ["tchibo-cafissimo"],
  ],
  ["Машините K-fee използват същия формат капсула като Caffitaly.", ["k-fee"]],
  [
    "Капсули Caffitaly — същият формат работи и в Tchibo Cafissimo и K-fee.",
    ["k-fee", "tchibo-cafissimo"],
  ],
  // What a model writing from "Съвместимост: Dolce Gusto" might say.
  [
    "Подходящи за всички машини Dolce Gusto, включително NEO.",
    ["dolce-gusto-machines", "dolce-gusto-neo"],
  ],
  ["Капсулите стават и за новите машини Dolce Gusto NEO.", ["dolce-gusto-neo"]],
  ["Пасват на всички Dolce Gusto машини на Krups и De'Longhi.", ["dolce-gusto-machines"]],
  ["Съвместими с машини Dolce Gusto, но не и с Nespresso.", ["dolce-gusto-machines"]],
  [
    "Капсули за NESCAFÉ Dolce Gusto, съвместими с всички машини NESCAFÉ Dolce Gusto.",
    ["dolce-gusto-machines"],
  ],
  ["16 капсули, съвместими с Dolce Gusto.", ["dolce-gusto-unqualified"]],
  ["Капсулите работят във всяка машина Nespresso.", ["nespresso-machines"]],
  ["Подходящи за кафемашини Nespresso у дома и в офиса.", ["nespresso-machines"]],
  ["Съвместими с Nespresso Original и с Vertuo.", ["nespresso-vertuo"]],
  ["10 капсули, съвместими с Nespresso.", ["nespresso-unqualified"]],
  ["Стават и за машините K-fee.", ["k-fee"]],
  ["Подходящи за K-fee, не за Nespresso.", ["k-fee"]],
  ["Не съдържат захар, пасват на машини K-fee.", ["k-fee"]],
  ["Капсулите Caffitaly пасват и на Tchibo Cafissimo.", ["tchibo-cafissimo"]],
  // A negation or a caveat that is about something else does not count.
  ["Подходящи без проблем за всички машини Dolce Gusto.", ["dolce-gusto-machines"]],
  ["Капсули за Dolce Gusto. Работят без проблем и с NEO.", ["dolce-gusto-neo"]],
  [
    "Стават и за Tchibo Cafissimo. Tchibo дава две години гаранция на машината.",
    ["tchibo-cafissimo"],
  ],
];

const ACCEPTED: readonly string[] = [
  // The corrected product copy (every sentence 6fcb6a0 wrote in place of one above).
  "16 капсули, съвместими с класическите машини Dolce Gusto (не NEO).",
  "10 капсули, съвместими с класическите машини Dolce Gusto (не NEO).",
  "16 капсули в кутия, съвместими с класическите машини Dolce Gusto (не NEO).",
  "16 капсули, съвместими с класическите машини Dolce Gusto (не NEO), по една на чаша.",
  "50 капсули, съвместими с класическите машини Dolce Gusto (не NEO); една капсула е една чаша.",
  "50 капсули, съвместими с класическите машини Dolce Gusto (не NEO). Всяка капсула е една чаша, а голямата кутия има смисъл там, където машината се ползва от няколко души.",
  "Classico за класическите машини Dolce Gusto (не NEO): 16 капсули с уравновесения бленд на Lollo Caffè от арабика и робуста, 8 от 10 по интензивност.",
  "Капсулите са съвместими с класическите машини Dolce Gusto (не NEO). Вътре е Argento — бленд от арабика и робуста с печени нотки, наситен аромат и плътно, кремообразно тяло.",
  "10 капсули, съвместими с класическите машини Nespresso (Original).",
  "20 капсули, съвместими с класическите машини Nespresso (Original).",
  "10 капсули за класическите машини Nespresso (Original).",
  "10 капсули, съвместими с класическите машини Nespresso (Original). За машините Iperespresso на illy нямаме капсули.",
  "44 капсули са 44 чаши; при по две на ден кутията стига за около три седмици. Съвместими са с класическите машини Nespresso (Original).",
  "Интензивност 10 от 12 при силен характер. Капсулите са съвместими с класическите машини Nespresso (Original), не с Vertuo.",
  // The rest of the product copy that names a system.
  "Afrodite за машини Nespresso Original — арабика и робуста със сладост и кадифена крема, интензивност 7 от 10.",
  "10 капсули, съвместими с машини Nespresso Original. Малкият пакет е удобен, ако тепърва избирате кое от кафетата на Lollo Caffè ви харесва.",
  "Капсули за Dolce Gusto с интензивност 10 от 12 — плътно еспресо с наситен вкус и интензивен аромат.",
  "Капсули за Nespresso с интензивност 9 от 12 — богат и балансиран аромат в традиционен италиански стил.",
  "Arte Classico е класическото предложение на Bianchi Caffè за системата Nespresso.",
  "Ако предпочитате Argento в друг формат, има го и в дози ESE, и в капсули за Nespresso Original.",
  "Същото име Rema Caffe има при нас и в капсули за Dolce Gusto и Nespresso, но тук кафето е в хартиена доза с диаметър 44 мм.",
  "Интензивност 8 от 10 — изразително за сутринта, но не и най-силното, което марката прави за Dolce Gusto.",
  "10 капсули за системата Caffitaly.",
  // The six Caffitaly entries as corrected here.
  "Капсулите са 10 и пасват на машини Caffitaly; същия формат приемат и машините Tchibo Cafissimo. Tchibo посочва, че в Cafissimo трябва да се използват само нейните капсули.",
  "10 капсули, които влизат в машини Caffitaly. Същия формат приемат и машините Tchibo Cafissimo. Tchibo посочва, че в Cafissimo трябва да се използват само нейните капсули.",
  "10 капсули, съвместими с машини Caffitaly. Същия формат приемат и машините Tchibo Cafissimo. Tchibo посочва, че в Cafissimo трябва да се използват само нейните капсули.",
  "10 капсули за Caffitaly. Същия формат приемат и машините Tchibo Cafissimo. Tchibo посочва, че в Cafissimo трябва да се използват само нейните капсули.",
  "Кутия от 10 капсули за машини Caffitaly. Същия формат приемат и машините Tchibo Cafissimo. Tchibo посочва, че в Cafissimo трябва да се използват само нейните капсули.",
  "10 капсули за машини Caffitaly; форматът става и за Tchibo Cafissimo. Tchibo посочва, че в Cafissimo трябва да се използват само нейните капсули.",
  // Category, article and machine copy after 6fcb6a0.
  "Капсулите Caffitaly са за машините със знака Caffitaly System. Същия формат приемат и машините Tchibo Cafissimo, макар Tchibo да посочва, че в тях трябва да се използват само нейните капсули. Машините K-fee, професионалните машини Caffitaly и Coffee For You са други системи.",
  "Машините Cafissimo използват формата на Caffitaly: Tchibo е партньор на системата и капсулите Caffitaly пасват в тях по размер и форма. Tchibo посочва, че в Cafissimo трябва да се използват само нейните капсули. Машините Qbo са друга система.",
  "Машините K-fee приемат капсулите на K-fee и EXPRESSI на Aldi — собствена система, различна от Caffitaly. Капсули за нея не предлагаме.",
  "Тези капсули са за класическите машини Dolce Gusto и не пасват на никоя друга система. По-новите машини Dolce Gusto NEO работят с хартиени дози и също не ги приемат.",
  "Машините се правят от Krups и De'Longhi, а името на модела започва с Dolce Gusto: Piccolo, Genio, Mini Me, Infinissima. По-новите машини Dolce Gusto NEO са отделна система с хартиени дози: класическите капсули не влизат в тях.",
  "Ако машината ви е Nespresso Vertuo, тези капсули няма да паснат — Vertuo приема само собствените си капсули с баркод по ръба, а такива не предлагаме.",
  "Vertuo чете баркод по ръба на капсулата и приема само капсули Vertuo.",
  "Капсула за Dolce Gusto не влиза в машина Nespresso, и обратното.",
  "Професионалните машини Nespresso използват по-голяма капсула от домашните.",
  "Krups прави машини за няколко несъвместими системи: Dolce Gusto и Dolce Gusto NEO, Nespresso Original и Vertuo, и автоматични на зърна.",
  // Exclusions a model may phrase its own way.
  "Не са за машините Dolce Gusto NEO, които приемат само хартиени дози.",
  "Капсулите не влизат в машини Nespresso.",
  "Капсули Caffitaly, които не стават за машини K-fee.",
  "K-fee не приема капсули Caffitaly.",
  "Съвместими с класическите машини Dolce Gusto. NEO е отделна система с хартиени дози.",
  "Подходящи за класическите машини Nespresso, системата Nespresso Original.",
  "Стават и за Tchibo Cafissimo, но Tchibo не поема по гаранция ремонт след чужди капсули.",
  // A fit word in another clause is about something else.
  "С мляко става чудесно лате, а капсулите са за Dolce Gusto.",
];

describe("compatibilityProblems", () => {
  it.each(REJECTED)("rejects „%s“", (text, rules) => {
    expect(rulesOf(text)).toEqual([...rules].sort());
  });

  it.each(ACCEPTED)("accepts „%s“", (text) => {
    expect(compatibilityProblems(text)).toEqual([]);
  });

  it("holds enough real sentences both ways to mean something", () => {
    expect(REJECTED.length).toBeGreaterThanOrEqual(15);
    expect(ACCEPTED.length).toBeGreaterThanOrEqual(15);
  });

  it("accepts every phrasing it recommends, in a sentence", () => {
    const sentences = [
      `10 капсули, ${COMPATIBILITY_WORDING.dolceGusto}.`,
      `10 капсули, ${COMPATIBILITY_WORDING.nespresso}.`,
      `10 капсули за ${COMPATIBILITY_WORDING.nespressoOriginal}.`,
      `10 капсули за класическите машини Nespresso (Original), ${COMPATIBILITY_WORDING.vertuo}.`,
      `Капсулите са само за машини Caffitaly System; ${COMPATIBILITY_WORDING.kFee}.`,
      `Формата приемат и машините Tchibo Cafissimo. ${COMPATIBILITY_WORDING.cafissimo}.`,
    ];
    for (const sentence of sentences) expect(compatibilityProblems(sentence), sentence).toEqual([]);
  });

  it("reads a product's text whole: a qualifier in the summary covers the body", () => {
    // The Lollo Caffè Classico entry: the summary excludes NEO, the body says „съвместими с Dolce Gusto“.
    const lollo = [
      "Classico за класическите машини Dolce Gusto (не NEO): 16 капсули с уравновесения бленд на Lollo Caffè от арабика и робуста, 8 от 10 по интензивност.",
      "16 капсули, съвместими с Dolce Gusto. Всяка капсула е едно кафе, така че цената на чаша се вижда точно, а не като оценка.",
    ];
    expect(compatibilityProblems(lollo)).toEqual([]);
    expect(rulesOf(lollo[1] as string)).toEqual(["dolce-gusto-unqualified"]);

    const cafissimo = [
      "Капсули Caffitaly, които стават и за машини Tchibo Cafissimo.",
      "Tchibo посочва, че в Cafissimo трябва да се използват само нейните капсули.",
    ];
    expect(compatibilityProblems(cafissimo)).toEqual([]);
    expect(rulesOf(cafissimo[0] as string)).toEqual(["tchibo-cafissimo"]);
  });

  it("names the phrase, its sentence and the wording to use instead", () => {
    const [problem] = compatibilityProblems([
      "Ароматно еспресо с плътна крема.",
      "16 капсули, съвместими с машини Dolce Gusto. Всяка е една чаша.",
    ]);
    expect(problem).toEqual({
      rule: "dolce-gusto-machines",
      phrase: "машини Dolce Gusto",
      sentence: "16 капсули, съвместими с машини Dolce Gusto.",
      reason: expect.stringContaining(COMPATIBILITY_WORDING.dolceGusto),
    });
    expect(compatibilityProblems("Съвместими са с домашните машини Nespresso.")[0]?.reason).toMatch(
      /Vertuo.*класическите машини Nespresso \(Original\)/,
    );
    expect(compatibilityProblems("Стават и за машините K-fee.")[0]?.reason).toMatch(
      /отделна система/,
    );
    expect(compatibilityProblems("Пасват и на Tchibo Cafissimo.")[0]?.reason).toContain(
      COMPATIBILITY_WORDING.cafissimo,
    );
  });

  it("does not mistake other words for the names it watches", () => {
    // „нео“ starts other words; „Нео-“ is a prefix; the name is written NEO.
    expect(compatibilityProblems("Неотразим вкус в капсули за Dolce Gusto.")).toEqual([]);
    expect(
      compatibilityProblems("Нео-класически дизайн на кутията, капсули за Dolce Gusto."),
    ).toEqual([]);
    // A machine of Tchibo's that is not a Cafissimo is not one.
    expect(compatibilityProblems("Машините Tchibo Qbo са друга система.")).toEqual([]);
  });
});

describe("compatibilitySentences", () => {
  it("splits at the end of a sentence, not at an abbreviation", () => {
    expect(
      compatibilitySentences([
        "В кутията има 16 бр. капсули. Всяка е една чаша!",
        "Втори абзац\nна два реда.",
      ]),
    ).toEqual([
      "В кутията има 16 бр. капсули.",
      "Всяка е една чаша!",
      "Втори абзац",
      "на два реда.",
    ]);
  });
});
