"use server";

import { randomUUID } from "node:crypto";
import { DEFAULT_LOCALE } from "@/i18n/config";
import { href, routes } from "@/lib/routes";
import { headers } from "next/headers";
import { contactMessages } from "@catalog/db/schema";
import { siteConfig } from "@/config/site";
import { cartBlock } from "@/lib/cart/view";
import { listProductsForOrder } from "@/lib/catalog/queries";
import { db } from "@/lib/db";
import { sendOrderConfirmation } from "@/lib/mail/confirmation";
import { contactNotice, orderNotice, signupNotice } from "@/lib/mail/owner-notices";
import { recordReference } from "@/lib/mail/reference";
import { notify } from "@/lib/notifications";
import {
  deliveryColumns,
  deliveryLines,
  fullName,
  type StoredDelivery,
} from "@/lib/orders/delivery";
import { productCount, samePrice } from "@/lib/orders/lines";
import {
  confirmationLines,
  findInquiry,
  itemFor,
  recordInquiry,
  type OrderItem,
} from "@/lib/orders/record";
import {
  clientFingerprint,
  contactLimiter,
  idempotencyKey,
  inquiryLimiter,
  newsletterLimiter,
} from "@/lib/rate-limit";
import { callbackSentence } from "./callback-window";
import { FORM_CONSENT_SOURCES, type FormConsentSource } from "./consent";
import { recordConsent } from "./subscribe";
import {
  CART_MESSAGES,
  CHECK_EMAIL_MESSAGE,
  CHECK_FIELDS_MESSAGE,
  type CartOrderInput,
  type FormState,
  cartOrderSchema,
  contactSchema,
  formText,
  newsletterSchema,
  submittedValues,
  toFieldErrors,
} from "./schemas";

/**
 * Public write endpoints.
 *
 * Server Actions rather than route handlers: Next.js binds each action to an
 * encrypted, origin-checked action id, which gives CSRF protection without a
 * hand-rolled token, and the same function is the only entry point.
 *
 * Every action follows the same order:
 *   1. rate limit  — before any parsing work is done. Shared across
 *                    instances through PostgreSQL, and it fails open: if
 *                    the limiter cannot reach its table the submission
 *                    still goes ahead (see `lib/rate-limit.ts`)
 *   2. validate    — Zod, including the honeypot, with the schema the form
 *                    itself validates with in the browser (`schemas.ts`), so
 *                    a refusal here reads exactly as one there. The browser's
 *                    check is a convenience; this one is the authority, and
 *                    the only one a page without JavaScript gets
 *   3. persist     — the record is safe before anything else can fail
 *   4. notify      — best effort; a failure here never fails the request
 */

/** The fields handed back with a refusal: what a person typed, never the honeypot. */
const CART_FIELDS = [
  "firstName",
  "lastName",
  "phone",
  "deliveryMethod",
  "deliveryCourier",
  "deliveryCity",
  "deliveryPostcode",
  "deliveryAddress",
  "deliveryOffice",
  "email",
  "notes",
  "newsletterConsent",
];
const CONTACT_FIELDS = ["name", "email", "phone", "subject", "message", "newsletterConsent"];

/** How long the same cart from the same phone is one order (`idempotencyKey`). */
const ORDER_WINDOW_MS = 5 * 60_000;

const GENERIC_ERROR = "Нещо се обърка. Моля, опитайте отново или ни се обадете.";
const RATE_LIMITED = "Твърде много опити. Моля, изчакайте малко и опитайте отново.";

/**
 * What the customer is told after an order, with what happens next and when.
 *
 * Built from the clock at the moment of submission, on the server, so the text
 * is the same with JavaScript off and a customer ordering on a Saturday is told
 * to expect the call on Monday. The honeypot branch uses it too: a bot must see
 * exactly what a person sees.
 */
function orderSuccessMessage(lead: string, now: Date = new Date()): string {
  return `${lead} ${callbackSentence(now, siteConfig.commerce.openingHours)}`;
}

/**
 * Subscribe somebody who ticked the box on another form.
 *
 * Runs after the record it belongs to is saved, and swallows its own failure:
 * an order or a message must never be lost, or reported as failed, because a
 * newsletter row could not be written. No notification — this is a customer's
 * tick on a form, not a signup the shop needs to hear about.
 */
async function subscribeFromForm(input: {
  ticked: boolean;
  email: string | undefined;
  source: Exclude<FormConsentSource, "footer">;
  fingerprint: string;
  metadata: Record<string, unknown>;
}): Promise<void> {
  if (!input.ticked || !input.email) return;
  try {
    await recordConsent({
      email: input.email,
      source: input.source,
      metadata: { ...input.metadata, fingerprint: input.fingerprint },
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "newsletter.consent_failed",
        source: input.source,
        error: String(error),
      }),
    );
  }
}

