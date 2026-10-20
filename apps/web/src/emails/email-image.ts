import { MEDIA_KEY, storeKey } from "./media";
import { PRODUCTION_ORIGIN } from "./theme";

/**
 * Product photographs, sized for an email.
 *
 * A card draws its photograph 112px wide, but the store holds the originals:
 * a product photo is around 60 KB, and its cut-out - the packshot on
 * transparency the storefront prefers (DESIGN.md, "Imagery") - 300 to 550 KB.
 * Twelve cards of cut-outs would put five megabytes in front of a reader on a
 * phone, for thumbnails. So a card points at `/email-img/{w}/{key}` instead:
 * the same picture, fitted into a fixed 2:3 frame on white and re-encoded as
 * a JPEG of a few kilobytes (`app/email-img/[w]/[...key]/route.ts`).
 *
 * WHY NOT `/_next/image`. Its URLs carry the optimiser's own parameters and
 * break when the image config changes - and an email, once sent, cannot be
 * re-rendered. And it picks WebP or AVIF from the `Accept` header, which a
 * mail client's image proxy may send, while Outlook on Windows draws neither.
 * A JPEG on white is what every client shows, and white is the card's own
 * background, so a cut-out sits on it as it does on the site.
 *
 * A FIXED FRAME, so the card carries `width` and `height` attributes that are
 * always right - Outlook sizes images from the attributes alone - and every
 * card in a block lines up whatever the photograph's shape. 2:3 is a coffee
 * pack's: the photographs are 800x1200, the cut-outs about 430x660.
 *
 * Pure, so the card and the route share one definition of what may be asked
 * for. The same idea, for machine photographs, is buy-a-vend's `email-image`.
 */

/** Where the thumbnails are served. */
export const EMAIL_IMAGE_PATH = "/email-img";

/** The only widths there are: 2x and 4x the 112px a card draws. A fixed set,
 *  so the route cannot be made to render arbitrary sizes. */
export const EMAIL_IMAGE_WIDTHS = [224, 448] as const;
export type EmailImageWidth = (typeof EMAIL_IMAGE_WIDTHS)[number];

/** The frame: 2 wide, 3 tall. */
export const emailImageHeight = (width: number): number => (width * 3) / 2;

/** What a card draws, in CSS pixels, from the 224px thumbnail. */
export const EMAIL_CARD_PHOTO = { width: 112, height: 168, source: 224 } as const;

/** A product photograph's or cut-out's key in our store: one of those two
 *  prefixes, safe segments only (the `/media` rule), an image extension. */
const KEY = new RegExp(`^(?:catalog|cutouts)/${MEDIA_KEY}$`);
const IMAGE = /\.(png|jpe?g|webp|avif|gif)$/i;

export const isEmailImageKey = (key: string): boolean =>
  key.length <= 300 && KEY.test(key) && IMAGE.test(key);

export const isEmailImageWidth = (value: number): value is EmailImageWidth =>
  (EMAIL_IMAGE_WIDTHS as readonly number[]).includes(value);

type Environment = Readonly<Record<string, string | undefined>>;

/**
 * The thumbnail address for a product photograph or cut-out in our store, or
 * null for anything else (a newsletter upload, a stranger's picture, a
 * laptop's disk), which the card then shows from `/media` as it is.
 */
export function emailThumbnailUrl(
  url: string,
  env: Environment = process.env,
  width: EmailImageWidth = EMAIL_CARD_PHOTO.source,
): string | null {
  const key = storeKey(url, env);
  if (key === null || !isEmailImageKey(key)) return null;
  return `${PRODUCTION_ORIGIN}${EMAIL_IMAGE_PATH}/${width}/${key}`;
}
