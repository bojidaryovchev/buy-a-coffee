import Link from "next/link";
import { ProductImage } from "@/components/catalog/product-image";
import { ButtonLink, buttonClasses } from "@/components/ui/primitives";
import { siteConfig } from "@/config/site";
import type { HeroShelfItem } from "@/lib/catalog/home-shelf";
import { countPhrase } from "./plural";

/**
 * The hero: what the shop is, and a start from the customer's machine.
 *
 * DESIGN.md, "Home page", section 1. The shelf on the right is the first
 * imagery a visitor sees, and it is the catalog itself — six real packs,
 * chosen by `selectHeroShelf`, each a link to its product.
 */

/** The hero's wells are a sixth of the shell from `md`, a third on a phone. */
export const HERO_SHELF_SIZES = "(min-width: 1180px) 180px, (min-width: 768px) 16vw, 30vw";

/** Wells shown on a phone: one row. The rest are hidden and stay unloaded. */
const PHONE_WELLS = 3;

export function HomeHero({
  brandCount,
  productCount,
  shelf,
  systemsHref,
}: {
  /** Brands with at least one product, counted from the database. */
  readonly brandCount: number;
  /** Active products, counted from the database. */
  readonly productCount: number;
  readonly shelf: readonly HeroShelfItem[];
  /** The tile section's anchor, or null when that section is not rendered. */
  readonly systemsHref: string | null;
}) {
  const hasShelf = shelf.length > 0;
  const counts = [
    brandCount > 0 ? countPhrase(brandCount, "марка", "марки") : null,
    productCount > 0 ? countPhrase(productCount, "продукт", "продукта") : null,
  ].filter((part): part is string => part !== null);

  return (
    <section className="on-pine bg-pine-900 text-paper">
      {/*
        Below `md` the gap is the column rhythm's 24 px rather than 32: on a
        phone it is what stands between the text and the packshots, and every
        pixel of it pushes the wells further below the fold.

        From `xl` the text takes seven columns of twelve. At six, the two
        actions need about 549 px and the column holds 542, so they wrapped;
        seven leaves them a line of their own and the six wells still read at
        about 140 px.
      */}
      <div className="shell grid gap-6 py-10 md:grid-cols-12 md:items-center md:gap-8 md:py-16">
        <div className={hasShelf ? "md:col-span-6 xl:col-span-7" : "md:col-span-12"}>
          {counts.length > 0 && (
            <p className="text-2xs font-semibold tracking-[0.06em] text-gold-300 uppercase tabular-nums">
              {counts.join(" · ")}
            </p>
          )}
          <h1 className="mt-3 font-display text-3xl leading-[1.1] font-semibold md:text-5xl">
            {siteConfig.tagline}
          </h1>
          {/*
            The lead steps down to `text-base` on a phone only: at 17 px it
            runs to four lines in a 358 px column and, with the stacked
            actions under it, pushes the packshots to the bottom edge of the
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
            <ButtonLink href="/wizard" variant="accent" size="lg" className="grow">
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
              href="/wizard/machines"
              className="text-gold-300 underline underline-offset-2 hover:no-underline"
            >
              Намерете я по марка и модел
            </Link>
          </p>
        </div>

        {hasShelf && (
          <ul className="grid grid-cols-3 gap-3 md:col-span-6 xl:col-span-5">
            {shelf.map((item, index) => (
              <li key={item.id} className={index >= PHONE_WELLS ? "hidden md:block" : undefined}>
                <Link
                  href={`/products/${item.slug}`}
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
        )}
      </div>
    </section>
  );
}
