import { Body, Head, Html, Section, Text } from "@react-email/components";
import { color, font, type } from "./theme";
import { renderEmail } from "./render";

/**
 * The band over a forwarded message: who it was from, who it was to, when.
 *
 * The forward goes to the owner's own inbox, wrapping somebody else's message,
 * so it is not drawn in the letterhead: a 600 px sheet around a stranger's
 * layout would squeeze it, and a shop footer under a customer's words would
 * read as if the shop had written them. What it does share with the
 * letterhead is the palette — the envelope used to be set in greys that were
 * not the shop's.
 *
 * The original is the sender's own markup and must reach the inbox as they
 * wrote it, which React cannot do (it escapes everything it is given). So the
 * band is rendered with a marker where the message goes, and the message is
 * put in its place afterwards — as data, with a replacer function, so a `$&`
 * in somebody's HTML stays a dollar sign.
 */

/** Plain text React leaves alone, and that no real message contains. */
const ORIGINAL_MARKER = "BAC_FORWARDED_ORIGINAL_6f1d2c";

/** `address` is the shop address the mail arrived at and replies leave from
    (`MAIL_ADDRESS`), which on a staging deployment is not the live one. */
export function ForwardEnvelope({ lines, address }: { lines: readonly string[]; address: string }) {
  return (
    <Html lang="bg" dir="ltr">
      <Head>
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
      </Head>
      <Body style={{ margin: 0, padding: 0, backgroundColor: color.paperRaised }}>
        <Section
          style={{
            backgroundColor: color.paperSunken,
            borderBottom: `1px solid ${color.line}`,
            padding: "12px 16px",
          }}
        >
          {lines.map((line, index) => (
            <Text
              key={index}
              style={{
                ...type.small,
                fontFamily: font.body,
                color: color.ink700,
                margin: 0,
                wordBreak: "break-word",
              }}
            >
              {line}
            </Text>
          ))}
          <Text
            style={{
              ...type.caption,
              fontFamily: font.body,
              color: color.ink500,
              margin: "6px 0 0",
            }}
          >
            {`Препратено от ${address}. Отговорът от панела излиза от този адрес.`}
          </Text>
        </Section>
        <Section style={{ padding: "16px 0 0" }}>{ORIGINAL_MARKER}</Section>
      </Body>
    </Html>
  );
}

/** The original's `<body>` content, or the whole string when it has none. */
function bodyOf(html: string): string {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  if (body) return body[1]!;
  return html
    .replace(/<!doctype[^>]*>/i, "")
    .replace(/<head[\s\S]*?<\/head>/i, "")
    .replace(/<\/?html[^>]*>/gi, "");
}

/** The original's `<style>` blocks from its head, which belong in ours. */
function headStylesOf(html: string): string {
  const head = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? "";
  return [...head.matchAll(/<style[\s\S]*?<\/style>/gi)].map((match) => match[0]).join("");
}

/**
 * The forward's HTML: the band, then the original exactly as it arrived.
 * One document, not two pasted together: the original's body goes inside
 * ours, and its head styles into our head, where clients look for them.
 */
export async function composeForwardHtml(
  envelope: readonly string[],
  originalHtml: string,
  address: string,
): Promise<string> {
  const frame = await renderEmail(<ForwardEnvelope lines={envelope} address={address} />);
  const styles = headStylesOf(originalHtml);
  const withStyles = styles ? frame.replace("</head>", () => `${styles}</head>`) : frame;
  return withStyles.replace(ORIGINAL_MARKER, () => bodyOf(originalHtml));
}
