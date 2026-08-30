"use server";

import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { contactMessages, newsletterSubscribers, orderInquiries, products } from "@catalog/db/schema";
import { db } from "@/lib/db";
import { notify } from "@/lib/notifications";
import {
  clientFingerprint,
  contactLimiter,
  idempotencyKey,
  inquiryLimiter,
  newsletterLimiter,
} from "@/lib/rate-limit";
import {
  type FormState,
  contactSchema,
  newsletterSchema,
  orderInquirySchema,
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
 *   1. rate limit  — before any parsing work is done
 *   2. validate    — Zod, including the honeypot
 *   3. persist     — the record is safe before anything else can fail
 *   4. notify      — best effort; a failure here never fails the request
 */

const GENERIC_ERROR = "Нещо се обърка. Моля, опитайте отново или ни се обадете.";
const RATE_LIMITED = "Твърде много опити. Моля, изчакайте малко и опитайте отново.";

/** Request context that is safe to store: no raw IP, no user agent string. */
async function requestContext(): Promise<{ fingerprint: string; metadata: Record<string, unknown> }> {
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

export async function submitOrderInquiry(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { fingerprint, metadata } = await requestContext();

  const limit = inquiryLimiter.check(fingerprint);
  if (!limit.allowed) return { status: "error", message: RATE_LIMITED };

  const parsed = orderInquirySchema.safeParse({
    productSlug: formData.get("productSlug"),
    phone: formData.get("phone"),
    customerName: formData.get("customerName") ?? "",
    email: formData.get("email") ?? "",
    quantity: formData.get("quantity") ?? 1,
    notes: formData.get("notes") ?? "",
    website: formData.get("website") ?? "",
  });

  if (!parsed.success) {
    const fieldErrors = toFieldErrors(parsed.error);
    // A honeypot hit is spam. Report success so a bot learns nothing, and
    // store nothing.
    if (fieldErrors.website) {
      return { status: "success", message: "Благодарим ви. Ще ви се обадим скоро." };
    }
    return { status: "error", message: "Моля, проверете отбелязаните полета.", fieldErrors };
  }

  const input = parsed.data;

  try {
    const [product] = await db
      .select({ id: products.id, name: products.name, status: products.status })
      .from(products)
      .where(eq(products.slug, input.productSlug))
      .limit(1);

    if (!product) {
      return { status: "error", message: "Не намерихме този продукт. Моля, презаредете страницата и опитайте отново." };
    }
    if (product.status !== "active") {
      return {
        status: "error",
        message: "Този продукт вече не се предлага. Моля, обадете ни се и ще ви предложим алтернатива.",
      };
    }

    const key = idempotencyKey(["inquiry", input.phone, input.productSlug]);

    const [row] = await db
      .insert(orderInquiries)
      .values({
        productId: product.id,
        productName: product.name,
        productSlug: input.productSlug,
        customerName: input.customerName || null,
        phone: input.phone,
        email: input.email || null,
        quantity: input.quantity,
        notes: input.notes || null,
        sourcePage: `/products/${input.productSlug}`,
        idempotencyKey: key,
        requestMetadata: { ...metadata, fingerprint },
      })
      // A double-clicked button must not create two orders.
      .onConflictDoNothing({ target: orderInquiries.idempotencyKey })
      .returning({ id: orderInquiries.id });

    if (!row) {
      // The conflict means an identical enquiry already exists, which from the
      // customer's point of view is a success.
      return { status: "success", message: "Вече получихме заявката ви. Ще ви се обадим скоро." };
    }

    await notify({
      kind: "order_inquiry",
      subject: `Нова заявка за поръчка: ${product.name}`,
      summary: `Количество ${input.quantity}. Данните за контакт са в записа в базата.`,
      recordId: row.id,
    });

    return { status: "success", message: "Благодарим ви. Ще ви се обадим скоро, за да потвърдим." };
  } catch (error) {
    console.error(JSON.stringify({ level: "error", msg: "inquiry.failed", error: String(error) }));
    return { status: "error", message: GENERIC_ERROR };
  }
}

export async function subscribeToNewsletter(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { fingerprint, metadata } = await requestContext();

  const limit = newsletterLimiter.check(fingerprint);
  if (!limit.allowed) return { status: "error", message: RATE_LIMITED };

  const parsed = newsletterSchema.safeParse({
    email: formData.get("email"),
    source: formData.get("source") ?? "",
    website: formData.get("website") ?? "",
  });

  if (!parsed.success) {
    const fieldErrors = toFieldErrors(parsed.error);
    if (fieldErrors.website) return { status: "success", message: "Благодарим ви за абонамента." };
    return { status: "error", message: "Моля, проверете имейл адреса си.", fieldErrors };
  }

  try {
    const [row] = await db
      .insert(newsletterSubscribers)
      .values({
        email: parsed.data.email,
        consentSource: parsed.data.source || "unknown",
        requestMetadata: { ...metadata, fingerprint },
      })
      // Re-subscribing refreshes consent rather than erroring.
      .onConflictDoUpdate({
        target: newsletterSubscribers.email,
        set: { unsubscribedAt: null, consentSource: parsed.data.source || "unknown" },
      })
      .returning({ id: newsletterSubscribers.id });

    if (row) {
      await notify({
        kind: "newsletter_signup",
        subject: "Нов абонат за бюлетина",
        summary: "Адресът е в записа в базата.",
        recordId: row.id,
      });
    }
    return { status: "success", message: "Благодарим ви. Вече сте в списъка." };
  } catch (error) {
    console.error(JSON.stringify({ level: "error", msg: "newsletter.failed", error: String(error) }));
    return { status: "error", message: GENERIC_ERROR };
  }
}

export async function submitContactMessage(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { fingerprint, metadata } = await requestContext();

  const limit = contactLimiter.check(fingerprint);
  if (!limit.allowed) return { status: "error", message: RATE_LIMITED };

  const parsed = contactSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone") ?? "",
    subject: formData.get("subject") ?? "",
    message: formData.get("message"),
    website: formData.get("website") ?? "",
  });

  if (!parsed.success) {
    const fieldErrors = toFieldErrors(parsed.error);
    if (fieldErrors.website) return { status: "success", message: "Благодарим ви. Ще се свържем с вас." };
    return { status: "error", message: "Моля, проверете отбелязаните полета.", fieldErrors };
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

    if (row) {
      await notify({
        kind: "contact_message",
        subject: `Форма за контакт: ${input.subject || "без тема"}`,
        summary: "Съобщението и данните за контакт са в записа в базата.",
        recordId: row.id,
      });
    }

    return { status: "success", message: "Благодарим ви. Ще се свържем с вас скоро." };
  } catch (error) {
    console.error(JSON.stringify({ level: "error", msg: "contact.failed", error: String(error) }));
    return { status: "error", message: GENERIC_ERROR };
  }
}
