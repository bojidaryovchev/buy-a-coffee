import { parseMarkdown } from "@/emails/markdown";
import type { DeliverabilityNote } from "./deliverability";
import { dayWords, lastDay } from "./sofia";

/**
 * What a letter may say about the shop's own promotions, checked where it is
 * written, where it is sent, and again at the top of every run of the send
 * (a resume can come a day later).
 *
 * A reduction announced is a reduction against the lowest price of the 30
 * days before it (Directive 98/6/EC, Art. 6a; CJEU C-330/23, Aldi Süd): the
 * shop's cards show exactly that, as the badge and the struck price, and show
 * nothing where nothing can be claimed. A letter must not claim more than
 * its cards do. So:
 *
 *   - A promotion's letter (`newsletter_campaigns.promotion_id`) says "−X%".
 *     It goes out only while the promotion runs — prepared ahead, it waits
 *     for the first day; after the last, or once stopped, it does not go at
 *     all — only over at least one product the promotion prices, and only if
 *     every product in it shows at least X% on its own badge. And only while
 *     the promotion is the one the letter was written about: a promotion
 *     whose days, reduction or name changed since makes the letter wrong.
 *   - The monthly letter names promotions in words, with their last day
 *     (`LetterPlan.named`, each with the line written for it and the
 *     reductions it priced). One the letter still mentions — its line is in
 *     the body, or one of its reductions is — must still run; one whose days
 *     or name changed must not keep its old line. Taking the line and its
 *     products out, as the note says, settles it.
 *
 * Every one of these stops the send (`blocksSend`); the composer shows them
 * as the owner writes, `submitNewsletter` refuses with the same words, and a
 * run stops on them (`runCampaign`). Pure: the facts come in from the page
 * and from the server's own reads (`claims-data.ts`).
 */

/** A promotion as it stands; `name` is the owner's, never shown to a customer. */
export interface PromotionFacts {
  readonly id: string;
  readonly name: string;
  readonly label: string | null;
  readonly percentOff: number;
  readonly startsAt: Date | string;
  readonly endsAt: Date | string;
  readonly stoppedAt: Date | string | null;
}

/** A promotion as the letter was written about it (`LetterPlan`). */
export interface PlannedPromotion {
  readonly id: string;
  readonly label: string | null;
  readonly percentOff: number;
  readonly startsAt: string;
  readonly endsAt: string;
  /** The line the monthly template wrote for it; null for a promotion's own letter. */
  readonly line: string | null;
  /** The reductions it priced, as the letter lists them. */
  readonly slugs: string[];
}

/** A named promotion: as written, and as it stands now (null when it is gone). */
export interface NamedPromotion {
  readonly planned: PlannedPromotion;
  readonly current: PromotionFacts | null;
}

/** A product of the letter, as its card claims it. */
export interface ClaimedProduct {
  readonly title: string;
  readonly discountPercent?: number | null;
  /** The promotion pricing it, if one does. */
  readonly promotionId?: string | null;
}

export interface ClaimInput {
  /** The promotion the letter announces, as it stands, for a promotion's letter. */
  readonly announced?: PromotionFacts | null;
  /** The same promotion as the letter was written about it. */
  readonly announcedPlan?: PlannedPromotion | null;
  /** A promotion's letter whose promotion is gone: deleted before it started. */
  readonly announcedMissing?: boolean;
  /** The promotions the letter was written naming (the monthly letter's). */
  readonly named?: readonly NamedPromotion[];
  /** The body as it is now: which named promotions it still mentions. */
  readonly body?: string;
  /** Every product the letter shows; null before they are known. */
  readonly products?: readonly ClaimedProduct[] | null;
  readonly now?: Date;
}

const asDate = (value: Date | string) => (value instanceof Date ? value : new Date(value));
const iso = (value: Date | string) => asDate(value).toISOString();
const quoted = (items: readonly string[]) => items.map((item) => `„${item}“`).join(", ");
const labelOf = (value: string | null) => value?.trim() || null;

/** "„Есенни дни“ („Есен 2026“ в панела)", or the owner's name alone. */
const called = (promotion: PromotionFacts) =>
  promotion.label ? `„${promotion.label}“ („${promotion.name}“)` : `„${promotion.name}“`;

