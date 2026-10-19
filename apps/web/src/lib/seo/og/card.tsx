import { ImageResponse } from "next/og";
import type { ReactElement, ReactNode } from "react";
import { siteConfig } from "@/config/site";
import type { BrewingSystemId } from "@/lib/recommend/systems";
import { ogFonts } from "./fonts";
import { fitWithin, type CardPicture } from "./image-data";

/**
 * The share cards: what Facebook, Viber, WhatsApp, LinkedIn and X draw when
 * someone pastes a link to a product, a listing, a brand or an article.
 *
 * **Why they are drawn rather than the packshot.** The photographs are 800 ×
 * 1200, portrait; every network crops a shared image to 1.91 : 1, so a bag of
 * coffee shared as itself lost its top and bottom and kept a white band with
 * a strip of label across it. A card composed at 1200 × 630 puts the whole
 * pack in a white well beside what it is and what it costs.
 *
 * In the site's own design language (DESIGN.md): cream paper, the pine strip
 * that opens every page, Literata for the heading and Inter for the rest,
 * packshots on pure white ("The White Well Rule"), a system's colour only
 * beside its name ("The Named Colour Rule"), clay only for a reduced price.
 * The colours are the hex values DESIGN.md gives for its OKLCH tokens:
 * satori draws without a browser, so there is no CSS to read them from.
 */

export const CARD_SIZE = { width: 1200, height: 630 } as const;
export const CARD_TYPE = "image/png";

export const INK = {
  ink900: "#23180f",
  ink700: "#463b32",
  ink500: "#5f544c",
  ink300: "#726860",
  paper: "#faf6ee",
  paperRaised: "#ffffff",
  line: "#ded8cf",
  pine900: "#002c1d",
  pine700: "#0b4f38",
  clay600: "#963912",
  caution: "#794d0b",
  caution100: "#f9edc8",
} as const;

/** `sys-<id>` and `sys-<id>-100` from DESIGN.md, "Brewing systems". */
export const SYSTEM_COLOURS: Readonly<
  Record<BrewingSystemId, { readonly solid: string; readonly wash: string }>
> = {
  "nespresso-original": { solid: "#7a2b56", wash: "#fce3ee" },
  "dolce-gusto": { solid: "#0e5a65", wash: "#d5f1f6" },
  "a-modo-mio": { solid: "#543a8b", wash: "#ece8fe" },
  caffitaly: { solid: "#475b1d", wash: "#e4f1d1" },
  "lavazza-blue": { solid: "#154d8c", wash: "#dfedfe" },
  "ese-pod": { solid: "#444e5b", wash: "#e3e8f0" },
  beans: { solid: "#5d381e", wash: "#f7e4d4" },
};

const SITE_HOST = new URL(siteConfig.url).host.replace(/^www\./, "");

/** A heading size that keeps a long name on three lines and a short one large. */
export function headingSize(text: string): number {
  const length = [...text].length;
  if (length <= 22) return 66;
  if (length <= 34) return 58;
  if (length <= 48) return 50;
  return 44;
}

/** The frame every card shares: the pine strip, the content, the shop's lockup. */
export function CardFrame({
  lockup,
  children,
}: {
  readonly lockup: CardPicture | null;
  readonly children: ReactNode;
}) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: INK.paper,
        fontFamily: "Inter",
        color: INK.ink900,
      }}
    >
      <div style={{ display: "flex", height: 12, backgroundColor: INK.pine900 }} />
      <div style={{ display: "flex", flex: 1, padding: "44px 56px 0 56px" }}>{children}</div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: 84,
          padding: "0 56px",
        }}
      >
        {lockup ? (
          // Satori draws a data URI; next/image does not exist here.
          <img src={lockup.src} {...fitWithin(lockup, { width: 220, height: 50 })} alt="" />
        ) : (
          <div style={{ display: "flex", fontFamily: "Literata", fontSize: 30 }}>
            {siteConfig.name}
          </div>
        )}
        <div style={{ display: "flex", fontSize: 22, color: INK.ink500 }}>{SITE_HOST}</div>
      </div>
    </div>
  );
}

/** A system's name on its own wash, as the system badge draws it. */
export function SystemTag({
  systemId,
  name,
}: {
  readonly systemId: BrewingSystemId;
  readonly name: string;
}) {
  const colours = SYSTEM_COLOURS[systemId];
  return (
    <div
      style={{
        display: "flex",
        alignSelf: "flex-start",
        padding: "6px 14px",
        borderRadius: 4,
        backgroundColor: colours.wash,
        color: colours.solid,
        fontSize: 24,
        fontWeight: 600,
      }}
    >
      {name}
    </div>
  );
}

/** One packshot, whole, on white, as large as its well allows. */
export function Packshot({
  picture,
  width,
  height,
}: {
  readonly picture: CardPicture | null;
  readonly width: number;
  readonly height: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width,
        height,
        backgroundColor: INK.paperRaised,
        border: `1px solid ${INK.line}`,
        borderRadius: 6,
      }}
    >
      {picture ? (
        // Satori draws an image only at the size it is given: fitted here.
        <img
          src={picture.src}
          {...fitWithin(picture, { width: width - 32, height: height - 32 })}
          alt=""
        />
      ) : null}
    </div>
  );
}

/** The heading: Literata, as large as its length allows, three lines at most. */
export function Heading({ text, size }: { readonly text: string; readonly size?: number }) {
  const fontSize = size ?? headingSize(text);
  return (
    <div
      style={{
        display: "block",
        fontFamily: "Literata",
        fontWeight: 600,
        fontSize,
        lineHeight: 1.12,
        letterSpacing: "-0.015em",
        color: INK.ink900,
        lineClamp: 3,
      }}
    >
      {text}
    </div>
  );
}

/**
 * How long a drawn card may be kept.
 *
 * A complete card is addressed by a hash of everything it shows (`cardId` in
 * `data.ts`): when a price or a photograph changes, the page names a new URL.
 * So it can be kept for a week, and the CDN keeps it (`s-maxage`).
 *
 * A card drawn without a picture it should have had — a photograph from the
 * image host that did not arrive within the deadline — is kept for a minute,
 * so the next request tries again instead of serving the gap for a week.
 *
 * Per response, which is why the card routes are rendered on request
 * (`revalidate = 0`) rather than kept by Next's own cache: a route's
 * `revalidate` is one figure for every response, and would hold the photo-less
 * card as long as the complete one.
 */
const KEEP = {
  complete: "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
  incomplete: "public, max-age=0, s-maxage=60, must-revalidate",
} as const;

/** Draw a card at 1200 × 630, with the site's faces. */
export async function renderCard(
  element: ReactElement,
  { complete = true }: { readonly complete?: boolean } = {},
): Promise<ImageResponse> {
  const fonts = await ogFonts();
  return new ImageResponse(element, {
    ...CARD_SIZE,
    fonts: fonts.map(({ name, data, weight, style }) => ({ name, data, weight, style })),
    headers: { "cache-control": complete ? KEEP.complete : KEEP.incomplete },
  });
}
