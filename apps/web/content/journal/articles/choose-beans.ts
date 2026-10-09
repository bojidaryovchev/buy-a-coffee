import { GRAMS_PER_SERVING, packServings } from "@catalog/shared";
import { pluralize } from "@/lib/catalog/format";
import type { BeanFigures, CupRange, FormatSummary } from "@/lib/catalog/journal-figures";
import {
  action,
  h2,
  link,
  ol,
  p,
  sentenceList,
  type Article,
  type Block,
  type Inline,
} from "../blocks";
import { relatedCopy } from "../../landing-copy";
import {
  VENDING_HREF,
  WIZARD_HREF,
  articleHref,
  landingHref,
  linkWhile,
  systemCategoryHref,
} from "../links";
import { shareBreakdown } from "./arabica-robusta";
import { CUP_COST_SLUG, rangeText } from "./cup-cost";
import { INTENSITY_SLUG } from "./intensity";
import { ARABICA_ROBUSTA_SLUG, CHOOSE_BEANS_SLUG } from "./slugs";

/**
 * How to choose coffee beans.
 *
 * The queries behind this article are „най-доброто кафе на зърна“ and „хубаво
 * кафе на зърна“, and the honest answer to both is that this shop cannot rank
 * its coffees: it has no ratings and no cupping scores (`PRODUCT.md`, "No
 * quality ranking"). So the article says that first, and then gives the three
 * things a buyer can compare without one — composition, roast, and the price
 * for a kilogram.
 *
 * Every count and every price is read from `figures.beans`: how many bags
 * state an arabica share or a roast, and the range of prices for a kilogram.
 * Where the catalog states little — and for roast it states very little — the
 * article says how little, instead of writing as if every bag were described.
 * Each paragraph that quotes a figure has a version that makes the same point
 * without it.
 */

export { CHOOSE_BEANS_SLUG };

/** ", при нас от 250 г, 500 г и 1 кг" — the pack sizes on sale, when known. */
function packsText(summary: FormatSummary | null): Inline[] {
  if (!summary || summary.packs.length < 2) return [];
  return [" — при нас от ", ...sentenceList([...summary.packs])];
}

function compositionText(beans: BeanFigures | null): Block {
  if (!beans) {
    return p(
      "Делът арабика пише на реда „Състав“ в характеристиките на продукта, когато е обявен. Където не е обявен, не го предполагаме.",
    );
  }
  const { composition } = beans;
  const have = `В момента имаме ${pluralize(beans.products, "продукт", "продукта")} на зърна.`;
  if (composition.declared === 0) {
    return p(
      have,
      " При нито един от тях делът арабика не е обявен, затова не предполагаме какъв е.",
    );
  }
  return p(
    have,
    ` Делът арабика е обявен при ${composition.declared} от тях: ${shareBreakdown(composition)}.`,
    ...(composition.declared < composition.products
      ? [" При останалите съставът не е обявен и не го предполагаме."]
      : []),
  );
}

function roastText(beans: BeanFigures | null): Block {
  if (!beans || beans.roast.declared === 0) {
    return p(
      "Степента на изпичане пише на реда „Изпичане“ в характеристиките на продукта, когато е обявена. Когато не е, не я предполагаме.",
    );
  }
  const levels = beans.roast.levels.map((level) => `${level.label} (${level.products})`);
  return p(
    `Степента на изпичане е обявена при ${beans.roast.declared} от ${pluralize(beans.products, "продукт", "продукта")} на зърна в каталога ни: `,
    ...sentenceList(levels),
    ".",
    ...(beans.roast.declared < beans.products
      ? [" При останалите не е посочена и не я предполагаме."]
      : []),
  );
}

function priceText(beans: BeanFigures | null, perCup: CupRange | null): Block[] {
  const range = beans?.perKilogram ?? null;
  if (!range) return [];
  const { cheapest, dearest } = range;
  return [
    p(
      cheapest.perKilogram === dearest.perKilogram
        ? `В момента кафето на зърна в каталога ни струва ${cheapest.perKilogram} за килограм.`
        : `В момента кафето на зърна в каталога ни струва от ${cheapest.perKilogram} до ${dearest.perKilogram} за килограм.`,
      ...(perCup
        ? [
            ` На чаша това прави ${rangeText(perCup)} — приблизително, защото смятаме по ${GRAMS_PER_SERVING} грама на чаша, а колко отива във вашата, зависи от машината.`,
          ]
        : []),
    ),
  ];
}

