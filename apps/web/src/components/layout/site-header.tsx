import Link from "next/link";
import { Suspense } from "react";
import { siteConfig } from "@/config/site";
import { SearchField } from "@/components/catalog/search-field";
import { SearchFieldFallback } from "@/components/catalog/search-field-fallback";
import { MachineIcon } from "@/components/layout/icons";
import { MobileNav } from "@/components/layout/mobile-nav";
import {
  BRANDS,
  FIND_BY_MACHINE,
  PROMOTIONS,
  WIZARD,
  type NavSystem,
  type SiteNavigation,
} from "@/components/layout/navigation";
import { RailLink } from "@/components/layout/rail-link";
import { Wordmark } from "@/components/layout/wordmark";

/**
 * Site header.
 *
 * Two rows: a masthead — menu, wordmark, search — and a rail organised by what
 * the customer owns. People know which machine is on their counter, not which
 * product type a capsule is filed under, so the rail runs systems first, then
 * the machine finder, and only then brands.
 *
 * The pine strip that used to sit on top of this is gone: the announcement bar
 * above the header carries the hours and the phone number now, and scrolls
 * away, while this stays.
 *
 * Rendered on the server, from the navigation the layout built out of the one
 * category read it already makes. The client components are the ones that
 * must be: the drawer, the search field, and the rail links, which mark the
 * current section.
 */
export function SiteHeader({
  navigation,
  showPhone = false,
}: {
  navigation: SiteNavigation;
  /**
   * Print the phone number in the masthead on a wide screen too. Set when
   * there is no announcement bar to carry it — a shop that takes its orders by
   * phone does not get a header without the number.
   */
  showPhone?: boolean;
}) {
  const { capsules, pods, beans } = navigation;

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/95 backdrop-blur">
      <div className="shell">
        {/*
          Masthead. The search field is rendered exactly once and wraps onto
          its own row on small screens. Rendering a second, hidden copy would
          duplicate a form control in the accessibility tree and in the DOM.

          The phone's vertical spacing is tighter than the desktop's because
          the sticky header has a ceiling there: two 44 px rows and the space
          around them must stay within 116 px.
        */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2 md:gap-y-3 md:py-4">
          <MobileNav navigation={navigation} />

          <Link
            href="/"
            className="flex shrink-0 items-center gap-2.5"
            aria-label={`${siteConfig.name} — начало`}
          >
            <Wordmark />
          </Link>

          <a
            href={`tel:${siteConfig.contact.phoneHref}`}
            className={`ml-auto inline-flex min-h-11 shrink-0 items-center text-sm font-medium text-pine-700 underline-offset-4 hover:underline ${
              showPhone ? "md:order-last md:ml-0" : "md:hidden"
            }`}
          >
            <span className={showPhone ? "md:hidden" : undefined}>Обадете се</span>
            {showPhone && (
              <span className="hidden tabular-nums md:inline">{siteConfig.contact.phone}</span>
            )}
          </a>

          <div className="order-last w-full min-w-0 md:order-none md:ml-auto md:w-auto md:max-w-md md:flex-1">
            {/*
              SearchField reads the URL to stay in sync, which would opt every
              page out of static rendering. The boundary keeps that cost local
              to the field itself.
            */}
            <Suspense fallback={<SearchFieldFallback />}>
              <SearchField />
            </Suspense>
          </div>
        </div>

        {/*
          The rail. One line: it does not wrap. Below `lg` the gaps close up
          and the vending link — the one item that is not about a home
          machine — steps out first. It stays in the drawer and the footer.
        */}
        <nav aria-label="Основна навигация" className="hidden md:block">
          <ul className="-mb-px flex items-center gap-x-4 lg:gap-x-6">
            {capsules && (
              <li className="group relative">
                <RailLink href={capsules.href} sections={capsules.systems.map((s) => s.href)}>
                  Капсули
                  <svg
                    aria-hidden
                    viewBox="0 0 12 12"
                    className="h-3 w-3 text-ink-300"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M2.5 4.5 6 8l3.5-3.5" />
                  </svg>
                </RailLink>
                <SystemsPanel href={capsules.href} systems={capsules.systems} />
              </li>
            )}
            {pods && (
              <li>
                <RailLink href={pods.href}>{pods.name}</RailLink>
              </li>
            )}
            {beans && (
              <li>
                <RailLink href={beans.href}>{beans.name}</RailLink>
              </li>
            )}
            <li>
              <RailLink href={FIND_BY_MACHINE.href}>
                <MachineIcon />
                {FIND_BY_MACHINE.label}
              </RailLink>
            </li>
            <li className="hidden lg:block">
              <RailLink href={navigation.vending.href}>{navigation.vending.label}</RailLink>
            </li>

            <li className="ml-auto">
              <RailLink href={WIZARD.href} except={[FIND_BY_MACHINE.href]}>
                {WIZARD.label}
              </RailLink>
            </li>
            <li>
              <RailLink href={BRANDS.href}>{BRANDS.label}</RailLink>
            </li>
            {navigation.hasPromotions && (
              <li>
                {/* Clay, because this is where the reduced prices are — the
                    one thing clay is allowed to mean. */}
                <RailLink href={PROMOTIONS.href} tone="clay">
                  {PROMOTIONS.label}
                </RailLink>
              </li>
            )}
          </ul>
        </nav>
      </div>
    </header>
  );
}

