import { siteConfig } from "@/config/site";
import { promotionsPageUrl } from "./links";
import { campaignTag } from "./product-blocks";
import { dayWords, lastDay, monthName, rangeWords } from "./sofia";
import { MAX_BLOCK_PRODUCTS, productTokenLine } from "./tokens";

/**
 * What "Нов бюлетин" can start from: the monthly letter, a promotion's
 * announcement, or a blank page (which needs nothing here).
 *
 * A template is a first draft, not a letter: subject, preheader and a body in
 * the composer's own grammar (`emails/markdown.ts`), every word of it the
 * owner's to change. So the products are written out as explicit
 * `[[продукти: …]]` lists rather than automatic blocks — the owner sees each
 * one in the composer and can take it out — and nothing in the text is a
 * figure that would go stale when they do: no "three new coffees", no price.
 * Dates are words, in Sofia's calendar (`sofia.ts`), because a promotion's
 * last day is the day a reader can still buy.
 *
 * Deterministic and pure: the same data writes the same letter, in the panel,
 * in the monthly job and in the tests. What the data is — which products are
 * new, which reduced, which promotion — is `template-data.ts`.
 */

/** A promotion as a letter speaks of it: the customer's words for it, never the owner's name. */
export interface TemplatePromotion {
  readonly id: string;
  /** "Есенни дни", or null when the owner gave customers no name for it. */
  readonly label: string | null;
  readonly percentOff: number;
  readonly startsAt: Date;
  /** The instant its last Sofia day ends. */
  readonly endsAt: Date;
}

export interface TemplateLetter {
  readonly subject: string;
  readonly preheader: string;
  readonly body: string;
}

export interface MonthlyInput {
  readonly now: Date;
  /** Slugs of the new arrivals, newest first, orderable; at most a block's worth. */
  readonly newArrivals: readonly string[];
  /** Slugs of the reduced products to show, the shop's promotions first; at most a block's worth. */
  readonly reduced: readonly string[];
  /** The shop's running promotions among what is reduced, soonest to end first. */
  readonly promotions: readonly TemplatePromotion[];
}

export interface PromotionInput {
  readonly now: Date;
  readonly promotion: TemplatePromotion;
  /** Slugs of its orderable products, the biggest saving first; at most a block's worth. */
  readonly members: readonly string[];
}

const SIGN_OFF = [
  `Ако не сте сигурни кое кафе е за вашата машина, обадете ни се на ${siteConfig.contact.phone} — ще ви помогнем да изберете.`,
  "",
  `Поздрави,\n${siteConfig.name}`,
].join("\n");

const picked = (slugs: readonly string[]) =>
  productTokenLine({ kind: "picked", slugs: slugs.slice(0, MAX_BLOCK_PRODUCTS) });

/** "−10%", with the minus the product cards use. */
const off = (percent: number) => `−${percent}%`;

/** "**Есенни дни**: −10% до 15 ноември включително." */
function promotionLine(promotion: TemplatePromotion): string {
  const until = `до ${dayWords(lastDay(promotion.endsAt))} включително`;
  return promotion.label
    ? `**${escapeText(promotion.label)}**: ${off(promotion.percentOff)} ${until}.`
    : `${off(promotion.percentOff)} на избрани продукти ${until}.`;
}

/**
 * The owner's words for customers, as text inside a sentence: a label like
 * "Есенни *дни*" must not turn into italics, nor brackets into a link. Only
 * what is syntax in the middle of a line is escaped, so the label reads in the
 * composer as it was typed.
 */
function escapeText(text: string): string {
  return text.replace(/[\\*[\]]/g, (character) => `\\${character}`);
}

/* -- the monthly letter ----------------------------------------------------- */

/**
 * The month's letter: what arrived since the last one, and what is reduced
 * now. The words follow what there is — new products, promotions, both, or
 * (when the owner starts one anyway) neither, which leaves a greeting and the
 * sign-off for them to write between.
 */
