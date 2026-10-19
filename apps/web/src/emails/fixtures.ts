import { siteConfig } from "@/config/site";
import type { NewsletterContent } from "./newsletter";
import type { OrderConfirmationContent } from "./order-confirmation";
import type { OwnerNotificationContent } from "./owner-notification";
import type { ReplyContent } from "./reply";

/**
 * Example content for every template, shared by the preview script
 * (`pnpm email:preview`) and `test/emails.test.ts`, so what the owner looks at
 * in a browser is what the tests check.
 *
 * Invented, and recognisably so: example.bg addresses, a 0888 number nobody
 * owns. Product names are the shop's own style of name. Nothing here is
 * imported by the application.
 */

const eur = (amount: string) => ({ amount, currency: "EUR" });

/** The address mail is sent from (`MAIL_ADDRESS`), as the configured identity has it. */
export const FIXTURE_SENDER_ADDRESS = siteConfig.contact.email;

/** The shape of `MAIL_SIGNATURE`, built from the configured identity. */
export const FIXTURE_SIGNATURE: readonly string[] = [
  "--",
  siteConfig.name,
  `${siteConfig.contact.phone} · ${siteConfig.contact.email}`,
  siteConfig.contact.hours,
];

export const orderConfirmationFixture: OrderConfirmationContent = {
  reference: "A1B2C3D4",
  customerName: "Иван",
  phone: "+359888123456",
  lines: [
    { name: "Lavazza Super Crema, кафе на зърна, 1 кг", quantity: 2, unitPrice: eur("19.90") },
    {
      name: "Rema Caffè Arabica Gold, капсули за Nespresso, 10 бр.",
      quantity: 3,
      unitPrice: eur("2.90"),
    },
    { name: "Kimbo Napoli, кафе дози ESE, 50 бр.", quantity: 1, unitPrice: null },
  ],
  callback: "Ще ви се обадим утре, в работно време.",
};

/**
 * An order and a message as the forms store them — contact details and all —
 * for `test/owner-notices.test.ts`, which builds the shop's notification from
 * them and checks that none of the details reach it.
 */
export const orderRecordFixture = {
  id: "a1b2c3d4-0000-4000-8000-000000000000",
  subject: "Нова заявка за поръчка: 2 продукта",
  phone: "+359 888 765 432",
  email: "maria.petrova@example.bg",
  customerName: "Мария Петрова",
  notes: "Звънете след 17:00 на 0888 765 432 или пишете на maria.petrova@example.bg",
  items: [
    { productName: "Super Crema 1кг", quantity: 2, unitPrice: "19.90", currency: "EUR" },
    { productName: "Napoli ESE 50", quantity: 1, unitPrice: null, currency: null },
  ],
} as const;

export const contactRecordFixture = {
  id: "b2c3d4e5-0000-4000-8000-000000000000",
  subject: "Доставка до офис",
  name: "Георги Иванов",
  email: "georgi.ivanov@example.bg",
  phone: "+359 887 111 222",
  message: "Обадете ми се на 0887 111 222, моля.",
} as const;

export const orderNotificationFixture: OwnerNotificationContent = {
  label: "Нова заявка",
  subject: "Нова заявка за поръчка: 3 продукта",
  summary: [
    "2 × Super Crema 1кг — 19,90 € за брой, 39,80 €",
    "3 × Arabica Gold Nespresso 10бр. — 2,90 € за брой, 8,70 €",
    "1 × Napoli ESE 50 — цена при запитване",
    "",
    "Сума на продуктите: 48,50 €, без 1 продукт с цена при запитване",
  ].join("\n"),
  lines: [
    { name: "Super Crema 1кг", quantity: 2, unitPrice: eur("19.90") },
    { name: "Arabica Gold Nespresso 10бр.", quantity: 3, unitPrice: eur("2.90") },
    { name: "Napoli ESE 50", quantity: 1, unitPrice: null },
  ],
  link: "https://buy-a-coffee.com/admin/zayavki/a1b2c3d4-0000-4000-8000-000000000000",
  footnote: [
    "Автоматично известие за заявка за поръчка.",
    "Данните за контакт са в записа, не в това писмо.",
  ],
};