/**
 * The panel under "Капсули".
 *
 * Opened by CSS alone, on hover and on `focus-within`, so it works with the
 * keyboard and without JavaScript; the label above it is itself a link, so a
 * tap on a tablet — which has no hover — simply goes to the capsules page.
 *
 * Two halves, because a visitor here is one of two people: the one who knows
 * their system and wants its shelf, and the one who knows only the machine.
 * The second must not be left reading five names that mean nothing to them.
 */
function SystemsPanel({ href, systems }: { href: string; systems: readonly NavSystem[] }) {
  return (
    <div className="invisible absolute top-full left-0 z-50 grid w-[34rem] max-w-[calc(100vw-4rem)] grid-cols-2 gap-2 rounded-md border border-line bg-paper-raised p-2 opacity-0 shadow-float transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
      <div>
        <p className="px-3 pt-2 pb-1 text-2xs font-semibold tracking-[0.06em] text-ink-500 uppercase">
          Капсули по система
        </p>
        <ul>
          {systems.map((system) => (
            <li key={system.id}>
              <Link
                href={system.href}
                data-system={system.id}
                className="flex min-h-11 items-center gap-2.5 rounded-sm px-3 text-sm text-ink-900 hover:bg-paper-sunken"
              >
                <span aria-hidden className="h-2 w-2 shrink-0 bg-(--system)" />
                <span className="min-w-0 flex-1">{system.name}</span>
                <span className="text-2xs text-ink-300 tabular-nums">
                  {system.count}
                  <span className="sr-only"> продукта</span>
                </span>
              </Link>
            </li>
          ))}
          <li>
            <Link
              href={href}
              className="flex min-h-11 items-center rounded-sm px-3 text-sm font-medium text-pine-700 hover:bg-paper-sunken"
            >
              Всички капсули
            </Link>
          </li>
        </ul>
      </div>

      <div className="self-start rounded-sm bg-pine-100 p-4">
        <p className="text-sm font-semibold text-pine-900">Не знаете коя е вашата система?</p>
        <p className="mt-1.5 text-sm text-ink-700">
          Намерете машината си по марка и модел и ще ви кажем какво пасва.
        </p>
        <Link
          href={FIND_BY_MACHINE.href}
          className="mt-3 inline-flex min-h-6 items-center gap-1 text-sm font-medium text-pine-700 underline underline-offset-4"
        >
          {FIND_BY_MACHINE.label} <span aria-hidden>→</span>
        </Link>
      </div>
    </div>
  );
}
