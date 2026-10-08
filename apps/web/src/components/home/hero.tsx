import Link from "next/link";
import { ProductImage } from "@/components/catalog/product-image";
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

/*
 * The accent button, written out. The `accent` variant of `ButtonLink` is
 * specified in DESIGN.md ("Buttons") but is not in `primitives.tsx` yet; when
 * it is, this becomes `<ButtonLink variant="accent" size="lg">`. On pine its
 * hover is `gold-300`.
 */
const ACCENT_ON_PINE =
  "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-sm bg-gold-500 px-6 py-3 text-base font-semibold text-ink-900 transition-colors hover:bg-gold-300 md:w-auto";

/** The secondary action on a pine band (DESIGN.md, "Buttons"). */
export const SECONDARY_ON_PINE =
  "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-sm border border-pine-200 px-6 py-3 text-base font-medium text-paper transition-colors hover:bg-pine-700 md:w-auto";

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
      <div className="shell grid gap-8 py-10 md:grid-cols-12 md:items-center md:py-16">
        <div className={hasShelf ? "md:col-span-6" : "md:col-span-12"}>
          {counts.length > 0 && (
            <p className="text-2xs font-semibold tracking-[0.06em] text-gold-300 uppercase tabular-nums">
              {counts.join(" · ")}
            </p>
          )}
          <h1 className="mt-3 font-display text-3xl leading-[1.1] font-semibold md:text-5xl">
            {siteConfig.tagline}
          </h1>
          <p className="mt-4 max-w-[48ch] text-lg text-pine-200">{siteConfig.description}</p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/wizard" className={ACCENT_ON_PINE}>
              Намерете кафе за вашата машина
            </Link>
            {systemsHref && (
              <a href={systemsHref} className={SECONDARY_ON_PINE}>
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
          <ul className="grid grid-cols-3 gap-3 md:col-span-6">
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
