import { MACHINE_BRANDS } from "@/content/machines";
import type { CupRange, FormatSummary } from "@/lib/catalog/journal-figures";
import { pluralize } from "@/lib/catalog/format";
import { getBrewingSystem, getUnsupportedSystem, systemsForMethod } from "@/lib/recommend/systems";
import {
  action,
  h2,
  link,
  p,
  sentenceList,
  table,
  ul,
  type Article,
  type Block,
  type Inline,
} from "../blocks";
import {
  MACHINES_HREF,
  WIZARD_HREF,
  articleHref,
  machineBrandHref,
  systemCategoryHref,
} from "../links";
import { CUP_COST_SLUG, rangeText } from "./cup-cost";
import { WHICH_CAPSULE_SLUG } from "./which-capsule";

/**
 * Beans, capsules or pods.
 *
 * The three formats are the wizard's first question, and this is the long
 * answer to it. What each format needs is taken from `systems.ts`; how much
 * choice there is and what a cup costs are counted from the catalog. The
 * advice at the end is ours and is labelled as a way to decide, not as a fact
 * about coffee.
 */

export const FORMATS_SLUG = "zarna-kapsuli-ili-dozi";

/** "В момента имаме 50 продукта на зърна, в опаковки от 250 г, 500 г и 1 кг." */
function choiceText(summary: FormatSummary | null, kind: "beans" | "pod"): Inline[] {
  if (!summary) return [];
  const packs =
    summary.packs.length === 0
      ? []
      : kind === "beans"
        ? [", в опаковки от ", ...sentenceList([...summary.packs])]
        : [", в кутии по ", ...sentenceList([...summary.packs]), " броя"];
  return [
    ` В момента имаме ${pluralize(summary.products, "продукт", "продукта")} ${kind === "beans" ? "на зърна" : "с дози"}`,
    ...packs,
    ".",
  ];
}

const costText = (range: CupRange | null): Inline[] =>
  range ? [` На чаша излиза ${rangeText(range)}.`] : [];

