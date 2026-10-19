import type { BrewingSystemId } from "@/lib/recommend/systems";
import { CardFrame, Heading, INK, Packshot, SystemTag } from "./card";
import { fitWithin, type CardPicture } from "./image-data";

/**
 * The kinds of share card — a product, a listing, an article — as pure
 * functions of what they show. The routes beside the pages
 * (`opengraph-image.tsx`) read the catalog, load the pictures and hand the
 * result in; nothing here reads anything, so a card can be drawn from a
 * fixture (`test/share-cards.test.ts` does).
 *
 * Every figure printed is one the page itself prints, formatted the same way:
 * the price, the price per cup, a count, a range. Nothing is typed here.
 */

const LEFT = 640;

export interface ProductCardData {
  readonly lockup: CardPicture | null;
  readonly photo: CardPicture | null;
  /** Brand and line: „Lavazza Super Crema“. */
  readonly title: string;
  /** „Кафе на зърна, 1 кг“. */
  readonly detail: string | null;
  readonly brandName: string | null;
  readonly system: { readonly id: BrewingSystemId; readonly name: string } | null;
  /** „25,10 €“, or null for a product sold on enquiry. */
  readonly price: string | null;
  readonly oldPrice: string | null;
  readonly discountPercent: number | null;
  /** „0,31 € на чаша“. */
  readonly perCup: string | null;
  /** What stands in for the price when the product cannot be ordered today. */
  readonly notice: string | null;
}

export function ProductCard(data: ProductCardData) {
  const reduced = data.oldPrice !== null && data.discountPercent !== null;
  return (
    <CardFrame lockup={data.lockup}>
      <div style={{ display: "flex", flexDirection: "column", width: LEFT, paddingRight: 40 }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
          {data.system ? <SystemTag systemId={data.system.id} name={data.system.name} /> : null}
          {data.brandName ? (
            <div
              style={{
                display: "flex",
                marginLeft: data.system ? 18 : 0,
                fontSize: 26,
                fontWeight: 600,
                color: INK.ink500,
              }}
            >
              {data.brandName}
            </div>
          ) : null}
        </div>
        <Heading text={data.title} />
        {data.detail ? (
          <div style={{ display: "flex", marginTop: 14, fontSize: 30, color: INK.ink700 }}>
            {data.detail}
          </div>
        ) : null}
        <div style={{ display: "flex", flex: 1 }} />
        {data.notice ? (
          <div
            style={{
              display: "flex",
              alignSelf: "flex-start",
              padding: "10px 18px",
              borderRadius: 4,
              backgroundColor: INK.caution100,
              color: INK.caution,
              fontSize: 28,
              fontWeight: 600,
            }}
          >
            {data.notice}
          </div>
        ) : data.price ? (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "baseline" }}>
              <div
                style={{
                  display: "flex",
                  fontSize: 64,
                  fontWeight: 600,
                  color: reduced ? INK.clay600 : INK.ink900,
                }}
              >
                {data.price}
              </div>
              {reduced ? (
                <div
                  style={{
                    display: "flex",
                    marginLeft: 20,
                    fontSize: 32,
                    color: INK.ink300,
                    textDecoration: "line-through",
                  }}
                >
                  {data.oldPrice}
                </div>
              ) : null}
              {reduced ? (
                <div
                  style={{
                    display: "flex",
                    marginLeft: 16,
                    padding: "2px 10px",
                    borderRadius: 2,
                    backgroundColor: INK.clay600,
                    color: INK.paperRaised,
                    fontSize: 26,
                    fontWeight: 600,
                  }}
                >
                  {`−${data.discountPercent}%`}
                </div>
              ) : null}
            </div>
            {data.perCup ? (
              <div
                style={{
                  display: "flex",
                  marginTop: 6,
                  fontSize: 32,
                  fontWeight: 600,
                  color: INK.pine700,
                }}
              >
                {data.perCup}
              </div>
            ) : null}
          </div>
        ) : (
          <div style={{ display: "flex", fontSize: 32, color: INK.ink500 }}>Цена при запитване</div>
        )}
      </div>
      <Packshot picture={data.photo} width={1200 - 112 - LEFT} height={474} />
    </CardFrame>
  );
}

export interface ListingCardData {
  readonly lockup: CardPicture | null;
  /** A brand's logo, above the heading of its page. */
  readonly logo?: CardPicture | null;
  /** A logo the brand publishes only for a dark ground sits on an ink tile, never recoloured. */
  readonly logoGround?: "light" | "dark";
  readonly system?: { readonly id: BrewingSystemId; readonly name: string } | null;
  readonly eyebrow?: string | null;
  readonly heading: string;
  /** „33 продукта“, „от 0,31 € до 0,67 € на чаша“: one line each. */
  readonly lines: readonly string[];
  /** Up to three packshots of what the page lists. */
  readonly photos: readonly (CardPicture | null)[];
}