/** Where a promotion is now: before its first day, running, or over. */
export function promotionPhase(
  promotion: Pick<PromotionFacts, "startsAt" | "endsAt" | "stoppedAt">,
  now: Date = new Date(),
): "upcoming" | "running" | "stopped" | "ended" {
  const stoppedAt = promotion.stoppedAt ? asDate(promotion.stoppedAt) : null;
  if (stoppedAt && stoppedAt <= now) return "stopped";
  if (asDate(promotion.endsAt) <= now) return "ended";
  if (asDate(promotion.startsAt) > now) return "upcoming";
  return "running";
}

/** A promotion as a letter is written about it, from its row. */
export function plannedFrom(
  promotion: Pick<PromotionFacts, "id" | "label" | "percentOff" | "startsAt" | "endsAt">,
  line: string | null,
  slugs: readonly string[] = [],
): PlannedPromotion {
  return {
    id: promotion.id,
    label: labelOf(promotion.label),
    percentOff: promotion.percentOff,
    startsAt: iso(promotion.startsAt),
    endsAt: iso(promotion.endsAt),
    line,
    slugs: [...slugs],
  };
}

/**
 * What about a promotion changed since the letter was written, in words:
 * its first day, its last, the name customers see, and — where the letter
 * states it — its reduction. Empty when nothing did.
 */
export function promotionChanges(
  planned: PlannedPromotion,
  current: PromotionFacts,
  { percent }: { percent: boolean },
): string[] {
  const changes: string[] = [];
  if (iso(current.startsAt) !== planned.startsAt) {
    changes.push(
      `започва на ${dayWords(asDate(current.startsAt))}, а не на ${dayWords(asDate(planned.startsAt))}`,
    );
  }
  if (iso(current.endsAt) !== planned.endsAt) {
    changes.push(
      `последният ѝ ден е ${dayWords(lastDay(asDate(current.endsAt)))}, а не ${dayWords(lastDay(asDate(planned.endsAt)))}`,
    );
  }
  if (labelOf(current.label) !== planned.label) {
    changes.push(
      current.label
        ? `за клиентите се казва „${current.label.trim()}“${planned.label ? `, а не „${planned.label}“` : ""}`
        : `вече няма име за клиентите${planned.label ? ` („${planned.label}“)` : ""}`,
    );
  }
  if (percent && current.percentOff !== planned.percentOff) {
    changes.push(`намалението е −${current.percentOff}%, а не −${planned.percentOff}%`);
  }
  return changes;
}

/** The reductions a body still lists (`[[промоции: адрес, …]]`). */
function listedReductions(body: string): Set<string> {
  const slugs = new Set<string>();
  for (const block of parseMarkdown(body)) {
    if (block.type === "products" && block.token.spec?.kind === "reduced") {
      for (const slug of block.token.spec.slugs) slugs.add(slug);
    }
  }
  return slugs;
}

function overNote(promotion: PromotionFacts, phase: "stopped" | "ended", own: boolean) {
  const when =
    phase === "stopped"
      ? `спряна е на ${dayWords(asDate(promotion.stoppedAt!))}`
      : `последният ѝ ден беше ${dayWords(lastDay(asDate(promotion.endsAt)))}`;
  return {
    id: "promotion-ended" as const,
    title: own
      ? phase === "stopped"
        ? "Промоцията е спряна"
        : "Промоцията е приключила"
      : `Промоцията ${called(promotion)} ${phase === "stopped" ? "е спряна" : "е приключила"}`,
    detail: own
      ? `${when[0]!.toLocaleUpperCase("bg")}${when.slice(1)}, а писмото обявява намаление, което вече не важи. Изтрийте черновата или напишете друго писмо.`
      : `Писмото я споменава, а ${when}. Махнете реда за нея и продуктите ѝ или ги заменете.`,
    blocksSend: true as const,
  };
}

