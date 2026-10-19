import "server-only";
import { siteConfig } from "@/config/site";
import { pluralize } from "@/lib/catalog/format";
import { getLanding } from "@/lib/catalog/landing-queries";
import { LANDING_IDS, type LandingId } from "@/lib/catalog/landings";
import { cupRangeText, landingCopy } from "../../../../content/landing-copy";
import {
  cardImage,
  cardLocale,
  oncePerRequest,
  renderListingCard,
  type ListingCardFacts,
} from "./data";

/**
 * The share card of a landing listing — Lavazza capsules, Lavazza beans,
 * decaf, cheapest per cup: its heading, how many products it lists and the
 * range of a cup, beside the first pack of each system it covers. Each
 * landing's folder holds an `opengraph-image.tsx` of a few lines that names
 * its landing; this is the rest. The landing is read with `getLanding`, which
 * the page itself reads too, once per request (React `cache`).
 *
 * A landing with nothing to list is a 404, and so is its card.
 */

type Params = Promise<{ lang: string }> | { lang: string };

async function landingCardFacts(id: LandingId): Promise<ListingCardFacts | null> {
  const view = await getLanding(id);
  if (view.count === 0) return null;
  const range = cupRangeText({ cupRange: view.cupRange, currency: siteConfig.currency });
  return {
    heading: landingCopy[id].h1,
    lines: [
      pluralize(view.count, "продукт", "продукта"),
      ...(range ? [range.charAt(0).toLocaleUpperCase("bg") + range.slice(1)] : []),
    ],
    // One pack from each system, so the picture says the page spans them.
    photos: view.groups
      .map((group) => group.products.find((product) => product.image)?.image?.url)
      .filter((url): url is string => Boolean(url))
      .slice(0, 3),
  };
}

/** One read per landing per card request (`oncePerRequest`, keyed by the params object). */
const cards = Object.fromEntries(
  LANDING_IDS.map((id) => [
    id,
    oncePerRequest(async (params: { lang: string }) =>
      cardLocale(params.lang) ? landingCardFacts(id) : null,
    ),
  ]),
) as Record<LandingId, (params: { lang: string }) => Promise<ListingCardFacts | null>>;

export async function landingImageMetadata(params: Params, id: LandingId) {
  const facts = await cards[id](await params);
  return facts
    ? cardImage(`${landingCopy[id].h1} в ${siteConfig.name}: продукти и цена на чаша`, facts)
    : [];
}

export async function landingImage(params: Params, id: LandingId): Promise<Response> {
  const facts = await cards[id](await params);
  return facts ? renderListingCard(facts) : new Response("Not found", { status: 404 });
}
