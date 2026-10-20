import type { OrderLine } from "@/lib/orders/lines";
import { orderLinesText } from "@/lib/orders/lines";
import { EmailLayout, Heading, Label, OrderLines, Paragraph } from "./components";
import { renderEmail, type ComposedEmail } from "./render";

/**
 * The confirmation a customer gets after an order, when they gave an address.
 *
 * Sent by `lib/mail/confirmation.ts`, which decides when and to whom; this is
 * only what it says. In the order a customer reads it: that it arrived and its
 * reference, when we ring and on which number (printed back, so a mistyped
 * digit is noticed now and not when the call fails), what was asked for at
 * what price, where it goes (printed back for the same reason), and then what
 * the call decides — because nothing is ordered or
 * paid on the site, and the message must not read as if it had been.
 *
 * No signature block in the HTML: the letterhead's footer already carries the
 * phone, the address and the hours, and twice in one screen is noise. The text
 * part keeps its signature, having no footer.
 */

export interface OrderConfirmationContent {
  /** "A1B2C3D4" (`recordReference`). */
  readonly reference: string;
  readonly customerName: string | null;
  /** The normalised number the shop will call. */
  readonly phone: string;
  /**
   * Under the shop's names for the products, never the supplier's; a reduced
   * line with the struck price and the badge the page showed, and never the
   * name the owner gave a promotion (`confirmationLines`).
   */
  readonly lines: readonly OrderLine[];
  /** When to expect the call (`callbackSentence`). */
  readonly callback: string;
  /**
   * Where it goes, as the lines of a label (`deliveryLines`). Absent for an
   * order taken before the form asked for a delivery.
   */
  readonly delivery?: readonly string[] | null;
}

const PRICES_NOTE =
  "Цените са към момента на заявката. Наличността, крайната сума и доставката потвърждаваме по телефона; поръчка има едва след този разговор и на сайта нищо не се плаща.";
const CHANGES_NOTE =
  "Ако номерът или адресът са сгрешени или искате да промените нещо, отговорете на това писмо или ни се обадете.";

function greeting(name: string | null): string {
  const trimmed = name?.trim();
  return trimmed ? `Здравейте, ${trimmed},` : "Здравейте,";
}

export function OrderConfirmationEmail({ order }: { order: OrderConfirmationContent }) {
  return (
    <EmailLayout preview={`Референция ${order.reference}. ${order.callback}`}>
      <Label>{`Заявка ${order.reference}`}</Label>
      <Heading>Получихме заявката ви</Heading>
      <Paragraph>{greeting(order.customerName)}</Paragraph>
      <Paragraph>
        Референцията ѝ е <strong>{order.reference}</strong>. {order.callback} Ще звъним на{" "}
        <strong style={{ whiteSpace: "nowrap" }}>{order.phone}</strong>.
      </Paragraph>

      <Heading level={2}>Какво поискахте</Heading>
      <OrderLines lines={order.lines} />

      {order.delivery && order.delivery.length > 0 && (
        <>
          <Heading level={2}>Къде доставяме</Heading>
          <Paragraph>
            {order.delivery.map((line, index) => (
              <span key={index}>
                {index > 0 && <br />}
                {line}
              </span>
            ))}
          </Paragraph>
        </>
      )}

      <Heading level={2}>Какво следва</Heading>
      <Paragraph tone="secondary">{PRICES_NOTE}</Paragraph>
      <Paragraph tone="secondary" style={{ margin: 0 }}>
        {CHANGES_NOTE}
      </Paragraph>
    </EmailLayout>
  );
}

/**
 * Both parts. The text is the message as it has always read, line for line;
 * `signature` is the shop's (`MAIL_SIGNATURE`), passed in because it carries
 * the configured sender address, which only the server knows.
 */
export async function composeOrderConfirmationEmail(
  order: OrderConfirmationContent,
  signature: readonly string[],
): Promise<ComposedEmail> {
  const text = [
    greeting(order.customerName),
    "",
    `Получихме заявката ви. Референцията ѝ е ${order.reference}.`,
    `${order.callback} Ще звъним на ${order.phone}.`,
    "",
    "Какво поискахте:",
    ...orderLinesText(order.lines),
    "",
    ...(order.delivery && order.delivery.length > 0
      ? ["Къде доставяме:", ...order.delivery, ""]
      : []),
    PRICES_NOTE,
    "",
    CHANGES_NOTE,
    "",
    ...signature,
  ].join("\n");

  return { html: await renderEmail(<OrderConfirmationEmail order={order} />), text };
}