export const contactNotificationFixture: OwnerNotificationContent = {
  label: "Ново съобщение",
  subject: "Форма за контакт: Доставка до офис",
  summary: "Съобщението и данните за контакт са в записа в базата.",
  link: "https://buy-a-coffee.com/admin/sabshteniya/b2c3d4e5-0000-4000-8000-000000000000",
  footnote: [
    "Автоматично известие за съобщение от формата за контакт.",
    "Данните за контакт са в записа, не в това писмо.",
  ],
};

export const signupNotificationFixture: OwnerNotificationContent = {
  label: "Нов абонат",
  subject: "Нов абонат за бюлетина",
  summary: "Адресът е в записа в базата.",
  link: "https://buy-a-coffee.com/admin/byuletin",
  footnote: [
    "Автоматично известие за нов абонат за бюлетина.",
    "Данните за контакт са в записа, не в това писмо.",
  ],
};

export const syncAlertFixture: OwnerNotificationContent = {
  label: "Синхронизация",
  subject: "Синхронизация: каталогът не е обновяван от 30 часа",
  summary:
    "Последната успешна синхронизация е от 17 октомври, 06:15 UTC. Цените и наличностите на сайта може да не са актуални.\nВижте журнала: https://github.com/example/actions",
  link: "https://buy-a-coffee.com/admin/sinhron",
  footnote: ["Автоматично известие за проблем със синхронизацията на каталога."],
};

export const replyFixture: ReplyContent = {
  senderAddress: FIXTURE_SENDER_ADDRESS,
  body: [
    "Здравейте, Иван,",
    "",
    "Lavazza Super Crema е налична и можем да я изпратим още утре.",
    "Цената за два пакета е 39,80 €.",
    "",
    "Повече за кафето: https://buy-a-coffee.com/bg/lavazza-super-crema-kafe-na-zarna-1-kg",
  ].join("\n"),
  attachments: [{ filename: "оферта-A1B2C3D4.pdf", size: 184_320 }],
};

export const forwardEnvelopeFixture: readonly string[] = [
  "От: Мария Петрова <maria@example.bg>",
  "До: info@buy-a-coffee.com",
  "Получено: 19.10.2026 г., 10:42:00",
];

export const forwardOriginalFixture = `<!DOCTYPE html><html><head><style>.note{color:#333}</style></head><body><p class="note">Здравейте, имате ли капсули за <b>Dolce Gusto Genio</b>?</p><p>Цена: 5 $ &amp; повече</p></body></html>`;

/** Hosted on the real Blob store's origin, under `newsletter/`, as uploads are. */
const BLOB = "https://j6xpmlta50zfdxeo.public.blob.vercel-storage.com/newsletter";

export const newsletterFixture: NewsletterContent = {
  subject: "Новите кафета на октомври",
  preheader: "Две нови марки на зърна и капсули за A Modo Mio.",
  body: [
    "Здравейте,",
    "",
    "Този месец в магазина има **две нови марки** кафе на зърна и още капсули за *Lavazza A Modo Mio*.",
    "",
    "## Какво е новото",
    "",
    "- Vergnano Espresso, 1 кг",
    "- Kimbo Aroma Intenso, 1 кг",
    "- Капсули Lavazza A Modo Mio Qualità Rossa",
    "",
    "Всичко е на [страницата с новите продукти](https://buy-a-coffee.com/bg/promotsii). Ако не сте сигурни кое кафе е за вашата машина, обадете ни се.",
  ].join("\n"),
  attachments: [
    {
      url: `${BLOB}/oktomvri-novi-kafeta-AbC123xYz.jpg`,
      name: "oktomvri-novi-kafeta.jpg",
      contentType: "image/jpeg",
      size: 245_000,
      kind: "image",
      alt: "Три нови пакета кафе на зърна един до друг",
    },
    {
      url: `${BLOB}/ceni-oktomvri-QwE789rTy.pdf`,
      name: "Цени октомври.pdf",
      contentType: "application/pdf",
      size: 1_240_000,
      kind: "file",
    },
  ],
};

/** A token of the real shape: 64 hex characters, the way the database mints them. */
export const FIXTURE_UNSUBSCRIBE_TOKEN = "0123456789abcdef".repeat(4);