export function monthlyLetter(input: MonthlyInput): TemplateLetter {
  const month = monthName(input.now);
  const hasNew = input.newArrivals.length > 0;
  const hasSale = input.reduced.length > 0;
  const onlyPromotion = input.promotions.length === 1 ? input.promotions[0]! : null;

  const subject = hasNew
    ? hasSale
      ? `Новото в магазина през ${month}: нови продукти и промоции`
      : `Новите продукти в магазина през ${month}`
    : hasSale
      ? `Промоциите в магазина през ${month}`
      : `Бюлетин за ${month}`;

  const until = onlyPromotion
    ? ` Промоцията важи до ${dayWords(lastDay(onlyPromotion.endsAt))} включително.`
    : "";
  const preheader = hasNew
    ? hasSale
      ? `Какво пристигна наскоро и какво е с намалена цена сега.${until}`
      : "Какво пристигна в магазина наскоро."
    : hasSale
      ? `Какво е с намалена цена сега.${until}`
      : "";

  const parts: string[] = ["Здравейте,"];
  if (hasNew && hasSale) {
    parts.push(
      `Ето какво е новото в магазина през ${month}: продуктите, които пристигнаха наскоро, и тези с намалена цена.`,
    );
  } else if (hasNew) {
    parts.push("Ето продуктите, които пристигнаха в магазина наскоро.");
  } else if (hasSale) {
    parts.push("Този месец ви пишем за промоциите — ето продуктите с намалена цена, докато траят.");
  }

  /* Each list right under its heading, with nothing between: a section whose
     products have all sold out by the time it is sent then disappears whole,
     heading and all (`sections.ts`). */
  if (hasNew) parts.push("## Ново в магазина", picked(input.newArrivals));

  if (hasSale) {
    parts.push("## Промоции");
    if (input.promotions.length === 1) parts.push(promotionLine(input.promotions[0]!));
    else if (input.promotions.length > 1) {
      parts.push(input.promotions.map((promotion) => `- ${promotionLine(promotion)}`).join("\n"));
    } else parts.push("Тези продукти са с намалена цена в момента.");
    parts.push(picked(input.reduced));
    parts.push(
      `Всички намалени продукти са на [страницата с промоциите](${promotionsPageUrl(campaignTag(subject, input.now))}).`,
    );
  }

  parts.push(SIGN_OFF);
  return { subject, preheader, body: parts.join("\n\n") };
}

/* -- one promotion ---------------------------------------------------------- */

/**
 * A promotion's announcement, running or still to come: its reduction and
 * its days in the subject, the same in the opening sentence, its products,
 * and the way to the rest of them.
 */
export function promotionLetter(input: PromotionInput): TemplateLetter {
  const { promotion } = input;
  const started = promotion.startsAt.getTime() <= input.now.getTime();
  const last = dayWords(lastDay(promotion.endsAt));
  const when = started ? `до ${last}` : rangeWords(promotion.startsAt, promotion.endsAt);
  const what = promotion.label
    ? `${promotion.label}: ${off(promotion.percentOff)}`
    : `${off(promotion.percentOff)} на избрани продукти`;
  const subject = `${what} ${when}`;

  const preheader = started
    ? `Цените на продуктите в промоцията са намалени с ${promotion.percentOff}% до ${last} включително.`
    : `${capitalise(rangeWords(promotion.startsAt, promotion.endsAt))} включително цените на продуктите в промоцията са намалени с ${promotion.percentOff}%.`;

  const lead = promotion.label ? `**${escapeText(promotion.label)}** — ` : "";
  const sentence = started
    ? `до ${last} включително цените на продуктите по-долу са намалени с ${promotion.percentOff}%.`
    : `${rangeWords(promotion.startsAt, promotion.endsAt)} включително цените на продуктите по-долу ще бъдат намалени с ${promotion.percentOff}%.`;

  const parts: string[] = ["Здравейте,", lead ? `${lead}${sentence}` : capitalise(sentence)];
  if (input.members.length > 0) parts.push(picked(input.members));
  const page = `[страницата с промоциите](${promotionsPageUrl(campaignTag(subject, input.now))})`;
  parts.push(
    started
      ? `Всички продукти в промоцията са на ${page}.`
      : `От ${dayWords(promotion.startsAt)} всички продукти в промоцията ще бъдат на ${page}.`,
  );
  parts.push(SIGN_OFF);
  return { subject, preheader, body: parts.join("\n\n") };
}

function capitalise(text: string): string {
  return text.charAt(0).toLocaleUpperCase("bg") + text.slice(1);
}
