import { siteConfig } from "@/config/site";
import { promotionsPageAddress } from "./links";
import { dayWords, lastDay, monthName, rangeWords, sameSofiaDay } from "./sofia";
import { MAX_BLOCK_PRODUCTS, MAX_LETTER_PRODUCTS, productTokenLine } from "./tokens";

/**
 * What "Нов бюлетин" can start from: the monthly letter, a promotion's
 * announcement, or a blank page (which needs nothing here).
 *
 * A template is a first draft, not a letter: subject, preheader and a body in
 * the composer's own grammar (`emails/markdown.ts`), every word of it the
 * owner's to change. So the products are written out as explicit lists — the
 * owner sees each one in the composer and can take it out — and nothing in
 * the text is a figure that would go stale when they do: no "three new
 * coffees", no price. Dates are words, in Sofia's calendar (`sofia.ts`),
 * because a promotion's last day is the day a reader can still buy.
 *
 * WHAT IT MAY CLAIM (`claims.ts`). A percentage only where every card under it
 * shows that percentage on its own badge: a running promotion's letter, whose
 * products are chosen so (`promotionPlan`). The monthly letter names its
 * promotions without a figure — each card's badge carries its own — and lists
 * its reductions as `[[промоции: адрес, …]]`, which the send checks are all
 * still reduced. A promotion that has not started is announced by its days
 * alone, with no figure and nothing in the present tense: the letter can be
 * prepared ahead, and goes once the promotion runs.
 *
 * WHAT MAY VANISH (`sections.ts`). Each list stands right under its heading,
 * and the reductions' section holds nothing but its promotion's words, its
 * list and the link to the promotions page: when everything in it has sold
 * out by the send, the section goes whole. The opening sentence names no
 * section, for the same reason.
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
  /** Slugs of the new arrivals, newest first, orderable; as many as the letter has room for. */
  readonly newArrivals: readonly string[];
  /** Slugs of the reduced products to show, the shop's promotions first; at most a block's worth. */
  readonly reduced: readonly string[];
  /** The shop's running promotions among what is reduced, soonest to end first. */
  readonly promotions: readonly TemplatePromotion[];
}

export interface PromotionInput {
  readonly now: Date;
  readonly promotion: TemplatePromotion;
  /** Slugs of its products, the biggest saving first; at most a block's worth. */
  readonly members: readonly string[];
}

const SIGN_OFF = [
  `Ако не сте сигурни кое кафе е за вашата машина, обадете ни се на ${siteConfig.contact.phone} — ще ви помогнем да изберете.`,
  "",
  `Поздрави,\n${siteConfig.name}`,
].join("\n");

/** Lists of at most a block each, in order: twelve new arrivals are two blocks of six. */
const lists = (kind: "picked" | "reduced", slugs: readonly string[]) => {
  const lines: string[] = [];
  const room = slugs.slice(0, MAX_LETTER_PRODUCTS);
  for (let at = 0; at < room.length; at += MAX_BLOCK_PRODUCTS) {
    lines.push(productTokenLine({ kind, slugs: room.slice(at, at + MAX_BLOCK_PRODUCTS) }));
  }
  return lines;
};

/** "−10%", with the minus the product cards use. */
const off = (percent: number) => `−${percent}%`;

/** Is the promotion a single Sofia day? */
const oneDay = (promotion: TemplatePromotion) =>
  sameSofiaDay(promotion.startsAt, lastDay(promotion.endsAt));

/** "до 15 ноември включително", or for a single day "на 15 ноември". */
function untilWords(promotion: TemplatePromotion): string {
  const last = dayWords(lastDay(promotion.endsAt));
  return oneDay(promotion) ? `на ${last}` : `до ${last} включително`;
}

