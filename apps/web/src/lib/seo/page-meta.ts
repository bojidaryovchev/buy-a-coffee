import { siteConfig, type CommerceConfig } from "@/config/site";
import { joinList, paymentMethods, withdrawalDays } from "@/components/commerce/terms";
import { fitDescription } from "./description";

/**
 * Titles and meta descriptions of the pages that are not listings: contact,
 * the three legal documents and the journal's index.
 *
 * Their own, and written for a search result. These pages used to describe
 * themselves with the one-line summaries the documents open with („Как работи
 * поръчването през този сайт.“, „Свържете се с Buy a Coffee.“) — true, and
 * too short to say anything a searcher could choose by. The documents keep
 * those summaries on the page; this is what a result shows.
 *
 * Nothing typed here is a figure. The phone, the hours, the days to withdraw
 * and the ways to pay are read from `siteConfig`, as the pages print them.
 */

export interface PageMeta {
  /** Before the shop's name, which `pageTitle` adds while it fits. */
  readonly title: string;
  readonly description: string;
}

export function contactMeta(): PageMeta {
  const { phone, email, hours } = siteConfig.contact;
  return {
    title: "Контакти: телефон, имейл и работно време",
    description: fitDescription(
      `Телефон ${phone}${hours ? ` (${hours})` : ""} и имейл ${email}.`,
      "Обадете се или пишете за поръчка, наличност или въпрос за кафето.",
    ),
  };
}

export function termsMeta(commerce: CommerceConfig = siteConfig.commerce): PageMeta {
  const payment = paymentMethods(commerce).map((method) => method.label);
  return {
    title: "Общи условия",
    description: fitDescription(
      `Как се поръчва в ${siteConfig.name}: заявка с телефон, ние се обаждаме и потвърждаваме.`,
      payment.length > 0 ? `Плащане: ${joinList(payment)}.` : null,
      `${withdrawalDays(commerce)} дни право на отказ, доставка и рекламации.`,
    ),
  };
}

export function privacyMeta(): PageMeta {
  return {
    title: "Политика за поверителност",
    description:
      "Какви лични данни събираме при поръчка, абонамент за бюлетина и съобщение, на какво основание, колко дълго ги пазим и как да упражните правата си.",
  };
}

export function cookiesMeta(): PageMeta {
  return {
    title: "Бисквитки",
    description:
      "Сайтът не поставя бисквитки — нито рекламни, нито аналитични. В браузъра ви остава само количката, и то едва когато добавите продукт в нея.",
  };
}

/**
 * The journal's index. The page's heading stays „Блог“, the section's name
 * (`JOURNAL_NAME`); the title says what is in it, without a listing's head
 * term — those belong to the listings (`docs/seo.md` §1).
 */
export const JOURNAL_META: PageMeta = {
  title: "Блог за кафе: съвети за капсули, зърна и цена на чаша",
  description:
    "Видове капсули, как се избира кафе на зърна, арабика и робуста, цена на чаша — отговори на въпросите, които изникват преди поръчка.",
};