/** Request context that is safe to store: no raw IP, no user agent string. */
async function requestContext(): Promise<{
  fingerprint: string;
  metadata: Record<string, unknown>;
}> {
  const headerList = await headers();
  return {
    fingerprint: clientFingerprint(headerList),
    metadata: {
      // A coarse language hint is useful for follow-up and is not identifying.
      language: headerList.get("accept-language")?.split(",")[0]?.slice(0, 12) ?? null,
      receivedAt: new Date().toISOString(),
    },
  };
}

/**
 * What happens once an order is safely stored: the shop is told, and the
 * customer gets a confirmation if they gave an address. Both are best effort —
 * `notify` and `sendOrderConfirmation` log a failure and never throw — so the
 * customer is answered "received" either way, which is the truth.
 *
 * The shop's mail names the products as the owner orders them (the supplier's
 * names), with what a promotion took off and which promotion it was, and
 * carries no contact detail; the customer's names them as the shop does,
 * reduced only as the page showed them reduced, and carries the number the
 * shop will ring.
 */
async function announceOrder(order: {
  id: string;
  subject: string;
  items: readonly OrderItem[];
  phone: string;
  email: string | null;
  delivery: StoredDelivery;
  callback: string;
}): Promise<void> {
  // The whole order goes in; what the notice may carry is `orderNotice`'s call.
  const customerName = fullName(order.delivery);
  const delivery = deliveryLines(order.delivery);
  await notify(orderNotice({ ...order, customerName, delivery }));

  if (order.email) {
    await sendOrderConfirmation({
      id: order.id,
      email: order.email,
      customerName,
      phone: order.phone,
      lines: confirmationLines(order.items),
      callback: order.callback,
      delivery,
    });
  }
}

/**
 * A reference for the honeypot's answer. A bot must see what a person sees, and
 * a person sees a reference; this one names nothing, because nothing was stored.
 */
const decoyReference = (): string => recordReference(randomUUID());

/**
 * The idempotency keys of an order from the cart: this five-minute window's,
 * which it is stored under, and the window before's, which a press is matched
 * against too.
 *
 * The same customer sending the same cart to the same place twice has ordered
 * once: the phone, the lines (sorted, so the order they happen to be in does
 * not make a second key) and the delivery as it is stored. The same cart from
 * the same phone to another address is another order. No price in it: a
 * second press just after a promotion began or ended is still the same order,
 * not a second one at the new price — the first press's prices stand, and the
 * call confirms them either way. Two windows, so two presses a moment apart are
 * one order even across a window's edge, and promotions begin and end at Sofia
 * midnight, which is always one: a press is one order for between five and ten
 * minutes.
 */
function orderKeys(
  input: CartOrderInput,
  delivery: StoredDelivery,
  now: number,
): { readonly key: string; readonly earlierKey: string } {
  const parts = [
    "cart",
    input.phone,
    delivery.deliveryMethod ?? "",
    delivery.deliveryCourier ?? "",
    delivery.deliveryCity ?? "",
    delivery.deliveryPostcode ?? "",
    delivery.deliveryAddress ?? "",
    delivery.deliveryOffice ?? "",
    ...input.lines.map((line) => `${line.productId}:${line.quantity}`).sort(),
  ];
  return {
    key: idempotencyKey(parts, ORDER_WINDOW_MS, now),
    earlierKey: idempotencyKey(parts, ORDER_WINDOW_MS, now - ORDER_WINDOW_MS),
  };
}

/**
 * An order from the cart: every line in one enquiry, and one phone call.
 *
 * The browser posts product ids and quantities, and the price it showed for
 * each as a hint it is never trusted with. Each line is priced and named
 * here, from the database, and stored as a snapshot (`order_inquiry_items`) —
 * what the customer is called back about is what the shop's catalog said at
 * the moment they pressed the button.
 *
 * A line that cannot be ordered any more — withdrawn, or sold out since the
 * page was drawn — refuses the whole request rather than vanishing from it,
 * and so does a price that is no longer the one the page showed.
 * The page then reloads the cart, shows the line for what it is, and leaves it
 * out; the customer sends again knowing what they are ordering. Quietly
 * ordering two of three products would be a surprise on the phone.
 */
