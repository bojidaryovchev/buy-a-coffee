import { z } from "zod";
import { MAX_CART_LINES, MAX_QUANTITY, MIN_QUANTITY, isProductId } from "@/lib/cart/cart";
import { isPlausibleToken } from "./unsubscribe-token";

/**
 * Validation schemas for the storefront's forms: one per form, and the same
 * object on both sides.
 *
 * The server action validates every submission with it before anything is
 * stored, and the form validates with it in the browser (react-hook-form, through
 * `@hookform/resolvers/zod`) before anything is sent. So a rule and its message
 * exist once: what a person reads under a field is the same sentence whether
 * the browser found the problem or the server did, and the browser can never
 * accept something the server refuses or the other way round.
 *
 * That is also why this file holds no `server-only` and imports nothing that
 * does: it is in the client bundle on purpose.
 *
 * Every message a person can see is written to say what to do („Въведете…“),
 * as `DESIGN.md` ("Inputs") asks. Messages for hidden fields are seen only by
 * someone posting by hand, and say the one useful thing: reload.
 */

/** Digits a phone number must have: 02 123 4567 (Sofia) has nine. */
const PHONE_MIN_DIGITS = 9;
/** E.164's ceiling. */
const PHONE_MAX_DIGITS = 15;
/**
 * What a typed number may contain: an optional leading plus, digits, and the
 * spaces, dashes, dots and parentheses people type between them. The
 * separators are stripped before storage.
 */
const PHONE_CHARACTERS = /^\+?[\d\s\-().]+$/;

export const PHONE_MESSAGES = {
  missing: "Въведете телефонен номер, за да можем да ви се обадим.",
  characters: "Въведете номера само с цифри, например 0888 123 456.",
  short: `Въведете телефонен номер с поне ${PHONE_MIN_DIGITS} цифри.`,
  long: `Въведете телефонен номер с не повече от ${PHONE_MAX_DIGITS} цифри.`,
} as const;

export function normalizePhone(input: string): string {
  const cleaned = input.replace(/[\s\-().]/g, "");
  // 0888... is the national form of +359888...
  if (/^0\d{8,9}$/.test(cleaned)) return `+359${cleaned.slice(1)}`;
  return cleaned;
}

/** The one thing wrong with a typed number, or null. In the order a person fixes them. */
function phoneProblem(value: string): string | null {
  if (value === "") return PHONE_MESSAGES.missing;
  if (!PHONE_CHARACTERS.test(value)) return PHONE_MESSAGES.characters;
  const digits = value.replace(/\D/g, "").length;
  if (digits < PHONE_MIN_DIGITS) return PHONE_MESSAGES.short;
  if (digits > PHONE_MAX_DIGITS) return PHONE_MESSAGES.long;
  return null;
}

export const phoneSchema = z
  .string()
  .trim()
  .superRefine((value, context) => {
    const message = phoneProblem(value);
    if (message) context.addIssue({ code: z.ZodIssueCode.custom, message });
  })
  .transform(normalizePhone);

/**
 * A phone number a form may leave empty. Written as one rule rather than a
 * union with `z.literal("")`: a union that fails reports "Invalid input" on
 * the server and a member's message in the browser, and the two must read the
 * same.
 */
export const optionalPhoneSchema = z
  .string()
  .trim()
  .superRefine((value, context) => {
    const message = value === "" ? null : phoneProblem(value);
    if (message) context.addIssue({ code: z.ZodIssueCode.custom, message });
  })
  .transform((value) => (value === "" ? "" : normalizePhone(value)))
  .optional();

export const EMAIL_MESSAGES = {
  missing: "Въведете имейл адреса си.",
  format: "Въведете целия имейл адрес, например ivan@example.com.",
  long: "Въведете имейл адрес до 254 знака.",
} as const;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, EMAIL_MESSAGES.missing)
  .max(254, EMAIL_MESSAGES.long)
  .email(EMAIL_MESSAGES.format);

