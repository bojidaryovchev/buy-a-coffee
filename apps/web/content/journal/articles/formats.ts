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
  CAPSULES_HREF,
  MACHINES_HREF,
  VENDING_HREF,
  WIZARD_HREF,
  articleHref,
  landingHref,
  machineBrandHref,
  systemCategoryHref,
} from "../links";
import { relatedCopy } from "../../landing-copy";
import { CUP_COST_SLUG, rangeText } from "./cup-cost";
import { WHICH_CAPSULE_SLUG } from "./which-capsule";

/**
 * A capsule machine or a bean-to-cup one.
 *
 * Retitled in October 2026 toward the query people type, „кафемашина с капсули
 * или на зърна“, and moved to the slug that says so. That query is asked by
 * someone about to buy a machine, and this shop sells none — so the article
 * says that in its first sentence and answers the half of the question a
 * coffee shop can: what each kind of machine commits its owner to buying
 * afterwards, how much choice there is, and what a cup costs. It says nothing
 * about machine prices, models or upkeep, because we hold no data on them.
 *
 * What each format needs is taken from `systems.ts`; how much choice there is
 * and what a cup costs are counted from the catalog. The advice at the end is
 * ours and is labelled as a way to decide, not as a fact about coffee.
 */

export const FORMATS_SLUG = "kafemashina-s-kapsuli-ili-na-zarna";

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
  previousSlugs: ["zarna-kapsuli-ili-dozi"],
  title: "Кафемашина с капсули или на зърна: какво ще купувате после",
  description:
    "Не продаваме кафемашини, а кафето за тях. Затова сравняваме двата вида машина по това, което идва след покупката: какво кафе влиза в нея, колко избор имате и колко струва една чаша.",
  publishedAt: "2026-10-09",
  usesCatalog: true,

  body: ({ formats: figures, cupCost, landings }) => {
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
            ["beans", "На зърна", "Кафе на зърна, без значение от марката на машината"],
            ["capsule", "С капсули", "Само капсулите за нейната система"],
            ["pod", "С цедка за дози ESE", "Хартиени дози 44 мм"],
          ] as const
        ).flatMap(([method, label, buys]) => {
          const summary = figures.byMethod[method];
          if (!summary) return [];
          const range = cupCost?.byMethod[method] ?? null;
          return [[label, buys, String(summary.products), range ? rangeText(range) : "—"]];
        })
      : [];

    const beansCheaper = cupCost?.beansUndercutCapsules ?? false;
    const cheapest = landingHref("cheapest", landings);

    const summary: Block[] =
      summaryRows.length > 0
        ? [
            h2("Накратко"),
            table({
              caption: "Трите вида машина един до друг",
              columns: ["Машина", "Какво купувате за нея", "Продукти в каталога", "На чаша"],
              rows: summaryRows,
              note: "Броят продукти и цените на чаша се смятат от каталога при всяко негово обновяване. Знакът ≈ значи приблизително.",
            }),
          ]
        : [];

    return [
      p(
        "Кафемашини не продаваме — продаваме кафето, което влиза в тях. Затова тук няма сравнение на модели. Има обаче нещо, което от нашата страна на щанда се вижда добре: с машината избирате и какво кафе ще купувате, докато тя работи, и колко ще ви струва всяка чаша.",
      ),
      p(
        "Машината на зърна не ви връзва за никаква система. Капсулната е по-проста за работа, но приема само капсулите за своята система. Има и трети вид, за който по-рядко се сещат: еспресо машина с цедка за хартиени дози.",
      ),

      h2("Машина на зърна"),
      p(
        beans ? beans.recognise : "Машината мели зърната сама.",
        " Не сте вързани за система: кафе на зърна се купува за всяка автоматична машина от списъка ни, независимо от марката ѝ.",
      ),
      p(
        "Така работят и вендинг автоматите: мелят зърната на място, обикновено от опаковки по 1 кг. За тях има отделна страница — ",
        link(VENDING_HREF, "кафе за вендинг машини"),
        ".",
      ),
      p(
        "Целият избор е в категорията ",
        link(systemCategoryHref("beans"), "кафе на зърна"),
        ".",
        ...choiceText(figures?.byMethod.beans ?? null, "beans"),
        ...costText(cupCost?.byMethod.beans ?? null),
      ),

      h2("Машина с капсули"),
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
      p(
        "Всички заедно са в категорията ",
        link(CAPSULES_HREF, "кафе капсули"),
        ". Как изглежда капсулата за всяка система и в кои машини влиза, пише във ",
        link(articleHref(WHICH_CAPSULE_SLUG), "видове капсули за кафе"),
        ".",
      ),

      h2("Еспресо машина с цедка за дози ESE"),
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
          "Ако водещ е разходът и се пие много — за семейство, офис или заведение — гледайте машина на зърна.",
          ...(beansCheaper
            ? [
                " В момента и най-скъпите зърна в каталога ни излизат по-евтино на чаша от най-евтините капсули.",
              ]
            : []),
          ...(cheapest
            ? [
                " Най-ниските цени на чаша във всяка система са на страницата „",
                link(cheapest, relatedCopy.cheapest),
                "“.",
              ]
            : []),
        ],
        "Ако искате кафе без мелене, гледайте капсулна машина — и изберете системата според това колко избор има за нея.",
        "Ако искате готова порция в еспресо машина с цедка, гледайте дозите.",
      ),
      p(
        "Колко струва самата машина и как се поддържа, не можем да кажем: не продаваме машини и нямаме данни за тях. Към цената на чаша добавете и това.",
      ),
      p(
        "Как се стига до цената на чаша и защо не сравняваме по цена на опаковката, пише в ",
        link(articleHref(CUP_COST_SLUG), "колко струва една чаша кафе"),
        ".",
      ),

      h2("Ако вече имате машина"),
      p(
        "Тогава форматът не е въпрос на предпочитание — машината го е решила. Ако сипвате зърна в контейнер отгоре, машината е на зърна. Капсулната машина работи само с капсулите за своята система. Еспресо машина с цедка за дози приема хартиени дози.",
      ),
      p(
        "Ако не сте сигурни коя е вашата, намерете модела в ",
        link(MACHINES_HREF, "списъка по марки"),
        ". Въпросникът започва точно оттук — капсули, зърна или дози — и продължава според отговора ви.",
      ),
      action(
        { href: WIZARD_HREF, label: "Към въпросника" },
        { href: MACHINES_HREF, label: "Намерете машината си" },
      ),
    ];
  },
};
