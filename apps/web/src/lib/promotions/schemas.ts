import { z } from "zod";
import type { PromotionTargets } from "@catalog/db/schema";
import { daysBetween, isDay, periodLength, todayInSofia, type Day } from "./days";

/**
 * The promotion editor's rules, shared by the form in the browser and the
 * server action, as every panel form shares its schema
 * (`lib/forms/admin-schemas.ts`): a rule and its message exist once.
 *
 * Not in `actions.ts`: that file is `"use server"` and may export async
 * functions only.
 *
 * What a rule depends on beyond the fields — which day it is today, whether
 * the promotion is already running — is passed in: `promotionFormSchema(mode,
 * today)`. The browser builds it with its own clock and the promotion it was
 * drawn for; the action builds it with the server's clock and the promotion
 * as the database has it now, and that answer is the one that counts.
 */

/**
 * The largest reduction the form accepts: `PROMOTION_MAX_PERCENT` of the
 * schema, which the database checks too. Repeated rather than imported because
 * this file runs in the browser and the schema module would bring the table
 * definitions with it; `test/promotion-schemas.test.ts` holds the two equal.
 */
export const PROMOTION_MAX_PERCENT = 50;

/** The percentages offered as one press. */
export const PROMOTION_PRESETS = [5, 10, 15, 20, 25, 30] as const;

/** Above this the form asks "is that right?", and so does the server. */
export const PROMOTION_CONFIRM_ABOVE = 20;

/**
 * The longest promotion, in days. A reduction that lasts for months is no
 * longer a reduction but the price, and the struck price beside it — the
 * lowest of the 30 days before it began — would by then describe a price
 * nobody has paid for a long time. Two months covers a season.
 */
export const PROMOTION_MAX_DAYS = 60;

export const PROMOTION_NAME_MAX = 80;
export const PROMOTION_LABEL_MAX = 40;

/** Per list. Far above the catalog's size; a guard against a hand-made post. */
const MAX_TARGET_IDS = 1000;

export const PROMOTION_MESSAGES = {
  name: "Напишете име на промоцията. Вижда го само вие.",
  nameLong: `Съкратете името до ${PROMOTION_NAME_MAX} знака.`,
  labelLong: `Съкратете надписа до ${PROMOTION_LABEL_MAX} знака.`,
  percent: `Изберете отстъпка или напишете цяло число от 1 до ${PROMOTION_MAX_PERCENT}.`,
  confirm: (percent: number) =>
    `Отбележете „Да, ${percent}% е правилно“: отстъпка над ${PROMOTION_CONFIRM_ABOVE}% е голяма и излиза от вашата печалба.`,
  startDay: "Изберете от кой ден започва.",
  startPast: "Началото не може да е в миналото. Изберете днес или по-късен ден.",
  endDay: "Изберете до кой ден трае.",
  endBeforeStart: "Последният ден не може да е преди първия.",
  endPast: "Последният ден не може да е в миналото. Изберете днес или по-късен ден.",
  tooLong: `Изберете период до ${PROMOTION_MAX_DAYS} дни. Намаление, което трае месеци, вече е просто новата цена, а зачертаната стара цена до него би подвела купувачите.`,
  targets: "Изберете поне една марка, категория или продукт.",
  targetsBroken: "Изборът на продукти не може да бъде прочетен. Презаредете страницата.",
  noPromotion: "Липсва промоция. Презаредете страницата.",
  noVersion: "Страницата е стара. Презаредете я и опитайте отново.",
} as const;

const uuidList = z.array(z.string().uuid()).max(MAX_TARGET_IDS);

/** What a promotion covers, from any JSON the hidden field may hold. */
export const promotionTargetsSchema = z
  .object({
    productIds: uuidList.default([]),
    brandIds: uuidList.default([]),
    categoryIds: uuidList.default([]),
    excludedProductIds: uuidList.default([]),
  })
  .transform((targets): PromotionTargets => ({
    productIds: [...new Set(targets.productIds)],
    brandIds: [...new Set(targets.brandIds)],
    categoryIds: [...new Set(targets.categoryIds)],
    excludedProductIds: [...new Set(targets.excludedProductIds)],
  }));

export function hasInclusion(targets: PromotionTargets): boolean {
  return (
    targets.productIds.length > 0 || targets.brandIds.length > 0 || targets.categoryIds.length > 0
  );
}

/** The hidden field's JSON, read into targets, or refused as a whole. */
const targetsField = z
  .string()
  .default("")
  .transform((raw, context) => {
    try {
      return JSON.parse(raw || "{}") as unknown;
    } catch {
      context.addIssue({ code: z.ZodIssueCode.custom, message: PROMOTION_MESSAGES.targetsBroken });
      return z.NEVER;
    }
  })
  .pipe(
    z.unknown().transform((value, context) => {
      const parsed = promotionTargetsSchema.safeParse(value);
      if (!parsed.success) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: PROMOTION_MESSAGES.targetsBroken,
        });
        return z.NEVER;
      }
      return parsed.data;
    }),
  );

/** A whole number from 1 to the cap, typed or pressed. */
export function parsePercent(value: unknown): number | null {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value : "";
  if (!/^\s*\d{1,3}\s*$/.test(text)) return null;
  const percent = Number(text);
  return percent >= 1 && percent <= PROMOTION_MAX_PERCENT ? percent : null;
}

