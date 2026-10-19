import { siteConfig } from "@/config/site";
import { DEFAULT_LOCALE } from "@/i18n/config";
import { href, routes } from "@/lib/routes";

/**
 * The mail letterhead's design tokens: `DESIGN.md`, restated for a renderer
 * that cannot read it.
 *
 * Mail is the one place the design system cannot be imported. A mail client
 * resolves no custom property (`var(--color-ink-900)` renders as no colour at
 * all), loads no stylesheet and no web font worth relying on, and Gmail strips
 * a `<style>` block from the body. So the palette is written here as the hex
 * Chromium paints for each OKLCH token in `globals.css` (the front matter of
 * `DESIGN.md` lists the same values), once, and every component in this folder
 * takes its colours from this object. Two copies of a hex in two templates is
 * how the old greys in the inbound forward drifted off the palette.
 *
 * Only pairings measured in `DESIGN.md` ("Measured contrast") are used:
 *
 *   ink-900 on paper 16.11, on paper-raised 17.36   headings, body, figures
 *   ink-700 on paper-raised 10.86                     secondary copy
 *   ink-500 on paper 6.81, on paper-raised 7.34       meta, captions, footer
 *   pine-700 on paper-raised 9.59, on paper 8.89      links
 *   paper on pine-900 14.13                           the button
 *   pine-900 on pine-100 12.71                        the information callout
 *   ink-900 on caution-100 14.86, caution 6.24        the caution callout
 *
 * Gold appears nowhere as text and as no fill: a letter has no "one most
 * important action" competing with anything, and the mark in the logo already
 * carries it.
 */
export const color = {
  ink900: "#23180f",
  ink700: "#463b32",
  ink500: "#5f544c",
  ink300: "#726860",
  paper: "#faf6ee",
  paperRaised: "#ffffff",
  paperSunken: "#f2ece1",
  line: "#ded8cf",
  lineStrong: "#8d8579",
  pine900: "#002c1d",
  pine700: "#0b4f38",
  pine100: "#d8f0e5",
  caution: "#794d0b",
  caution100: "#f9edc8",
} as const;

/**
 * Typefaces, with the fallbacks that actually render.
 *
 * Literata and Inter are web fonts on the site (`next/font`) and are not
 * loaded here: half the clients would ignore the `@font-face` and the other
 * half would show the fallback while it downloaded. So each stack names the
 * face first, for the reader who has it installed, then what every client has.
 * Georgia, Segoe UI, Roboto and the Apple system face all carry Cyrillic, which
 * is the requirement `PRODUCT.md` sets for the site's own two faces.
 */
export const font = {
  display: "Literata, Georgia, 'Times New Roman', serif",
  body: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
} as const;

/**
 * The type scale, from `DESIGN.md` "Scale", in pixels with line heights.
 * Eleven is the floor there and here (`test/emails.test.ts` checks every
 * rendered `font-size`).
 */
export const type = {
  label: { fontSize: "11px", lineHeight: "16px" },
  caption: { fontSize: "12px", lineHeight: "18px" },
  small: { fontSize: "13px", lineHeight: "20px" },
  body: { fontSize: "15px", lineHeight: "24px" },
  lead: { fontSize: "17px", lineHeight: "26px" },
  panelTitle: { fontSize: "20px", lineHeight: "28px" },
  title: { fontSize: "24px", lineHeight: "31px" },
} as const;

/** The sheet: 600 px is the width every client lays out without scaling. */
export const SHEET_WIDTH = 600;
/** Left and right inside the sheet: 552 px of content on a desktop, and on a
    360 px phone still about 290 px once the page's own margin is taken. */
export const SHEET_PADDING = 24;
export const CONTENT_WIDTH = SHEET_WIDTH - 2 * SHEET_PADDING;

/**
 * The live site's origin. Committed as `NEXT_PUBLIC_SITE_URL`'s production
 * value in `env.schema.mjs`; repeated here because a preview deployment does
 * not have that variable and mail still needs one thing from production — see
 * `logo`.
 */
export const PRODUCTION_ORIGIN = "https://buy-a-coffee.com";

/**
 * Where a message's links point: the deployment that sent it.
 *
 * `NEXT_PUBLIC_SITE_URL` in production. A preview deployment is not given it
 * (its canonicals must not claim the live site), so there the platform's own
 * `VERCEL_URL` is used — an unsubscribe link in mail a preview sent must reach
 * the preview, whose database holds the token. Neither, on a laptop: the
 * configured site URL, which is localhost.
 */
export function mailOrigin(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const configured = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const vercel = env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return siteConfig.url.replace(/\/+$/, "");
}

/** An absolute link into the deployment that sends the message. */
export function mailUrl(path: string): string {
  return `${mailOrigin()}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * The lockup, flattened onto white and cut to 400 × 102 for mail
 * (`public/email-logo.png`, from `public/logo-lockup.png`), drawn at half that.
 *
 * Opaque on purpose. The site's lockup is a transparent PNG with brown-black
 * lettering, and a client that darkens the message (the Gmail apps, Outlook)
 * repaints the ground under a transparent image and leaves the image alone —
 * which puts dark lettering on a dark ground. An opaque logo stays a light
 * badge on a dark page and is read either way. It is also 20 KB instead of the
 * lockup's 175 KB, which every copy of every newsletter downloads.
 *
 * Always the production origin, unlike the links: a preview deployment sits
 * behind Vercel's login, so its own copy of the logo would be a broken image
 * in every inbox. Absolute, like every URL in a message.
 */
export const logo = {
  src: `${PRODUCTION_ORIGIN}/email-logo.png`,
  width: 200,
  height: 51,
  alt: siteConfig.name,
} as const;

/** Facts about the shop every footer prints, read from `siteConfig` so the
    letterhead cannot disagree with the site's own footer. */
export const shop = {
  name: siteConfig.name,
  phone: siteConfig.contact.phone,
  phoneHref: `tel:${siteConfig.contact.phoneHref}`,
  email: siteConfig.contact.email,
  emailHref: `mailto:${siteConfig.contact.email}`,
  hours: siteConfig.contact.hours,
  url: mailUrl(href(DEFAULT_LOCALE, routes.home)),
  /** "buy-a-coffee.com", for a link whose text is the address. */
  host: new URL(mailOrigin()).host,
  legal: siteConfig.legal,
} as const;