/** An address a form may leave empty; one rule, for the reason `optionalPhoneSchema` gives. */
export const optionalEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, EMAIL_MESSAGES.long)
  .refine(
    (value) => value === "" || z.string().email().safeParse(value).success,
    EMAIL_MESSAGES.format,
  )
  .optional();

/**
 * Honeypot.
 *
 * A field hidden from humans but visible to naive bots. It must arrive empty;
 * anything else is treated as spam. Cheap, invisible to real users, and it
 * costs nothing in accessibility when the field is properly hidden and
 * excluded from the tab order.
 *
 * The browser never validates it: the forms do not register it, so it is not
 * among the values the browser checks, and it is posted exactly as the page
 * holds it. Only the server looks, and answers a filled one as if it had
 * succeeded, so a bot learns nothing.
 */
export const honeypotSchema = z
  .string()
  .optional()
  .refine((value) => !value || value.trim() === "", "Отказано.");

/**
 * An HTML checkbox: the browser sends its value when it is ticked and nothing
 * at all when it is not, and react-hook-form reports it as `true` or `false`.
 * Anything but a plain "ticked" reads as not ticked, and this never fails — a
 * consent box is optional, so it must not be able to be the reason a form is
 * refused.
 */
export const checkboxSchema = z.preprocess(
  (value) => value === true || value === "on" || value === "true" || value === "1",
  z.boolean(),
);

/** For a field the page fills in itself: only a hand-made post can get it wrong. */
const RELOAD = "Презаредете страницата и опитайте отново.";

/** A note to the order, in the customer's words. */
const notesSchema = z.string().trim().max(1000, "Съкратете бележката до 1000 знака.").optional();

/* --- Who the order is for, and where it goes ------------------------------- */

/**
 * Where an order is delivered: to an address, or to a courier's office or
 * locker for the customer to collect, which is how most people in Bulgaria
 * take a parcel.
 */
export const DELIVERY_METHODS = ["address", "office"] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];

/**
 * The couriers the shop sends with (the owner, 19 October 2026), named as a
 * customer reads them. BOX NOW delivers only to its own lockers, so an address
 * can go by Econt or Speedy and an office or locker by any of the three.
 */
export const COURIERS = { econt: "Еконт", speedy: "Спиди", boxnow: "BOX NOW" } as const;
export type Courier = keyof typeof COURIERS;
export const COURIERS_FOR: Readonly<Record<DeliveryMethod, readonly Courier[]>> = {
  address: ["econt", "speedy"],
  office: ["econt", "speedy", "boxnow"],
};

export const DELIVERY_MESSAGES = {
  firstName: "Въведете името си.",
  lastName: "Въведете фамилията си.",
  nameLong: "Съкратете до 60 знака.",
  method: "Изберете дали да доставим до адрес или до офис или автомат.",
  courier: "Изберете куриер.",
  city: "Въведете населеното място.",
  cityLong: "Съкратете до 80 знака.",
  postcode: "Въведете пощенския код: 4 цифри, например 4000.",
  address: "Въведете улица и номер, или квартал, блок, вход и апартамент.",
  addressLong: "Съкратете адреса до 200 знака.",
  office: "Напишете кой офис или автомат, например „Пловдив Център“.",
  officeLong: "Съкратете до 200 знака.",
} as const;

/** A Bulgarian postcode: four digits. */
const POSTCODE = /^\d{4}$/;

/**
 * Text a person must type. `default("")` makes a field missing from a post read
 * as empty, so it fails with this message rather than zod's English one.
 */
const requiredText = (missing: string, max: number, long: string) =>
  z.string().trim().min(1, missing).max(max, long).default("");

const isDeliveryMethod = (value: string): value is DeliveryMethod =>
  (DELIVERY_METHODS as readonly string[]).includes(value);