export async function submitCartOrder(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { fingerprint, metadata } = await requestContext();

  // One limit for every order, from whichever form: a phone call each.
  const limit = await inquiryLimiter.check(fingerprint);
  if (!limit.allowed) return { status: "error", message: RATE_LIMITED };

  const parsed = cartOrderSchema.safeParse({
    lines: formText(formData, "lines"),
    firstName: formText(formData, "firstName"),
    lastName: formText(formData, "lastName"),
    phone: formText(formData, "phone"),
    deliveryMethod: formText(formData, "deliveryMethod"),
    deliveryCourier: formText(formData, "deliveryCourier"),
    deliveryCity: formText(formData, "deliveryCity"),
    deliveryPostcode: formText(formData, "deliveryPostcode"),
    deliveryAddress: formText(formData, "deliveryAddress"),
    deliveryOffice: formText(formData, "deliveryOffice"),
    email: formText(formData, "email"),
    notes: formText(formData, "notes"),
    newsletterConsent: formData.get("newsletterConsent"),
    website: formText(formData, "website"),
  });

  if (!parsed.success) {
    const fieldErrors = toFieldErrors(parsed.error);
    if (fieldErrors.website) {
      return {
        status: "success",
        message: orderSuccessMessage("Благодарим ви."),
        reference: decoyReference(),
      };
    }
    return {
      status: "error",
      // The lines have no field to stand under: their message is the form's.
      message: fieldErrors.lines ?? CHECK_FIELDS_MESSAGE,
      fieldErrors,
      values: submittedValues(formData, CART_FIELDS),
    };
  }

  const input = parsed.data;

  try {
    const delivery = deliveryColumns(input);
    const { key, earlierKey } = orderKeys(input, delivery, Date.now());

    /*
     * A repeat of an order already taken is answered as that order, before
     * anything about the cart is checked again: whatever happened since — a
     * product sold out, a price moved at midnight — the first press's order
     * stands, and the customer is shown its reference, not a refusal.
     */
    const repeat = await findInquiry([key, earlierKey]);
    if (repeat) {
      await subscribeFromForm({
        ticked: input.newsletterConsent,
        email: input.email || undefined,
        source: "cart_form",
        fingerprint,
        metadata,
      });
      return {
        status: "success",
        message: orderSuccessMessage("Вече получихме заявката ви."),
        reference: recordReference(repeat),
      };
    }

    const found = await listProductsForOrder(input.lines.map((line) => line.productId));

    const refused = input.lines.filter((line) => {
      const product = found.get(line.productId);
      return !product || cartBlock(product.status, product.card.availability) !== null;
    });
    if (refused.length > 0) {
      const names = refused.flatMap((line) => {
        const product = found.get(line.productId);
        return product ? [product.card.name] : [];
      });
      return {
        status: "error",
        message:
          names.length > 0
            ? `Вече не можем да приемем поръчка за ${names.join(", ")}. Прегледайте количката и изпратете отново.`
            : "Продукт от количката вече не се предлага. Прегледайте количката и изпратете отново.",
        values: submittedValues(formData, CART_FIELDS),
      };
    }

    const items = input.lines.map((line) => itemFor(found.get(line.productId)!, line.quantity));
    const units = items.reduce((sum, item) => sum + item.quantity, 0);

    /*
     * A price that moved since the page showed it refuses the order, as a
     * withdrawn product does: the page asks again, shows the new price, and
     * the customer sends what they have seen. The page's price is a hint and
     * only compared; what is stored is read here.
     */
    const repriced = input.lines.some(
      (line, index) => line.price !== undefined && !samePrice(line.price, items[index]!.unitPrice),
    );
    if (repriced) {
      return {
        status: "error",
        message: CART_MESSAGES.repriced,
        values: submittedValues(formData, CART_FIELDS),
      };
    }
    const callback = callbackSentence(new Date(), siteConfig.commerce.openingHours);

    const {
      id,
      created,
      items: stored,
    } = await recordInquiry(
      {
        // A cart names no single product; its lines are in the items. The
        // quantity is every unit in it, for anything that reads the old shape.
        productId: null,
        productName: null,
        productSlug: null,
        ...delivery,
        phone: input.phone,
        email: input.email || null,
        quantity: units,
        notes: input.notes || null,
        // As for the quick order: the Bulgarian page, the only one that ships.
        sourcePage: href(DEFAULT_LOCALE, routes.cart),
        idempotencyKey: key,
        requestMetadata: { ...metadata, fingerprint },
      },
      items,
      { earlierKeys: [earlierKey] },
    );

    await subscribeFromForm({
      ticked: input.newsletterConsent,
      email: input.email || undefined,
      source: "cart_form",
      fingerprint,
      metadata,
    });

    if (!created) {
      return {
        status: "success",
        message: orderSuccessMessage("Вече получихме заявката ви."),
        reference: recordReference(id),
      };
    }

    await announceOrder({
      id,
      subject: `Нова заявка от количката: ${productCount(items.length)}, ${units} бр.`,
      // As stored: with the names of the promotions that priced them.
      items: stored,
      phone: input.phone,
      email: input.email || null,
      delivery,
      callback,
    });

    return {
      status: "success",
      message: `Благодарим ви. ${callback}`,
      reference: recordReference(id),
    };
  } catch (error) {
    console.error(
      JSON.stringify({ level: "error", msg: "cart_order.failed", error: String(error) }),
    );
    return {
      status: "error",
      message: GENERIC_ERROR,
      values: submittedValues(formData, CART_FIELDS),
    };
  }
}

