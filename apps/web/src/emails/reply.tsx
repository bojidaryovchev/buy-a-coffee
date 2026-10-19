import { AttachmentList, EmailLayout, Inlines, Paragraph, Signature } from "./components";
import { plainParagraphs } from "./markdown";
import { renderEmail, type ComposedEmail } from "./render";

/**
 * A reply written in the admin panel, as the shop.
 *
 * The plainest template on purpose. What it carries is a sentence a person
 * typed, and wrapping that in labelled panels would make a human answer read
 * like an automated one — the opposite of what a shop selling by phone call
 * wants. So: the letterhead, the text as paragraphs (a blank line typed is a
 * new paragraph, a line break stays a break, and an address typed out becomes
 * a link), the names of the files that travel with it, and the signature.
 *
 * No Markdown: in a reply an asterisk is an asterisk.
 */

export interface ReplyContent {
  readonly body: string;
  /** The address it is sent from (`MAIL_ADDRESS`), printed in the signature. */
  readonly senderAddress: string;
  /** Files attached to this message; listed by name and size, not linked. */
  readonly attachments: readonly { readonly filename: string; readonly size: number }[];
}

export function ReplyEmail({ content }: { content: ReplyContent }) {
  const paragraphs = plainParagraphs(content.body);
  return (
    <EmailLayout preview={content.body.trim().replace(/\s+/g, " ").slice(0, 140)}>
      {paragraphs.map((nodes, index) => (
        <Paragraph key={index}>
          <Inlines nodes={nodes} />
        </Paragraph>
      ))}
      {content.attachments.length > 0 && (
        <AttachmentList
          title="Прикачени файлове"
          items={content.attachments.map((file) => ({ name: file.filename, size: file.size }))}
        />
      )}
      <Signature address={content.senderAddress} />
    </EmailLayout>
  );
}

/**
 * Both parts. The text is the body and the shop's signature, exactly what is
 * stored in the mailbox as the message's text — the thread view finds the
 * signature by its `--` line and hides it.
 */
export async function composeReplyEmail(
  content: ReplyContent,
  signature: readonly string[],
): Promise<ComposedEmail> {
  const text = [content.body.trim(), "", ...signature].join("\n");
  return { html: await renderEmail(<ReplyEmail content={content} />), text };
}
