import type { CSSProperties, ReactNode } from "react";
import {
  Body,
  Button as MailButton,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { lineTotal, orderSum, productCount, type OrderLine } from "@/lib/orders/lines";
import { toPriceView } from "@/lib/catalog/format";
import type { Inline } from "./markdown";
import { CONTENT_WIDTH, SHEET_PADDING, SHEET_WIDTH, color, font, logo, shop, type } from "./theme";

/**
 * The mail components: one letterhead and the blocks a message is made of.
 *
 * Built on React Email's primitives, which turn a `Section` into the nested
 * presentation tables and inline styles a mail client still needs, and which
 * know Outlook's quirks (the button's padding, the hidden preheader). What is
 * ours is the design: `theme.ts` holds every value, and nothing in a template
 * sets a colour or a size of its own.
 *
 * Rules carried over from `DESIGN.md`, because a message is the shop speaking
 * as much as a page is:
 *
 *   - Literata for headings, the system sans for everything a reader decides
 *     on: figures, names, links.
 *   - Figures are tabular and carry their unit ("2 бр.", "39,80 €").
 *   - Nothing under 11 px; uppercase only for a label of a few words.
 *   - Radii of 2 to 6 px, hairlines rather than shadows, no gold text.
 *   - Every image has a text alternative, and no meaning is carried by an
 *     image or a colour alone: a message read with images off still says
 *     everything it has to.
 *
 * Every element is told its colour and its background explicitly. A client
 * in a dark theme recolours what it is left to guess about; one that is told
 * leaves it alone or inverts it consistently. `color-scheme: light` asks the
 * clients that honour it not to try.
 */

const tabular: CSSProperties = {
  fontVariantNumeric: "tabular-nums",
  fontFeatureSettings: "'tnum' 1",
};

const linkStyle: CSSProperties = {
  color: color.pine700,
  textDecoration: "underline",
};

/* -- the letterhead --------------------------------------------------------- */

export interface UnsubscribeNotice {
  /** The subscriber's own link: the page that asks, then unsubscribes. */
  readonly url: string;
  /** Why this reader gets this message, in one sentence. */
  readonly reason: string;
}

/**
 * Logo, sheet, footer. Every message the shop sends is drawn in this.
 *
 * `preview` is the line a client shows after the subject in the inbox list.
 * It is hidden in the message itself and skipped in the text part.
 *
 * `unsubscribe` adds the block a newsletter must carry: why the reader gets
 * it and a link to leave. A transactional message (a confirmation, a reply)
 * has neither and passes nothing.
 */
export function EmailLayout({
  preview,
  children,
  unsubscribe,
}: {
  preview: string;
  children: ReactNode;
  unsubscribe?: UnsubscribeNotice;
}) {
  return (
    <Html lang="bg" dir="ltr">
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
      </Head>
      <Preview>{preview}</Preview>
      <Body
        style={{
          backgroundColor: color.paper,
          color: color.ink900,
          fontFamily: font.body,
          margin: 0,
          padding: "24px 8px",
        }}
      >
        <Container
          style={{
            width: "100%",
            maxWidth: `${SHEET_WIDTH}px`,
            backgroundColor: color.paperRaised,
            border: `1px solid ${color.line}`,
            /* The site's pine bar, as the sheet's top edge: a border cannot be
               collapsed by a client the way an empty band can. */
            borderTop: `4px solid ${color.pine900}`,
            borderRadius: "6px",
          }}
        >
          <Section style={{ padding: `24px ${SHEET_PADDING}px 8px` }}>
            <Link href={shop.url} style={{ ...linkStyle, display: "inline-block" }}>
              <Img
                src={logo.src}
                alt={logo.alt}
                width={logo.width}
                height={logo.height}
                style={{ display: "block", border: 0, outline: "none" }}
              />
            </Link>
          </Section>
          <Section style={{ padding: `16px ${SHEET_PADDING}px 28px` }}>{children}</Section>
        </Container>
        <Footer unsubscribe={unsubscribe} />
      </Body>
    </Html>
  );
}

const footerText: CSSProperties = {
  ...type.caption,
  ...tabular,
  color: color.ink500,
  margin: "0 0 6px",
  fontFamily: font.body,
};

/**
 * Who sent this and every way to answer: the same three facts as the site's
 * footer — phone, address, hours — then the legal line, and for a newsletter
 * the reason and the way out, first, where a reader looks for them.
 */
function Footer({ unsubscribe }: { unsubscribe?: UnsubscribeNotice }) {
  const legal = shop.legal;
  return (
    <Container style={{ width: "100%", maxWidth: `${SHEET_WIDTH}px` }}>
      <Section style={{ padding: `20px ${SHEET_PADDING}px 8px` }}>
        {unsubscribe && (
          <Text style={{ ...footerText, margin: "0 0 14px" }}>
            {unsubscribe.reason}{" "}
            <Link href={unsubscribe.url} style={{ ...linkStyle, whiteSpace: "nowrap" }}>
              Отписване от бюлетина
            </Link>
          </Text>
        )}
        <Text style={{ ...footerText, color: color.ink700, fontWeight: 600 }}>{shop.name}</Text>
        <Text style={footerText}>
          <Link href={shop.phoneHref} style={{ ...linkStyle, whiteSpace: "nowrap" }}>
            {shop.phone}
          </Link>
          {" · "}
          <Link href={shop.emailHref} style={{ ...linkStyle, whiteSpace: "nowrap" }}>
            {shop.email}
          </Link>
          {" · "}
          <Link href={shop.url} style={{ ...linkStyle, whiteSpace: "nowrap" }}>
            {shop.host}
          </Link>
        </Text>
        {shop.hours && <Text style={footerText}>{`Работно време: ${shop.hours}`}</Text>}
        {legal.isComplete && (
          <Text style={footerText}>
            {`${legal.companyName} · ЕИК ${legal.companyId} · ${legal.address}`}
          </Text>
        )}
      </Section>
    </Container>
  );
}

/* -- text ------------------------------------------------------------------- */

/** A label of one to three words above a heading. Never a sentence. */
export function Label({ children }: { children: ReactNode }) {
  return (
    <Text
      style={{
        ...type.label,
        fontFamily: font.body,
        fontWeight: 600,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: color.ink500,
        margin: "0 0 6px",
      }}
    >
      {children}
    </Text>
  );
}

const HEADING_STYLE: Record<1 | 2 | 3, CSSProperties> = {
  1: { ...type.title, margin: "0 0 16px" },
  2: { ...type.panelTitle, margin: "28px 0 10px" },
  3: { ...type.lead, margin: "24px 0 8px" },
};

/** Literata, semibold, slightly tightened — the site's heading voice. */
export function Heading({ level = 1, children }: { level?: 1 | 2 | 3; children: ReactNode }) {
  const Tag = `h${level}` as const;
  return (
    <Tag
      style={{
        ...HEADING_STYLE[level],
        fontFamily: font.display,
        fontWeight: 600,
        letterSpacing: "-0.015em",
        color: color.ink900,
      }}
    >
      {children}
    </Tag>
  );
}

const PARAGRAPH_TONE = {
  default: color.ink900,
  secondary: color.ink700,
  meta: color.ink500,
} as const;

export function Paragraph({
  children,
  tone = "default",
  size = "body",
  style,
}: {
  children: ReactNode;
  tone?: keyof typeof PARAGRAPH_TONE;
  size?: "body" | "small" | "lead";
  style?: CSSProperties;
}) {
  return (
    <Text
      style={{
        ...type[size],
        fontFamily: font.body,
        color: PARAGRAPH_TONE[tone],
        margin: "0 0 16px",
        ...style,
      }}
    >
      {children}
    </Text>
  );
}

/** A parsed run of text (`markdown.ts`) as React nodes. Text is escaped by React. */
export function Inlines({ nodes }: { nodes: readonly Inline[] }) {
  return (
    <>
      {nodes.map((node, index) => {
        switch (node.type) {
          case "text":
            return node.value;
          case "break":
            return <br key={index} />;
          case "strong":
            return (
              <strong key={index} style={{ fontWeight: 700 }}>
                <Inlines nodes={node.children} />
              </strong>
            );
          case "em":
            return (
              <em key={index} style={{ fontStyle: "italic" }}>
                <Inlines nodes={node.children} />
              </em>
            );
          case "link":
            return (
              <Link key={index} href={node.href} style={{ ...linkStyle, wordBreak: "break-word" }}>
                <Inlines nodes={node.children} />
              </Link>
            );
        }
      })}
    </>
  );
}

/** A bulleted list. Real list markup: a screen reader announces it as one. */
export function BulletList({ items }: { items: readonly ReactNode[] }) {
  return (
    <ul
      style={{
        margin: "0 0 16px",
        padding: "0 0 0 22px",
        color: color.ink900,
        fontFamily: font.body,
        ...type.body,
      }}
    >
      {items.map((item, index) => (
        <li key={index} style={{ margin: "0 0 6px" }}>
          {item}
        </li>
      ))}
    </ul>
  );
}

/* -- actions ---------------------------------------------------------------- */

/**
 * A link that looks like the site's button: `primary` is pine with paper text
 * (14.13:1), `secondary` is the outlined one. Always a link — a message can
 * only ever navigate.
 */
export function Button({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary";
}) {
  const look: CSSProperties =
    variant === "primary"
      ? { backgroundColor: color.pine900, color: color.paper, border: `1px solid ${color.pine900}` }
      : {
          backgroundColor: color.paperRaised,
          color: color.ink900,
          border: `1px solid ${color.lineStrong}`,
        };
  return (
    <MailButton
      href={href}
      style={{
        ...look,
        ...(variant === "primary" ? type.body : type.small),
        fontFamily: font.body,
        fontWeight: 600,
        borderRadius: "4px",
        padding: variant === "primary" ? "12px 20px" : "8px 14px",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </MailButton>
  );
}

/** A primary button on a line of its own, with the space around it. */
export function ButtonRow({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Section style={{ margin: "8px 0 20px" }}>
      <Button href={href}>{children}</Button>
    </Section>
  );
}

export function Divider({ spacing = 24 }: { spacing?: number }) {
  return (
    <Hr
      style={{
        border: "none",
        borderTop: `1px solid ${color.line}`,
        margin: `${spacing}px 0`,
        width: "100%",
      }}
    />
  );
}

/* -- structured content ----------------------------------------------------- */

const cell: CSSProperties = { fontFamily: font.body, verticalAlign: "top" };

/** Label and value, one pair a row. Labels in meta grey, values in ink. */
export function KeyValueRows({ rows }: { rows: readonly { label: string; value: ReactNode }[] }) {
  return (
    <table
      role="presentation"
      width="100%"
      cellPadding={0}
      cellSpacing={0}
      style={{ borderCollapse: "collapse", margin: "0 0 16px" }}
    >
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <td
              style={{
                ...cell,
                ...type.small,
                color: color.ink500,
                padding: "6px 16px 6px 0",
                width: "36%",
              }}
            >
              {row.label}
            </td>
            <td
              style={{ ...cell, ...type.body, ...tabular, color: color.ink900, padding: "4px 0" }}
            >
              {row.value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * What an order asks for: each line's name, quantity and unit price, its
 * total on the right, and the sum underneath with what it leaves out.
 *
 * The arithmetic is `lib/orders/lines.ts`, the same that prints the cart and
 * the text part of this message, so the two halves cannot disagree. A line
 * with no price says so in words and is left out of the sum, and the sum says
 * how many it leaves out — never a partial figure presented as the whole.
 *
 * Two columns rather than four: a product name in Cyrillic and Latin runs to
 * three lines on a phone, and four columns would leave it one word wide.
 */
export function OrderLines({ lines }: { lines: readonly OrderLine[] }) {
  const sum = orderSum(lines);
  const meta: CSSProperties = { ...type.small, ...tabular, color: color.ink500, margin: "2px 0 0" };
  return (
    <table
      role="presentation"
      width="100%"
      cellPadding={0}
      cellSpacing={0}
      style={{ borderCollapse: "collapse", margin: "0 0 16px" }}
    >
      <tbody>
        {lines.map((line, index) => {
          const total = lineTotal(line.unitPrice, line.quantity);
          const unit = line.unitPrice
            ? toPriceView(line.unitPrice.amount, line.unitPrice.currency)
            : null;
          return (
            <tr key={index}>
              <td
                style={{
                  ...cell,
                  padding: "12px 16px 12px 0",
                  borderBottom: `1px solid ${color.line}`,
                }}
              >
                <div style={{ ...type.body, color: color.ink900, fontWeight: 500 }}>
                  {line.name}
                </div>
                <div style={meta}>
                  {`${line.quantity} бр.${total && unit ? ` × ${unit.formatted}` : ""}`}
                </div>
              </td>
              <td
                align="right"
                style={{
                  ...cell,
                  ...tabular,
                  padding: "12px 0",
                  borderBottom: `1px solid ${color.line}`,
                  textAlign: "right",
                  whiteSpace: "nowrap",
                  ...(total
                    ? { ...type.body, fontWeight: 600, color: color.ink900 }
                    : { ...type.small, color: color.ink700 }),
                }}
              >
                {total ? total.formatted : "Цена при запитване"}
              </td>
            </tr>
          );
        })}
        <tr>
          <td style={{ ...cell, ...type.body, padding: "14px 16px 0 0", color: color.ink900 }}>
            {sum.subtotal ? "Сума на продуктите" : "Всички продукти са с цена при запитване."}
          </td>
          <td
            align="right"
            style={{
              ...cell,
              ...type.lead,
              ...tabular,
              padding: "12px 0 0",
              textAlign: "right",
              whiteSpace: "nowrap",
              fontWeight: 700,
              color: color.ink900,
            }}
          >
            {sum.subtotal?.formatted ?? ""}
          </td>
        </tr>
        {sum.subtotal && sum.unpriced > 0 && (
          <tr>
            <td colSpan={2} style={{ ...cell, ...meta, padding: "4px 0 0" }}>
              {`Без ${productCount(sum.unpriced)} с цена при запитване.`}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

const CALLOUT_TONE = {
  /** pine-900 on pine-100, 12.71:1. */
  info: { background: color.pine100, title: color.pine900, body: color.pine900 },
  /** caution on caution-100 6.24:1 for the title, ink-900 14.86:1 for the text. */
  caution: { background: color.caution100, title: color.caution, body: color.ink900 },
} as const;

/** A panel that has to be read before the rest: a notice, a caveat, a test mark. */
export function Callout({
  tone = "info",
  title,
  children,
}: {
  tone?: keyof typeof CALLOUT_TONE;
  title?: string;
  children: ReactNode;
}) {
  const look = CALLOUT_TONE[tone];
  return (
    <table
      role="presentation"
      width="100%"
      cellPadding={0}
      cellSpacing={0}
      style={{ borderCollapse: "separate", margin: "0 0 20px" }}
    >
      <tbody>
        <tr>
          <td
            style={{
              ...cell,
              backgroundColor: look.background,
              borderRadius: "4px",
              padding: "14px 16px",
            }}
          >
            {title && (
              <div
                style={{
                  ...type.small,
                  fontWeight: 700,
                  color: look.title,
                  margin: "0 0 4px",
                }}
              >
                {title}
              </div>
            )}
            <div style={{ ...type.small, color: look.body }}>{children}</div>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/**
 * A picture across the sheet. `alt` is required and is what a reader with
 * images off sees in its place, so it says what the picture shows.
 */
export function ImageBlock({
  src,
  alt,
  caption,
  href,
}: {
  src: string;
  alt: string;
  caption?: string;
  href?: string;
}) {
  const image = (
    <Img
      src={src}
      alt={alt}
      width={CONTENT_WIDTH}
      style={{
        display: "block",
        width: "100%",
        maxWidth: `${CONTENT_WIDTH}px`,
        height: "auto",
        border: 0,
        borderRadius: "4px",
        backgroundColor: color.paperRaised,
      }}
    />
  );
  return (
    <Section style={{ margin: "4px 0 20px" }}>
      {href ? <Link href={href}>{image}</Link> : image}
      {caption && (
        <Text style={{ ...type.caption, color: color.ink500, margin: "6px 0 0" }}>{caption}</Text>
      )}
    </Section>
  );
}

/** "1,2 MB", "340 KB": decimal units, comma decimals, as Bulgarian writes them. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1000) return `${Math.round(bytes)} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  const mb = bytes / 1_000_000;
  return `${(mb < 10 ? mb.toFixed(1) : Math.round(mb).toString()).replace(".", ",")} MB`;
}

/** "PDF", "DOCX", "XLSX": what the reader is about to open, from the name. */
export function fileKind(name: string): string {
  const extension = /\.([a-z0-9]{1,5})$/i.exec(name)?.[1];
  return extension ? extension.toUpperCase() : "Файл";
}

export interface AttachmentItem {
  readonly name: string;
  readonly size: number;
  /** Where to download it. Absent for a file attached to the message itself. */
  readonly url?: string;
}

/**
 * Files, each with its name, its type and size, and — when it is hosted
 * rather than attached — a download button. A reply's attachments travel
 * with the message and are only listed; a newsletter's live on our storage
 * and are linked.
 */
export function AttachmentList({
  title,
  items,
}: {
  title: string;
  items: readonly AttachmentItem[];
}) {
  if (items.length === 0) return null;
  return (
    <Section style={{ margin: "8px 0 16px" }}>
      <Label>{title}</Label>
      <table
        role="presentation"
        width="100%"
        cellPadding={0}
        cellSpacing={0}
        style={{ borderCollapse: "collapse" }}
      >
        <tbody>
          {items.map((item, index) => {
            const meta = [fileKind(item.name), formatFileSize(item.size)]
              .filter(Boolean)
              .join(" · ");
            return (
              <tr key={index}>
                <td
                  style={{
                    ...cell,
                    padding: "10px 12px 10px 0",
                    borderTop: `1px solid ${color.line}`,
                  }}
                >
                  <div style={{ ...type.body, color: color.ink900, wordBreak: "break-word" }}>
                    {item.url ? (
                      <Link href={item.url} style={{ ...linkStyle, wordBreak: "break-word" }}>
                        {item.name}
                      </Link>
                    ) : (
                      item.name
                    )}
                  </div>
                  <div style={{ ...type.small, ...tabular, color: color.ink500 }}>{meta}</div>
                </td>
                {item.url && (
                  <td
                    align="right"
                    style={{
                      ...cell,
                      padding: "10px 0",
                      borderTop: `1px solid ${color.line}`,
                      textAlign: "right",
                      verticalAlign: "middle",
                    }}
                  >
                    <Button href={item.url} variant="secondary">
                      Изтегли
                    </Button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </Section>
  );
}

/**
 * Who wrote, under a letter: the shop's name, how to call and write back, and
 * when someone answers. The phone first, because the fastest answer to
 * anything this shop sends is the customer ringing.
 *
 * `address` is the address the letter is actually sent from (`MAIL_ADDRESS`),
 * as in the text part's signature: a staging deployment sends as itself, and
 * a signature naming the live inbox there would invite replies to the wrong
 * place.
 */
export function Signature({ address }: { address: string }) {
  return (
    <Section style={{ margin: "24px 0 0" }}>
      <Text style={{ ...type.body, color: color.ink900, fontWeight: 600, margin: "0 0 2px" }}>
        {shop.name}
      </Text>
      <Text style={{ ...type.small, ...tabular, color: color.ink700, margin: "0 0 2px" }}>
        <Link href={shop.phoneHref} style={{ ...linkStyle, whiteSpace: "nowrap" }}>
          {shop.phone}
        </Link>
        {" · "}
        <Link href={`mailto:${address}`} style={{ ...linkStyle, whiteSpace: "nowrap" }}>
          {address}
        </Link>
      </Text>
      {shop.hours && (
        <Text style={{ ...type.small, color: color.ink500, margin: 0 }}>{shop.hours}</Text>
      )}
    </Section>
  );
}
