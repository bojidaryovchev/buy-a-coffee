import { siteConfig } from "@/config/site";
import { listBrands } from "@/lib/catalog/queries";
import { systemsForCategories } from "@/lib/catalog/brand-summary";
import { brandHasInstantCoffee, listBrandCategoryKeys } from "@/lib/catalog/taxonomy";
import { matchBrandSlug } from "@/lib/routes";
import { brandDescriptionLead } from "@/lib/seo/listing-meta";
import {
  brandCardFacts,
  cardImage,
  cardLocale,
  oncePerRequest,
  renderListingCard,
} from "@/lib/seo/og/data";
import { brandLogoFor } from "../../../../../../content/brand-logos";

/**
 * The share card of a brand's page: the brand's own logo where we hold one,
 * what the shop has of it — „Кафе Bianchi: капсули, дози и разтворимо“ — how
 * many products and what a cup costs, beside three of its packs. Attached by
 * Next because the page's `shareMetadata` names no image (`image:
 * "generated"`); its id is a hash of what it shows. See `lib/seo/og/`.
 *
 * The reads are the brand page's own — `listBrands`, `listBrandCategoryKeys`,
 * `brandHasInstantCoffee`, `getListingFacts` — each kept once per request by
 * React `cache` where it is defined, so the page, its metadata and this
 * card's metadata ask the database once between them.
 */
export const revalidate = 0;

type Params = { lang: string; slug: string };

const card = oncePerRequest(async ({ lang, slug }: Params) => {
  const locale = cardLocale(lang);
  if (!locale) return null;
  const found = matchBrandSlug(locale, await listBrands(), slug);
  if (!found?.published) return null;
  const { brand } = found;
  const [keys, instant] = await Promise.all([
    listBrandCategoryKeys(brand.slug),
    brandHasInstantCoffee(brand.slug),
  ]);
  // „Кафе Bianchi: капсули, дози и разтворимо“: the formats on the page.
  const heading = brandDescriptionLead(brand, systemsForCategories(keys), instant);
  return {
    facts: await brandCardFacts(brand, heading, brandLogoFor(brand.slug)),
    alt: `${heading}: продукти и цена на чаша в ${siteConfig.name}`,
  };
});

export async function generateImageMetadata({ params }: { params: Promise<Params> | Params }) {
  const found = await card(await params);
  return found ? cardImage(found.alt, found.facts) : [];
}

export default async function Image({ params }: { params: Promise<Params> }) {
  const found = await card(await params);
  if (!found) return new Response("Not found", { status: 404 });
  return renderListingCard(found.facts);
}
