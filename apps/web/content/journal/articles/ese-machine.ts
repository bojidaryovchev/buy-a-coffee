import { MACHINE_BRANDS, type MachineBrand, type MachineModel } from "@/content/machines";
import { STRENGTH_LABELS, STRENGTH_ORDER } from "@/lib/catalog/attributes";
import { pluralize } from "@/lib/catalog/format";
import type { CupRange, FormatSummary, PodFigures } from "@/lib/catalog/journal-figures";
import { getUnsupportedSystem } from "@/lib/recommend/systems";
import {
  action,
  callout,
  h2,
  h3,
  link,
  ol,
  p,
  phone,
  sentenceList,
  strong,
  table,
  ul,
  type Article,
  type Block,
  type Inline,
} from "../blocks";
import { MACHINES_HREF, articleHref, machineBrandHref, systemCategoryHref } from "../links";
import { CUP_COST_SLUG, rangeText } from "./cup-cost";
import { INTENSITY_SLUG } from "./intensity";
import { WHICH_CAPSULE_SLUG } from "./which-capsule";

/**
 * The machine for ESE paper pods: how to tell one, what to check before buying
 * one, and how to choose the pods.
 *
 * Written for „кафемашина за хартиени дози“ (research `09`, T2.3), which is
 * asked by someone who owns such a machine or is about to buy one. This shop
 * sells neither machines nor advice on models, so the article says so in its
 * second paragraph and answers what it can.
 *
 * Where each kind of statement comes from:
 *
 *  - **The standard.** What a pod is (7 g of ground, pressed coffee sealed
 *    between two sheets of filter paper, 44 mm across and about a centimetre
 *    thick), that pods and machines of different makers are compatible, that
 *    the mark is on both machine and pack, and that the consortium checks a
 *    machine's water temperature and pressure before it may carry the mark and
 *    again in production: the E.S.E. Consortium's own page on the standard,
 *    https://eseconsortium.com/standard. The mark on the pack is also in
 *    De'Longhi's FAQ, https://www.delonghi.com/en-gb/faqs/How-big-are-ESE-pods/a/8750.
 *    That some machines are made for pods alone: illy's own ESE machine,
 *    https://www.illy.com/en-ca/coffee-machines/ese-coffee-pod-machines/illy-ese-coffee-machine/60453.html
 *    — named nowhere here, because the machine database does not list it.
 *  - **Which machines take pods.** The machine database, `machines.ts`, and
 *    nothing else (`PRODUCT.md`, "Compatibility is a promise"). The list is
 *    built from the models whose system is `ese-pod`; the one typed sentence
 *    that names models — which of them also take ground coffee — restates
 *    those models' notes and is pinned to them in `journal-ese-machine.test.ts`.
 *    Dolce Gusto NEO is named as a system, from `systems.ts`, to say that its
 *    paper pods are a different thing.
 *  - **Every count and price.** `figures.formats`, `figures.cupCost` and
 *    `figures.pods`, computed from the catalog at render. Each paragraph that
 *    quotes one has a version that makes the same point without it.
 */

export const ESE_MACHINE_SLUG = "kafemashina-za-dozi-ese";

/** The brands in the machine database with a model that takes ESE pods, and those models. */
export function podMachines(): ReadonlyArray<{
  readonly brand: MachineBrand;
  readonly models: readonly MachineModel[];
}> {
  return MACHINE_BRANDS.flatMap((brand) => {
    const models = brand.models.filter((model) => model.system === "ese-pod");
    return models.length > 0 ? [{ brand, models }] : [];
  });
}

/** „слабо“, „средно“, „силно“: the shop's own steps, as the filter names them. */
const stepLabel = (key: string): string => (STRENGTH_LABELS[key] ?? key).toLocaleLowerCase("bg");

/** "В момента в категорията има 45 продукта, в кутии от 18 до 200 броя." */
function choiceText(summary: FormatSummary | null): Block[] {
  if (!summary) return [];
  // Pods are sold by the piece; a size written by weight would not read as „броя“.
  const counts = summary.packs.every((pack) => /^\d+$/.test(pack)) ? summary.packs : [];
  const first = counts[0];
  const last = counts[counts.length - 1];
  const packs =
    first === undefined || last === undefined
      ? ""
      : first === last
        ? `, в кутии по ${first} броя`
        : `, в кутии от ${first} до ${last} броя`;
  return [
    p(`В момента в категорията има ${pluralize(summary.products, "продукт", "продукта")}${packs}.`),
  ];
}

function priceText(range: CupRange | null): Block[] {
  return range ? [p(`В момента дозите в каталога ни излизат ${rangeText(range)} на чаша.`)] : [];
}

