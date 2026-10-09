import { STRENGTH_LABELS } from "@/lib/catalog/attributes";
import { pluralize } from "@/lib/catalog/format";
import { TASTE_OPTIONS } from "@/lib/recommend/answers";
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
import { CAPSULES_HREF, WIZARD_HREF, productHref, systemCategoryHref } from "../links";

/**
 * How to read an intensity number.
 *
 * Which scales exist, how many products sit on each, and which numeral shows
 * the problem best are all read from the catalog — the scales in use are a
 * property of what is on sale this week, not of this text. The reasoning about
 * what the number means for choosing is the wizard's own, from
 * `docs/decisions.md`: compare the position on the scale, never the numeral.
 *
 * What is deliberately absent: any account of what "intensity" measures in the
 * cup. The source publishes a number and a scale and nothing else, so that is
 * all the article claims to know.
 */

export const INTENSITY_SLUG = "kak-se-chete-intenzivnostta-na-kafeto";

export const intensity: Article = {
  slug: INTENSITY_SLUG,
  title: "Как се чете числото за интензивност на кафето",
  description:
    "Едно и също число не значи едно и също при две марки: производителите обявяват интензивност по различни скали. Какво казва числото, какво не казва и как да избирате по него.",
  publishedAt: "2026-10-09",
  usesCatalog: true,

  body: ({ intensity: figures }) => {
    const scales = figures?.scales ?? [];
    const numeral = figures?.sameNumeral ?? null;
    const decaf = figures?.decafWithIntensity ?? null;

    const scaleSection: Block[] =
      figures && scales.length > 1
        ? [
            p(
              `В каталога ни в момента ${pluralize(figures.declared, "продукт има", "продукта имат")} обявена интензивност и тя е по ${pluralize(scales.length, "скала", "различни скали")}: до `,
              ...sentenceList(scales.map((scale) => String(scale.max))),
              ".",
            ),
            table({
              caption: "Скали за интензивност в каталога",
              columns: ["Скала", "Продукти", "Марки"],
              rows: scales.map((scale) => [
                `до ${scale.max}`,
                String(scale.products),
                scale.brands.length > 0 ? scale.brands.join(", ") : "—",
              ]),
            }),
            ...(figures.mixedBrands.length > 0
              ? [
                  p(
                    "Скалата не е постоянна дори в рамките на една марка. При ",
                    ...sentenceList(figures.mixedBrands.map((brand) => brand.name)),
                    " различните продукти са по различни скали, така че и името на марката не казва по коя скала е числото.",
                  ),
                ]
              : []),
          ]
        : [
            p(
              "Едни производители броят до малко число, други до десет, трети продължават и над десет. Обща скала няма и никой не е длъжен да се придържа към чужда.",
            ),
          ];

    const numeralSection: Block[] = numeral
      ? [
          p(`Вземете числото ${numeral.value}. В каталога ни то стои на ето тези места:`),
          ul(
            ...numeral.readings.map(
              (reading) => `${numeral.value} от ${reading.max} — ${reading.percent}% от скалата`,
            ),
          ),
          p(
            `Числото е едно и също, а мястото му на скалата — не. Затова го четете винаги заедно със скалата: „${numeral.value} от ${numeral.readings[0]!.max}“, никога само „${numeral.value}“.`,
          ),
        ]
      : [
          p(
            "Едно и също число може да е на върха на една скала и в средата на друга. Затова го четете винаги заедно със скалата — „толкова от толкова“, никога само първото число.",
          ),
        ];

    const caffeine: Inline[] = [
      "Не казва колко кофеин има в кафето. Кофеинът е отделна характеристика и в каталога я показваме отделно.",
      ...(decaf
        ? [
            ` Че двете не са едно и също, личи от самия каталог: в него има кафе без кофеин с обявена интензивност ${decaf.declared} — `,
            link(productHref(decaf.slug), decaf.name),
            ".",
          ]
        : []),
    ];

    const strengths = figures?.strengths ?? [];
    const strengthList =
      strengths.length > 0
        ? strengths
            .map(
              (step) =>
                `${(STRENGTH_LABELS[step.key] ?? step.key).toLocaleLowerCase("bg")} (${step.products})`,
            )
            .join(", ")
        : null;

    return [
      p(
        "Числото за интензивност върху опаковката изглежда като оценка, която може да се сравнява между марките. Не може. Няма обща скала: всеки производител брои по своя.",
      ),

      h2("Скалите са различни"),
      ...scaleSection,

      h2("Едно число, различно място на скалата"),
      ...numeralSection,

      h2("Какво казва числото"),
      p(
        "Числото е на производителя: той го обявява и той решава какво значи. Показваме го така, както е обявено, заедно със скалата, и не го превръщаме в своя оценка.",
      ),
      p(
        "Полезно е вътре в една скала. Две кафета на една марка, обявени по една и съща скала, се подреждат едно спрямо друго: по-високото число е по-интензивното от двете според този, който ги е произвел.",
      ),

      h2("Какво не казва"),
      ul(
        caffeine,
        "Не е оценка за качество. По-високото число не значи по-добро кафе.",
        "Не се пренася между скали. Сравнявайте мястото на скалата, не самото число.",
        figures && figures.undeclared > 0
          ? `Липсата на число не значи слабо кафе. ${pluralize(figures.undeclared, "продукт в каталога ни няма", "продукта в каталога ни нямат")} обявена интензивност — тя просто не е посочена.`
          : "Липсата на число не значи слабо кафе — значи само, че интензивност не е посочена.",
      ),

      h2("Как да избирате тогава"),
      p(
        "В каталога продуктите са отнесени и към три степени, по които може да се филтрира независимо от скалата на производителя",
        ...(strengthList ? [`: ${strengthList}`] : []),
        ". Филтърът „Интензивност“ стои във всяка категория — ",
        ...sentenceList([
          [link(CAPSULES_HREF, "кафе капсули")],
          [link(systemCategoryHref("beans"), "кафе на зърна")],
          [link(systemCategoryHref("ese-pod"), "кафе дози")],
        ]),
        ".",
      ),
      p(
        "Във ",
        link(WIZARD_HREF, "въпросника"),
        " не питаме за число, а за ситуация: ",
        ...sentenceList(
          TASTE_OPTIONS.map((option) => `„${option.label.toLocaleLowerCase("bg")}“`),
          "или",
        ),
        ". Причината е, че „силно“ за един значи много кофеин, а за друг — горчиво, докато описаната ситуация се разбира еднакво. После сравняваме къде стои всяко кафе на собствената си скала, а не самото число.",
      ),
      action({ href: WIZARD_HREF, label: "Към въпросника" }),
    ];
  },
};
