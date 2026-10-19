import { siteConfig } from "@/config/site";
import { resolveSlug } from "@/lib/catalog/resolve-slug";
import { categoryHeading } from "@/lib/seo/listing-meta";
import {
  cardImage,
  cardLocale,
  categoryCardFacts,
  oncePerRequest,
  productCardAlt,
  productCardFacts,
  renderListingCard,
  renderProductCard,
} from "@/lib/seo/og/data";
import { brewingSystemForCategory, businessSectionForCategory } from "../_lib/category-scope";

/**
 * The share card of a product or a category, at `/<locale>/<slug>`.
 *
 * A product: its packshot whole, on white, beside its name, the system it is
 * for, its price and its price per cup. A category: its heading, how many
 * products it lists and the range of a cup, beside three of them.
 *
 * Next attaches it to the page because the page's `shareMetadata` names no
 * image of its own (`image: "generated"`), and writes `og:image` with its
 * width, height, type and the `alt` below; `twitter:image` follows. The id
 * in its URL is a hash of what it shows, so a new price is a new URL. Drawn on
 * request; `renderCard` says how long each answer may be kept. See
 * `lib/seo/og/`.
 */
export const revalidate = 0;

type Params = { lang: string; slug: string };

/** What the slug names, when it is a page that shares under its own card. */
async function subject({ lang, slug }: Params) {
  const locale = cardLocale(lang);
  if (!locale) return null;
  const resolved = await resolveSlug(locale, slug);
  if (!resolved || resolved.kind === "redirect") return null;
  // A business section's category answers 308 to the section's page.
  if (resolved.kind === "category" && businessSectionForCategory(resolved.category)) return null;
  return resolved;
}

/** The facts the card shows, and what it is called: the same for the page and the card. */
const card = oncePerRequest(async (params: Params) => {
  const found = await subject(params);
  if (!found) return null;
  if (found.kind === "product") {
    return {
      kind: "product" as const,
      facts: productCardFacts(found.product),
      alt: productCardAlt(found.product),
    };
  }
  const heading = categoryHeading(found.category);
  return {
    kind: "listing" as const,
    facts: await categoryCardFacts(
      found.category,
      heading,
      brewingSystemForCategory(found.category),
    ),
    alt: `${heading} в ${siteConfig.name}: продукти и цена на чаша`,
  };
});

export async function generateImageMetadata({ params }: { params: Promise<Params> | Params }) {
  const found = await card(await params);
  return found ? cardImage(found.alt, found.facts) : [];
}

export default async function Image({ params }: { params: Promise<Params> }) {
  const found = await card(await params);
  if (!found) return new Response("Not found", { status: 404 });
  return found.kind === "product" ? renderProductCard(found.facts) : renderListingCard(found.facts);
}