export const chooseBeans: Article = {
  slug: CHOOSE_BEANS_SLUG,
  title: "Как да изберете кафе на зърна",
  description:
    "На въпроса „кое е най-доброто кафе на зърна“ няма един отговор — има кафе, което подхожда на начина, по който го пиете. Как да изберете по състав, изпичане и цена за килограм.",
  publishedAt: "2026-10-09",
  usesCatalog: true,

  body: ({ beans, formats, cupCost, landings }) => {
    /* From the shared helper, as in the cup-cost article: the number of cups
       a kilogram holds is the number the wizard would compute for the bag. */
    const cupsPerKilogram = packServings("1000", "g")?.whole ?? null;
    const decaf = beans?.decaf ?? 0;
    const cheapest = landingHref("cheapest", landings);

    return [
      p(
        "Класация на кафетата тук няма, и не защото избягваме да я направим. Нямаме оценки от дегустации, по които да подреждаме по качество, а по-скъпото не е непременно по-хубавото.",
      ),
      p(
        "Честно могат да се сравнят три неща: от какво е сместа, как е изпечена и колко струва килограмът. По тях хубавото кафе на зърна за вас се намира по-лесно, отколкото по класация.",
      ),

      h2("Съставът: арабика, робуста или смес"),
      p(
        "Кафето на зърна е или от един вид, или смес от два — арабика и робуста. Арабиката по правило е по-ароматна и с по-изразена киселинност, а робустата е по-горчива, с по-плътно тяло и с повече кофеин. Затова „100% арабика“ описва състава, а не качеството: казва какъв вкус да очаквате, не колко добро е кафето.",
      ),
      compositionText(beans),
      ...(decaf > 0
        ? [
            p(
              "Ако не искате кофеин, не го търсете в състава: и двата вида го съдържат. Сред зърната има и ",
              linkWhile(landingHref("decaf", landings), "кафе без кофеин"),
              ` — в момента ${pluralize(decaf, "продукт", "продукта")}.`,
            ),
          ]
        : []),
      p(
        "Повече за двата вида има в статията „",
        link(articleHref(ARABICA_ROBUSTA_SLUG), "Арабика и робуста: каква е разликата"),
        "“.",
      ),

      h2("Изпичането"),
      p(
        "Колкото по-тъмно е изпечено кафето, толкова повече се усеща самото изпичане: повече горчивина, по-малко киселинност. По-светлото изпичане запазва повече от киселинността и от собствения аромат на зърното. Нито едното не е по-добро — въпросът е кое ви харесва. Тъмното изпичане прави вкуса по-силен, но не добавя кофеин.",
      ),
      roastText(beans),
      p(
        "Отделно от изпичането производителите обявяват и интензивност — свое число по своя скала. Какво казва то и какво не, пише в ",
        link(articleHref(INTENSITY_SLUG), "как се чете числото за интензивност"),
        ".",
      ),

      h2("Цената за килограм"),
      p(
        "Кафето на зърна се продава в различни опаковки",
        ...packsText(formats?.byMethod.beans ?? null),
        ", затова цените на пакетите не се сравняват пряко. Сравнява се цената за килограм. Тя е точно число, защото и теглото, и цената са известни, и стои до цената на пакета на страницата на всеки продукт на зърна.",
      ),
      ...priceText(beans, cupCost?.byMethod.beans ?? null),
      p(
        "По-високата цена за килограм не доказва по-добро кафе. Тя е повод да прочетете какво още пише за продукта — състав, произход, изпичане — и да решите дали то е важно за вас.",
      ),
      p(
        "Ако водеща за вас е цената, сравнявайте по цена за килограм или на чаша, а не по цена на пакета. Как се смята втората, пише в ",
        link(articleHref(CUP_COST_SLUG), "колко струва една чаша кафе"),
        ".",
        ...(cheapest
          ? [
              " Кое кафе излиза най-евтино на чаша в момента, показва страницата „",
              link(cheapest, relatedCopy.cheapest),
              "“.",
            ]
          : []),
      ),

      h2("За каква машина е"),
      p(
        "Кафето на зърна е за машина с мелачка: автоматична кафемашина (кафеавтомат), която мели сама, или отделна мелачка към еспресо машина. Марката на машината няма значение — при зърната няма системи, както при капсулите.",
      ),
      p(
        "За вендинг автомат или заведение, където се пие много, има отделна страница — ",
        link(VENDING_HREF, "кафе за вендинг машини"),
        ".",
      ),

      h2("Колко да купите"),
      p(
        "Цялото зърно пази аромата си по-дълго от мляното, но не безкрайно: след отварянето пакетът постепенно го губи. Дръжте кафето затворено, на сухо и тъмно място, и купувайте толкова, колкото ще изпиете за няколко седмици.",
      ),
      p(
        ...(cupsPerKilogram
          ? [
              `При ${GRAMS_PER_SERVING} грама на чаша килограм зърна стига за около ${pluralize(cupsPerKilogram, "чаша", "чаши")}. `,
            ]
          : []),
        "Сметнете за колко време ще ви стигне пакетът, преди да изберете размера. Ако кафето е непознато, започнете с по-малка опаковка, когато има такава.",
      ),

      h2("Накратко, стъпка по стъпка"),
      ol(
        "Решете как пиете кафето: само или с мляко, и по колко чаши на ден.",
        "Вижте състава, ако е обявен. Повече арабика значи повече аромат и киселинност; смес с робуста — повече горчивина, плътност и кофеин.",
        "Вижте изпичането и интензивността, ако са обявени, и четете интензивността заедно със скалата ѝ.",
        "Сравнете по цена за килограм, не по цена на пакета.",
      ),
      p(
        "Целият избор е в категорията ",
        link(systemCategoryHref("beans"), "кафе на зърна"),
        ". Ако предпочитате да отговорите на няколко въпроса, вместо да четете характеристики, въпросникът предлага три кафета според отговорите ви и казва защо е избрал всяко.",
      ),
      action(
        { href: systemCategoryHref("beans"), label: "Към кафето на зърна" },
        { href: WIZARD_HREF, label: "Към въпросника" },
      ),
    ];
  },
};
