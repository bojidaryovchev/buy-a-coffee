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

/** Product photographs on the real store, under `catalog/`, as the sync mirrors them. */
const CATALOG = "https://j6xpmlta50zfdxeo.public.blob.vercel-storage.com/catalog";

let fixtureProducts = 0;

const product = (
  slug: string,
  title: string,
  detail: string,
  figures: {
    price: string | null;
    oldPrice?: string;
    discountPercent?: number;
    perCup: string | null;
    image?: string | null;
    /** The photograph's size as the catalog stores it; most are 800 × 800. */
    size?: { width: number; height: number } | null;
    availability?: "in_stock" | "out_of_stock" | "preorder" | "unknown";
  },
) => ({
  id: `00000000-0000-4000-8000-${String((fixtureProducts += 1)).padStart(12, "0")}`,
  slug,
  path: `/bg/${slug}`,
  name: `${title} — ${detail.charAt(0).toLowerCase()}${detail.slice(1)}`,
  title,
  detail,
  price: figures.price,
  oldPrice: figures.oldPrice ?? null,
  discountPercent: figures.discountPercent ?? null,
  perCup: figures.perCup,
  availability: figures.availability ?? ("in_stock" as const),
  image:
    figures.image === null
      ? null
      : {
          url: `${CATALOG}/${figures.image ?? "aa/bb/aabb.jpg"}`,
          alt: title,
          width: figures.size === null ? null : (figures.size?.width ?? 800),
          height: figures.size === null ? null : (figures.size?.height ?? 800),
        },
});

/**
 * A newsletter with all three product blocks, and the snapshot a send would
 * have taken of them: what the letter's cards look like, in every state a
 * card has — reduced or not, estimated per-cup or counted, sold out, without
 * a photograph.
 */
export const newsletterProductsFixture: NewsletterContent = {
  subject: "Новите кафета на октомври",
  preheader: "Три нови марки на зърна, капсули за Dolce Gusto и намаления до 20%.",
  body: [
    "Здравейте,",
    "",
    "Този месец в магазина пристигнаха три нови марки кафе на зърна и още капсули за Dolce Gusto. Ето какво избрахме за вас — цените са същите като в магазина, а цената на чаша е изчислена от грамажа на пакета.",
    "",
    "## Нашият избор",
    "",
    "[[продукти: kafe-na-zarna-vandino-espresso-aroma-1kg, kapsuli-dg-rema-caffe-cortado-16-br, kafe-na-zarna-biancaffe-arabica-0-500kg]]",
    "",
    "## Ново в магазина",
    "",
    "[[нови-продукти: 2]]",
    "",
    "## Намалени цени",
    "",
    "Намаленията важат, докато има количества. Ако не сте сигурни кое кафе е за вашата машина, обадете ни се — ще ви помогнем да изберете.",
    "",
    "[[промоции]]",
  ].join("\n"),
  attachments: [],
  products: {
    kind: "product-blocks",
    version: 1,
    resolvedAt: "2026-10-19T09:30:00.000Z",
    campaign: "2026-10-novite-kafeta-na-oktomvri",
    blocks: [
      {
        token:
          "[[продукти: kafe-na-zarna-vandino-espresso-aroma-1kg, kapsuli-dg-rema-caffe-cortado-16-br, kafe-na-zarna-biancaffe-arabica-0-500kg]]",
        spec: {
          kind: "picked",
          slugs: [
            "kafe-na-zarna-vandino-espresso-aroma-1kg",
            "kapsuli-dg-rema-caffe-cortado-16-br",
            "kafe-na-zarna-biancaffe-arabica-0-500kg",
          ],
        },
        products: [
          product(
            "kafe-na-zarna-vandino-espresso-aroma-1kg",
            "Vandino Espresso Aroma",
            "Кафе на зърна, 1 кг",
            {
              price: "15,85 €",
              perCup: "≈ 0,11 € на чаша",
              image: "f1/10/f110d45c721286ff7f6b99cbadf5c0a806fbb20401db00003c6a0c70471c6184.jpg",
              size: { width: 800, height: 1200 },
            },
          ),
          product(
            "kapsuli-dg-rema-caffe-cortado-16-br",
            "Rema Caffè Cortado",
            "Капсули за Dolce Gusto, 16 бр.",
            {
              price: "5,90 €",
              perCup: "0,37 € на чаша",
              image: "2e/61/2e61dfc3a20f9c7ad2f2c0e439bc78607faa041a4e0068b12148d7631bdd76de.jpg",
              availability: "out_of_stock",
            },
          ),
          product(
            "kafe-na-zarna-biancaffe-arabica-0-500kg",
            "Biancaffe Arabica",
            "Кафе на зърна, 500 г",
            {
              price: null,
              perCup: null,
              image: null,
            },
          ),
        ],
        missing: [],
      },
      {
        token: "[[нови-продукти: 2]]",
        spec: { kind: "new", limit: 2 },
        products: [
          product(
            "kapsuli-dg-molini-torino-16-br",
            "Molini Torino",
            "Капсули за Dolce Gusto, 16 бр.",
            {
              price: "4,90 €",
              perCup: "0,31 € на чаша",
              image: "e2/df/e2df2d1912b11fdb172e0df6e710f92ed5a3cc64c897096f59e792f2fe7ac155.jpg",
            },
          ),
        ],
        missing: [],
      },
      {
        token: "[[промоции]]",
        spec: { kind: "sale", limit: 4 },
        products: [
          product(
            "kafe-na-zarna-eurocaf-crema-vivace-1kg",
            "Eurocaf Crema Vivace",
            "Кафе на зърна, 1 кг",
            {
              price: "11,04 €",
              oldPrice: "13,80 €",
              discountPercent: 20,
              perCup: "≈ 0,08 € на чаша",
              image: "ff/58/ff5850f6ef4f116f4e77fab46cdc9ecf4512cdf94202fb1dd50816900cdf4679.jpg",
            },
          ),
          product(
            "kapsuli-dg-rema-caffe-arabica-gold-16-br",
            "Rema Caffè Arabica Gold",
            "Капсули за Dolce Gusto, 16 бр.",
            {
              price: "5,49 €",
              oldPrice: "5,90 €",
              discountPercent: 6,
              perCup: "0,34 € на чаша",
              image: "83/6f/836f5b8b7042f7b73594e4e1d9f605872fbdd567294e56bbb4910d6f247f8182.jpg",
            },
          ),
        ],
        missing: [],
      },
    ],
  },
};

/** A token of the real shape: 64 hex characters, the way the database mints them. */
export const FIXTURE_UNSUBSCRIBE_TOKEN = "0123456789abcdef".repeat(4);
