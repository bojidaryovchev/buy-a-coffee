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

/** Written as codes, so the source shows what they are. */
const NBSP = String.fromCharCode(0xa0);
const GRAVE = String.fromCharCode(0x300);
const NEWLINE = String.fromCharCode(10);
const SHY = String.fromCharCode(0xad);
const ZWSP = String.fromCharCode(0x200b);

const rulesOf = (text: string | readonly string[]) =>
  [...new Set(compatibilityProblems(text).map((problem) => problem.rule))].sort();

const REJECTED: ReadonlyArray<readonly [string | readonly string[], readonly CompatibilityRule[]]> =
  [
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
    // The review of this rule (H1): Tchibo's word, as a statement of its own.
    ["Tchibo Cafissimo работи само с капсули Caffitaly, като тези.", ["tchibo-cafissimo"]],
    [
      "Капсулите Caffitaly пасват в Tchibo Cafissimo, която приема само капсули с този формат.",
      ["tchibo-cafissimo"],
    ],
    ["Стават за Tchibo Cafissimo и не губите гаранцията на Tchibo.", ["tchibo-cafissimo"]],
    [
      ["Стават и за Tchibo Cafissimo.", "Tchibo предлага само капсули за Cafissimo и Qbo."],
      ["tchibo-cafissimo"],
    ],
    // M3: exclusion is judged in the name's own clause.
    ["Подходящи за K-fee; не стават за Nespresso.", ["k-fee"]],
    ["Капсули за Dolce Gusto. Подходящи и за NEO; не стават за Nespresso.", ["dolce-gusto-neo"]],
    ["Пасват на машините K-fee — формат, различен от Nespresso.", ["k-fee"]],
    ["Пасват на Vertuo и Original — системи, различни от Dolce Gusto.", ["nespresso-vertuo"]],
    ["Пасват на машини K-fee със собствена система за налягане.", ["k-fee"]],
    ["Пасват на K-fee и Tchibo Cafissimo, не пасват на Nespresso.", ["k-fee", "tchibo-cafissimo"]],
    ["Пасват и на K-fee, а в друг формат са капсулите за Nespresso.", ["k-fee"]],
    [
      "Капсули за Dolce Gusto, подходящи за NEO и за класическите машини, различни от Nespresso.",
      ["dolce-gusto-neo"],
    ],
    // M4: a negation stops at „и“ and a new verb; „не само“ affirms.
    ["Не горчат и пасват на K-fee.", ["k-fee"]],
    ["Не горчат и стават за Cafissimo.", ["tchibo-cafissimo"]],
    ["Стават не само за Caffitaly и K-fee.", ["k-fee"]],
    ["Стават не само за Caffitaly, а и за Cafissimo.", ["tchibo-cafissimo"]],
    ["Съвместими не само с Nespresso Original, но и с Vertuo.", ["nespresso-vertuo"]],
    ["Съвместими не само с Original и Vertuo.", ["nespresso-vertuo"]],
    ["Не са капсули на Tchibo, но пасват в Cafissimo.", ["tchibo-cafissimo"]],
    // L2: lower case, Cyrillic, Tchibo before the machine word, every model.
    ["Пасват и на машините k-fee.", ["k-fee"]],
    ["Пасват и на машините К-фий.", ["k-fee"]],
    ["Капсули за Dolce Gusto, подходящи и за neo.", ["dolce-gusto-neo"]],
    ["Пасват и на cafissimo.", ["tchibo-cafissimo"]],
    ["Съвместими и с Tchibo.", ["tchibo-cafissimo"]],
    ["Пасват и на Tchibo машините.", ["tchibo-cafissimo"]],
    [
      ["Капсули за Nespresso Original.", "Съвместими с всички модели Nespresso."],
      ["nespresso-machines"],
    ],
    [
      ["Капсули за Nespresso Original.", "Подходящи за всяка кафемашина Nespresso у дома."],
      ["nespresso-machines"],
    ],
    [
      [
        "Съвместими с класическите машини Nespresso и с всички нови модели.",
        "Опитайте и Argento в капсули за Nespresso Original.",
      ],
      ["nespresso-machines"],
    ],
    ["Съвместими с всички модели Dolce Gusto.", ["dolce-gusto-machines"]],
    ["Пасват на всички апарати Dolce Gusto.", ["dolce-gusto-machines"]],
    ["Подходящи за всяка Dolce Gusto у дома.", ["dolce-gusto-machines"]],
    ["Пасват на всички Nespresso.", ["nespresso-machines"]],
    ["Пасват на машините на Nespresso.", ["nespresso-machines"]],
    ["Подходящи за кафемашините Nespresso в офиса.", ["nespresso-machines"]],
    [
      "Съвместими с машини Nespresso — както Original, така и Vertuo.",
      ["nespresso-machines", "nespresso-vertuo"],
    ],
    // L4: one excluded mention does not cover a later affirmative one.
    [
      ["Съвместими с класическите машини Dolce Gusto и с NEO.", "Не е за NEO-фенове."],
      ["dolce-gusto-neo"],
    ],
    [
      [
        "Съвместими с класическите машини Dolce Gusto и новите модели.",
        "Rema не прави капсули за NEO.",
      ],
      ["dolce-gusto-machines", "dolce-gusto-neo"],
    ],
    [
      "Капсули за Nespresso Original. Не стават за Vertuo Next, но пасват на VertuoPlus.",
      ["nespresso-vertuo"],
    ],
    // Deliberate: a Tchibo machine with no line named is taken for a Cafissimo.
    ["Смилането е подходящо за кафемашина Tchibo с джезве.", ["tchibo-cafissimo"]],
    // Second review. H1: an exclusion the clause takes back, and its own capsules without „само“.
    ["Машините K-fee са отделна система, но капсулите Caffitaly пасват и в тях.", ["k-fee"]],
    [
      "Капсули за Nespresso Original. Vertuo е отделна система, но с адаптер приема и тези капсули.",
      ["nespresso-vertuo"],
    ],
    [
      "Капсули за Dolce Gusto. NEO използва хартиени дози, но приема и тези капсули.",
      ["dolce-gusto-neo"],
    ],
    [
      "Капсули за Nespresso Original. Vertuo приема собствените си капсули и тези.",
      ["nespresso-vertuo"],
    ],
    ["Капсули Caffitaly. K-fee е собствена система, ала форматът пасва и в нея.", ["k-fee"]],
    [
      "Капсули за Dolce Gusto. NEO работи с хартиени дози, но и с тези капсули.",
      ["dolce-gusto-neo"],
    ],
    // Accepted in the first review; without „само“ its own capsules no longer exclude it.
    ["Капсули Caffitaly. K-fee и EXPRESSI на Aldi ползват собствени капсули.", ["k-fee"]],
    // H2: what only looks like Tchibo's word.
    ["Пасват и в Tchibo Cafissimo, без да губите гаранцията от Tchibo.", ["tchibo-cafissimo"]],
    ["Стават за Tchibo Cafissimo, а гаранцията на Tchibo не се губи.", ["tchibo-cafissimo"]],
    ["Пасват в Cafissimo и гаранцията на Tchibo няма да отпадне.", ["tchibo-cafissimo"]],
    [
      "Пасват в Cafissimo. Tchibo съветва да ползвате оригинални капсули или съвместими като тези.",
      ["tchibo-cafissimo"],
    ],
    [
      "Пасват в Cafissimo. Tchibo уточнява, че капсулите на Tchibo и Caffitaly са еднакви по формат.",
      ["tchibo-cafissimo"],
    ],
    [
      "Пасват в Cafissimo. Производителят посочва, че оригиналните капсули Caffitaly стават в тях.",
      ["tchibo-cafissimo"],
    ],
    [
      "Пасват в Cafissimo. Tchibo препоръчва само оригинални капсули Caffitaly.",
      ["tchibo-cafissimo"],
    ],
    [
      "Пасват в Cafissimo. Производителят на капсулите препоръчва собствените си капсули.",
      ["tchibo-cafissimo"],
    ],
    [
      "Пасват в Cafissimo. Tchibo препоръчваше само собствените си капсули, но вече не.",
      ["tchibo-cafissimo"],
    ],
    [
      "Пасват в Cafissimo. Tchibo вече не препоръчва само собствените си капсули.",
      ["tchibo-cafissimo"],
    ],
    // M1: a comma that opens a clause of its own ends the negation.
    ["Не са за Nespresso, K-fee обаче ги приема.", ["k-fee"]],
    ["Не са за Nespresso Original, Vertuo ги приема.", ["nespresso-vertuo"]],
    ["Не са подходящи за Nespresso, K-fee машините ги приемат.", ["k-fee"]],
    // M2: a denial the clause then takes back.
    [
      "Капсули за Nespresso Original. Vertuo не работи без адаптер, но с него приема тези капсули.",
      ["nespresso-vertuo"],
    ],
    [
      "Капсули за Dolce Gusto. NEO не ги приема без адаптер, а с адаптер – да.",
      ["dolce-gusto-neo"],
    ],
    ["Машините K-fee, които не стават за лате, приемат тези капсули.", ["k-fee"]],
    // M3: a colon or dash after a fit word is a label.
    ["Съвместимост: Dolce Gusto.", ["dolce-gusto-unqualified"]],
    ["Съвместимост: Nespresso.", ["nespresso-unqualified"]],
    [
      "Съвместими машини: Dolce Gusto и Nespresso.",
      ["dolce-gusto-unqualified", "nespresso-unqualified"],
    ],
    ["16 капсули, съвместими — Nespresso.", ["nespresso-unqualified"]],
    ["Съвместими — Dolce Gusto, Nespresso.", ["dolce-gusto-unqualified", "nespresso-unqualified"]],
    ["Работи с една машина: Dolce Gusto.", ["dolce-gusto-unqualified"]],
    // M4: Tchibo's machines.
    ["Кафемашините на Tchibo приемат същия формат.", ["tchibo-cafissimo"]],
    ["Машините на Tchibo също ги приемат.", ["tchibo-cafissimo"]],
    // Spelling: EXPRESSI, transliterations, invisible characters, an entity.
    ["Стават и за машините EXPRESSI на Aldi.", ["k-fee"]],
    ["Стават и за машините Експреси на Алди.", ["k-fee"]],
    ["Стават и за машините Кей-фий.", ["k-fee"]],
    ["Съвместими с всички машини Неспрессо.", ["nespresso-machines"]],
    ["Пасват и в Кафиссимо.", ["tchibo-cafissimo"]],
    [`Съвместими с всички машини Nes${SHY}presso.`, ["nespresso-machines"]],
    [`Съвместими с всички машини Dolce${ZWSP}Gusto.`, ["dolce-gusto-machines"]],
    ["16 капсули, съвместими с машини Dolce&nbsp;Gusto.", ["dolce-gusto-machines"]],
    // „Освен … и на“ means "besides"; „без“ governs only its own noun phrase.
    ["Пасват освен на машините Caffitaly и на K-fee.", ["k-fee"]],
    ["Работят без Nespresso adapter в K-fee.", ["k-fee"]],
    ["Не са оригинални за Cafissimo, но пасват в нея.", ["tchibo-cafissimo"]],
  ];