/**
 * Everything the courier needs, so the call only confirms the order and never
 * has to ask for a detail.
 *
 * The fields of both delivery methods are always in the shape; which of them
 * are required depends on the method, so `checkDelivery` decides that. A field
 * of the method not chosen may hold whatever was typed before switching, and is
 * dropped when the order is stored (`deliveryColumns` in `lib/orders/delivery`).
 *
 * Nothing here can fail with a type error, only with a message. A type error
 * would stop zod before the object-level check runs, and a person pressing the
 * button on an empty form must see every missing field at once.
 */
export const deliveryShape = {
  firstName: requiredText(DELIVERY_MESSAGES.firstName, 60, DELIVERY_MESSAGES.nameLong),
  lastName: requiredText(DELIVERY_MESSAGES.lastName, 60, DELIVERY_MESSAGES.nameLong),
  deliveryMethod: z.string().trim().default("").refine(isDeliveryMethod, DELIVERY_MESSAGES.method),
  deliveryCourier: z.string().trim().default(""),
  deliveryCity: requiredText(DELIVERY_MESSAGES.city, 80, DELIVERY_MESSAGES.cityLong),
  deliveryPostcode: z.string().trim().default(""),
  deliveryAddress: z.string().trim().max(200, DELIVERY_MESSAGES.addressLong).default(""),
  deliveryOffice: z.string().trim().max(200, DELIVERY_MESSAGES.officeLong).default(""),
};

/** The fields the chosen method requires, each reported under its own input. */
export function checkDelivery(
  value: {
    readonly deliveryMethod: string;
    readonly deliveryCourier: string;
    readonly deliveryPostcode: string;
    readonly deliveryAddress: string;
    readonly deliveryOffice: string;
  },
  context: z.RefinementCtx,
): void {
  const missing = (field: string, message: string) =>
    context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message });
  if (isDeliveryMethod(value.deliveryMethod)) {
    const offered: readonly string[] = COURIERS_FOR[value.deliveryMethod];
    if (!offered.includes(value.deliveryCourier))
      missing("deliveryCourier", DELIVERY_MESSAGES.courier);
  }
  if (value.deliveryMethod === "address") {
    if (!POSTCODE.test(value.deliveryPostcode))
      missing("deliveryPostcode", DELIVERY_MESSAGES.postcode);
    if (value.deliveryAddress === "") missing("deliveryAddress", DELIVERY_MESSAGES.address);
  } else if (value.deliveryMethod === "office") {
    if (value.deliveryOffice === "") missing("deliveryOffice", DELIVERY_MESSAGES.office);
  }
}

/** Who and where, with the fields the chosen method requires. */
export const deliverySchema = z.object(deliveryShape).superRefine(checkDelivery);

export const CART_MESSAGES = {
  empty: "Количката е празна. Добавете продукт и изпратете отново.",
  changed: "Количката се промени в друг прозорец. Презаредете страницата и изпратете отново.",
} as const;

/**
 * The cart's lines, as the order form posts them: one hidden field holding the
 * JSON the page wrote from the cart (`[{"productId": "…", "quantity": 2}]`).
 *
 * The page writes it, so only a hand-made post — or a cart changed in another
 * tab between drawing and sending — gets it wrong, and the message says to
 * reload. The ids and quantities are all the browser is trusted with; what each
 * product is and costs is read from the database by the action.
 */
const cartLineSchema = z.object({
  productId: z.string().refine(isProductId, CART_MESSAGES.changed),
  quantity: z
    .number({ invalid_type_error: CART_MESSAGES.changed })
    .int(CART_MESSAGES.changed)
    .min(MIN_QUANTITY, CART_MESSAGES.changed)
    .max(MAX_QUANTITY, CART_MESSAGES.changed),
});

const parseLines = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  if (value.trim() === "") return [];
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