/** A category, a landing or a brand: what it is, how much of it, what a cup costs. */
export function ListingCard(data: ListingCardData) {
  const photos = data.photos.filter((photo): photo is CardPicture => photo !== null).slice(0, 3);
  const slot = {
    width: Math.floor((1200 - 112 - 560 - 40) / Math.max(1, photos.length)) - 8,
    height: 420,
  };
  // A raster logo is never drawn larger than its own pixels (DESIGN.md, "Brand logo").
  const logoBox = data.logo
    ? data.logo.src.startsWith("data:image/svg")
      ? fitWithin(data.logo, { width: 260, height: 84 })
      : fitWithin(data.logo, {
          width: Math.min(260, data.logo.width),
          height: Math.min(84, data.logo.height),
        })
    : null;
  return (
    <CardFrame lockup={data.lockup}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: photos.length > 0 ? 560 : 1088,
          paddingRight: 36,
        }}
      >
        {data.logo ? (
          <div
            style={{
              display: "flex",
              alignSelf: "flex-start",
              marginBottom: 22,
              ...(data.logoGround === "dark"
                ? { padding: "12px 18px", borderRadius: 4, backgroundColor: INK.ink900 }
                : {}),
            }}
          >
            <img src={data.logo.src} {...logoBox} alt="" />
          </div>
        ) : null}
        {data.system ? (
          <div style={{ display: "flex", marginBottom: 18 }}>
            <SystemTag systemId={data.system.id} name={data.system.name} />
          </div>
        ) : data.eyebrow ? (
          <div
            style={{
              display: "flex",
              marginBottom: 16,
              fontSize: 24,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: INK.ink500,
            }}
          >
            {data.eyebrow}
          </div>
        ) : null}
        <Heading text={data.heading} />
        <div style={{ display: "flex", flex: 1 }} />
        {data.lines.map((line, index) => (
          <div
            key={line}
            style={{
              display: "flex",
              marginTop: index === 0 ? 0 : 6,
              fontSize: index === data.lines.length - 1 ? 32 : 28,
              fontWeight: index === data.lines.length - 1 ? 600 : 400,
              color: index === data.lines.length - 1 ? INK.pine700 : INK.ink700,
            }}
          >
            {line}
          </div>
        ))}
      </div>
      {photos.length > 0 ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 1200 - 112 - 560,
            height: 474,
            backgroundColor: INK.paperRaised,
            border: `1px solid ${INK.line}`,
            borderRadius: 6,
          }}
        >
          {photos.map((photo, index) => (
            <div
              key={index}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: slot.width,
                height: slot.height,
                margin: "0 4px",
              }}
            >
              <img src={photo.src} {...fitWithin(photo, slot)} alt="" />
            </div>
          ))}
        </div>
      ) : null}
    </CardFrame>
  );
}

export interface ArticleCardData {
  readonly lockup: CardPicture | null;
  readonly mark: CardPicture | null;
  readonly section: string;
  readonly title: string;
  readonly description: string;
  readonly date: string;
}

/** An article: its question, large, and the first lines of the answer. */
export function ArticleCard(data: ArticleCardData) {
  return (
    <CardFrame lockup={data.lockup}>
      <div style={{ display: "flex", flexDirection: "column", width: 840, paddingRight: 48 }}>
        {/* The section as a one-word label; the date in its own case, as a
            sentence is never set in capitals (DESIGN.md, "Typography"). */}
        <div
          style={{ display: "flex", alignItems: "baseline", marginBottom: 18, color: INK.ink500 }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 24,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            {data.section}
          </div>
          <div style={{ display: "flex", marginLeft: 14, fontSize: 24 }}>{data.date}</div>
        </div>
        <Heading text={data.title} size={data.title.length > 44 ? 50 : 58} />
        <div
          style={{
            display: "block",
            marginTop: 22,
            fontSize: 27,
            lineHeight: 1.45,
            color: INK.ink700,
            lineClamp: 3,
          }}
        >
          {data.description}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 1200 - 112 - 840,
          height: 474,
          backgroundColor: INK.pine900,
          borderRadius: 6,
        }}
      >
        {data.mark ? (
          <img src={data.mark.src} {...fitWithin(data.mark, { width: 200, height: 200 })} alt="" />
        ) : null}
      </div>
    </CardFrame>
  );
}
