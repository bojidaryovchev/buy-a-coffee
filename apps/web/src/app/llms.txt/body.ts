import { absoluteUrl, siteConfig, type CommerceConfig } from "@/config/site";
import {
  couriersSentence,
  deliveryCostSentences,
  deliveryFee,
  deliveryTimeSentence,
  freeDeliveryThreshold,
  paymentSentence,
  returnShippingSentence,
} from "@/components/commerce/terms";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import { href, routes } from "@/lib/routes";
import { landingLabels } from "../../../content/landing-copy";

/**
 * The text of `/llms.txt`, as a function of what it describes.
 *
 * Separate from the route so that it can be read by a test: the route decides
 * whether the file is served at all and fetches the catalog; this decides what
 * the file says. Nothing here touches the database or the environment.
 */

export interface LlmsLink {
  readonly name: string;
  /** A public path, already in the file's locale (`/bg/marki/lavazza`). */
  readonly href: string;
}

export interface LlmsInput {
  readonly summary: {
    readonly products: number;
    readonly brands: number;
    readonly categories: number;
  };
  /** Top-level categories, without the ones a business section stands for. */
  readonly categories: readonly LlmsLink[];
  readonly brands: readonly LlmsLink[];
  readonly machineBrandCount: number;
  /** The business sections, by their own pages. */
  readonly sections: readonly (LlmsLink & { readonly description: string })[];
  /**
   * The landing listings that have products right now (Lavazza capsules and
   * beans, decaf, cheapest per cup). Absent or empty: no block.
   */
  readonly landings?: readonly (LlmsLink & { readonly description: string })[];
  /**
   * Whether any product is reduced right now. The promotions page is `noindex`
   * while nothing is, and is linked here only while something is. Absent: not
   * linked.
   */
  readonly hasPromotions?: boolean;
  /** Journal articles, newest first. Empty when the journal is off. */
  readonly articles: readonly (LlmsLink & { readonly description: string })[];
  readonly commerce?: CommerceConfig;
  /** The company's legal line, or null while it is not yet real. */
  readonly company: string | null;
  /**
   * The locale the file is written in and links into. Bulgarian, the default:
   * the file is the shop's prose, and its prose is Bulgarian.
   */
  readonly locale?: Locale;
}

/**
 * What the shop has actually said about delivery and payment, one sentence to
 * a line.
 *
 * The sentences are the ones `terms.ts` builds for the delivery page, the
 * terms and the product page, so this file cannot say something the site does
 * not. A term nobody has set contributes nothing: with no threshold and no fee
 * there is no line about what delivery costs — not even the site's "we tell
 * you on the call", which is an answer for a person who is about to be called
 * and a non-answer in a file that will be quoted to someone who is not.
 */
export function deliveryTermLines(
  commerce: CommerceConfig = siteConfig.commerce,
): readonly string[] {
  const costKnown = freeDeliveryThreshold(commerce) !== null || deliveryFee(commerce) !== null;

  return [
    ...(costKnown ? deliveryCostSentences(commerce) : []),
    deliveryTimeSentence(commerce),
    couriersSentence(commerce),
    paymentSentence(commerce),
    returnShippingSentence(commerce),
  ].filter((line): line is string => line !== null);
}

const link = (entry: LlmsLink, note?: string): string =>
  `- [${entry.name}](${absoluteUrl(entry.href)})${note ? `: ${note}` : ""}`;

/** A titled block, or null when it has no lines: an empty heading is noise. */
const section = (title: string, lines: readonly string[]): string | null =>
  lines.length === 0 ? null : `## ${title}\n\n${lines.join("\n")}`;

export function llmsText(input: LlmsInput): string {
  const locale = input.locale ?? DEFAULT_LOCALE;
  const at = (path: string) => href(locale, path);
  const key: readonly LlmsLink[] = [
    { href: at(routes.wizard), name: "Кое кафе е за мен — препоръка по система, вкус и бюджет" },
    {
      href: at(routes.machines),
      name: "Коя капсула става за моята машина — по марка и модел",
    },
    { href: at(routes.categories), name: "Всички категории" },
    { href: at(routes.brands), name: "Всички марки" },
    ...(input.hasPromotions ? [{ href: at(routes.promotions), name: "Промоции" }] : []),
    { href: at(routes.delivery), name: "Доставка и плащане" },
    { href: at(routes.contact), name: "Контакти" },
  ];

  const blocks: readonly (string | null)[] = [
    `# ${siteConfig.name}`,
    `> ${siteConfig.description}`,
    `Онлайн магазин за кафе в България: ${input.summary.products} продукта от
${input.summary.brands} марки в ${input.summary.categories} категории. Поръчката е на една
стъпка — оставяте телефон и ние се обаждаме за потвърждение.`,
    `Ключови факти:

- Обхват: само България. Всички цени са в ${siteConfig.currency}.
- Продават се кафе на зърна, капсули и дози (доза-в-опаковка).
- Поръчката не изисква регистрация и не се плаща онлайн — потвърждава се по
  телефон.
- Работно време за запитвания: ${siteConfig.contact.hours}
- Телефон: ${siteConfig.contact.phone}
- Имейл: ${siteConfig.contact.email}`,
    section(
      "Доставка и плащане",
      deliveryTermLines(input.commerce).map((line) => `- ${line}`),
    ),
    section(
      "Категории",
      input.categories.map((entry) => link(entry)),
    ),
    section(
      "Марки",
      input.brands.map((entry) => link(entry)),
    ),
    section(
      landingLabels.llmsHeading,
      (input.landings ?? []).map((entry) => link(entry, entry.description)),
    ),
    section(
      "Основни страници",
      key.map((entry) => link(entry)),
    ),
    section(
      "За фирми и вендинг оператори",
      input.sections.map((entry) => link(entry, entry.description)),
    ),
    `## Съвместимост с машини

Сайтът публикува страница за всяка от ${input.machineBrandCount} марки машини,
която казва коя капсулна система използва тя и кои капсули от каталога стават за
нея.`,
    section(
      "Блог",
      input.articles.map((entry) => link(entry, entry.description)),
    ),
    `## Бележки

- Цените и наличностите на сайта се обновяват редовно. Окончателната цена и
  наличност се потвърждават по телефона при поръчката.
- Страницата на продукт, който вече не се предлага, остава достъпна и показва,
  че продуктът не се предлага.
- Сайтът не публикува ревюта и рейтинги.
${
  input.company
    ? `- Фирма: ${input.company}.`
    : "- Фирмените регистрационни данни предстои да бъдат публикувани."
}`,
  ];

  return `${blocks.filter((block): block is string => block !== null).join("\n\n")}\n`;
}
