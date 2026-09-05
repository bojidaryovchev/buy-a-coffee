import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { siteConfig } from "@/config/site";

/**
 * The share card — what Facebook, Viber, WhatsApp and X draw when someone
 * pastes a link.
 *
 * ⚠ THIS FILE DID NOT EXIST, and its absence was the one blocking SEO gap on
 * this repo. `(site)/layout.tsx` has always declared
 * `twitter: { card: "summary_large_image" }` with no image behind it, so every
 * link to this shop rendered as a grey box or as whatever image the network
 * scraped off the page. The three vend repos all carry a generated card and a
 * written note about this exact failure; this one was written from the same
 * template and never got one.
 *
 * WHY IT IS GENERATED rather than pointing `og:image` at a PNG in `public/`:
 * the lockup is roughly 4:1 and the icons are square, and networks centre-crop
 * whatever they are given to 1.91:1. A square mark loses a third of its height;
 * the wide lockup loses its ends. Composing the card at 1200x630 is the only
 * way to control what survives.
 *
 * NO TEXT, AND THEREFORE NO FONTS. A tagline was drafted into this card and
 * taken back out: satori has no access to the site's faces, `next/font` resolves
 * them into `.next` at build time rather than to a readable path, and the
 * fallback satori falls back to is not guaranteed to carry Cyrillic. "Кафе,
 * подбрано с грижа" rendering as a row of empty boxes on every shared link is a
 * worse card than no tagline at all. The lockup is artwork, so it needs none.
 *
 * ⚠ NAMING IT IN `pageMetadata` IS SEPARATE AND ALSO REQUIRED. Next applies a
 * root `opengraph-image` to every page beneath it, but `openGraph` is
 * shallow-merged: a page that sets `openGraph` to add its own `url` replaces the
 * parent object outright and the inherited image goes with it. Product pages
 * here do exactly that. See the note in `(site)/layout.tsx`.
 */

export const alt = `${siteConfig.name} — ${siteConfig.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/* Straight out of globals.css, converted from oklch. Values, not tokens: this
   renders through satori rather than a browser, so there is no CSS to read. */
const PAPER = "#fbfaf6"; // --color-paper
const PINE_900 = "#002c1d"; // --color-pine-900

export default async function Image() {
  /**
   * Read from `public/`, not from an `assets/` directory beside this file.
   *
   * A `readFile` at request time is not something Next's build can trace, so
   * the file has to be somewhere that ships regardless — and `public/` is the
   * only directory guaranteed to. `pnpm brand:assets` writes this one at 880px,
   * which is a downscale to the 720 it renders at rather than an enlargement.
   */
  const lockup = await readFile(join(process.cwd(), "public/og-lockup.png"), "base64");

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: PAPER,
        }}
      >
        {/* The pine strip that opens the header, opening the card instead. */}
        <div style={{ display: "flex", height: 12, backgroundColor: PINE_900 }} />

        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* A bare <img> on purpose: next/image does not exist inside
              ImageResponse — this renders through satori, not the browser, and
              a data-URI <img> is the documented approach. No eslint-disable for
              `@next/next/no-img-element` because this workspace's flat config
              does not load the Next plugin, and a disable comment for a rule
              that is not defined is itself an eslint error.
              Height follows the lockup's own 1579:402. */}
          <img src={`data:image/png;base64,${lockup}`} width={780} height={199} alt="" />
        </div>
      </div>
    ),
    size,
  );
}
