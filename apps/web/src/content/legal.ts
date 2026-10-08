import { siteConfig, type CommerceConfig } from "@/config/site";
import {
  couriersSentence,
  deliveryCostSentences,
  deliveryFee,
  deliveryTime,
  deliveryTimeSentence,
  freeDeliveryThreshold,
  paymentSentence,
  returnShippingSentence,
  withdrawalDays,
} from "@/components/commerce/terms";

/**
 * Legal and policy content.
 *
 * Written for this business from scratch. Nothing here is copied from the
 * reference site.
 *
 * These are **drafts, not legal advice**. They describe how the storefront
 * actually behaves — what data the forms collect, how long it is kept, who it
 * is shared with — which is the part an engineer can state accurately. The
 * wording specific to Bulgarian law still needs a lawyer's review before
 * launch, and every page says so plainly rather than pretending otherwise.
 *
 * The copy is Bulgarian because the shop sells only in Bulgaria. A paragraph
 * that begins with `REVIEW_MARKER` is an open question, not legal text:
 * `legal-document.tsx` renders it as a visible callout, the delivery page
 * leaves it out, and `pnpm check:launch` fails while one remains.
 *
 * The delivery, payment and withdrawal sections are not written here by hand.
 * They are generated from `siteConfig.commerce`, and the delivery page prints
 * the same generated sections — so the two cannot state different terms, and
 * changing a number in the config changes both.
 */

/** Opens a paragraph that still needs an answer from the business or a lawyer. */
export const REVIEW_MARKER = "ЗА ПРЕГЛЕД";

export function isReviewParagraph(paragraph: string): boolean {
  return paragraph.startsWith(REVIEW_MARKER);
}

export interface LegalSection {
  readonly heading: string;
  readonly paragraphs: readonly string[];
  readonly bullets?: readonly string[];
}

export interface LegalDocument {
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly needsReview: boolean;
  readonly sections: readonly LegalSection[];
}

const contactLine = `${siteConfig.contact.email} или ${siteConfig.contact.phone}`;

/**
 * The paragraphs and bullets of a document that are still open questions.
 * Bullets are included because nothing stops a marker being written into one,
 * and a check that only looked at paragraphs would wave it through.
 */
export function openReviewItems(document: LegalDocument): readonly string[] {
  return document.sections.flatMap((section) =>
    [...section.paragraphs, ...(section.bullets ?? [])].filter(isReviewParagraph),
  );
}

/** A section as a customer should read it: the open questions left out. */
export function settledParagraphs(section: LegalSection): readonly string[] {
  return section.paragraphs.filter((paragraph) => !isReviewParagraph(paragraph));
}

/* --- Generated from the commercial terms -------------------------------- */

const CONFIRMED_ON_THE_CALL =
  "Общата сума, включително доставката, потвърждаваме с вас по телефона, преди поръчката да бъде приета — така че никога не поемате задължение за сума, която не сте чули.";

/**
 * Delivery.
 *
 * States what the config can support and nothing more. While the fee or the
 * delivery time is missing, the customer-facing sentence says — truthfully —
 * that it is agreed on the confirmation call, and a marker records that the
 * number itself still has to be written down before launch.
 */
export function deliverySection(commerce: CommerceConfig = siteConfig.commerce): LegalSection {
  const couriers = couriersSentence(commerce);
  const time = deliveryTimeSentence(commerce);

  const missing: string[] = [];
  if (!deliveryFee(commerce)) {
    missing.push(
      freeDeliveryThreshold(commerce)
        ? "цената на доставката за поръчки под прага за безплатна доставка"
        : "цената на доставката",
    );
  }
  if (!deliveryTime(commerce)) missing.push("срокът за доставка");

  return {
    heading: "Доставка",
    paragraphs: [
      ["Доставяме на територията на България.", couriers].filter(Boolean).join(" "),
      [...deliveryCostSentences(commerce), CONFIRMED_ON_THE_CALL].join(" "),
      time ?? "Срока на доставката уговаряме с вас по телефона, когато потвърждаваме поръчката.",
      ...(missing.length > 0
        ? [
            `${REVIEW_MARKER}: още не е потвърдено от търговеца и трябва да бъде изписано тук с конкретни числа преди пускането на сайта: ${missing.join("; ")}. Общата цена, включително доставката, трябва да е известна на потребителя, преди да се обвърже с поръчката.`,
          ]
        : []),
    ],
  };
}

/**
 * Payment. Null when no method is configured: the terms then say nothing about
 * payment beyond what "Как работи поръчването" already states, rather than
 * naming a method the shop may not accept.
 */
