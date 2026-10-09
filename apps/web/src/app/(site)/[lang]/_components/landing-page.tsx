import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductGrid } from "@/components/catalog/product-card";
import { RelatedLandings } from "@/components/catalog/related-landings";
import { JsonLd } from "@/components/seo/json-ld";
import { Breadcrumbs } from "@/components/ui/primitives";
import { siteConfig } from "@/config/site";
import { MACHINE_BRANDS } from "@/content/machines";
import type { Locale } from "@/i18n/config";
import { pluralize } from "@/lib/catalog/format";
import { getLanding, type LandingGroupView, type LandingView } from "@/lib/catalog/landing-queries";
import { LANDING_PATHS, type LandingId } from "@/lib/catalog/landings";
import { getArticle } from "@/lib/journal";
import type { BrewingSystem } from "@/lib/recommend/systems";
import { categoryHref, href, productHref, routes, systemCategory } from "@/lib/routes";
import { pageAlternates } from "@/lib/seo/alternates";
import { breadcrumbJsonLd, itemListJsonLd } from "@/lib/seo/json-ld";
import { CUP_COST_SLUG } from "../../../../../content/journal/articles/cup-cost";
import {
  cheapestGroupNote,
  landingCopy,
  landingLabels,
  machineBrandsSentence,
  systemShelfLabel,
  type LandingFacts,
} from "../../../../../content/landing-copy";

/**
 * The four landing listings, at `/<locale>/<their slug>`.
 *
 * One body for all of them, because they are one kind of page: a heading, a
 * few sentences, and the products a rule selected, a section per brewing
 * system. What differs — which products, which words — is in
 * `lib/catalog/landings.ts` and `content/landing-copy.ts`; each route is a
 * few lines that name its landing.
 *
 * The sections are the listing components every category page uses: the same
 * card, the same grid, the system named on every card. No filters and no sort
 * control, on purpose. Each page is already one selection in one order — by
 * system, cheapest per cup first — and its URL has no query to canonicalise.
 *
 * **An empty landing is a 404, not an empty page**: `count === 0` is the same
 * test that takes it out of the sitemap and removes every link to it.
 *
 * Lives beside the routes that use it; the underscore keeps the folder out of
 * routing.
 */

const factsOf = (view: LandingView): LandingFacts => ({
  count: view.count,
  systems: view.groups.map((group) => group.system),
  methods: view.methods,
  cupRange: view.cupRange,
  commonPack: view.commonPack,
  currency: siteConfig.currency,
});

export async function landingMetadata(locale: Locale, id: LandingId): Promise<Metadata> {
  const view = await getLanding(id);
  const copy = landingCopy[id];
  // The page itself answers 404; this is only what that response is titled.
  if (view.count === 0) return { title: copy.h1, robots: { index: false, follow: true } };

  const facts = factsOf(view);
  return {
    title: copy.title(facts),
    description: copy.description(facts),
    alternates: pageAlternates(locale, LANDING_PATHS[id]),
  };
}

/** The machine brands our own database lists a model of, for one system. */
function machineBrandNames(system: BrewingSystem): readonly string[] {
  return MACHINE_BRANDS.filter((brand) =>
    brand.models.some((model) => model.system === system.id),
  ).map((brand) => brand.name);
}

/** The sentence under a group's heading: what the group is, or how it was chosen. */
function groupNote(id: LandingId, group: LandingGroupView): string {
  if (id === "cheapest") return cheapestGroupNote(group.products.length, group.poolSize);
  if (id === "lavazzaCapsules" && group.system.method === "capsule") {
    const machines = machineBrandsSentence(machineBrandNames(group.system));
    return [group.system.summary, machines].filter(Boolean).join(" ");
  }
  return group.system.summary;
}

const TEXT_LINK = "font-medium text-pine-700 underline underline-offset-4 hover:text-pine-900";

