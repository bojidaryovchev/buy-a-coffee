import { siteConfig } from "@/config/site";
import { INK, renderCard } from "@/lib/seo/og/card";
import { fitWithin, imageDataUri } from "@/lib/seo/og/image-data";
import { SHARE_CARD_ALT, SHARE_CARD_SIZE } from "@/lib/seo/share-card";

/**
 * The share card — what Facebook, Viber, WhatsApp and X draw when someone
 * pastes a link to a page that has no card of its own: the home page, an
 * index, a landing listing, the legal pages. A product, a category, a brand
 * and an article each have their own (`opengraph-image.tsx` beside the page,
 * `lib/seo/og/`).
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
 * TEXT, NOW THAT THERE ARE FACES FOR IT. The first card carried none: satori
 * had no access to the site's faces, and its own fallback has no Cyrillic, so
 * the tagline would have come out as a row of empty boxes. The cards now draw
 * with Literata and Inter read from `assets/og/` (`lib/seo/og/fonts.ts`), so
 * the tagline is set under the lockup in the site's heading face.
 *
 * ⚠ NAMING IT IN `pageMetadata` IS SEPARATE AND ALSO REQUIRED. Next applies a
 * root `opengraph-image` to every page beneath it, but `openGraph` is
 * shallow-merged: a page that sets `openGraph` to add its own `url` replaces the
 * parent object outright and the inherited image goes with it. Every page
 * names it through `shareMetadata` (`lib/seo/share.ts`), with this size and alt.
 */

export const alt = SHARE_CARD_ALT;
export const size = SHARE_CARD_SIZE;
export const contentType = "image/png";

export default async function Image() {
  /**
   * Read from `public/`, not from an `assets/` directory beside this file:
   * `pnpm brand:assets` writes the lockup there at 880px, a downscale to the
   * 720 it renders at rather than an enlargement. This card is prerendered at
   * build, where `public/` is on disk.
   */
  const lockup = await imageDataUri("/og-lockup.png");

  return renderCard(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: INK.paper,
      }}
    >
      {/* The pine strip that opens the header, opening the card instead. */}
      <div style={{ display: "flex", height: 12, backgroundColor: INK.pine900 }} />

      <div
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* A bare <img> on purpose: next/image does not exist inside
              ImageResponse — this renders through satori, not the browser, and
              a data-URI <img> is the documented approach, at the size it is
              given: the lockup's own 880:224, fitted to 720 wide. */}
        {lockup ? (
          <img src={lockup.src} {...fitWithin(lockup, { width: 720, height: 200 })} alt="" />
        ) : null}
        <div
          style={{
            display: "flex",
            marginTop: 36,
            fontFamily: "Literata",
            fontWeight: 600,
            fontSize: 46,
            letterSpacing: "-0.015em",
            color: INK.ink900,
          }}
        >
          {siteConfig.tagline}
        </div>
        <div style={{ display: "flex", marginTop: 14, fontSize: 28, color: INK.ink500 }}>
          Кафе на зърна, капсули и дози — с цена на чаша
        </div>
      </div>
    </div>,
  );
}