/** "**Есенни дни** — намалени цени до 15 ноември включително." No figure: each badge says its own. */
function promotionLine(promotion: TemplatePromotion): string {
  const words = `намалени цени ${untilWords(promotion)}.`;
  return promotion.label ? `**${escapeText(promotion.label)}** — ${words}` : capitalise(words);
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

const PROMOTIONS_LINK = () => `[страницата с промоциите](${promotionsPageAddress()})`;

/* -- the monthly letter ----------------------------------------------------- */

/**
 * The month's letter: what arrived since the last one, and what is reduced
 * now. The subject and the preheader follow what there is — new products,
 * promotions, both, or (when the owner starts one anyway) neither, which
 * leaves a greeting and the sign-off for them to write between.
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

  const until = onlyPromotion ? ` Промоцията важи ${untilWords(onlyPromotion)}.` : "";
  const preheader = hasNew
    ? hasSale
      ? `Какво пристигна наскоро и какво е с намалена цена сега.${until}`
      : "Какво пристигна в магазина наскоро."
    : hasSale
      ? `Какво е с намалена цена сега.${until}`
      : "";

  const parts: string[] = ["Здравейте,"];
  if (hasNew || hasSale) parts.push(`Ето какво е новото в магазина през ${month}.`);

  if (hasNew) parts.push("## Ново в магазина", ...lists("picked", input.newArrivals));

  if (hasSale) {
    parts.push("## Промоции");
    if (input.promotions.length === 1) parts.push(promotionLine(input.promotions[0]!));
    else if (input.promotions.length > 1) {
      parts.push(input.promotions.map((promotion) => `- ${promotionLine(promotion)}`).join("\n"));
    } else parts.push("Тези продукти са с намалена цена в момента.");
    parts.push(...lists("reduced", input.reduced.slice(0, MAX_BLOCK_PRODUCTS)));
    parts.push(`Всички намалени продукти са на ${PROMOTIONS_LINK()}.`);
  }

  parts.push(SIGN_OFF);
  return { subject, preheader, body: parts.join("\n\n") };
}

/* -- one promotion ---------------------------------------------------------- */

/**
 * A promotion's announcement. Running: its reduction and its last day, in the
 * subject and the opening sentence, over products whose badges all show that
 * reduction. Still to come: its days alone — no figure, nothing in the
 * present tense — for a letter that may be prepared ahead and goes out once
 * the promotion runs.
 */
export function promotionLetter(input: PromotionInput): TemplateLetter {
  const { promotion } = input;
  const started = promotion.startsAt.getTime() <= input.now.getTime();
  const lead = promotion.label ? `**${escapeText(promotion.label)}** — ` : "";
  const parts: string[] = ["Здравейте,"];
  let subject: string;
  let preheader: string;

  if (started) {
    const last = dayWords(lastDay(promotion.endsAt));
    const when = oneDay(promotion) ? `на ${last}` : `до ${last}`;
    const until = untilWords(promotion);
    subject = promotion.label
      ? `${promotion.label}: ${off(promotion.percentOff)} ${when}`
      : `${off(promotion.percentOff)} на избрани продукти ${when}`;
    preheader = `Цените на продуктите в промоцията са намалени с ${promotion.percentOff}% ${until}.`;
    const sentence = `${until} цените на продуктите по-долу са намалени с ${promotion.percentOff}%.`;
    parts.push(lead ? `${lead}${sentence}` : capitalise(sentence));
  } else {
    const days = rangeWords(promotion.startsAt, promotion.endsAt);
    const daysIncl = oneDay(promotion) ? days : `${days} включително`;
    subject = promotion.label
      ? `${promotion.label}: намалени цени ${days}`
      : `Намалени цени ${days}`;
    preheader = `Намалени цени на избрани продукти ${daysIncl}.`;
    const sentence = `намалени цени на продуктите по-долу ${daysIncl}.`;
    parts.push(lead ? `${lead}${sentence}` : capitalise(sentence));
  }

  parts.push(...lists("picked", input.members.slice(0, MAX_BLOCK_PRODUCTS)));
  parts.push(
    started
      ? `Всички продукти в промоцията са на ${PROMOTIONS_LINK()}.`
      : `Всички продукти в промоцията — на ${PROMOTIONS_LINK()} от ${dayWords(promotion.startsAt)}.`,
  );
  parts.push(SIGN_OFF);
  return { subject, preheader, body: parts.join("\n\n") };
}

function capitalise(text: string): string {
  return text.charAt(0).toLocaleUpperCase("bg") + text.slice(1);
}