export function paymentSection(
  commerce: CommerceConfig = siteConfig.commerce,
): LegalSection | null {
  const sentence = paymentSentence(commerce);
  if (!sentence) return null;
  return {
    heading: "Плащане",
    paragraphs: [
      `${sentence} Начина на плащане избирате по време на обаждането, с което потвърждаваме поръчката.`,
      "На сайта не се плаща и не се въвеждат данни за карта или банкова сметка.",
    ],
  };
}

/**
 * The right of withdrawal.
 *
 * The period comes from the config and never drops below the statutory one;
 * the 14 days for the refund are a separate, fixed deadline set by the law and
 * do not follow the configured window.
 */
export function withdrawalSection(commerce: CommerceConfig = siteConfig.commerce): LegalSection {
  const days = withdrawalDays(commerce);
  const returnShipping = returnShippingSentence(commerce);

  return {
    heading: "Право на отказ",
    paragraphs: [
      `Тъй като поръчката се сключва от разстояние, като потребител имате право да се откажете от нея в срок от ${days} дни, без да посочвате причина. Срокът тече от деня, в който получите стоката.`,
      "За да упражните правото си, е достатъчно да ни уведомите с недвусмислено заявление — обаждане или имейл на посочените по-долу контакти — преди срокът да е изтекъл. Може да използвате и стандартния формуляр за отказ, но не сте длъжни.",
      "Възстановяваме всички получени от вас суми, включително разходите за доставка, не по-късно от 14 дни от уведомлението. Може да задържим възстановяването, докато не получим стоката обратно или докато не представите доказателство, че сте я изпратили.",
      returnShipping ??
        `${REVIEW_MARKER}: трябва да бъде решено и изписано изрично кой поема разходите за връщане на стоката. Това е търговско решение, не техническо.`,
      `${REVIEW_MARKER}: стандартният формуляр за отказ трябва да бъде приложен като отделен документ.`,
    ],
  };
}

