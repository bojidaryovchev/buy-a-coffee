/**
 * Copy for the two business sections, `/vending` and `/consumables`.
 *
 * Written by us, for one reader: someone who runs one or several vending or
 * office coffee machines and buys for the machine rather than for the cup.
 *
 * The rule that shapes every line here is the catalog's own — nothing is
 * invented — and on these two pages it bites harder than anywhere else,
 * because a business reader takes a sentence as an offer:
 *
 *  - No item is said or implied to be in stock unless the catalog lists it.
 *    The page shows products from the database; the prose never names one.
 *  - No prices, delivery times, minimum or maximum volumes, discounts,
 *    contracts, servicing or maintenance. None of those is recorded anywhere
 *    in this repository, so none of them is ours to promise.
 *  - Where we do not know, the copy says so and gives the phone number.
 *
 * The consumables page explains what the word covers. That is a definition,
 * not an assortment, and the paragraph after it says so in plain words.
 *
 * Kept apart from the layout so that changing a sentence is a one-file review
 * by someone who reads Bulgarian, not a diff through JSX.
 */

export interface BusinessSectionCopy {
  /** The `h1`, the breadcrumb and the structured-data name. */
  readonly title: string;
  readonly metaTitle: string;
  readonly metaDescription: string;
  readonly lead: readonly string[];

  /** A definition list explaining terms. Never a list of things on offer. */
  readonly explainer?: {
    readonly heading: string;
    readonly intro: string;
    readonly items: ReadonlyArray<{ readonly term: string; readonly text: string }>;
  };

  /** Heading for products that arrive through the section's own category. */
  readonly listing: { readonly heading: string; readonly description?: string };

  /** Heading for the vending blends found in the catalog. */
  readonly blends?: { readonly heading: string; readonly description: string };

  /** Shown only when the page has no product to show at all. */
  readonly nothingListed: string;

  readonly ordering: {
    readonly heading: string;
    readonly steps: readonly string[];
    readonly note?: string;
  };

  readonly enquiry: {
    readonly heading: string;
    readonly intro: string;
    /** Prefilled into the form's subject, so the message arrives labelled. */
    readonly subject: string;
  };

  /** A pointer to the sibling section. */
  readonly related: { readonly text: string; readonly label: string; readonly href: string };
}

export const vendingCopy: BusinessSectionCopy = {
  title: "Вендинг зона",
  metaTitle: "Вендинг зона — кафе за вендинг автомати и автоматични машини",
  metaDescription:
    "Кафе на зърна за вендинг автомати и автоматични кафемашини в офиса или обекта. Поръчвате по телефона и уговаряте количеството в същия разговор.",
  lead: [
    "Тази страница е за хората, които зареждат машини: оператори на вендинг автомати и фирми с една или няколко автоматични кафемашини в офиса или в обекта.",
    "Тук събираме кафето от нашия каталог, което е предназначено за такава работа. Показваме само продукти, които наистина са в каталога ни, с цената им за опаковка. Ако търсите нещо, което не виждате по-долу, попитайте ни направо.",
  ],

  listing: { heading: "Продукти във Вендинг зона" },

  blends: {
    heading: "Смеси за вендинг и автоматични машини",
    description:
      "Кафе на зърна, което производителят сам е нарекъл Vending. Цената е за една опаковка; характеристиките на всяка смес са на нейната страница.",
  },

  nothingListed:
    "В момента в каталога няма продукти, означени за вендинг. Обадете ни се или ни пишете през формата по-долу и ще ви кажем направо дали можем да помогнем.",

  ordering: {
    heading: "Как поръчва фирма",
    steps: [
      "Отворете продукта, който ви интересува, и оставете телефонен номер. Ако поръчката е за няколко продукта, по-лесно е да ги опишете наведнъж във формата по-долу.",
      "Обаждаме ви се. В този разговор уточняваме количеството и уговаряме доставката.",
      "Поръчката е приета едва след разговора. На сайта няма количка и няма онлайн плащане.",
    ],
    note: "Формата на продуктовата страница приема до 99 броя. За по-голямо количество използвайте формата тук или телефона.",
  },

  enquiry: {
    heading: "Запитване за фирми",
    intro:
      "Напишете какви машини зареждате, кое кафе ви интересува и приблизително какво количество ви трябва. Ще се свържем с вас на посочения имейл или телефон.",
    subject: "Запитване: вендинг зона",
  },

  related: {
    text: "Какво се разбира под консумативи и как да попитате за тях:",
    label: "Консумативи",
    href: "/consumables",
  },
};

export const consumablesCopy: BusinessSectionCopy = {
  title: "Консумативи",
  metaTitle: "Консумативи за кафемашини и вендинг автомати",
  metaDescription:
    "Какво се разбира под консумативи за кафемашини и вендинг автомати и как да ни попитате за тях.",
  lead: [
    "Една машина не работи само с кафе. Тази страница обяснява накратко какво се има предвид под консумативи и как да ни попитате за тях.",
  ],

  explainer: {
    heading: "Какво наричаме консумативи",
    intro:
      "Думата събира три различни групи неща. Изброяваме ги, за да е ясно за какво говорим — това е обяснение, а не списък на наличности.",
    items: [
      {
        term: "За сервиране",
        text: "чаши, капачки и бъркалки — това, което клиентът взема заедно с напитката.",
      },
      {
        term: "Към напитката",
        text: "захар, сухо мляко и другите съставки, с които автоматът приготвя напитки, различни от чисто кафе.",
      },
      {
        term: "За поддръжка",
        text: "препарати за почистване и срещу котлен камък, както и филтри за вода — нещата, които пазят машината в изправност.",
      },
    ],
  },

  listing: { heading: "Консумативи в каталога" },

  nothingListed:
    "Към момента в каталога ни няма консумативи — нито като продукти, нито с цени. Затова тук няма списък и не обещаваме наличност. Ако ви трябва нещо от описаното, пишете ни през формата или се обадете и ще ви кажем направо дали можем да помогнем.",

  ordering: {
    heading: "Как да попитате",
    steps: [
      "Опишете какво ви трябва, за каква машина е и приблизително в какво количество.",
      "Свързваме се с вас на посочения имейл или телефон.",
      "Ако можем да го осигурим, уговаряме количеството и доставката в същия разговор. Ако не можем, казваме го.",
    ],
  },

  enquiry: {
    heading: "Запитване за консумативи",
    intro:
      "Колкото по-точно опишете машината и нуждата, толкова по-ясен отговор ще получите — включително когато отговорът е „не“.",
    subject: "Запитване: консумативи",
  },

  related: {
    text: "Кафето за вендинг автомати и автоматични машини е във",
    label: "Вендинг зона",
    href: "/vending",
  },
};
