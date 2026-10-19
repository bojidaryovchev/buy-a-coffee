import type { OrderLine } from "@/lib/orders/lines";
import {
  ButtonRow,
  EmailLayout,
  Heading,
  Inlines,
  Label,
  OrderLines,
  Paragraph,
} from "./components";
import { plainParagraphs } from "./markdown";
import { renderEmail, type ComposedEmail } from "./render";

/**
 * The shop's own notification: something arrived, and here is the link.
 *
 * Sent by `lib/mail/notify-sink.ts` for every kind of record. What it does
 * NOT carry is deliberate and is the sink's rule, not this file's: no phone
 * number, no address, no message text from a customer. The record is behind
 * the panel's password, and a copy in an inbox would be a second place with
 * weaker access control. So the content is the summary the caller wrote — for
 * an order, the products as the owner orders them — and the button.
 */

export interface OwnerNotificationContent {
  /** A label of a few words over the heading: "Нова заявка". */
  readonly label: string;
  /** The message's subject, repeated as its heading. */
  readonly subject: string;
  /** The caller's summary, as text. Shown when there are no `lines`. */
  readonly summary: string;
  /** An order's lines, drawn as a table instead of the summary's text. */
  readonly lines?: readonly OrderLine[];
  /** Absolute link to the record in the panel. */
  readonly link: string;
  /** The closing lines under the signature delimiter, e.g. where the contact
      details are. */
  readonly footnote: readonly string[];
}

export function OwnerNotificationEmail({ content }: { content: OwnerNotificationContent }) {
  return (
    <EmailLayout preview={content.footnote[0] ?? content.subject}>
      <Label>{content.label}</Label>
      <Heading>{content.subject}</Heading>
      {content.lines && content.lines.length > 0 ? (
        <OrderLines lines={content.lines} />
      ) : (
        plainParagraphs(content.summary).map((nodes, index) => (
          <Paragraph key={index}>
            <Inlines nodes={nodes} />
          </Paragraph>
        ))
      )}
      <ButtonRow href={content.link}>Отворете в панела</ButtonRow>
      {content.footnote.map((line) => (
        <Paragraph key={line} tone="meta" size="small" style={{ margin: "0 0 4px" }}>
          {line}
        </Paragraph>
      ))}
    </EmailLayout>
  );
}

/** Both parts. The text is the notification as it has always read. */
export async function composeOwnerNotificationEmail(
  content: OwnerNotificationContent,
): Promise<ComposedEmail> {
  const text = [
    content.summary,
    "",
    `Отворете в панела: ${content.link}`,
    "",
    "--",
    ...content.footnote,
  ].join("\n");
  return { html: await renderEmail(<OwnerNotificationEmail content={content} />), text };
}