export const privacyPolicy: LegalDocument = {
  slug: "privacy",
  title: "Политика за поверителност",
  summary: "Какви данни събираме, защо и колко дълго ги пазим.",
  needsReview: true,
  sections: [
    {
      heading: "Какво обхваща тази политика",
      paragraphs: [
        `Тази политика обяснява как ${siteConfig.name} обработва личните данни, събрани през този сайт.`,
      ],
    },
    {
      heading: "Какво събираме",
      paragraphs: ["Сайтът събира данни на точно три места и никъде другаде."],
      bullets: [
        "Заявки за поръчка: вашият телефонен номер и по желание име, имейл адрес, количество и бележка. Това е единственият начин за поръчка — на сайта няма количка и не се извършват плащания.",
        "Бюлетин: вашият имейл адрес, както и часът и страницата, от която сте се абонирали — така документираме съгласието ви.",
        "Форма за контакт: вашето име, имейл адрес, телефон по желание и текстът на съобщението ви.",
      ],
    },
    {
      heading: "Какво не събираме",
      paragraphs: [
        "На този сайт не приемаме плащания, така че данни за карта или банкова сметка никога не се въвеждат и не се съхраняват. Не съхраняваме вашия IP адрес: за ограничаване на честотата на заявките пазим само необратим хеш със сол, от който адресът не може да бъде възстановен.",
      ],
    },
    {
      heading: "На какво основание",
      paragraphs: ["Различните дейности стъпват на различно правно основание:"],
      bullets: [
        "Заявката за поръчка. Обработваме данните, за да предприемем стъпки по ваше искане преди сключване на договор — член 6, параграф 1, буква „б“ от Общия регламент. Обаждането, с което потвърждаваме поръчката, е част от същата стъпка.",
        "Бюлетинът. Вашето съгласие — член 6, параграф 1, буква „а“. Затова запазваме и часа и страницата, от която сте се записали: те документират съгласието. Може да го оттеглите по всяко време и това не засяга обработването преди оттеглянето.",
        "Формата за контакт. Наш легитимен интерес да отговорим на въпрос, който сами сте ни задали — член 6, параграф 1, буква „е“.",
        "Защита от злоупотреба. Ограничаването на честотата на заявките стъпва на легитимния ни интерес формата да остане използваема — член 6, параграф 1, буква „е“.",
        "Счетоводство и данъци, ако се стигне до поръчка — законово задължение по член 6, параграф 1, буква „в“.",
      ],
    },
    {
      heading: "За какво ги използваме",
      paragraphs: [
        "Заявките за поръчка използваме, за да ви се обадим, да потвърдим поръчката и да уговорим доставката. Имейл адресите за бюлетина използваме единствено за да изпращаме бюлетина, за който сте се записали. Съобщенията от формата за контакт използваме, за да ви отговорим.",
        "Не продаваме лични данни и не ги предоставяме за рекламни цели. Не извършваме автоматизирано вземане на решения по смисъла на член 22 от Общия регламент и не профилираме — решението по всяка поръчка се взема от човек.",
      ],
    },
    {
      heading: "На кого ги предоставяме",
      paragraphs: [
        "Заявките се обработват от нас. Извън това данните достигат само до доставчици, които ги обработват по наше нареждане и нямат право да ги ползват за свои цели:",
      ],
      bullets: [
        "Доставчик на хостинг и база данни — съхранява заявката, абонамента и съобщението.",
        "Resend — изпраща известието по имейл до нас и потвърждението до вас, както и препраща писмата, получени на адреса ни за контакт.",
      ],
      // Deliberately short. This site has no Turnstile, no embedded map and no
      // advertising tag, and its page measurement is aggregate and carries no
      // personal data (see "Бисквитки" below), so there is nobody else to name
      // — and naming a processor we do not use would be as wrong as omitting
      // one.
    },
    {
      heading: "Предаване извън Европейския съюз",
      paragraphs: [
        "Resend е дружество със седалище в САЩ, така че при него е възможно предаване на данни извън Европейския съюз. Същото може да важи и за доставчика на хостинг, в зависимост от региона, в който се намира сървърът. Такова предаване се извършва въз основа на приетите от Европейската комисия стандартни договорни клаузи или на друг признат механизъм за защита.",
      ],
    },
    {
      heading: "Колко дълго ги пазим",
      paragraphs: [
        "Заявки за поръчка, които не водят до поръчка, пазим до 12 месеца. Ако поръчката бъде изпълнена, счетоводните документи, свързани с нея, се пазят 10 години съгласно член 12 от Закона за счетоводството.",
        "Абонаментите за бюлетина се пазят, докато не се отпишете. Съобщенията от формата за контакт се пазят до 12 месеца след приключване на разговора.",
      ],
    },
    {
      heading: "Вашите права",
      paragraphs: ["По отношение на данните, които съхраняваме за вас, имате право на:"],
      bullets: [
        "достъп до данните и копие от тях;",
        "коригиране на неточни данни;",
        "изтриване;",
        "ограничаване на обработването;",
        "преносимост на данните, които сте ни предоставили;",
        "възражение срещу обработване, което стъпва на легитимен интерес;",
        "оттегляне на съгласието за бюлетина по всяко време.",
      ],
    },
    {
      heading: "Как да ги упражните",
      paragraphs: [
        `Пишете ни на ${contactLine} и ще отговорим в срок до един месец.`,
        "Имате право и на жалба до Комисията за защита на личните данни — София 1592, бул. „Проф. Цветан Лазаров“ № 2, cpdp.bg.",
      ],
    },
    {
      heading: "Бисквитки",
      paragraphs: [
        "При разглеждане на магазина този сайт не поставя бисквитки — нито рекламни, нито аналитични.",
        "Посещенията измерваме обобщено и без бисквитки: броим колко пъти е отворена дадена страница и колко заявки са изпратени. За това не записваме нищо в браузъра ви, не използваме идентификатор, по който да бъдете разпознати при следващо посещение или на друг сайт, и не събираме лични данни. Подробностите са на страницата „Бисквитки“.",
        "Ако това се промени, първо ще бъдат обновени тази политика и страницата за бисквитките.",
      ],
    },
    {
      heading: "Кой е администратор на данните",
      paragraphs: [
        siteConfig.legal.isComplete
          ? `${siteConfig.legal.companyName}, ${siteConfig.legal.address}. ЕИК ${siteConfig.legal.companyId}.`
          : `${REVIEW_MARKER}: фирменото наименование, адресът и ЕИК трябва да бъдат попълнени преди пускането на сайта. Оставени са умишлено празни, вместо да бъдат измислени.`,
      ],
    },
  ],
};

/**
 * A function of the commercial terms rather than a constant, so the tests can
 * read the document as it would be with a term set, unset or changed.
 */
