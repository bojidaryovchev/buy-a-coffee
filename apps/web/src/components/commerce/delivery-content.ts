import { formatOpeningHours, siteConfig, type CommerceConfig } from "@/config/site";
import {
  deliveryCostSentences,
  deliveryTimeSentence,
  freeDeliveryThreshold,
  paymentSentence,
  returnShippingSentence,
  withdrawalDays,
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
    "Намерете кафето, което искате, и оставете телефонния си номер на страницата му. Без регистрация и без количка — в този момент нищо не се таксува и нищо не се изпраща.",
    `Обаждаме ви се${hours ? ` в работно време (${hours})` : ""}, за да потвърдим наличността и крайната сума и да уговорим доставката. Поръчка има едва след този разговор.`,
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
        "Не. На сайта няма регистрация, количка и плащане. Оставяте само телефонен номер и ние ви се обаждаме.",
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
          answer: `${payment} Избирате по време на обаждането.`,
        }
      : null,
    {
      question: "Мога ли да поръчам няколко продукта наведнъж?",
      answer: [
        "Да. Оставете заявка за един от тях и опишете останалите в бележката към нея — или ни ги кажете, когато се обадим.",
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
        "За някои стоки законът предвижда изключения — описани са в Общите условия.",
      ]
        .filter(Boolean)
        .join(" "),
    },
  ];

  return entries.filter((entry): entry is FaqEntry => entry !== null);
}
