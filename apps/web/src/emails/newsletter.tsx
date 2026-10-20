import type { NewsletterAttachment } from "@catalog/db/schema";
import { siteConfig } from "@/config/site";
import {
  AttachmentList,
  BulletList,
  Callout,
  EmailLayout,
  Heading,
  ImageBlock,
  Inlines,
  Paragraph,
  fileKind,
  formatFileSize,
} from "./components";
import {
  letterBlocks,
  type ProductBlocksSnapshot,
  type ResolvedBlock,
} from "@/lib/newsletter/product-blocks";
import { markdownToText, type Block, type ProductsBlock } from "./markdown";
import { emailMediaUrl } from "./media";
import { ProductCards, productTextLines } from "./product-cards";
import { renderEmail, type ComposedEmail } from "./render";
import { shop } from "./theme";

/**
 * A newsletter, as one subscriber receives it.
 *
 * The body is what the owner typed in the composer, in the Markdown subset
 * `markdown.ts` reads — never HTML from the panel. Images uploaded with it are
 * drawn under the text, in the order they were added; other files are download
 * buttons. Both live on our storage, because Resend's batch endpoint carries
 * no attachments (`lib/newsletter/send.ts`), and both are addressed through
 * the shop's own domain (`media.ts`), not the storage's.
 *
 * A `[[продукти…]]` line in the body draws product cards (`product-cards.tsx`)
 * from `products`: what the blocks resolved to, which the caller supplies —
 * read from the catalog for a preview or a test, the campaign's snapshot for
 * a send. This file never reads the catalog, so drawing the same snapshot
 * twice draws the same letter. Without it, a block draws nothing. A block
 * with nothing to show is left out, and so is a heading over nothing but such
 * blocks (`lib/newsletter/sections.ts`): the letter reads as if the section
 * had never been written.
 *
 * Every copy carries its reader's own unsubscribe link, in the footer with the
 * reason they are receiving it. The same address, as an RFC 8058 one-click
 * endpoint, goes in the message's headers (`lib/newsletter/links.ts`).
 *
 * A test copy says so at the top, in words, before anything else.
 */

export interface NewsletterContent {
  readonly subject: string;
  /** The inbox preview line. Falls back to the start of the body. */
  readonly preheader: string;
  /** Markdown-subset source. */
  readonly body: string;
  readonly attachments: readonly NewsletterAttachment[];
  /** What the body's product blocks resolved to (`lib/newsletter/product-blocks.ts`). */
  readonly products?: ProductBlocksSnapshot | null;
}

export interface NewsletterRecipient {
  /** The page that asks, then unsubscribes: `unsubscribeUrl(token)`. */
  readonly unsubscribeUrl: string;
  /** Marks the copy as the owner's test, in the body and the text. */
  readonly test?: boolean;
}

const REASON = `Получавате това писмо, защото сте се абонирали за бюлетина на ${siteConfig.name}.`;
const TEST_TITLE = "Пробно писмо";
const TEST_BODY =
  "Абонатите още не са го получили, а връзката за отписване в него не отписва никого.";

/**
 * A hosted file as a download: Blob serves it as an attachment with
 * `?download=1`, and the shop's `/media` passes the query on. Through our
 * own address (`media.ts`).
 */
export function downloadUrl(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set("download", "1");
  return emailMediaUrl(parsed.toString());
}

/** What an image shows, or failing that its file name without the extension. */
export function imageAlt(file: NewsletterAttachment): string {
  return file.alt?.trim() || file.name.replace(/\.[a-z0-9]{1,5}$/i, "");
}

function preview(content: NewsletterContent, blocks: readonly Block[]): string {
  const line = content.preheader.trim() || markdownToText(blocks).replace(/\s+/g, " ");
  return line.slice(0, 140);
}

type Pairs = Map<ProductsBlock, ResolvedBlock | null>;

