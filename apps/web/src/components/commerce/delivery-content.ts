import { formatOpeningHours, siteConfig, type CommerceConfig } from "@/config/site";
import {
  deliveryCostSentences,
  deliveryTimeSentence,
  freeDeliveryThreshold,
  paymentSentence,
  returnShippingSentence,
  withdrawalDays,
  OPENED_PACKS_EXCLUDED,
  paymentMethods,
} from "@/components/commerce/terms";

/**
 * The words of the "Доставка и плащане" page that are not legal text: the
 * ordering steps and the questions customers ask.
 *
 * Kept apart from the page so they can be tested as data, and built from the
 * same sentences as the terms so an answer here cannot say something the terms
 * do not. A question whose answer depends on an unset term is left out — an
 * FAQ that answers "we will tell you" is not answering.
 */

export interface FaqEntry {
  readonly question: string;
  readonly answer: string;
}

/** How an order happens, in order. Always three steps; the wording follows the config. */
export function orderingSteps(commerce: CommerceConfig = siteConfig.commerce): readonly string[] {
  const hours = formatOpeningHours(commerce.openingHours);
  const payment = paymentSentence(commerce);

  return [
    "Сложете в количката кафето, което искате (или натиснете „Поръчай“ на страницата му), и изпратете заявката с име, телефон и къде да доставим. Без регистрация и без плащане на сайта: в този момент нищо не се таксува и нищо не се изпраща.",
    `Обаждаме ви се${hours ? ` в работно време (${hours})` : ""}, за да потвърдим наличността, крайната сума и доставката. Поръчка има едва след този разговор.`,
    ["Получавате пратката, както сме се уговорили.", payment].filter(Boolean).join(" "),
  ];
}

export function deliveryFaq(commerce: CommerceConfig = siteConfig.commerce): readonly FaqEntry[] {
  const hours = formatOpeningHours(commerce.openingHours);
  const time = deliveryTimeSentence(commerce);
  const payment = paymentSentence(commerce);
  const returnShipping = returnShippingSentence(commerce);

  const entries: Array<FaqEntry | null> = [
    {
      question: "Трябва ли да се регистрирам или да платя на сайта?",
      answer:
        "Не. На сайта няма регистрация и плащане. Изпращате заявка от количката с име, телефон и къде да доставим, а ние ви се обаждаме, за да я потвърдим.",
    },
    hours
      ? {
          question: "Кога ще ми се обадите?",
          answer: `В работно време: ${hours}.`,
        }
      : null,
    {
      question: "Колко струва доставката?",
      answer: deliveryCostSentences(commerce).join(" "),
    },
    time ? { question: "Кога ще получа поръчката?", answer: time } : null,
    payment
      ? {
          question: "Как се плаща?",
          answer:
            paymentMethods(commerce).length > 1
              ? `${payment} Избирате по време на обаждането.`
              : payment,
        }
      : null,
    {
      question: "Мога ли да поръчам няколко продукта наведнъж?",
      answer: [
        "Да. Добавете ги в количката и изпратете една заявка — обаждаме ви се веднъж, за цялата поръчка.",
        freeDeliveryThreshold(commerce)
          ? "Сумата за безплатна доставка се смята за цялата поръчка."
          : null,
      ]
        .filter(Boolean)
        .join(" "),
    },
    {
      question: "Мога ли да върна поръчката?",
      answer: [
        `Да. Може да се откажете от поръчката в срок от ${withdrawalDays(commerce)} дни от получаването ѝ, без да посочвате причина.`,
        returnShipping,
        OPENED_PACKS_EXCLUDED,
        "Подробностите са в Общите условия.",
      ]
        .filter(Boolean)
        .join(" "),
    },
  ];

  return entries.filter((entry): entry is FaqEntry => entry !== null);
}
