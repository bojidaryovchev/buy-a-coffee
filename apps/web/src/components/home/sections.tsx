import Link from "next/link";
import type { ReactNode } from "react";
import { SystemIcon } from "@/components/catalog/system-icon";
import { BrandLogo } from "@/components/catalog/brand-logo";
import { Crema } from "@/components/illustrations/drawings";
import { ArticleDrawing } from "@/components/journal/article-drawing";
import { CartIcon, PhoneIcon } from "@/components/layout/icons";
import { ProductGrid } from "@/components/catalog/product-card";
import { ButtonLink, SectionHeading } from "@/components/ui/primitives";
import {
  deliveryCostSentences,
  deliveryTimeSentence,
  freeDeliveryThreshold,
  paymentSentence,
  deliveryCostKnown,
} from "@/components/commerce/terms";
import { siteConfig, type CommerceConfig } from "@/config/site";
import type { BrandView, ProductCardView } from "@/lib/catalog/types";
import { BUSINESS_SECTIONS } from "@/lib/catalog/business-sections";
import { JOURNAL_PATH, formatArticleDate, type ArticleSummary } from "@/lib/journal";
import { STEP_LABELS, STEP_SEQUENCE } from "@/lib/recommend/answers";
import { BREWING_SYSTEMS, type BrewingSystemId } from "@/lib/recommend/systems";
import { countPhrase } from "./plural";
import type { Locale } from "@/i18n/config";
import { brandHref, categoryHref, href, routes, systemCategory } from "@/lib/routes";

/**
 * The home page's sections below the hero, in DESIGN.md order ("Home page",
 * sections 2 to 10).
 *
 * Each one takes its data as props and returns `null` when that data gives it
 * nothing to show. None of them queries anything, so the page decides the
 * round trips and a test can render any section from a fixture.
 */

/** Where the hero's "Разгледайте по система" lands. */
export const SYSTEMS_ANCHOR = "systems";

/* --- 2. Delivery promise ------------------------------------------------- */

const ICON = {
  viewBox: "0 0 20 20",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  className: "h-5 w-5 shrink-0 text-pine-700",
} as const;

const DELIVERY_ICON = (
  <svg {...ICON}>
    <path d="M1.5 5h10v9h-10zM11.5 8h4l3 3v3h-7z" />
    <path d="M5 16.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM14.5 16.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" />
  </svg>
);
const TIME_ICON = (
  <svg {...ICON}>
    <path d="M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15z" />
    <path d="M10 5.5V10l3 2" />
  </svg>
);
const PAYMENT_ICON = (
  <svg {...ICON}>
    <path d="M2 5h16v10.5H2zM2 8.5h16M5 12.5h3.5" />
  </svg>
);
const PHONE_ICON = (
  <svg {...ICON}>
    <path d="M4 2.5h3l1.5 4-2 1.5a9 9 0 0 0 5.5 5.5l1.5-2 4 1.5v3a1.5 1.5 0 0 1-1.5 1.5A13.5 13.5 0 0 1 2.5 4 1.5 1.5 0 0 1 4 2.5z" />
  </svg>
);

interface DeliveryFact {
  readonly id: "delivery" | "time" | "payment" | "confirmation";
  readonly icon: ReactNode;
  readonly title: string;
  readonly line: string;
}

/**
 * The facts the strip may state, from the configuration alone.
 *
 * The first three exist only when their term is set, and each is the sentence
 * `terms.ts` builds — the same one the delivery page and the legal text print,
 * so the strip cannot say something they do not.
 */
