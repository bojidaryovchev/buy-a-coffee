import Link from "next/link";
import type { ReactNode } from "react";
import { BrandLogo } from "@/components/catalog/brand-logo";
import { ProductGrid } from "@/components/catalog/product-card";
import { ButtonLink, SectionHeading } from "@/components/ui/primitives";
import {
  deliveryCostSentences,
  deliveryFee,
  deliveryTimeSentence,
  freeDeliveryThreshold,
  paymentSentence,
} from "@/components/commerce/terms";
import { siteConfig, type CommerceConfig } from "@/config/site";
import type { BrandView, ProductCardView } from "@/lib/catalog/types";
import { BUSINESS_SECTIONS } from "@/lib/catalog/business-sections";
import { JOURNAL_PATH, formatArticleDate, type ArticleSummary } from "@/lib/journal";
import { STEP_LABELS, STEP_SEQUENCE } from "@/lib/recommend/answers";
import { BREWING_SYSTEMS, type BrewingSystemId } from "@/lib/recommend/systems";
import { countPhrase } from "./plural";

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
  const fee = deliveryFee(commerce);
  if (freeDeliveryThreshold(commerce) || fee) {
    const sentences = deliveryCostSentences(commerce);
    facts.push({
      id: "delivery",
      icon: DELIVERY_ICON,
      title: "Доставка",
      line: (fee ? sentences : sentences.slice(0, 1)).join(" "),
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

const TILE_SHAPE = "group flex h-full flex-col rounded-md border border-t-4 p-4 transition-colors";

export function ShopBySystem({ counts }: { readonly counts: SystemCounts }) {
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
              href={`/categories/${system.categorySlugs[0]}`}
              data-system={system.id}
              className={`${TILE_SHAPE} border-line border-t-(--system) bg-(--system-wash) hover:border-(--system)`}
            >
              <h3 className="font-display text-lg font-semibold text-ink-900 md:text-xl">
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
        <li className="on-pine">
          <Link
            href="/wizard/machines"
            className={`${TILE_SHAPE} border-pine-900 bg-pine-900 text-paper hover:border-pine-700 hover:bg-pine-700`}
          >
            <h3 className="font-display text-lg font-semibold md:text-xl">Не знаете системата?</h3>
            <p className="mt-1 text-sm text-pine-200">Намерете машината си по марка и модел.</p>
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

export function WizardEntry() {
  return (
    <section className="bg-paper-sunken py-12 md:py-16">
      <div className="shell">
        <div className="rounded-md bg-gold-100 p-6 md:grid md:grid-cols-2 md:items-center md:gap-10 md:p-8">
          <div>
            <h2 className="font-display text-2xl font-semibold text-ink-900 md:text-3xl">
              Кое кафе е за вас?
            </h2>
            <p className="mt-2 max-w-[60ch] text-base text-ink-700">
              Няколко въпроса и три предложения — с причините за всяко.
            </p>
            <ButtonLink href="/wizard" className="mt-5 w-full md:w-auto">
              Започнете
            </ButtonLink>
          </div>
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

export function HomePromotions({ products }: { readonly products: readonly ProductCardView[] }) {
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
            <ButtonLink href="/promotions" variant="secondary" size="sm">
              Всички промоции
            </ButtonLink>
          }
        />
        <ProductGrid products={reduced} priorityCount={0} />
      </div>
    </section>
  );
}

/* --- 6. New arrivals ----------------------------------------------------- */

export function NewArrivals({ products }: { readonly products: readonly ProductCardView[] }) {
  if (products.length === 0) return null;

  return (
    <section className="shell py-12 md:py-16">
      <SectionHeading
        title="Ново в асортимента"
        action={
          <ButtonLink href="/categories" variant="secondary" size="sm">
            Всичко
          </ButtonLink>
        }
      />
      {/* Eight cards; four on a phone. `ProductGrid` owns its list, so the
          second four are hidden from here rather than by a prop it lacks. */}
      <div className="max-md:[&>ul>li:nth-child(n+5)]:hidden">
        {/* None is a priority image: the hero holds the page's LCP element. */}
        <ProductGrid products={products} priorityCount={0} />
      </div>
    </section>
  );
}

/* --- 7. How ordering works ----------------------------------------------- */

const ORDER_STEPS = [
  "Намерете кафето, което искате.",
  "Оставете телефонния си номер.",
  "Звъним ви, за да потвърдим и да уговорим доставката.",
] as const;

export function HowOrderingWorks() {
  return (
    <section className="border-t border-line">
      <div className="shell py-12 md:py-16">
        <SectionHeading title="Поръчката е на една стъпка" />
        <ol className="grid gap-4 md:grid-cols-3">
          {ORDER_STEPS.map((step, index) => (
            <li
              key={step}
              className="flex items-start gap-4 rounded-md border border-line bg-paper-raised p-5"
            >
              <span
                aria-hidden
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xs bg-gold-500 text-sm font-semibold text-ink-900 tabular-nums"
              >
                {index + 1}
              </span>
              <p className="text-base text-ink-900">{step}</p>
            </li>
          ))}
        </ol>
        <p className="mt-5 text-sm text-ink-500">
          Без регистрация и без количка. Предпочитате да говорим?{" "}
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

export function HomeBrands({ brands }: { readonly brands: readonly BrandView[] }) {
  const stocked = brands.filter((brand) => brand.productCount > 0);
  if (stocked.length === 0) return null;

  return (
    <section className="border-t border-line">
      <div className="shell py-12 md:py-16">
        <SectionHeading
          title="Марките, които предлагаме"
          action={
            <ButtonLink href="/brands" variant="secondary" size="sm">
              Всички марки
            </ButtonLink>
          }
        />
        {/* Logo tiles (DESIGN.md, "Brand logo"): the logo's alt is the name;
            a brand with no logo shows its name in the same box, so the row
            stays even. On a phone twenty tiles would stack ten deep, so
            they become one scrolling row; the padding keeps the focus ring
            inside the scroller's clip. */}
        <ul className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 py-1 md:mx-0 md:grid md:grid-cols-4 md:gap-3 md:overflow-visible md:p-0 lg:grid-cols-6">
          {stocked.map((brand) => (
            <li key={brand.slug} className="shrink-0 snap-start scroll-ml-4">
              <Link
                href={`/brands/${brand.slug}`}
                // `relative` keeps the visually hidden count inside the tile;
                // unanchored, it would sit outside the scroller's clip and
                // widen the whole page on a phone.
                className="relative flex h-full items-center justify-center rounded-md border border-line bg-paper-raised p-3 transition-colors hover:border-pine-500"
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

export function JournalTeaser({ articles }: { readonly articles: readonly ArticleSummary[] }) {
  const latest = articles.slice(0, 3);
  if (latest.length === 0) return null;

  return (
    <section className="bg-paper-sunken py-12 md:py-16">
      <div className="shell">
        <SectionHeading
          title="От дневника"
          description="Кратки отговори на въпросите, които изникват преди поръчка."
          action={
            <ButtonLink href={JOURNAL_PATH} variant="secondary" size="sm">
              Всички статии
            </ButtonLink>
          }
        />
        <ul className="grid gap-4 md:grid-cols-3">
          {latest.map((article) => (
            <li key={article.slug}>
              <article className="relative flex h-full flex-col rounded-md border border-line bg-paper-raised p-5 transition-colors hover:border-line-strong">
                <p className="text-xs text-ink-500">
                  <time dateTime={article.publishedAt}>
                    {formatArticleDate(article.publishedAt)}
                  </time>
                </p>
                <h3 className="mt-1.5 font-display text-lg font-semibold text-ink-900 md:text-xl">
                  <Link
                    href={article.href}
                    className="underline-offset-4 after:absolute after:inset-0 hover:underline"
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

export function VendingBand() {
  return (
    <section className="on-pine bg-pine-900 text-paper">
      <div className="shell flex flex-col gap-5 py-12 md:flex-row md:items-center md:justify-between md:gap-10 md:py-16">
        <div>
          <h2 className="font-display text-2xl font-semibold md:text-3xl">Вендинг зона</h2>
          <p className="mt-2 max-w-[60ch] text-base text-pine-200">
            Зареждате вендинг автомат или кафемашините в офиса? Събрали сме кафето от каталога,
            което е за такава работа.
          </p>
        </div>
        <ButtonLink
          href={BUSINESS_SECTIONS.vending.path}
          variant="on-pine"
          size="lg"
          className="w-full shrink-0 md:w-auto"
        >
          Към Вендинг зоната
        </ButtonLink>
      </div>
    </section>
  );
}