/** Does this percentage need the "Да, X% е правилно" box? */
export function needsConfirmation(percent: number | null): boolean {
  return percent !== null && percent > PROMOTION_CONFIRM_ABOVE;
}

/**
 * Which form the editor is: a new promotion, one that has not started (all of
 * it can change), or one that is running (the percentage and the start are
 * fixed: changing the percentage mid-run would rewrite what the shop already
 * charged, and the next promotion's 30-day history with it).
 */
export type PromotionFormMode = "new" | "upcoming" | "running";

/** The editor's fields as typed: strings, the targets as JSON. */
export const PROMOTION_FIELDS = [
  "name",
  "label",
  "percent",
  "confirmHigh",
  "startDay",
  "endDay",
  "targets",
] as const;

export function promotionFormSchema(mode: PromotionFormMode, today: Day = todayInSofia()) {
  return z
    .object({
      id: z.string().default(""),
      version: z.string().default(""),
      name: z
        .string()
        .trim()
        .min(1, PROMOTION_MESSAGES.name)
        .max(PROMOTION_NAME_MAX, PROMOTION_MESSAGES.nameLong),
      label: z.string().trim().max(PROMOTION_LABEL_MAX, PROMOTION_MESSAGES.labelLong).default(""),
      percent: z.string().default(""),
      /** The percentage the owner confirmed, when it is above the threshold. */
      confirmHigh: z.union([z.string(), z.boolean()]).optional(),
      startDay: z.string().default(""),
      endDay: z.string().default(""),
      targets: targetsField,
    })
    .superRefine((value, context) => {
      if (value.id !== "" && !z.string().uuid().safeParse(value.id).success) {
        context.addIssue({ code: "custom", path: ["id"], message: PROMOTION_MESSAGES.noPromotion });
      }
      if (mode !== "new" && !/^\d{1,15}$/.test(value.version)) {
        context.addIssue({
          code: "custom",
          path: ["version"],
          message: PROMOTION_MESSAGES.noVersion,
        });
      }

      const percent = parsePercent(value.percent);
      if (percent === null) {
        context.addIssue({
          code: "custom",
          path: ["percent"],
          message: PROMOTION_MESSAGES.percent,
        });
      } else if (
        mode !== "running" &&
        needsConfirmation(percent) &&
        String(value.confirmHigh ?? "") !== String(percent)
      ) {
        context.addIssue({
          code: "custom",
          path: ["confirmHigh"],
          message: PROMOTION_MESSAGES.confirm(percent),
        });
      }

      const start = isDay(value.startDay) ? value.startDay : null;
      const end = isDay(value.endDay) ? value.endDay : null;
      if (!start) {
        context.addIssue({
          code: "custom",
          path: ["startDay"],
          message: PROMOTION_MESSAGES.startDay,
        });
      } else if (mode !== "running" && daysBetween(today, start) < 0) {
        context.addIssue({
          code: "custom",
          path: ["startDay"],
          message: PROMOTION_MESSAGES.startPast,
        });
      }
      if (!end) {
        context.addIssue({ code: "custom", path: ["endDay"], message: PROMOTION_MESSAGES.endDay });
      } else if (start && daysBetween(start, end) < 0) {
        context.addIssue({
          code: "custom",
          path: ["endDay"],
          message: PROMOTION_MESSAGES.endBeforeStart,
        });
      } else if (daysBetween(today, end) < 0) {
        context.addIssue({ code: "custom", path: ["endDay"], message: PROMOTION_MESSAGES.endPast });
      } else if (start && periodLength(start, end) > PROMOTION_MAX_DAYS) {
        context.addIssue({ code: "custom", path: ["endDay"], message: PROMOTION_MESSAGES.tooLong });
      }

      /* Unreadable targets have said so already; what zod hands on for them
         is its "aborted" marker, not targets. */
      if (Array.isArray(value.targets?.productIds) && !hasInclusion(value.targets)) {
        context.addIssue({
          code: "custom",
          path: ["targets"],
          message: PROMOTION_MESSAGES.targets,
        });
      }
    })
    .transform((value) => ({
      id: value.id === "" ? null : value.id,
      version: value.version,
      name: value.name,
      label: value.label === "" ? null : value.label,
      percentOff: parsePercent(value.percent) as number,
      startDay: value.startDay as Day,
      endDay: value.endDay as Day,
      targets: value.targets,
    }));
}

export type PromotionFormSchema = ReturnType<typeof promotionFormSchema>;
export type PromotionFormInput = z.input<PromotionFormSchema>;
export type PromotionDraft = z.output<PromotionFormSchema>;

/**
 * What the live preview is asked: the promotion as the form holds it now,
 * valid or not yet. The preview answers for what it can read and says what
 * it cannot.
 */
export const promotionPreviewSchema = z.object({
  promotionId: z.string().uuid().nullish(),
  percent: z.union([z.string(), z.number()]).transform(parsePercent),
  startDay: z.string().refine(isDay),
  endDay: z.string().refine(isDay),
  targets: promotionTargetsSchema,
});

export type PromotionPreviewRequest = z.output<typeof promotionPreviewSchema>;