export function deliveryFacts(
  commerce: CommerceConfig = siteConfig.commerce,
): readonly DeliveryFact[] {
  const facts: DeliveryFact[] = [];

  // With neither a threshold nor a fee, the builder can only say "we will tell
  // you on the phone". That is not a term, so the fact is left out — and with
  // a threshold but no fee, so is its second sentence, for the same reason.
  const costKnown = deliveryCostKnown(commerce);
  if (freeDeliveryThreshold(commerce) || costKnown) {
    const sentences = deliveryCostSentences(commerce);
    facts.push({
      id: "delivery",
      icon: DELIVERY_ICON,
      title: "Доставка",
      line: (costKnown ? sentences : sentences.slice(0, 1)).join(" "),
    });
  }

  const time = deliveryTimeSentence(commerce);
  if (time) facts.push({ id: "time", icon: TIME_ICON, title: "Срок на доставка", line: time });

  const payment = paymentSentence(commerce);
  if (payment) facts.push({ id: "payment", icon: PAYMENT_ICON, title: "Плащане", line: payment });

  facts.push({
    id: "confirmation",
    icon: PHONE_ICON,
    title: "Потвърждаваме по телефона",
    line: "Нищо не тръгва към вас, преди да сме го уточнили с вас в един разговор.",
  });

  return facts;
}

const FACT_COLUMNS: Readonly<Record<number, string>> = {
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-4",
};

export function DeliveryPromise({
  commerce = siteConfig.commerce,
}: {
  readonly commerce?: CommerceConfig;
}) {
  const facts = deliveryFacts(commerce);
  // "We confirm by phone" is always true; alone it is not a delivery answer.
  if (facts.length < 2) return null;

  return (
    <section aria-label="Доставка и плащане" className="border-b border-line">
      <dl className={`shell grid grid-cols-2 gap-4 py-5 ${FACT_COLUMNS[facts.length] ?? ""}`}>
        {facts.map((fact) => (
          <div key={fact.id} className="flex gap-3">
            {fact.icon}
            <div>
              <dt className="text-sm font-semibold text-ink-900">{fact.title}</dt>
              <dd className="mt-0.5 text-xs text-ink-500">{fact.line}</dd>
            </div>
          </div>
        ))}
      </dl>
    </section>
  );
}

/* --- 3. Shop by system --------------------------------------------------- */

export type SystemCounts = Readonly<Partial<Record<BrewingSystemId, number>>>;

/** Systems that hold at least one product, in `BREWING_SYSTEMS` order. */
export function stockedSystems(counts: SystemCounts) {
  return BREWING_SYSTEMS.map((system) => ({ system, count: counts[system.id] ?? 0 })).filter(
    (entry) => entry.count > 0,
  );
}

/*
 * No border and no coloured top rule (Phase K): the wash carries the tile, the
 * system's capsule tips out of it on hover, and the tiles rise into place as
 * the row scrolls into view (`.reveal-on-scroll`; DESIGN.md, "Motion").
 */
const TILE_SHAPE = "group reveal-on-scroll flex h-full flex-col rounded-md p-4 transition-colors";

export function ShopBySystem({
  counts,
  locale,
}: {
  readonly counts: SystemCounts;
  readonly locale: Locale;
}) {
  const systems = stockedSystems(counts);
  // The finder tile closes a row of systems; alone under this heading it
  // would be a heading over nothing. The hero still links to the finder.
  if (systems.length === 0) return null;

  return (
    <section id={SYSTEMS_ANCHOR} className="shell scroll-mt-24 py-12 md:py-16">
      <SectionHeading
        title="Изберете по машината си"
        description="Всяка система приема само своите капсули."
      />
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-4">
        {systems.map(({ system, count }) => (
          <li key={system.id}>
            <Link
              href={categoryHref(locale, systemCategory(system))}
              data-system={system.id}
              className={`${TILE_SHAPE} bg-(--system-wash)`}
            >
              {/* Its capsule, in its colour, above its name (DESIGN.md, "System icon"). */}
              <SystemIcon
                systemId={system.id}
                size="lg"
                className="tile-capsule mb-3 h-10 w-12.5"
              />
              <h3 className="font-display text-lg font-semibold text-ink-900 underline-offset-4 group-hover:underline md:text-xl">
                {system.name}
              </h3>
              <p className="mt-1 line-clamp-2 text-sm text-ink-700">{system.summary}</p>
              <p className="mt-auto flex items-center justify-between pt-4">
                <span className="text-xs font-semibold text-(--system) tabular-nums">
                  {countPhrase(count, "продукт", "продукта")}
                </span>
                <span aria-hidden className="text-(--system)">
                  →
                </span>
              </p>
            </Link>
          </li>
        ))}
        <li className="on-espresso">
          <Link
            href={href(locale, routes.machines)}
            className={`${TILE_SHAPE} bg-espresso-900 text-paper`}
          >
            <h3 className="font-display text-lg font-semibold underline-offset-4 group-hover:underline md:text-xl">
              Не знаете системата?
            </h3>
            <p className="mt-1 text-sm text-espresso-200">Намерете машината си по марка и модел.</p>
            <p className="mt-auto pt-4 text-xs font-semibold text-gold-300">
              Намери по машина <span aria-hidden>→</span>
            </p>
          </Link>
        </li>
      </ul>
    </section>
  );
}

