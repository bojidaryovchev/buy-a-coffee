import { z } from "zod";

/**
 * Validation schemas shared by the server actions and their tests.
 *
 * Every public write endpoint validates here first. Nothing reaches the
 * database that has not passed through one of these.
 */

/**
 * Bulgarian mobile and landline numbers, plus international format.
 * Spaces, dashes and parentheses are accepted because people type them, and
 * are stripped before storage.
 */
const PHONE_PATTERN = /^(?:\+?\d[\d\s\-().]{5,20}\d)$/;

export function normalizePhone(input: string): string {
  const cleaned = input.replace(/[\s\-().]/g, "");
  // 0888... is the national form of +359888...
  if (/^0\d{8,9}$/.test(cleaned)) return `+359${cleaned.slice(1)}`;
  return cleaned;
}

export const phoneSchema = z
  .string()
  .trim()
  .min(6, "Моля, въведете телефонен номер, за да можем да ви се обадим.")
  .max(24, "Този телефонен номер изглежда твърде дълъг.")
  .refine((value) => PHONE_PATTERN.test(value), "Моля, въведете валиден телефонен номер.")
  .transform(normalizePhone);

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(5, "Моля, въведете имейл адреса си.")
  .max(254, "Този имейл адрес е твърде дълъг.")
  .email("Моля, въведете валиден имейл адрес.");

/**
 * Honeypot.
 *
 * A field hidden from humans but visible to naive bots. It must arrive empty;
 * anything else is treated as spam. Cheap, invisible to real users, and it
 * costs nothing in accessibility when the field is properly hidden and
 * excluded from the tab order.
 */
export const honeypotSchema = z
  .string()
  .optional()
  .refine((value) => !value || value.trim() === "", "Отказано.");

export const orderInquirySchema = z.object({
  productSlug: z.string().trim().min(1).max(200),
  phone: phoneSchema,
  customerName: z.string().trim().max(120).optional().or(z.literal("")),
  email: z.union([emailSchema, z.literal("")]).optional(),
  quantity: z.coerce.number().int().min(1, "Количеството трябва да е поне 1.").max(99, "За по-големи поръчки, моля, обадете ни се.").default(1),
  notes: z.string().trim().max(1000, "Моля, ограничете бележката до 1000 знака.").optional().or(z.literal("")),
  website: honeypotSchema,
});

export const newsletterSchema = z.object({
  email: emailSchema,
  source: z.string().trim().max(60).optional(),
  website: honeypotSchema,
});

export const contactSchema = z.object({
  name: z.string().trim().min(2, "Моля, кажете ни името си.").max(120),
  email: emailSchema,
  phone: z.union([phoneSchema, z.literal("")]).optional(),
  subject: z.string().trim().max(160).optional().or(z.literal("")),
  message: z
    .string()
    .trim()
    .min(10, "Моля, напишете малко повече, за да можем да помогнем.")
    .max(4000, "Моля, ограничете съобщението до 4000 знака."),
  website: honeypotSchema,
});

export type OrderInquiryInput = z.infer<typeof orderInquirySchema>;
export type NewsletterInput = z.infer<typeof newsletterSchema>;
export type ContactInput = z.infer<typeof contactSchema>;

/** Uniform result shape for every form action. */
export type FormState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string> };

export const IDLE_FORM_STATE: FormState = { status: "idle" };

/** Flatten Zod issues into one message per field. */
export function toFieldErrors(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    fieldErrors[key] ??= issue.message;
  }
  return fieldErrors;
}