function announcedNotes(input: ClaimInput, now: Date): DeliverabilityNote[] {
  const announced = input.announced ?? null;
  if (!announced) {
    return input.announcedMissing
      ? [
          {
            id: "promotion-ended",
            title: "Промоцията вече я няма",
            detail:
              "Изтрита е, преди да започне, а писмото я обявява. Изтрийте черновата или напишете друго писмо.",
            blocksSend: true,
          },
        ]
      : [];
  }
  const notes: DeliverabilityNote[] = [];
  const phase = promotionPhase(announced, now);
  if (phase === "stopped" || phase === "ended") return [overNote(announced, phase, true)];

  const changes = input.announcedPlan
    ? promotionChanges(input.announcedPlan, announced, { percent: true })
    : [];
  if (changes.length > 0) {
    notes.push({
      id: "promotion-changed",
      title: "Промоцията е променена след като обявата е подготвена",
      detail: `Сега ${changes.join("; ")}. Писмото е написано за старите ѝ данни: изтрийте черновата и започнете обявата отново.`,
      blocksSend: true,
    });
  }
  if (phase === "upcoming") {
    notes.push({
      id: "promotion-not-started",
      title: "Промоцията още не е започнала",
      detail: `Започва на ${dayWords(asDate(announced.startsAt))}. Писмото може да се подготви отрано, но се изпраща едва когато промоцията тече: дотогава цените в магазина не са намалени.`,
      blocksSend: true,
    });
    return notes;
  }
  if (!input.products) return notes;

  if (!input.products.some((product) => product.promotionId === announced.id)) {
    notes.push({
      id: "promotion-empty",
      title: "В писмото няма продукт от промоцията",
      detail: `Писмото обявява −${announced.percentOff}%, а под него няма нито един продукт, който промоцията намалява. Добавете продукти от нея — с −${announced.percentOff}% на значката — или изтрийте черновата.`,
      blocksSend: true,
    });
  }
  const short = input.products.filter(
    (product) => (product.discountPercent ?? 0) < announced.percentOff,
  );
  if (short.length > 0) {
    const one = short.length === 1;
    notes.push({
      id: "promotion-claim",
      title: one
        ? `Продукт без −${announced.percentOff}% на значката`
        : `Продукти без −${announced.percentOff}% на значката`,
      detail: `${quoted(short.map((product) => product.title))} — ${
        one ? "значката му не показва" : "значките им не показват"
      } −${announced.percentOff}%, а писмото го обявява: ${
        one ? "няма" : "нямат"
      } 30-дневна история на цената или наскоро ${one ? "е бил" : "са били"} по-евтин${
        one ? "" : "и"
      }. Махнете ${one ? "го" : "ги"} от писмото.`,
      blocksSend: true,
    });
  }
  return notes;
}

function namedNotes(input: ClaimInput, now: Date): DeliverabilityNote[] {
  const notes: DeliverabilityNote[] = [];
  const body = input.body;
  const listed = body === undefined ? null : listedReductions(body);
  for (const { planned, current } of input.named ?? []) {
    /* What the body still says of it: its line, word for word, or one of the
       reductions it priced. Taken out, the promotion is no longer the
       letter's to answer for. */
    const lineThere = body === undefined || (planned.line !== null && body.includes(planned.line));
    const picksThere = listed === null || planned.slugs.some((slug) => listed.has(slug));
    if (!lineThere && !picksThere) continue;
    if (!current) {
      notes.push({
        id: "promotion-ended",
        title: "Промоция, която писмото споменава, вече я няма",
        detail: "Махнете реда за нея и продуктите ѝ или ги заменете.",
        blocksSend: true,
      });
      continue;
    }
    const phase = promotionPhase(current, now);
    if (phase === "stopped" || phase === "ended") {
      notes.push(overNote(current, phase, false));
      continue;
    }
    /* Changed days or name make the line written for it wrong; its products
       are checked on their own (each must still be reduced). */
    const changes = promotionChanges(planned, current, { percent: false });
    if (lineThere && planned.line !== null && changes.length > 0) {
      notes.push({
        id: "promotion-changed",
        title: `Промоцията ${called(current)} е променена`,
        detail: `След като писмото е написано, ${changes.join("; ")}. Редът „${planned.line}“ вече не е верен: махнете го или го напишете отново с новите данни.`,
        blocksSend: true,
      });
    }
  }
  return notes;
}

export function claimNotes(input: ClaimInput): DeliverabilityNote[] {
  const now = input.now ?? new Date();
  return [...announcedNotes(input, now), ...namedNotes(input, now)];
}