export const formats: Article = {
  slug: FORMATS_SLUG,
  title: "Зърна, капсули или дози: кое е за вас",
  description:
    "Трите формата кафе искат различна машина, струват различно на чаша и дават различен избор. Как да решите според това как пиете кафе — и какво да правите, ако машината вече е решила вместо вас.",
  publishedAt: "2026-10-09",
  usesCatalog: true,

  body: ({ formats: figures, cupCost }) => {
    const beans = getBrewingSystem("beans");
    const pod = getBrewingSystem("ese-pod");
    const capsuleSystems = systemsForMethod("capsule");
    const ground = getUnsupportedSystem("ground");

    const podBrands = MACHINE_BRANDS.filter((brand) =>
      brand.models.some((model) => model.system === "ese-pod"),
    ).map((brand) => [link(machineBrandHref(brand.slug), brand.name)]);

    const capsuleChoice = (figures?.bySystem ?? []).filter(
      ({ system }) => system.method === "capsule",
    );

    const summaryRows = figures
      ? (
          [
            ["beans", "Зърна", "Машина с мелачка или отделна мелачка"],
            ["capsule", "Капсули", "Капсулна машина; само капсулите за нейната система"],
            ["pod", "Дози ESE", "Еспресо машина с цедка за дози 44 мм"],
          ] as const
        ).flatMap(([method, label, needs]) => {
          const summary = figures.byMethod[method];
          if (!summary) return [];
          const range = cupCost?.byMethod[method] ?? null;
          return [[label, needs, String(summary.products), range ? rangeText(range) : "—"]];
        })
      : [];

    const beansCheaper = cupCost?.beansUndercutCapsules ?? false;

    const summary: Block[] =
      summaryRows.length > 0
        ? [
            h2("Накратко"),
            table({
              caption: "Трите формата един до друг",
              columns: ["Формат", "Какво ви трябва", "Продукти в каталога", "На чаша"],
              rows: summaryRows,
              note: "Броят продукти и цените на чаша се смятат от каталога при всяко негово обновяване. Знакът ≈ значи приблизително.",
            }),
          ]
        : [];

    return [
      p(
        "Преди марката и вкуса има един по-прост въпрос: в какъв вид да е кафето. Зърна, капсули и хартиени дози искат различни машини, струват различно на чаша и дават различен избор.",
      ),

      h2("Ако вече имате машина"),
      p(
        "Тогава форматът не е въпрос на предпочитание — машината го е решила. Ако сипвате зърна в контейнер отгоре, машината е на зърна. Капсулната машина работи само с капсулите за своята система. Еспресо машина с цедка за дози приема хартиени дози.",
      ),
      p(
        "Ако не сте сигурни коя е вашата, прочетете ",
        link(articleHref(WHICH_CAPSULE_SLUG), "коя капсула пасва на коя кафемашина"),
        " или намерете модела в ",
        link(MACHINES_HREF, "списъка по марки"),
        ".",
      ),

      h2("Зърна"),
      p(
        beans ? beans.summary : "За машина с мелачка.",
        " Не сте вързани за система: кафе на зърна се купува за всяка автоматична машина от списъка ни, независимо от марката ѝ.",
      ),
      p(
        "Така работят и вендинг автоматите: мелят зърната на място, обикновено от опаковки по 1 кг.",
      ),
      p(
        "Целият избор е в категорията ",
        link(systemCategoryHref("beans"), "кафе на зърна"),
        ".",
        ...choiceText(figures?.byMethod.beans ?? null, "beans"),
        ...costText(cupCost?.byMethod.beans ?? null),
      ),

      h2("Капсули"),
      p(
        "Слагате капсула и машината прави останалото. Цената на това удобство е, че сте вързани за една система: държим капсули за ",
        pluralize(capsuleSystems.length, "система", "системи"),
        " и те не са взаимозаменяеми.",
        ...costText(cupCost?.byMethod.capsule ?? null),
      ),
      ...(capsuleChoice.length > 1
        ? [
            p(
              "Изборът не е еднакъв за всички системи, и това си струва да се знае, преди да купите машина. В момента имаме:",
            ),
            ul(
              ...capsuleChoice.map(({ system, products }) => [
                link(systemCategoryHref(system.id), system.name),
                ` — ${pluralize(products, "продукт", "продукта")}`,
              ]),
            ),
          ]
        : [
            p(
              "Изборът не е еднакъв за всички системи, и това си струва да се провери, преди да купите машина: за едни има много видове кафе, за други — няколко.",
            ),
          ]),

      h2("Дози ESE"),
      p(
        pod ? pod.recognise : "Хартиени дози за еспресо машина с цедка за дози.",
        " Една доза е една чаша, както при капсулата.",
        ...(podBrands.length > 0
          ? [
              " В списъка ни дози приемат модели на ",
              ...sentenceList(podBrands),
              " — винаги с цедката за дози.",
            ]
          : []),
      ),
      p(
        "Някои от тези машини работят и с мляно кафе.",
        ...(ground ? [` ${ground.explanation}`] : []),
      ),
      p(
        "Дозите са в категорията ",
        link(systemCategoryHref("ese-pod"), "кафе дози"),
        ".",
        ...choiceText(figures?.byMethod.pod ?? null, "pod"),
        ...costText(cupCost?.byMethod.pod ?? null),
      ),

      ...summary,

      h2("Как да решите"),
      ul(
        [
          "Ако водещ е разходът и се пие много — за семейство, офис или заведение — гледайте зърната.",
          ...(beansCheaper
            ? [
                " В момента и най-скъпите зърна в каталога ни излизат по-евтино на чаша от най-евтините капсули.",
              ]
            : []),
        ],
        "Ако искате кафе без мелене, гледайте капсулите — и изберете системата според това колко избор има за нея.",
        "Ако вече имате еспресо машина с цедка за дози и искате готова порция, гледайте дозите.",
      ),
      p(
        "Как се стига до цената на чаша и защо не сравняваме по цена на опаковката, пише в ",
        link(articleHref(CUP_COST_SLUG), "колко струва една чаша кафе"),
        ".",
      ),
      p(
        "Въпросникът започва точно оттук — капсули, зърна или дози — и продължава според отговора ви.",
      ),
      action(
        { href: WIZARD_HREF, label: "Към въпросника" },
        { href: MACHINES_HREF, label: "Намерете машината си" },
      ),
    ];
  },
};