export async function LandingPage({ locale, id }: { locale: Locale; id: LandingId }) {
  const view = await getLanding(id);
  if (view.count === 0) notFound();

  const copy = landingCopy[id];
  const facts = factsOf(view);
  const path = href(locale, LANDING_PATHS[id]);
  const breadcrumbs = [
    { name: landingLabels.breadcrumbHome, href: href(locale, routes.home) },
    { name: copy.h1, href: path },
  ];

  /*
   * A page with one group and a heading that already names it — the Lavazza
   * beans — needs no second heading over its only grid. Everywhere else the
   * group heading is the point: it says which machine the products go in.
   */
  const showGroupHeadings = id !== "lavazzaBeans";
  const products = view.groups.flatMap((group) => group.products);
  const cupCost = id === "cheapest" && siteConfig.features.blog ? getArticle(CUP_COST_SLUG) : null;
  const needsMachine = view.methods.includes("capsule") && id !== "cheapest";

  return (
    <div className="shell pb-16">
      <JsonLd id="ld-breadcrumbs" data={breadcrumbJsonLd(breadcrumbs)} />
      <JsonLd
        id="ld-itemlist"
        data={itemListJsonLd(
          products.map((product) => ({ name: product.name, href: productHref(locale, product) })),
          copy.h1,
        )}
      />

      <Breadcrumbs items={breadcrumbs} />

      <header className="mb-10">
        <h1 className="font-display text-2xl font-semibold text-ink-900 md:text-4xl">{copy.h1}</h1>
        <div className="mt-3 max-w-measure space-y-3 text-base text-ink-700">
          {copy.intro(facts).map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          {needsMachine && (
            <p>
              <Link href={href(locale, routes.machines)} className={TEXT_LINK}>
                {landingLabels.findMachine}
              </Link>
            </p>
          )}
          {cupCost && (
            <p>
              <Link href={href(locale, routes.article(cupCost.slug))} className={TEXT_LINK}>
                {/* By its title, as every other page links an article. */}
                {cupCost.title}
              </Link>
            </p>
          )}
        </div>

        {showGroupHeadings && view.groups.length > 1 && (
          <nav aria-label={landingLabels.jumpLabel} className="mt-5">
            {/* The category pages' row of system chips: one scrolling line on a
                phone, wrapped from `md`. `relative` contains the chips'
                screen-reader text, which would otherwise widen the page. */}
            <ul className="relative -mx-4 flex snap-x gap-2 overflow-x-auto px-4 py-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
              {view.groups.map((group) => (
                <li key={group.key} className="shrink-0 snap-start">
                  <a
                    href={`#${group.key}`}
                    data-system={group.system.id}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-sm border border-line bg-paper-raised px-3 text-sm font-medium text-ink-900 transition-colors hover:border-pine-500"
                  >
                    <span aria-hidden className="h-2 w-2 shrink-0 bg-(--system)" />
                    {/* The system's own name: a coloured square never stands alone. */}
                    {group.system.name}
                    <span className="text-2xs text-ink-300 tabular-nums">
                      {group.products.length}
                      <span className="sr-only"> продукта</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}

        {await RelatedLandings({ locale, subject: { landing: id } })}
      </header>

      <div className="space-y-14">
        {view.groups.map((group, index) => {
          const headingId = `${group.key}-heading`;
          return (
            <section
              key={group.key}
              id={group.key}
              className="scroll-mt-32"
              {...(showGroupHeadings ? { "aria-labelledby": headingId } : {})}
            >
              {showGroupHeadings && (
                <div className="mb-6">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h2
                      id={headingId}
                      className="font-display text-2xl font-semibold text-ink-900 md:text-3xl"
                    >
                      {copy.groupHeading(group.system)}
                    </h2>
                    <span className="text-sm text-ink-500 tabular-nums">
                      {pluralize(group.products.length, "продукт", "продукта")}
                    </span>
                  </div>
                  <p className="mt-1.5 max-w-measure text-sm text-ink-500">
                    {groupNote(id, group)}{" "}
                    <Link
                      href={categoryHref(locale, systemCategory(group.system))}
                      className={TEXT_LINK}
                    >
                      {systemShelfLabel(group.system)}
                    </Link>
                  </p>
                </div>
              )}
              <ProductGrid
                locale={locale}
                products={group.products}
                // Only the first row of the page is above the fold.
                priorityCount={index === 0 ? 4 : 0}
                headingLevel={showGroupHeadings ? "h3" : "h2"}
              />
            </section>
          );
        })}
      </div>

      <section className="mt-14 border-t border-line pt-10">
        <h2 className="font-display text-2xl font-semibold text-ink-900">
          {landingLabels.orderHeading}
        </h2>
        <p className="mt-2 max-w-measure text-base text-ink-700">{landingLabels.orderBody}</p>
        <a
          href={`tel:${siteConfig.contact.phoneHref}`}
          className="mt-3 inline-block font-display text-2xl font-semibold text-pine-700 underline-offset-4 hover:underline"
        >
          {siteConfig.contact.phone}
        </a>
        <p className="mt-0.5 text-sm text-ink-500">{siteConfig.contact.hours}</p>
      </section>
    </div>
  );
}