function BodyBlocks({
  blocks,
  pairs,
  campaign,
}: {
  blocks: readonly Block[];
  pairs: Pairs;
  campaign: string;
}) {
  return (
    <>
      {blocks.map((block, index) => {
        switch (block.type) {
          case "heading":
            return (
              <Heading key={index} level={block.level}>
                <Inlines nodes={block.children} />
              </Heading>
            );
          case "paragraph":
            return (
              <Paragraph key={index}>
                <Inlines nodes={block.children} />
              </Paragraph>
            );
          case "list":
            return (
              <BulletList
                key={index}
                items={block.items.map((item, itemIndex) => (
                  <Inlines key={itemIndex} nodes={item} />
                ))}
              />
            );
          case "products":
            return (
              <ProductCards
                key={index}
                products={pairs.get(block)?.products ?? []}
                campaign={campaign}
              />
            );
        }
      })}
    </>
  );
}

export function NewsletterEmail({
  content,
  recipient,
}: {
  content: NewsletterContent;
  recipient: NewsletterRecipient;
}) {
  const { blocks, pairs } = letterBlocks(content.body, content.products);
  const campaign = content.products?.campaign ?? "";
  const images = content.attachments.filter((file) => file.kind === "image");
  const files = content.attachments.filter((file) => file.kind === "file");
  return (
    <EmailLayout
      preview={preview(content, blocks)}
      unsubscribe={{ url: recipient.unsubscribeUrl, reason: REASON }}
    >
      {recipient.test && (
        <Callout tone="caution" title={TEST_TITLE}>
          {TEST_BODY}
        </Callout>
      )}
      <Heading>{content.subject}</Heading>
      <BodyBlocks blocks={blocks} pairs={pairs} campaign={campaign} />
      {images.map((file) => (
        <ImageBlock key={file.url} src={emailMediaUrl(file.url)} alt={imageAlt(file)} />
      ))}
      <AttachmentList
        title="Файлове"
        items={files.map((file) => ({
          name: file.name,
          size: file.size,
          url: downloadUrl(file.url),
        }))}
      />
    </EmailLayout>
  );
}

/** The plain-text twin: the same message, for a client that shows no HTML. */
export function newsletterText(content: NewsletterContent, recipient: NewsletterRecipient): string {
  const { blocks, pairs } = letterBlocks(content.body, content.products);
  const campaign = content.products?.campaign ?? "";
  const images = content.attachments.filter((file) => file.kind === "image");
  const files = content.attachments.filter((file) => file.kind === "file");
  const legal = shop.legal;

  return [
    ...(recipient.test ? [`${TEST_TITLE}. ${TEST_BODY}`, ""] : []),
    content.subject,
    "",
    markdownToText(blocks, (block) => productTextLines(pairs.get(block)?.products ?? [], campaign)),
    ...(images.length > 0
      ? ["", "Снимки:", ...images.map((file) => `- ${imageAlt(file)}: ${emailMediaUrl(file.url)}`)]
      : []),
    ...(files.length > 0
      ? [
          "",
          "Файлове за изтегляне:",
          ...files.map(
            (file) =>
              `- ${file.name} (${[fileKind(file.name), formatFileSize(file.size)].filter(Boolean).join(", ")}): ${downloadUrl(file.url)}`,
          ),
        ]
      : []),
    "",
    "--",
    shop.name,
    `${shop.phone} · ${shop.email}`,
    ...(shop.hours ? [shop.hours] : []),
    shop.url,
    "",
    REASON,
    `Отписване: ${recipient.unsubscribeUrl}`,
    ...(legal.isComplete
      ? [`${legal.companyName} · ЕИК ${legal.companyId} · ${legal.address}`]
      : []),
  ].join("\n");
}

export async function composeNewsletterEmail(
  content: NewsletterContent,
  recipient: NewsletterRecipient,
): Promise<ComposedEmail> {
  return {
    html: await renderEmail(<NewsletterEmail content={content} recipient={recipient} />),
    text: newsletterText(content, recipient),
  };
}