function strengthTable(pods: PodFigures | null): Block[] {
  if (!pods || pods.strengths.length === 0) return [];
  return [
    p("Ето колко продукта има на всяка степен в момента и колко струва чаша при тях:"),
    table({
      caption: "Дозите по степен на интензивност",
      columns: ["Степен", "Продукти", "На чаша"],
      rows: pods.strengths.map((step) => [
        stepLabel(step.key),
        String(step.products),
        step.perCup ? rangeText(step.perCup) : "—",
      ]),
      note: "Броят и цените се смятат от каталога при всяко негово обновяване.",
    }),
  ];
}

function scaleText(pods: PodFigures | null): Inline[] {
  const scales = pods?.scales ?? [];
  if (scales.length > 1) {
    return [
      "Числото на производителя е по неговата собствена скала, а при дозите в каталога ни се срещат скали до ",
      ...sentenceList(scales.map(String)),
      ". Затова сравнявайте мястото на скалата, а не самото число.",
    ];
  }
  return [
    "Числото на производителя е по неговата собствена скала, а скалите на различните марки не са еднакви. Затова го четете заедно със скалата му.",
  ];
}

export const eseMachine: Article = {
  slug: ESE_MACHINE_SLUG,
  title: "Кафемашина за хартиени дози ESE: как да изберете",
  description:
    "Хартиената доза ESE е 44 мм и влиза в еспресо машина с цедка за дози. Как да разберете дали вашата машина я приема, какво да проверите при нова и как да изберете дозите.",
  metaDescription:
    "Дозата ESE е 44 мм и влиза в еспресо машина с цедка (филтър) за дози. Как да познаете такава кафемашина и как да изберете дозите по цена на чаша.",
  publishedAt: "2026-10-20",
  usesCatalog: true,

  body: ({ formats, cupCost, pods }) => {
    const machines = podMachines();
    const modelCount = machines.reduce((sum, entry) => sum + entry.models.length, 0);
    const neo = getUnsupportedSystem("dolce-gusto-neo");
    const podsHref = systemCategoryHref("ese-pod");

    return [
      p(
        "Кафемашина за хартиени дози е еспресо машина, в която вместо мляно кафе слагате готова доза: кафе, смляно, отмерено и пресовано между два тънки листа филтърна хартия. Форматът се казва ESE и е общ стандарт, затова доза ESE от една марка става за машина ESE от друга.",
      ),
      p(
        "Машини не продаваме — продаваме дозите за тях, затова модели не сравняваме и не класираме. Тук е това, което знаем със сигурност: какво е дозата, как да познаете машина, която я приема, какво да проверите, ако тепърва купувате, и как да изберете самите дози.",
      ),

      h2("Какво е дозата ESE"),
      p(
        "ESE идва от Easy Serving Espresso. Стандартът се поддържа от консорциум на производители на кафе и на машини и описва и двете страни: каква е дозата и каква трябва да е машината, която я приготвя.",
      ),
      ul(
        [
          strong("Дозата. "),
          "В една доза има 7 грама смляно кафе, пресовано и запечатано между два слоя филтърна хартия. Тя е за една чаша и след нея се изхвърля.",
        ],
        [
          strong("Размерът. "),
          "Кафето в дозата е кръгло, 44 мм в диаметър и около сантиметър дебело. Хартията около него е по-широка и стърчи като ръб.",
        ],
        [
          strong("Машината. "),
          "Машината със знака ESE има камера, оформена по дозата, и зададени температура и налягане на водата. Консорциумът ги проверява на всеки нов модел, преди да му позволи да носи знака, и после периодично на машините от серийното производство.",
        ],
      ),
      p(
        "Кафето не се мели, не се отмерва и не се пресова у дома — всичко това вече е направено в дозата. Слагате я в машината, пускате водата и после я изхвърляте.",
      ),

      h2("Как да познаете кафемашина с хартиени дози"),
      p("Ако вече имате машина и не сте сигурни дали приема дози, минете през тези стъпки по ред:"),
      ol(
        [
          "Вижте какъв е видът на машината. Дозите са за еспресо машина с дръжка и цедка — ръчната, в която иначе слагате мляно кафе, — и за машини, направени само за дози. Автоматичната машина, която мели зърна сама, не ги приема: за нея се купува ",
          link(systemCategoryHref("beans"), "кафе на зърна"),
          ". Не ги приема и капсулната машина, която работи само с капсулите за своята система — за тях пише във ",
          link(articleHref(WHICH_CAPSULE_SLUG), "видове капсули за кафе"),
          ".",
        ],
        "Потърсете знака ESE върху машината. По стандарта той стои и на машините, и на опаковките на дозите, а двата знака заедно казват, че машината и дозите си пасват.",
        "Вижте с какви цедки е машината. При моделите в нашия списък дозите влизат с цедката за дози, която наричат още филтър за дози.",
        [
          "Намерете модела в ",
          link(MACHINES_HREF, "списъка ни по марки"),
          ": за всеки модел там пише какво приема.",
        ],
        "Ако имате доза под ръка, сравнете я с описанието по-горе: кръгло кафе от 44 мм в хартия с ръб.",
        [
          "Не намирате модела си или все още не сте сигурни? Обадете ни се на ",
          phone,
          ", кажете ни марката и модела, и ще ви кажем какво знаем за тях.",
        ],
      ),
      ...(neo
        ? [
            callout(
              { tone: "caution", title: `Хартиени дози има и при ${neo.name}` },
              `Машините ${neo.name} също работят с хартиени дози, но това е отделна система, а не ESE. Дозите ESE не са за тях, а дози NEO нямаме.`,
            ),
          ]
        : []),

      h2("Машините в нашия списък, които приемат дози"),
      ...(machines.length > 0
        ? [
            p(
              `В списъка ни дози ESE приемат ${pluralize(modelCount, "модел", "модела")} на ${pluralize(machines.length, "марка", "марки")}:`,
            ),
            ul(
              ...machines.map(({ brand, models }) => [
                link(machineBrandHref(brand.slug), brand.name),
                " — ",
                ...sentenceList(models.map((model) => model.name)),
              ]),
            ),
            p(
              "При всички тях дозите влизат с цедката за дози. Ако вашият модел е тук, дозите от категорията ",
              link(podsHref, "кафе дози"),
              " стават за него.",
            ),
          ]
        : []),
      p(
        "Списъкът не е пълен: в него влизат само модели, за които знаем със сигурност какво приемат. Ако вашата машина я няма, това не значи, че не приема дози — проверете знака ESE и цедките ѝ, както е описано по-горе.",
      ),

      h2("Ако тепърва купувате кафемашина с филтър за дози"),
      p(
        "Модел няма да ви препоръчаме: не продаваме машини и не сме ги изпитвали. Каквато и машина да гледате обаче, ето какво си струва да проверите преди покупката:",
      ),
      ul(
        [
          strong("Знакът ESE. "),
          "Той значи, че моделът е проверен по стандарта и че дозите със същия знак пасват на него.",
        ],
        [
          strong("Цедката за дози. "),
          "Попитайте дали е в комплекта, или се купува отделно, и дали изобщо се предлага за този модел.",
        ],
        [
          strong("Мляното кафе. "),
          "Ако искате да варите и мляно кафе, търсете машина с цедки и за двете. От машините в нашия списък така работят De'Longhi Dedica и ръчните модели на Gaggia. Мляно кафе в пакет обаче не предлагаме — при нас има зърна, капсули и дози.",
        ],
        [
          strong("Цената и поддръжката. "),
          "За тях не можем да ви кажем нищо: нямаме данни нито за цените на машините, нито за разходите по тях.",
        ],
      ),
      p(
        "Едно предимство на формата не зависи от модела: дозите не ви връзват за една марка кафе. По стандарта дози ESE от различни марки стават за машините със знака ESE, докато при капсулите всяка система приема само своите.",
      ),

      h2("Как да изберете дозите"),
      p(
        "Щом машината приема дози ESE, изборът е между марки, интензивност и размер на кутията. Марката на машината тук вече няма значение.",
      ),
      ...choiceText(formats?.byMethod.pod ?? null),

      h3("Цената на чаша"),
      p(
        "При дозите цената на чаша е точна: една доза е една чаша, така че цената на кутията се дели на броя дози в нея. Тя стои до цената на кутията при всеки продукт. Сравнявайте по нея, защото кутиите са с различен брой дози.",
      ),
      ...priceText(cupCost?.byMethod.pod ?? null),
      p(
        "Защо цената на кутията подвежда и как се стига до цената на чаша, пише в ",
        link(articleHref(CUP_COST_SLUG), "колко струва една чаша кафе"),
        ".",
      ),

      h3("Интензивността"),
      p(
        "Освен числото, което обявява производителят, в каталога ни има и степени: ",
        ...sentenceList(STRENGTH_ORDER.map(stepLabel)),
        ". По тях дозите се отделят с филтъра „Интензивност“ в категорията.",
      ),
      ...strengthTable(pods),
      p(
        "Степента не е оценка за качество: тя казва колко интензивно е кафето, а не колко е хубаво.",
      ),
      p(
        ...scaleText(pods),
        " Повече за това пише в ",
        link(articleHref(INTENSITY_SLUG), "как се чете числото за интензивност"),
        ".",
      ),

      h2("Накратко"),
      ol(
        "Проверете дали машината ви приема дози ESE: по знака ESE, по цедката за дози или по модела в списъка ни.",
        "Сравнявайте дозите по цена на чаша, а не по цена на кутията.",
        "Избирайте интензивност по степента във филтъра, а числото на производителя четете само заедно със скалата му.",
      ),
      p("Всички дози са в категорията ", link(podsHref, "кафе дози"), "."),
      action(
        { href: podsHref, label: "Към кафе дозите" },
        { href: MACHINES_HREF, label: "Намерете машината си" },
      ),
    ];
  },
};
