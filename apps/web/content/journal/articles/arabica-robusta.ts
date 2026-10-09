import { STRENGTH_LABELS } from "@/lib/catalog/attributes";
import { pluralize } from "@/lib/catalog/format";
import type { CompositionFigures, ShareCount } from "@/lib/catalog/journal-figures";
import type { BrewMethod } from "@/lib/recommend/systems";
import {
  action,
  h2,
  link,
  p,
  table,
  ul,
  type Article,
  type Block,
  type Inline,
  type InlineLink,
} from "../blocks";
import {
  CAPSULES_HREF,
  WIZARD_HREF,
  articleHref,
  landingHref,
  linkWhile,
  systemCategoryHref,
} from "../links";
import { ARABICA_ROBUSTA_SLUG, CHOOSE_BEANS_SLUG } from "./slugs";

/**
 * Arabica and robusta.
 *
 * Two kinds of sentence live in this file and they are kept apart.
 *
 * **General facts about the two species** are typed, because no catalog holds
 * them: which is the more bitter, which carries more caffeine, why blends
 * exist. Only what is common ground among growers and roasters is stated, and
 * as a tendency of the species — never as a property of a product. Nothing
 * here gives a caffeine figure in milligrams, a share of world production to
 * the percent, or a health claim; those need a source this shop does not have.
 *
 * **Everything about this catalog** — how many products state an arabica share,
 * how many of those are pure arabica, how the shares spread — comes out of
 * `figures.composition`. The record holds the arabica share only, so the
 * article never says what the rest of a blend is, and never reads a product
 * with no figure as "robusta".
 */

export { ARABICA_ROBUSTA_SLUG };

/** "70% арабика" for one blend, "между 10% и 80% арабика" for several. */
function blendSpan(count: ShareCount): string {
  if (count.blendMin === null || count.blendMax === null) return "";
  return count.blendMin === count.blendMax
    ? `${count.blendMin}% арабика`
    : `между ${count.blendMin}% и ${count.blendMax}% арабика`;
}

/**
 * "6 са изцяло арабика, а при 7 арабиката е между 10% и 80% от сместа" — what
 * the products that state a share actually state. Empty when none does.
 */
export function shareBreakdown(count: ShareCount): string {
  const parts: string[] = [];
  if (count.pure > 0) {
    parts.push(count.pure === 1 ? "1 е изцяло арабика" : `${count.pure} са изцяло арабика`);
  }
  if (count.blends > 0) {
    parts.push(
      `${count.blends === 1 ? "1 е смес с" : `${count.blends} са смеси с`} ${blendSpan(count)}`,
    );
  }
  return parts.join(", а ");
}

const FORMAT_ROWS: ReadonlyArray<readonly [BrewMethod, InlineLink]> = [
  ["beans", link(systemCategoryHref("beans"), "Кафе на зърна")],
  ["capsule", link(CAPSULES_HREF, "Кафе капсули")],
  ["pod", link(systemCategoryHref("ese-pod"), "Кафе дози")],
];

function catalogSection(figures: CompositionFigures | null): Block[] {
  if (!figures || figures.declared === 0) {
    return [
      p(
        "В каталога съставът е записан като дял арабика, когато е обявен, и стои на реда „Състав“ в характеристиките на продукта. Където не е обявен, не го предполагаме.",
      ),
    ];
  }

  const rows = FORMAT_ROWS.flatMap(([method, label]) => {
    const count = figures.byMethod[method];
    return count
      ? [[[label], String(count.products), String(count.declared), String(count.pure)]]
      : [];
  });

  return [
    p(
      "В каталога съставът е записан като дял арабика, когато е обявен, и стои на реда „Състав“ в характеристиките на продукта. ",
      `В момента делът е обявен при ${figures.declared} от ${pluralize(figures.products, "продукт", "продукта")}: ${shareBreakdown(figures)}.`,
    ),
    table({
      caption: "Обявен дял арабика по формат",
      columns: ["Формат", "Продукти", "С обявен дял", "От тях 100% арабика"],
      rows,
      note: "Числата се смятат от каталога при всяко негово обновяване.",
    }),
    p(
      "За продуктите без обявен дял не твърдим нищо — нито че са арабика, нито че са робуста. Дял под 100% значи смес; останалата част обикновено е робуста, но в данните ни е записан само делът арабика.",
    ),
  ];
}

/** "От 49 продукта с обявени 100% арабика 10 са отнесени към степен „силно“." */
function pureStrengthText(figures: CompositionFigures | null): Inline[] {
  const strong = figures?.pureByStrength.find((step) => step.key === "strong") ?? null;
  if (!figures || !strong || figures.pure < 2) return [];
  const label = (STRENGTH_LABELS.strong ?? "силно").toLocaleLowerCase("bg");
  return [
    ` Личи и от каталога ни: от ${figures.pure} продукта с обявени 100% арабика ${
      strong.products === 1 ? "1 е отнесен" : `${strong.products} са отнесени`
    } към степен „${label}“ във филтъра за интензивност.`,
  ];
}