export async function subscribeToNewsletter(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { fingerprint, metadata } = await requestContext();

  const limit = await newsletterLimiter.check(fingerprint);
  if (!limit.allowed) return { status: "error", message: RATE_LIMITED };

  const parsed = newsletterSchema.safeParse({
    email: formText(formData, "email"),
    source: formText(formData, "source"),
    website: formText(formData, "website"),
  });

  if (!parsed.success) {
    const fieldErrors = toFieldErrors(parsed.error);
    if (fieldErrors.website) return { status: "success", message: "Благодарим ви за абонамента." };
    return {
      status: "error",
      message: CHECK_EMAIL_MESSAGE,
      fieldErrors,
      values: submittedValues(formData, ["email"]),
    };
  }

  try {
    // The source is a hidden field, so it is whatever a client sends: only a
    // code this site knows is kept as the record of "how".
    const source =
      parsed.data.source && Object.hasOwn(FORM_CONSENT_SOURCES, parsed.data.source)
        ? parsed.data.source
        : "unknown";
    const row = await recordConsent({
      email: parsed.data.email,
      source,
      metadata: { ...metadata, fingerprint },
    });

    if (row.created) {
      await notify(signupNotice({ id: row.id, email: parsed.data.email }));
    }
    return { status: "success", message: "Благодарим ви. Вече сте в списъка." };
  } catch (error) {
    console.error(
      JSON.stringify({ level: "error", msg: "newsletter.failed", error: String(error) }),
    );
    return { status: "error", message: GENERIC_ERROR };
  }
}

export async function submitContactMessage(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { fingerprint, metadata } = await requestContext();

  const limit = await contactLimiter.check(fingerprint);
  if (!limit.allowed) return { status: "error", message: RATE_LIMITED };

  const parsed = contactSchema.safeParse({
    name: formText(formData, "name"),
    email: formText(formData, "email"),
    phone: formText(formData, "phone"),
    subject: formText(formData, "subject"),
    message: formText(formData, "message"),
    newsletterConsent: formData.get("newsletterConsent"),
    website: formText(formData, "website"),
  });

  if (!parsed.success) {
    const fieldErrors = toFieldErrors(parsed.error);
    if (fieldErrors.website)
      return { status: "success", message: "Благодарим ви. Ще се свържем с вас." };
    return {
      status: "error",
      message: CHECK_FIELDS_MESSAGE,
      fieldErrors,
      values: submittedValues(formData, CONTACT_FIELDS),
    };
  }

  const input = parsed.data;

  try {
    const key = idempotencyKey(["contact", input.email, input.message.slice(0, 64)]);

    const [row] = await db
      .insert(contactMessages)
      .values({
        name: input.name,
        email: input.email,
        phone: input.phone || null,
        subject: input.subject || null,
        message: input.message,
        idempotencyKey: key,
        requestMetadata: { ...metadata, fingerprint },
      })
      .onConflictDoNothing({ target: contactMessages.idempotencyKey })
      .returning({ id: contactMessages.id });

    await subscribeFromForm({
      ticked: input.newsletterConsent,
      email: input.email,
      source: "contact_form",
      fingerprint,
      metadata,
    });

    if (row) {
      await notify(
        contactNotice({
          id: row.id,
          subject: input.subject || null,
          name: input.name || null,
          email: input.email,
          phone: input.phone || null,
          message: input.message,
        }),
      );
    }

    return { status: "success", message: "Благодарим ви. Ще се свържем с вас скоро." };
  } catch (error) {
    console.error(JSON.stringify({ level: "error", msg: "contact.failed", error: String(error) }));
    return { status: "error", message: GENERIC_ERROR };
  }
}
