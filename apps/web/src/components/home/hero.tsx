import type { CSSProperties } from "react";
import Link from "next/link";
import { ProductImage } from "@/components/catalog/product-image";
import { Bean, Cup } from "@/components/illustrations/drawings";
import { ButtonLink, buttonClasses } from "@/components/ui/primitives";
import { siteConfig } from "@/config/site";
import type { HeroShelfItem, StillLifePack } from "@/lib/catalog/home-shelf";
import { countPhrase } from "./plural";
import type { Locale } from "@/i18n/config";
import { href, productHref, routes } from "@/lib/routes";

/**
 * The hero: what the shop is, and a start from the customer's machine.
 *
 * DESIGN.md, "Home page", section 1. On the right, the catalog itself: while
 * at least three packs have live cut-outs, a still life of them standing
 * together on the lit green with drawn beans and a glass of espresso
 * (`selectHeroStillLife`); before that, the shelf of six photographs it
 * replaces. Every pack is a link to its product.
 *
 * Motion (DESIGN.md, "Motion" and "The Web Vitals rules"): on load the packs
 * are set down and the beans drop, once, in CSS; the steam loops while it is
 * on screen. The title and lead never move — the lead is the LCP element on a
 * phone — and the centre pack, the likely LCP element on a desktop, is
 * preloaded and moves without fading.
 */

/** The hero's wells are a sixth of the shell from `md`, a third on a phone. */
export const HERO_SHELF_SIZES = "(min-width: 1180px) 180px, (min-width: 768px) 16vw, 30vw";

/** Wells shown on a phone: one row. The rest are hidden and stay unloaded. */
const PHONE_WELLS = 3;

/**
 * Beans scattered round the packs' feet, in percentages of the stage, each
 * with its own turn; `i` staggers their drop.
 */
const BEANS: ReadonlyArray<{
  left: number;
  bottom: number;
  size: number;
  turn: number;
  dark?: boolean;
}> = [
  { left: 33, bottom: 5, size: 5.2, turn: 20 },
  { left: 38, bottom: 1, size: 4.2, turn: -60, dark: true },
  { left: 28, bottom: 0, size: 4.6, turn: 95 },
  { left: 72, bottom: 1, size: 4.4, turn: 140, dark: true },
  { left: 88, bottom: 0, size: 4.2, turn: -15 },
  { left: 20, bottom: 2, size: 4, turn: 70, dark: true },
  { left: 62, bottom: -1, size: 4.8, turn: -110 },
];

/** A pack's `sizes`: its share of a stage up to 580 px wide, or of a phone. */
function packSizes(widthShare: number): string {
  return `(min-width: 768px) ${Math.ceil(5.8 * widthShare)}px, ${Math.ceil(widthShare)}vw`;
}

function StillLife({ locale, packs }: { locale: Locale; packs: readonly StillLifePack[] }) {
  return (
    <div className="hero-stage relative mx-auto aspect-square w-full max-w-[27.5rem] md:col-span-6 md:max-w-[36rem] md:justify-self-end xl:col-span-5">
      <span aria-hidden className="hero-floor" />
      {packs.map((pack, index) => (
        <Link
          key={pack.id}
          href={productHref(locale, pack)}
          data-slot={pack.slot}
          className="hero-pack absolute block"
          style={
            {
              left: `${pack.box.left}%`,
              bottom: `${pack.box.bottom}%`,
              width: `${pack.box.width}%`,
              height: `${pack.box.height}%`,
              zIndex: pack.box.z,
              "--rot": `${pack.box.rotate}deg`,
              "--d": `${index * 0.08}s`,
            } as CSSProperties
          }
        >
          <span aria-hidden className="hero-pack-shadow" />
          <span className="hero-pack-image">
            <ProductImage
              src={pack.cutout.url}
              alt={pack.name}
              fill
              sizes={packSizes(pack.box.width)}
              // The centre pack is the stage's largest image: the one preload.
              preload={pack.slot === "centre"}
              fetchPriority={pack.slot === "centre" ? "high" : undefined}
              loading={pack.slot === "centre" ? undefined : "lazy"}
              className="object-contain object-bottom"
            />
          </span>
        </Link>
      ))}
      <Cup ground="dark" steam className="hero-cup absolute right-0 bottom-[7%] z-[4] w-[22%]" />
      {BEANS.map((bean, index) => (
        <span
          key={index}
          aria-hidden
          className="hero-bean absolute z-[5] block"
          style={
            {
              left: `${bean.left}%`,
              bottom: `${bean.bottom}%`,
              width: `${bean.size}%`,
              "--r": `${bean.turn}deg`,
              "--i": index,
            } as CSSProperties
          }
        >
          <Bean roast={bean.dark ? "dark" : "medium"} className="block h-auto w-full" />
        </span>
      ))}
    </div>
  );
}

