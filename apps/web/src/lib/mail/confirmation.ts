import "server-only";
import { orderLinesText, type OrderLine } from "@/lib/orders/lines";
import { asHtml } from "./html";
import { MAIL_FROM, MAIL_SIGNATURE } from "./identity";
import { orderThreadSubject, recordReference } from "./reference";

/**
 * The confirmation a customer gets after an order, when they gave an address.
 *
 * The privacy policy has said since launch that Resend sends "потвърждението
 * до вас", and until the cart nothing did. This is that message, for both
 * order forms.
 *
 * What it is for: the reference, what was asked for at what price, and the
 * number we are going to ring — printed back so a mistyped digit is noticed
 * now and not when the call fails. The phone is the customer's own, sent to the
 * address they gave on the same form; the rule that keeps contact details out
 * of mail (`notify-sink.ts`) is about the shop's inbox, where they would be a
 * second copy.
 *
 * It goes out under the order's thread subject (`orderThreadSubject`). A reply
 * to it reaches the shop's mailbox under that subject, and a reply from the
 * panel later finds the same conversation.
 *
 * **Never blocks the order.** It runs after the enquiry is stored, and every
 * failure — no key configured, Resend refusing, the network — is a log line
 * with the record's id, never an error for the customer. The log carries no
 * address and no number.
 */

export interface OrderConfirmation {
  /** The stored enquiry's id. */
  readonly id: string;
  readonly email: string;
  readonly customerName: string | null;
  /** The normalised number the shop will call. */
  readonly phone: string;
  /** Under the shop's names for the products (`displayName`), never the supplier's. */
  readonly lines: readonly OrderLine[];
  /** When to expect the call (`callbackSentence`), worked out when the order came in. */
  readonly callback: string;
}

export function composeOrderConfirmation(order: OrderConfirmation): {
  subject: string;
  text: string;
  html: string;
} {
  const name = order.customerName?.trim();
  const text = [
    name ? `Здравейте, ${name},` : "Здравейте,",
    "",
    `Получихме заявката ви. Референцията ѝ е ${recordReference(order.id)}.`,
    `${order.callback} Ще звъним на ${order.phone}.`,
    "",
    "Какво поискахте:",
    ...orderLinesText(order.lines),
    "",
    "Цените са към момента на заявката. Наличността, крайната сума и доставката потвърждаваме по телефона; поръчка има едва след този разговор и на сайта нищо не се плаща.",
    "",
    "Ако номерът е сгрешен или искате да промените нещо, отговорете на това писмо или ни се обадете.",
    "",
    ...MAIL_SIGNATURE,
  ].join("\n");

  return { subject: orderThreadSubject(order.id), text, html: asHtml(text) };
}

/** Send it, or log why not. Never throws. */
export async function sendOrderConfirmation(order: OrderConfirmation): Promise<{ sent: boolean }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.info(
      JSON.stringify({
        level: "info",
        msg: "confirmation.skipped",
        recordId: order.id,
        reason: "RESEND_API_KEY is not set",
      }),
    );
    return { sent: false };
  }

  try {
    const { subject, text, html } = composeOrderConfirmation(order);
    const { Resend } = await import("resend");
    const { error } = await new Resend(key).emails.send({
      from: MAIL_FROM,
      to: order.email,
      subject,
      text,
      html,
    });
    if (error) throw new Error(error.message);
    return { sent: true };
  } catch (error) {
    // The order is stored; only the confirmation is lost. The panel still has
    // the address, and the operator can write from there.
    console.error(
      JSON.stringify({
        level: "error",
        msg: "confirmation.failed",
        recordId: order.id,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return { sent: false };
  }
}