export function buildTermsOfService(commerce: CommerceConfig = siteConfig.commerce): LegalDocument {
  const payment = paymentSection(commerce);

  return {
    slug: "terms",
    title: "Общи условия",
    summary: "Как работи поръчването през този сайт.",
    needsReview: true,
    sections: [
      {
        heading: "Как работи поръчването",
        paragraphs: [
          "Този сайт не приема поръчки и плащания директно. Изпращането на формата за поръчка ни изпраща заявка да ви се обадим. Поръчка възниква едва след като сме говорили с вас и сме я потвърдили.",
          "Това означава, че в момента на изпращане на формата нищо не се таксува, не се запазва и не се изпраща.",
        ],
      },
      {
        heading: "Цени и наличност",
        paragraphs: [
          "Цените и наличностите тук се обновяват автоматично и са верни доколкото ни е известно. Те могат да се променят и понякога продукт, отбелязан като наличен, вече да е изчерпан. Окончателната цена и наличност потвърждаваме с вас по телефона, преди да бъде поръчано каквото и да е.",
          "Когато при продукт не е посочена цена, той може да бъде поръчан и ще ви кажем цената по телефона.",
        ],
      },
      {
        heading: "Информация за продуктите",
        paragraphs: [
          "Описанията, изображенията и характеристиките на продуктите се основават на информация от производителите. Стараем се да са точни, но ако нещо е от значение за вашето решение, моля, проверете при нас преди да поръчате.",
        ],
      },
      deliverySection(commerce),
      ...(payment ? [payment] : []),
      withdrawalSection(commerce),
      {
        heading: "Кога правото на отказ не важи",
        paragraphs: [
          "Законът изключва някои стоки от правото на отказ. Тук това може да засегне мляно кафе или дози в отворена опаковка, ако запечатването има значение за запазването им.",
          `${REVIEW_MARKER}: обхватът на изключенията по член 57 от Закона за защита на потребителите трябва да бъде потвърден от юрист за конкретния асортимент. Кафе на зърна и капсули в запечатана опаковка по правило НЕ попадат в изключенията, така че по подразбиране изхождаме от това, че правото на отказ важи за по-голямата част от каталога.`,
        ],
      },
      {
        heading: "Съответствие на стоката и рекламации",
        paragraphs: [
          "Отговаряме за липсата на съответствие на стоката с договора съгласно Закона за защита на потребителите. Ако получената стока не отговаря на поръчаното — сгрешен артикул, повредена опаковка, изтекъл срок на годност — имате право да предявите рекламация.",
          `Рекламацията се предявява на ${contactLine}. Опишете какъв е проблемът и приложете снимка, ако е възможно; това не е задължително, но ускорява решаването.`,
        ],
      },
      {
        heading: "Спорове",
        paragraphs: [
          "Ако не успеем да решим въпроса помежду си, може да се обърнете към Комисията за защита на потребителите (kzp.bg) или към помирителна комисия към нея.",
          // No EU ODR link: the platform closed on 20 July 2025 and Regulation
          // (EU) 524/2013 was repealed by Regulation (EU) 2024/3228, which also
          // removed the duty to link it. buy-a-vend carried such a link in eleven
          // locales and it has been removed there for the same reason.
        ],
      },
      {
        heading: "Контакт",
        paragraphs: [`Въпроси относно тези условия: ${contactLine}.`],
      },
    ],
  };
}

export const termsOfService: LegalDocument = buildTermsOfService();

export const cookiePolicy: LegalDocument = {
  slug: "cookies",
  title: "Бисквитки",
  summary: "Какво този сайт съхранява в браузъра ви.",
  needsReview: false,
  sections: [
    {
      heading: "Накратко",
      paragraphs: [
        "Този сайт не поставя бисквитки на посетителите си — нито рекламни, нито аналитични, нито на трети страни. Няма за какво да давате съгласие, затова няма и банер за бисквитки.",
      ],
    },
    {
      heading: "Какво всъщност се съхранява",
      paragraphs: [
        "Сайтът се изгражда на сървъра и не изисква да влизате в профил, така че при разглеждане на магазина не се поставят бисквитки. Браузърът ви кешира страници и изображения по обичайния начин, както при всеки сайт.",
        "Единственото изключение е административният панел, до който посетителите нямат достъп: там се поставя една бисквитка за сесия, за да остане администраторът вписан. Тя е строго необходима за работата на панела и затова не изисква съгласие. Не се използва за проследяване и не следи посетителите на магазина.",
      ],
    },
    {
      heading: "Как измерваме посещенията",
      paragraphs: [
        "Броим посещенията обобщено — колко пъти е отворена дадена страница и колко заявки са изпратени — за да знаем кое на сайта върши работа и кое не.",
        "За това измерване не се поставят бисквитки и в браузъра ви не се записва нищо. Не използваме идентификатор, по който да бъдете разпознати при следващо посещение или на друг сайт, и не събираме лични данни: виждаме числа за страници, а не хора. Затова за него не се иска съгласие.",
      ],
    },
    {
      heading: "Ако това се промени",
      paragraphs: [
        "Ако по-късно бъдат добавени инструменти, които поставят бисквитки или разпознават отделния посетител — например маркетингови — тази страница ще бъде обновена, преди те да бъдат включени, и ще бъде поискано съгласие там, където законът го изисква.",
      ],
    },
  ],
};

export const legalDocuments = [privacyPolicy, termsOfService, cookiePolicy] as const;

export function getLegalDocument(slug: string): LegalDocument | null {
  return legalDocuments.find((document) => document.slug === slug) ?? null;
}