/* --- 4. Wizard entry ----------------------------------------------------- */

export function WizardEntry({ locale }: { readonly locale: Locale }) {
  return (
    <section className="bg-paper-sunken py-12 md:py-16">
      <div className="shell">
        <div className="relative overflow-hidden rounded-md bg-gold-100 p-6 md:grid md:grid-cols-[1fr_auto_auto] md:items-center md:gap-10 md:p-8">
          <div>
            <h2 className="font-display text-2xl font-semibold text-ink-900 md:text-3xl">
              Кое кафе е за вас?
            </h2>
            <p className="mt-2 max-w-[60ch] text-base text-ink-700">
              Няколко въпроса и три предложения — с причините за всяко.
            </p>
            <ButtonLink href={href(locale, routes.wizard)} className="mt-5 w-full md:w-auto">
              Започнете
            </ButtonLink>
          </div>
          {/* The cup the questions end in: crema from above (DESIGN.md, "Imagery"). */}
          <Crema className="reveal-on-scroll hidden h-36 w-auto md:block" />
          <ol className="hidden gap-3 md:grid">
            {STEP_SEQUENCE.map((step, index) => (
              <li key={step} className="flex items-center gap-3 text-base text-ink-900">
                <span
                  aria-hidden
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-xs bg-gold-500 text-xs font-semibold text-ink-900 tabular-nums"
                >
                  {index + 1}
                </span>
                {STEP_LABELS[step]}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/* --- 5. Promotions ------------------------------------------------------- */

export function HomePromotions({
  products,
  locale,
}: {
  readonly products: readonly ProductCardView[];
  readonly locale: Locale;
}) {
  /*
   * A reduction is real or absent. The query already asks for an old price
   * above the current one; the card view carries `discountPercent` only when
   * exact minor units agree, and this band trusts nothing less.
   */
  const reduced = products.filter(
    (product) => product.oldPrice !== null && product.discountPercent !== null,
  );
  if (reduced.length === 0) return null;

  return (
    <section className="border-y border-line bg-clay-100 py-12 md:py-16">
      <div className="shell">
        <SectionHeading
          title="Намалени в момента"
          action={
            <ButtonLink href={href(locale, routes.promotions)} variant="secondary" size="sm">
              Всички промоции
            </ButtonLink>
          }
        />
        {/* Four cards; three on a tablet, where the grid has three columns
            and a fourth would sit alone on a second row. */}
        <div className="md:max-lg:[&>ul>li:nth-child(n+4)]:hidden">
          <ProductGrid locale={locale} products={reduced} priorityCount={0} />
        </div>
      </div>
    </section>
  );
}

/* --- 6. New arrivals ----------------------------------------------------- */

export function NewArrivals({
  products,
  locale,
}: {
  readonly products: readonly ProductCardView[];
  readonly locale: Locale;
}) {
  if (products.length === 0) return null;

  return (
    <section className="shell py-12 md:py-16">
      <SectionHeading
        title="Ново в асортимента"
        action={
          <ButtonLink href={href(locale, routes.categories)} variant="secondary" size="sm">
            Всичко
          </ButtonLink>
        }
      />
      {/* Eight cards; four on a phone, six on a tablet, where the grid has
          three columns and eight would leave a row of two. `ProductGrid` owns
          its list, so the rest are hidden from here rather than by a prop it
          lacks. */}
      <div className="max-md:[&>ul>li:nth-child(n+5)]:hidden md:max-lg:[&>ul>li:nth-child(n+7)]:hidden">
        {/* None is a priority image: the hero holds the page's LCP element. */}
        <ProductGrid locale={locale} products={products} priorityCount={0} />
      </div>
    </section>
  );
}

/* --- 7. How ordering works ----------------------------------------------- */

const ORDER_STEPS = [
  { text: "Сложете в количката кафето, което искате.", Icon: CartIcon },
  { text: "Оставете име, телефон и къде да доставим.", Icon: FormIcon },
  { text: "Звъним ви, за да потвърдим и да уговорим доставката.", Icon: PhoneIcon },
] as const;

/** A filled-in form: the order form's one step. 24 px line icon, `currentColor`. */
function FormIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  );
}

/*
 * Three drawings joined by the curl from the mark, which draws itself as the
 * section scrolls past (`.draw-on-scroll`; DESIGN.md, "Motion"). It replaces
 * three bordered boxes, and shows how short the way is. The numbers stay: the
 * order is information.
 */
export function HowOrderingWorks() {
  return (
    <section className="border-t border-line">
      <div className="shell py-12 md:py-16">
        <SectionHeading title="Поръчката е на една стъпка" />
        <div className="relative">
          {/* From the first square's centre to the last's (the columns'
              centres, a sixth in from each side), level with the squares'
              middles, so the wave stays in the squares' band and clear of
              the sentences. The width is set, not left to `auto`: an SVG
              takes its width from its viewBox and would ignore `right`. */}
          <svg
            aria-hidden
            viewBox="0 0 1000 60"
            preserveAspectRatio="none"
            className="absolute top-0 left-[16.667%] hidden h-14 w-[66.667%] overflow-visible md:block"
          >
            <path
              d="M0 30C80 -10 170 70 250 30S420 -10 500 30S670 70 750 30S920 -10 1000 30"
              pathLength={1}
              fill="none"
              strokeWidth="2.5"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              className="draw-on-scroll stroke-gold-600"
            />
          </svg>
          <ol className="relative grid gap-8 md:grid-cols-3 md:gap-6">
            {ORDER_STEPS.map(({ text, Icon }, index) => (
              <li
                key={text}
                className="flex items-start gap-4 md:flex-col md:items-center md:text-center"
              >
                <span
                  aria-hidden
                  className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-paper-raised text-pine-700"
                >
                  <Icon className="h-6 w-6" />
                  <span className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-xs bg-gold-500 text-xs font-semibold text-ink-900 tabular-nums">
                    {index + 1}
                  </span>
                </span>
                <p className="max-w-[28ch] pt-3 text-base text-ink-900 md:pt-0">{text}</p>
              </li>
            ))}
          </ol>
        </div>
        <p className="mt-5 text-sm text-ink-500">
          Без регистрация и без плащане на сайта. Предпочитате да говорим?{" "}
          <a
            href={`tel:${siteConfig.contact.phoneHref}`}
            className="whitespace-nowrap text-pine-700 underline underline-offset-2 hover:no-underline"
          >
            {siteConfig.contact.phone}
          </a>
        </p>
      </div>
    </section>
  );
}

/* --- 8. Brands ----------------------------------------------------------- */

export function HomeBrands({
  brands,
  locale,
}: {
  readonly brands: readonly BrandView[];
  readonly locale: Locale;
}) {
  const stocked = brands.filter((brand) => brand.productCount > 0);
  if (stocked.length === 0) return null;

  return (
    <section className="border-t border-line">
      <div className="shell py-12 md:py-16">
        <SectionHeading
          title="Марките, които предлагаме"
          action={
            <ButtonLink href={href(locale, routes.brands)} variant="secondary" size="sm">
              Всички марки кафе
            </ButtonLink>
          }
        />
        {/* An open wall of logos (DESIGN.md, "Brand logo"): no box round each,
            only the hairlines between them — each cell's 1 px ring, the two
            rings of neighbours meeting in the 1 px gap, the outer ones clipped,
            so a short last row ends open rather than on a grey block. The
            logo's alt is the name; a brand with no
            logo shows its name in the same cell, so the rows stay even. On a
            phone twenty cells would stack ten deep, so they become one
            scrolling row; the padding keeps the focus ring inside its clip. */}
        <ul className="-mx-4 flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 py-1 md:mx-0 md:grid md:grid-cols-4 md:gap-px md:overflow-hidden md:p-0 lg:grid-cols-6">
          {stocked.map((brand) => (
            <li
              key={brand.slug}
              className="shrink-0 snap-start scroll-ml-4 bg-paper md:ring-1 md:ring-line"
            >
              <Link
                href={brandHref(locale, brand)}
                // `relative` keeps the visually hidden count inside the cell;
                // unanchored, it would sit outside the scroller's clip and
                // widen the whole page on a phone.
                className="relative flex h-full min-h-20 items-center justify-center p-3 transition-colors hover:bg-paper-raised"
              >
                <BrandLogo brand={brand} size="tile" />
                <span className="sr-only">
                  {" "}
                  {brand.productCount} {brand.productCount === 1 ? "продукт" : "продукта"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* --- 9. Journal ---------------------------------------------------------- */

export function JournalTeaser({
  articles,
  locale,
}: {
  readonly articles: readonly ArticleSummary[];
  readonly locale: Locale;
}) {
  const latest = articles.slice(0, 3);
  if (latest.length === 0) return null;

  return (
    <section className="bg-paper-sunken py-12 md:py-16">
      <div className="shell">
        <SectionHeading
          title="От блога"
          description="Отговори на въпросите, които изникват преди поръчка."
          action={
            <ButtonLink href={href(locale, JOURNAL_PATH)} variant="secondary" size="sm">
              Всички статии
            </ButtonLink>
          }
        />
        <ul className="grid gap-4 md:grid-cols-3">
          {latest.map((article) => (
            <li key={article.slug}>
              {/* A tone step, not a box: the white card on the sunken band. */}
              <article className="group relative flex h-full flex-col rounded-md bg-paper-raised p-5">
                <ArticleDrawing slug={article.slug} className="mb-4" />
                <p className="text-xs text-ink-500">
                  <time dateTime={article.publishedAt}>
                    {formatArticleDate(article.publishedAt, locale)}
                  </time>
                </p>
                <h3 className="mt-1.5 font-display text-lg font-semibold text-ink-900 md:text-xl">
                  <Link
                    href={href(locale, article.href)}
                    className="underline-offset-4 group-hover:underline after:absolute after:inset-0"
                  >
                    {article.title}
                  </Link>
                </h3>
                <p className="mt-2 line-clamp-3 text-sm text-ink-700">{article.description}</p>
              </article>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* --- 10. Vending Zone ---------------------------------------------------- */

export function VendingBand({ locale }: { readonly locale: Locale }) {
  return (
    /*
     * The page's last section, full bleed, so the frame below needs no space
     * above it: `data-ends-on-band` closes the gap (`globals.css`), and the
     * newsletter band or the footer meets it edge to edge.
     */
    /*
     * On espresso, the second dark ground, so the page does not close on the
     * green it opened with (DESIGN.md, "Second ground — espresso").
     */
    <section data-ends-on-band="" className="on-espresso bg-espresso-900 text-paper">
      <div className="shell flex flex-col gap-5 py-12 md:flex-row md:items-center md:justify-between md:gap-10 md:py-16">
        <div>
          <h2 className="font-display text-2xl font-semibold md:text-3xl">Вендинг зона</h2>
          <p className="mt-2 max-w-[60ch] text-base text-espresso-200">
            Зареждате вендинг автомат или кафемашините в офиса? Събрали сме кафето от каталога,
            което е за такава работа.
          </p>
        </div>
        <ButtonLink
          href={href(locale, BUSINESS_SECTIONS.vending.path)}
          variant="on-espresso"
          size="lg"
          className="w-full shrink-0 md:w-auto"
        >
          Кафе за вендинг машини
        </ButtonLink>
      </div>
    </section>
  );
}