export const cartLinesSchema = z.preprocess(
  parseLines,
  z
    .array(cartLineSchema, { invalid_type_error: CART_MESSAGES.changed })
    .min(1, CART_MESSAGES.empty)
    .max(MAX_CART_LINES, CART_MESSAGES.changed)
    .refine(
      (lines) => new Set(lines.map((line) => line.productId)).size === lines.length,
      CART_MESSAGES.changed,
    ),
);

/**
 * The order form: the cart's lines, and who the order is for and where it
 * goes. A name, a phone number and a delivery are required, so the call back
 * only confirms the order; an email and a note stay optional.
 */
export const cartOrderSchema = z
  .object({
    lines: cartLinesSchema,
    phone: phoneSchema,
    email: optionalEmailSchema,
    notes: notesSchema,
    /** Unticked by default. Only means anything when an email was given. */
    newsletterConsent: checkboxSchema,
    website: honeypotSchema,
  })
  /* The delivery is checked as its own object, beside the rest rather than
     inside it. An object-level check is skipped once any field has aborted,
     and a wrong phone number aborts (its transform does); checked apart,
     the postcode and the street are reported on the same press as the phone. */
  .and(deliverySchema);

export const newsletterSchema = z.object({
  email: emailSchema,
  source: z.string().trim().max(60, RELOAD).optional(),
  website: honeypotSchema,
});

export const CONTACT_MESSAGES = {
  nameMissing: "Въведете името си.",
  nameShort: "Въведете името си, поне 2 знака.",
  messageMissing: "Напишете съобщението си.",
  messageShort: "Напишете поне 10 знака, за да разберем с какво да помогнем.",
} as const;

export const contactSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, CONTACT_MESSAGES.nameMissing)
    .min(2, CONTACT_MESSAGES.nameShort)
    .max(120, "Съкратете името до 120 знака."),
  email: emailSchema,
  phone: optionalPhoneSchema,
  subject: z.string().trim().max(160, "Съкратете темата до 160 знака.").optional(),
  message: z
    .string()
    .trim()
    .min(1, CONTACT_MESSAGES.messageMissing)
    .min(10, CONTACT_MESSAGES.messageShort)
    .max(4000, "Съкратете съобщението до 4000 знака."),
  newsletterConsent: checkboxSchema,
  website: honeypotSchema,
});

/**
 * The unsubscribe button. Both fields are the page's own; a token that cannot
 * be one of ours is answered with the page that says the link is not active.
 */
export const unsubscribeSchema = z.object({
  token: z.string().refine(isPlausibleToken, "Отворете връзката от писмото отново."),
  locale: z.string().max(10, RELOAD).optional(),
});

export type CartOrderInput = z.infer<typeof cartOrderSchema>;
export type NewsletterInput = z.infer<typeof newsletterSchema>;
export type ContactInput = z.infer<typeof contactSchema>;

/* The answer's shape and the form-level lines are in a module without zod, so
   a component that needs only them does not bring zod along (`form-state.ts`).
   Re-exported here, where every form has always found them. */
export {
  CHECK_EMAIL_MESSAGE,
  CHECK_FIELDS_MESSAGE,
  IDLE_FORM_STATE,
  type FormState,
} from "./form-state";

/** Flatten Zod issues into one message per field. */
export function toFieldErrors(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    fieldErrors[key] ??= issue.message;
  }
  return fieldErrors;
}

/**
 * A text field off a submitted form: "" when it is missing or is not text.
 *
 * A browser always sends a text field, empty or not. Only a hand-made post
 * leaves one out, and reading that as "" lets the schema answer it with the
 * same Bulgarian sentence as an empty field, instead of zod's English
 * "Expected string, received null".
 */
export function formText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** The named text fields as they were typed, to hand back with an error. */
export function submittedValues(
  formData: FormData,
  names: readonly string[],
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const name of names) {
    const value = formData.get(name);
    // Bounded, so a hand-made post cannot make the answer large.
    if (typeof value === "string") values[name] = value.slice(0, 4000);
  }
  return values;
}