const ACCEPTED: ReadonlyArray<string | readonly string[]> = [
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
  // The review of this rule. H1: Tchibo's word in Tchibo's words.
  "Пасват и на Tchibo Cafissimo, но Tchibo препоръчва собствените си капсули.",
  "Пасват и на Tchibo Cafissimo. Производителят Tchibo препоръчва в Cafissimo да се използват оригинални капсули Tchibo.",
  "Форматът става и за Tchibo Cafissimo, макар Tchibo да съветва да ползвате само нейните капсули.",
  `Пасват и на Tchibo Cafissimo. Tchibo препоръчва само оригиналните и${GRAVE} капсули.`,
  "Пасват и на Cafissimo. Tchibo препоръчва в машините да се използват само капсули Tchibo.",
  "Пасват и на Cafissimo. Tchibo препоръчва само собствените си оригинални Cafissimo капсули.",
  "Пасват и на Tchibo Cafissimo, но Tchibo препоръчва само оригиналните си капсули.",
  "Пасват и на Tchibo Cafissimo. Tchibo предупреждава, че гаранцията може да не покрие ремонт след чужди капсули.",
  // H2: a negation carries across a list, and a negated verb after the names counts.
  "Капсулите A Modo Mio не са съвместими с машини Nespresso и Dolce Gusto.",
  "Не са съвместими с Nespresso Original, Vertuo, Dolce Gusto и K-fee.",
  "Lavazza Blue е отделна система и капсулите не пасват на Nespresso, Dolce Gusto или K-fee.",
  "Капсулите не пасват на машини Nespresso, Dolce Gusto или Caffitaly.",
  "Тези капсули не стават за машините Nespresso и Dolce Gusto, само за A Modo Mio.",
  "Форматът е само за A Modo Mio: в машина Nespresso или Dolce Gusto капсулата не влиза.",
  "Капсулите Lavazza Blue не са съвместими с машини Nespresso и Dolce Gusto.",
  "A Modo Mio е отделна система, не пасва на машини Nespresso.",
  // M1: Nespresso's exclusions, as Dolce Gusto's.
  "10 капсули, съвместими с класическите машини Nespresso (не Vertuo).",
  "Съвместими с класическите машини Nespresso, не с Vertuo.",
  "10 капсули, съвместими с Nespresso (не Vertuo).",
  "Съвместими с машините Nespresso от линията Original.",
  "За машини Nespresso (системата Original).",
  "Съвместими с машини Nespresso®* Original.",
  "Съвместими с машините Неспресо Оригинал.",
  ["Капсули за класическите машини Nespresso.", "Не са за Vertuo."],
  // M2: the other ways a sentence leaves a machine out.
  "Съвместими с класическите машини Dolce Gusto (с изключение на NEO).",
  "Съвместими с всички машини Dolce Gusto освен NEO.",
  "Съвместими с класическите машини Dolce Gusto, без NEO.",
  "Съвместими с класическите машини Dolce Gusto. Машините NEO работят с хартиени дози.",
  "Съвместими с класическите машини Dolce Gusto; NEO използва други капсули.",
  "Съвместими с класическите машини Dolce Gusto. NEO машините използват хартиени дози, затова тези капсули не са за тях.",
  "Съвместими с класическите машини Nespresso (Original). Vertuo използва други капсули.",
  "Съвместими с машините Nespresso Original, с изключение на Vertuo.",
  "Пасват на машините Caffitaly System, с изключение на K-fee.",
  "K-fee е друг формат.",
  "Не са за K-fee.",
  "Капсули за класическите машини Dolce Gusto (не NEO); NEO не ги приема.",
  "Съвместими с класическите машини Dolce Gusto (NEO не е съвместима).",
  "Съвместими с класическите машини Dolce Gusto. В NEO няма да влязат.",
  "Съвместими с класическите машини Dolce Gusto — не и с NEO.",
  "Подходящи за класическите машини Dolce Gusto, но не за NEO.",
  "Съвместими с машини Dolce Gusto от първото поколение, не с NEO.",
  "Подходящи за класическите машини Dolce Gusto. За моделите NEO не са.",
  [
    "Капсули за класическите машини Dolce Gusto.",
    "Машините NEO са с хартиени дози и не ги приемат.",
  ],
  "Капсули за Dolce Gusto. Не са за Dolce Gusto NEO-серията.",
  // Spelling: Cyrillic, other spaces, marks, a line broken in two.
  "Съвместими с класическите машини Долче Густо (не НЕО).",
  "Съвместими с класическите машини Долче Густо (не NEO).",
  `Съвместими с класическите машини${NBSP}Dolce${NBSP}Gusto (не${NBSP}NEO).`,
  "Съвместими с класическите машини NESCAFÉ® Dolce Gusto® (не NEO).",
  ["Съвместими с класическите машини Dolce Gusto", "(не NEO)."],
  `Съвместими с класическите машини Dolce Gusto${NEWLINE}(не NEO).`,
  "Капсула за класическата машина Dolce Gusto (не NEO).",
  "Подходящи за класическите модели Dolce Gusto като Piccolo, Genio и Mini Me (не NEO).",
  "Подходящи за класическите машини Dolce Gusto (не NEO) на Krups и De'Longhi.",
  // M5: only a Cafissimo is a Cafissimo.
  "Цели зърна, подходящи за всяка автоматична кафемашина Tchibo Esperto или Saeco.",
  // L5: the reader's own machine, in an instruction; a fit word about something else.
  "Капсули за Dolce Gusto (не NEO). Поставете капсулата в машината Dolce Gusto и изберете размер на чашата.",
  "Капсули за Nespresso Original. Поставете капсулата в машината Nespresso и натиснете бутона.",
  "Подходяща за лате и капучино, тази капсула за Dolce Gusto дава плътна крема.",
  "Подходящи за напитки с мляко в Dolce Gusto.",
  // Second review: good copy in the shapes a model writes it.
  "Капсули Caffitaly. K-fee и EXPRESSI на Aldi ползват само собствени капсули.",
  "10 капсули, съвместими с класическите Nespresso машини (Original).",
  "Капсули Original за Nespresso: съвместими с класическите машини Nespresso.",
  "Пасват на Essenza Mini, Pixie, CitiZ и другите машини Nespresso Original.",
  "Подходящи за кафемашините Nespresso Original на Krups и De'Longhi.",
  "Капсулите са за машините Nespresso Original, а не за Vertuo.",
  "Съвместими са с машините Nespresso Original и не стават за Vertuo.",
  "Съвместими с класическите машини Nespresso (Original), но не и с Vertuo.",
  "Съвместими с машините Nespresso оригинал.",
  "Съвместими с машините Nespresso от серията Original: Essenza, Pixie, CitiZ.",
  "Капсулите Nespresso Original не стават за Vertuo.",
  "Подходящи са за класическите машини Dolce Gusto (без NEO).",
  "Тази кутия е за класическите машини Dolce Gusto; машините NEO използват хартиени дози.",
  "За машините NEO има хартиени дози — тези капсули не са за тях. Капсули за Dolce Gusto.",
  "Dolce Gusto Piccolo XS, Genio S и Infinissima приемат тези капсули.",
  "Капсули за Dolce Gusto (не за NEO). Изберете размер 2 на машината Dolce Gusto.",
  "Съвместими с класическите машини Dolce Gusto (не NEO) — Piccolo, Genio, Mini Me, Infinissima.",
  "Съвместими с класическите машини Dolce Gusto (с изключение на моделите NEO).",
  "Съвместими с класическите машини Dolce Gusto (не с NEO).",
  "Съвместими с класическите машини Dolce Gusto (NEO не ги приема).",
  "Подходящи за класическите машини Dolce Gusto, а не за NEO.",
  "Подходящо за ристрето и лунго в класическите машини Dolce Gusto (не NEO).",
  "Само за класическите машини Dolce Gusto, не за NEO.",
  "Съвместими с класическите машини NESCAFÉ® Dolce Gusto® (не NEO™).",
  "Съвместими с класическите машини Долче Густо (не Нео).",
  "Пасват в Tchibo Cafissimo. По препоръка на Tchibo в Cafissimo се използват само нейните капсули.",
  "Пасват в Tchibo Cafissimo. Tchibo пише в инструкциите, че трябва да се използват само нейните капсули.",
  "Пасват в Tchibo Cafissimo. Официалната позиция на Tchibo е, че в Cafissimo се използват само нейните капсули.",
  "Пасват в Tchibo Cafissimo. Tchibo съветва собствениците на Cafissimo да използват само капсули Tchibo.",
  "Форматът пасва и на Tchibo Cafissimo, но в ръководството на машината Tchibo препоръчва само собствените си капсули.",
  "Пасват в Cafissimo. Tchibo препоръчва в Cafissimo само оригиналните капсули Cafissimo.",
  "Пасват в Cafissimo, но гаранцията на Tchibo може да не покрие ремонт след чужди капсули.",
  "Форматът става и за Tchibo Cafissimo; Tchibo посочва, че в Cafissimo трябва да се използват само нейните капсули.",
  "Същия формат приемат и машините Tchibo Cafissimo, макар Tchibo да посочва, че в тях трябва да се използват само нейните капсули.",
  "K-fee е друга система и капсули за нея нямаме.",
  "Капсули Lavazza Blue за офис машините Lavazza Blue; не пасват на Nespresso и A Modo Mio.",
  "Капсулите са само за машините Lavazza A Modo Mio — не стават за Nespresso, Dolce Gusto или Caffitaly.",
  "10 капсули за машините със знака Caffitaly System.",
  "Тези капсули не са за Vertuo, нито за Dolce Gusto.",
  "Не са дози NEO, а класически капсули Dolce Gusto (не NEO).",
  // The machine finder's own K-fee note: EXPRESSI is listed among the capsules.
  "K-fee е собствена система капсули, не Caffitaly: машините приемат капсулите на K-fee и EXPRESSI на Aldi.",
];

describe("compatibilityProblems", () => {
  it.each(REJECTED)("rejects „%s“", (text, rules) => {
    expect(rulesOf(text)).toEqual([...rules].sort());
  });

  // Wrapped: `it.each` would spread a multi-paragraph text into arguments.
  it.each(ACCEPTED.map((text) => [text]))("accepts „%s“", (text) => {
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
    // „нео“ starts other words; the name stands alone, or hyphenated: „NEO-серията“.
    expect(compatibilityProblems("Неотразим вкус в капсули за Dolce Gusto.")).toEqual([]);
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