export const arabicaRobusta: Article = {
  slug: ARABICA_ROBUSTA_SLUG,
  title: "Арабика и робуста: каква е разликата",
  description:
    "Арабика и робуста са двата вида зърна, от които се прави почти всяко кафе. Каква е разликата във вкуса и кофеина, какво значи „100% арабика“ на опаковката и какво пише за състава в каталога ни.",
  publishedAt: "2026-10-09",
  usesCatalog: true,

  body: ({ composition, landings }) => [
    p(
      "Арабика и робуста са двата вида кафеено дърво, от които идва почти цялото кафе в света. Разликата се усеща в чашата: арабиката е по-ароматна и с по-изразена киселинност, а робустата е по-горчива, по-плътна и с около два пъти повече кофеин.",
    ),
    p(
      "Нито едната не е „по-добрата“. Двете дават различно кафе, и много традиционни италиански смеси за еспресо нарочно съдържат и двете.",
    ),

    h2("Арабика"),
    p(
      "Арабиката (Coffea arabica) расте на по-голяма надморска височина и е по-чувствителна към болести и към времето. Отглежда се по-трудно и затова обикновено е по-скъпа. На нея се пада повече от половината от кафето, което се произвежда в света.",
    ),
    p(
      "Във вкуса това значи повече аромат, по-изразена киселинност и по-малко горчивина. Кофеинът в зърното е около половината от този в робустата.",
    ),

    h2("Робуста"),
    p(
      "Робуста е търговското име на вида Coffea canephora. Растението е по-издръжливо, вирее на по-малка височина и дава по-голям добив, затова обикновено е по-евтина.",
    ),
    p(
      "Във вкуса: повече горчивина, по-плътно тяло, по-малко киселинност. В еспресото робустата се цени и заради кремата, която става по-гъста и по-трайна, затова много смеси я включват нарочно.",
    ),

    h2("Разликите накратко"),
    table({
      caption: "Арабика и робуста една до друга",
      columns: ["Показател", "Арабика", "Робуста"],
      rows: [
        ["Вкус", "По-ароматна, с по-изразена киселинност", "По-горчива, с по-плътно тяло"],
        ["Кофеин", "По-малко", "Около два пъти повече"],
        ["Отглеждане", "На по-голяма височина, по-чувствителна", "По-ниско, по-издръжлива"],
        ["Цена на суровината", "Обикновено по-висока", "Обикновено по-ниска"],
      ],
      note: "Това са общи разлики между двата вида, не оценка за конкретен продукт.",
    }),

    h2("Какво значи „100% арабика“"),
    p(
      "Че в пакета има само арабика — нищо повече. Не е клас качество и не е сертификат. Две кафета от 100% арабика могат да са съвсем различни на вкус, защото вкусът зависи и от произхода, от обработката и от изпичането.",
    ),
    p(
      "Не значи и слабо кафе. Колко силно е едно кафе, зависи от изпичането и от приготвянето, не само от вида.",
      ...pureStrengthText(composition),
    ),

    h2("Кофеинът"),
    p(
      "Робустата има около два пъти повече кофеин от арабиката, така че при едно и също количество кафе смес с робуста по правило носи повече кофеин от чиста арабика. Колко кофеин има в чашата, зависи и от това колко кафе влиза в нея и как се приготвя, затова точни числа не даваме.",
    ),
    p("Изпичането не добавя кофеин: тъмно изпеченото кафе има по-силен вкус, не повече кофеин."),
    p(
      "Ако търсите кафе без кофеин, видът на зърното не е отговорът — и арабиката, и робустата съдържат кофеин. ",
      linkWhile(landingHref("decaf", landings), "Безкофеиновото кафе"),
      " е отделен продукт и в каталога е отбелязано като такова.",
    ),

    h2("Какво пише в каталога ни"),
    ...catalogSection(composition),

    h2("Как да изберете"),
    ul(
      "Ако искате по-меко кафе, без изразена горчивина, гледайте висок дял арабика.",
      "Ако искате плътно и по-горчиво еспресо с гъста крема, гледайте смесите.",
      "Ако ви трябва повече кофеин, търсете го в състава, не в тъмното изпичане.",
    ),
    p(
      "Това са ориентири, не правила: две смеси с еднакъв дял арабика могат да се различават на вкус. Съставът е едно от трите неща, по които сравняваме ",
      link(systemCategoryHref("beans"), "кафе на зърна"),
      "; другите две — изпичането и цената за килограм — са в статията „",
      link(articleHref(CHOOSE_BEANS_SLUG), "Как да изберете кафе на зърна"),
      "“.",
    ),
    p(
      "Във ",
      link(WIZARD_HREF, "въпросника"),
      " не питаме за вид, а за това как пиете кафето си. Обявеният състав влиза в подреждането само там, където наистина казва нещо за отговора ви.",
    ),
    action({ href: WIZARD_HREF, label: "Към въпросника" }),
  ],
};
