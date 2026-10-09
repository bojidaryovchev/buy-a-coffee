import type { PaymentMethod, WeekDay } from "@/config/site";

/**
 * Bulgarian — the canonical dictionary.
 *
 * The shape of this object is the `Dictionary` type every other locale is
 * checked against, so a key added here and forgotten in English is a compile
 * error rather than an empty label in production. Bulgarian is canonical
 * because it is the language the shop was written in; deriving the type from a
 * translation would make the translation the authority over the original.
 *
 * **Scope: the frame, and only the frame** — the header, navigation, drawer,
 * search field, footer, announcement bar, skip link, language switcher and
 * 404. (The error page's few strings are in `i18n/error-copy.ts`: it is a
 * client component, and this module stays on the server.) Page bodies keep
 * their Bulgarian inline until a later wave
 * extracts and translates them, which is what `LOCALE_READY` waits for:
 * translating the frame makes a locale possible, translating the content makes
 * it real.
 *
 * `{name}` placeholders are filled by `i18n/fill`, never by concatenation, so
 * each language keeps its own word order.
 */
export const bg = {
  site: {
    tagline: "Кафе, подбрано с грижа",
    description:
      "Кафе на зърна, капсули и дози от марки, които си заслужават. Поръчка на една стъпка — ние ви звъним, за да потвърдим.",
  },

  skipLink: "Към основното съдържание",

  nav: {
    /** Accessible name of the rail and of the drawer's list. */
    label: "Основна навигация",
    home: "{name} — начало",
    capsules: "Капсули",
    capsulesBySystem: "Капсули по система",
    allCapsules: "Всички капсули",
    findByMachine: "Намери по машина",
    wizard: "Кое кафе е за вас",
    brands: "Марки",
    promotions: "Промоции",
    delivery: "Доставка и плащане",
    journal: "Дневник",
    contact: "Контакти",
    allCategories: "Всички категории",
    vending: "Вендинг зона",
    consumables: "Консумативи",
    /**
     * The two systems whose names are kinds of coffee rather than brands. The
     * capsule systems are trade names and read the same in every language.
     */
    systems: {
      "ese-pod": "Дози ESE",
      beans: "Кафе на зърна",
    },
    /** After a count, for a screen reader: "12 продукта". */
    products: { one: "продукт", many: "продукта" },
    /** The panel under "Капсули", for the visitor who knows only the machine. */
    unsureHeading: "Не знаете коя е вашата система?",
    unsureBody: "Намерете машината си по марка и модел и ще ви кажем какво пасва.",
  },

  header: {
    call: "Обадете се",
  },

  drawer: {
    open: "Меню",
    dialog: "Меню на сайта",
    close: "Затвори менюто",
    findByMachineHint: "По марка и модел",
    wizardHint: "Няколко въпроса, три предложения",
  },

  search: {
    label: "Търсене на продукти",
    placeholder: "Търсете кафе, марки, капсули…",
    submit: "Търси",
    suggestions: "Предложения при търсене",
    /** Announced while the list is open. */
    suggestionCount: "{count} предложения за „{term}“",
    brands: "Марки",
    categories: "Категории",
    seeAll: { one: "Виж всички {count} резултат", many: "Виж всички {count} резултата" },
  },

  announcement: {
    label: "Доставка и поръчка",
    /** Must read exactly as `freeDeliveryPromise` does; a test holds them together. */
    freeDelivery: "Безплатна доставка за поръчки над {amount}",
  },

  language: {
    label: "Език",
  },

  hours: {
    days: {
      monday: "Пон",
      tuesday: "Вт",
      wednesday: "Ср",
      thursday: "Чет",
      friday: "Пет",
      saturday: "Съб",
      sunday: "Нед",
    } satisfies Record<WeekDay, string>,
  },

  footer: {
    phone: "Телефон",
    email: "Имейл",
    hours: "Работно време",
    shop: "Магазин",
    help: "Помощ",
    legal: "Правна информация",
    /** Out of the rail's context the word has to come along: "Капсули Nespresso". */
    systemCapsules: "Капсули {system}",
    /** The two listings cut across every system; shown only while they list something. */
    decaf: "Безкофеиново кафе",
    cheapestPerCup: "Най-евтино на чаша",
    terms: "Общи условия",
    privacy: "Поверителност",
    cookies: "Бисквитки",
    newsletterHeading: "Бъдете в течение",
    newsletterBody: "Кратки съобщения за новите попълнения. Не повече от веднъж месечно.",
    copyright: "© {year} {owner}. Всички права запазени.",
    payment: "Плащане: {methods}",
    /** The labels `paymentMethods()` prints; a test holds the two together. */
    paymentMethods: {
      cash_on_delivery: "наложен платеж",
      card_on_delivery: "карта при получаване",
      bank_transfer: "банков превод",
    } satisfies Record<PaymentMethod, string>,
    companyId: "ЕИК",
    vatId: "ДДС №",
    companyPending: "Фирмените данни още не са попълнени",
  },

  notFound: {
    title: "Тази страница я няма",
    body: "Може адресът да е сгрешен или продуктът да е спрян.",
    home: "Към началната страница",
    findByMachine: "Намери по машина",
    lookingFor: "Търсите нещо конкретно?",
    contact: "Пишете ни или се обадете",
  },
};

/** Every locale's dictionary has exactly this shape, with strings for values. */
export type Dictionary = Widen<typeof bg>;

type Widen<T> = { readonly [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };
