import { GRAMS_PER_SERVING, packServings } from "@catalog/shared";
import type { CupRange, PricedPack } from "@/lib/catalog/journal-figures";
import { pluralize } from "@/lib/catalog/format";
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
import { relatedCopy } from "../../landing-copy";
import { CAPSULES_HREF, WIZARD_HREF, landingHref, productHref, systemCategoryHref } from "../links";

/**
 * What a cup really costs.
 *
 * There is not one price in this file. Every amount the article prints comes
 * out of `figures.cupCost`, which is computed from the live catalog with the
 * shared serving helpers; the grams-per-cup assumption is read from the same
 * constant the wizard ranks by. Where the catalog cannot supply a figure the
 * paragraph that would have quoted it is replaced by one that makes the same
 * point in words, so the article is complete either way.
 */

export const CUP_COST_SLUG = "kolko-struva-edna-chasha-kafe";

/** "капсули" for a capsule system, "дози" for pods, "чаши" for beans. */
function unitsOf(pack: PricedPack): string {
  if (pack.system.method === "pod") return pluralize(pack.servings, "доза", "дози");
  if (pack.system.method === "capsule") return pluralize(pack.servings, "капсула", "капсули");
  return `около ${pluralize(pack.servings, "чаша", "чаши")}`;
}

/** How to say that two packs are for the same machine. */
function sameSystemText(pack: PricedPack): string {
  if (pack.system.method === "capsule") return `с капсули за ${pack.system.name}`;
  return pack.system.method === "pod" ? "с хартиени дози ESE" : "на зърна";
}

/** "от X до Y" — or just "X" when the range is a single price. */
export function rangeText(range: CupRange): string {
  return range.cheapest.perCup === range.dearest.perCup
    ? range.cheapest.perCup
    : `от ${range.cheapest.perCup} до ${range.dearest.perCup}`;
}

const packLine = (pack: PricedPack): Inline[] => [
  link(productHref(pack.slug), pack.name),
  ` — ${unitsOf(pack)} за ${pack.packPrice}, тоест ${pack.perCup} на чаша`,
];

export const cupCost: Article = {
  slug: CUP_COST_SLUG,
  title: "Колко струва една чаша кафе всъщност",
  description:
    "Цената на опаковката подвежда, защото опаковките са различни. Цената на чаша не подвежда. Как се смята при зърна, капсули и дози и какво показва за асортимента ни.",
  publishedAt: "2026-10-09",
  usesCatalog: true,

  body: ({ cupCost: figures, landings }) => {
    const reversal = figures?.reversal ?? null;
    const beans = figures?.byMethod.beans ?? null;
    const capsules = figures?.byMethod.capsule ?? null;
    const pods = figures?.byMethod.pod ?? null;

    /* From the shared helper, not typed: the number of cups the article says a
       kilogram holds is the number the wizard would compute for the same bag. */
    const cupsPerKilogram = packServings("1000", "g")?.whole ?? null;

    const example: Block[] = reversal
      ? [
          p(
            `Ето два продукта от каталога ни в момента, и двата ${sameSystemText(reversal.bigger)}:`,
          ),
          ul(packLine(reversal.bigger), packLine(reversal.smaller)),
          p(
            "По цена на опаковката първият е по-скъпият. На чаша е по-евтиният. Който сравнява по цената на опаковката, подрежда двата точно наобратно.",
          ),
        ]
      : [
          p(
            "Голямата опаковка струва повече, а на чаша може да излезе по-евтина; малката изглежда изгодна, без непременно да е. По цената на опаковката това не личи.",
          ),
        ];

    const current: Block[] = [];
    if (figures && figures.bySystem.length > 0) {
      current.push(
        p("Това излиза, като се приложи същата сметка към цените в каталога ни в момента:"),
        table({
          caption: "Цена на чаша по системи",
          columns: ["Система", "Продукти с цена", "На чаша"],
          // Each system's name is the way into its listing: the article
          // explains the number, the listing is where it is compared.
          rows: figures.bySystem.map(({ system, range }) => [
            link(systemCategoryHref(system.id), system.name),
            String(range.count),
            rangeText(range),
          ]),
          note: "Числата се смятат от текущите цени при всяко обновяване на каталога. Знакът ≈ значи приблизително: при зърната броят чаши зависи от машината.",
        }),
      );

      const lines: string[][] = [];
      if (beans) lines.push([`Зърната излизат ${rangeText(beans)} на чаша.`]);
      if (capsules) lines.push([`Капсулите — ${rangeText(capsules)}.`]);
      if (pods) lines.push([`Дозите — ${rangeText(pods)}.`]);
      if (lines.length > 1) current.push(p(lines.flat().join(" ")));
    } else {
      current.push(
        p(
          "Точните числа зависят от текущите цени, затова не ги пишем тук наизуст. Във въпросника всяко предложение идва със своята цена на чаша, сметната от цената в момента.",
        ),
      );
    }

    /* The listing this article explains: the cheapest per cup in each system.
       Linked only while it has something to list, with or without the table. */
    const cheapest = landingHref("cheapest", landings);
    if (cheapest) {
      current.push(
        p(
          "Продуктите с най-ниска цена на чаша във всяка система са събрани на страницата „",
          link(cheapest, relatedCopy.cheapest),
          "“.",
        ),
      );
    }

    return [
      p(
        "Цената на опаковката е първото, което се вижда, и последното, по което си струва да се сравнява кафе. Опаковките са различни — десет капсули, сто капсули, килограм зърна — и сравнението има смисъл едва когато се сведе до една чаша.",
      ),

      h2("Защо цената на опаковката подвежда"),
      ...example,

      h2("Как се смята цената на чаша"),
      p(
        "При капсулите и дозите сметката е точна. Една капсула е една чаша, значи цената на кутията се дели на броя в нея.",
      ),
      p(
        `При зърната е приблизителна. Смятаме по ${GRAMS_PER_SERVING} грама кафе на чаша — италианската мярка за еспресо.`,
        ...(cupsPerKilogram
          ? [` По нея килограм зърна е около ${pluralize(cupsPerKilogram, "чаша", "чаши")}.`]
          : []),
        " Колко точно ще отиде във вашата чаша зависи от машината и от това как пиете кафето, не от пакета. Затова при зърната пишем знака ≈ пред цената на чаша и не я представяме за точно число.",
      ),

      p(
        "Не се налага да я смятате сами: цената на чаша стои до цената на опаковката при всеки продукт — в ",
        ...sentenceList([
          [link(CAPSULES_HREF, "кафе капсули")],
          [link(systemCategoryHref("beans"), "кафе на зърна")],
          [link(systemCategoryHref("ese-pod"), "кафе дози")],
        ]),
        ".",
      ),

      h2("Какво излиза в момента"),
      ...current,

      h2("Какво не казва цената на чаша"),
      p(
        "Ниската цена на чаша може да идва просто от голямата опаковка. Това е изгодно, ако ще я изпиете: при една-две чаши на ден голямата кутия ще ви стигне за дълго, така че сметнете за колко време, преди да посегнете към най-голямата.",
      ),
      p(
        "И второ: цената на чаша сравнява разхода, не вкуса. Нямаме основание да твърдим, че по-скъпото кафе е по-добро, и затова не го твърдим.",
      ),
      p(
        "Във ",
        link(WIZARD_HREF, "въпросника"),
        " питаме колко кафе пиете на ден и сравняваме по цена на чаша спрямо останалите продукти за същата система, не по цена на кутията.",
      ),
      action({ href: WIZARD_HREF, label: "Кое кафе е за вас" }),
    ];
  },
};