function Shelf({ locale, shelf }: { locale: Locale; shelf: readonly HeroShelfItem[] }) {
  return (
    <ul className="grid grid-cols-3 gap-3 md:col-span-6 xl:col-span-5">
      {shelf.map((item, index) => (
        <li key={item.id} className={index >= PHONE_WELLS ? "hidden md:block" : undefined}>
          <Link
            href={productHref(locale, item)}
            className="relative block aspect-square overflow-hidden rounded-md bg-well"
          >
            <ProductImage
              src={item.image.url}
              alt={item.name}
              fill
              sizes={HERO_SHELF_SIZES}
              // One preloaded image per page, and this is it: the first
              // well. Every other well is lazy, which also means a phone
              // never fetches the row it does not show.
              preload={index === 0}
              fetchPriority={index === 0 ? "high" : undefined}
              loading={index === 0 ? undefined : "lazy"}
              className="object-contain"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The tagline, its last words in the italic accent when the config names them. */
function Tagline() {
  const { tagline, taglineAccent: accent } = siteConfig;
  if (!accent || !tagline.endsWith(accent)) return <>{tagline}</>;
  return (
    <>
      {tagline.slice(0, -accent.length)}
      <em className="font-accent font-medium text-gold-300 italic">{accent}</em>
    </>
  );
}

export function HomeHero({
  locale,
  brandCount,
  productCount,
  shelf,
  stillLife = [],
  systemsHref,
}: {
  readonly locale: Locale;
  /** Brands with at least one product, counted from the database. */
  readonly brandCount: number;
  /** Active products, counted from the database. */
  readonly productCount: number;
  readonly shelf: readonly HeroShelfItem[];
  /** Packs with live cut-outs, placed; empty while fewer than three are live. */
  readonly stillLife?: readonly StillLifePack[];
  /** The tile section's anchor, or null when that section is not rendered. */
  readonly systemsHref: string | null;
}) {
  const showStillLife = stillLife.length > 0;
  const hasPicture = showStillLife || shelf.length > 0;
  const counts = [
    brandCount > 0 ? countPhrase(brandCount, "марка", "марки") : null,
    productCount > 0 ? countPhrase(productCount, "продукт", "продукта") : null,
  ].filter((part): part is string => part !== null);

  return (
    <section className="hero-lit on-pine relative isolate overflow-hidden bg-pine-900 text-paper">
      {/*
        Below `md` the gap is the column rhythm's 24 px rather than 32: on a
        phone it is what stands between the text and the picture, and every
        pixel of it pushes the packs further below the fold.

        From `xl` the text takes seven columns of twelve. At six, the two
        actions need about 549 px and the column holds 542, so they wrapped;
        seven leaves them a line of their own.
      */}
      <div className="shell grid gap-6 py-10 md:grid-cols-12 md:items-center md:gap-8 md:py-16">
        <div className={hasPicture ? "md:col-span-6 xl:col-span-7" : "md:col-span-12"}>
          {counts.length > 0 && (
            <p className="text-2xs font-semibold tracking-[0.06em] text-gold-300 uppercase tabular-nums">
              {counts.join(" · ")}
            </p>
          )}
          <h1 className="mt-3 font-display text-3xl leading-[1.08] font-semibold md:text-6xl md:leading-[1.04]">
            <Tagline />
          </h1>
          {/*
            The lead steps down to `text-base` on a phone only: at 17 px it
            runs to four lines in a 358 px column and, with the stacked
            actions under it, pushes the picture to the bottom edge of the
            first screen. At 15 px it takes three.
          */}
          <p className="mt-4 max-w-[48ch] text-base text-pine-200 md:text-lg">
            {siteConfig.description}
          </p>

          {/*
            Each action grows to fill its line. Side by side they share the
            row; once the column is too narrow for both (a phone, a tablet, a
            small laptop) each takes a full line, so the stacked pair is two
            buttons of one width rather than a long one over a short one.
          */}
          <div className="mt-6 flex flex-wrap gap-3">
            <ButtonLink
              href={href(locale, routes.wizard)}
              variant="accent"
              size="lg"
              className="grow"
            >
              Намерете кафе за вашата машина
            </ButtonLink>
            {systemsHref && (
              <a
                href={systemsHref}
                className={buttonClasses({
                  variant: "on-pine",
                  size: "lg",
                  className: "grow",
                })}
              >
                Разгледайте по система
              </a>
            )}
          </div>

          <p className="mt-4 text-sm text-pine-200">
            Не знаете каква система е машината ви?{" "}
            <Link
              href={href(locale, routes.machines)}
              className="text-gold-300 underline underline-offset-2 hover:no-underline"
            >
              Намерете я по марка и модел
            </Link>
          </p>
        </div>

        {showStillLife ? (
          <StillLife locale={locale} packs={stillLife} />
        ) : (
          shelf.length > 0 && <Shelf locale={locale} shelf={shelf} />
        )}
      </div>
    </section>
  );
}
