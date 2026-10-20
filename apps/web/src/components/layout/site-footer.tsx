import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { siteConfig, usingPlaceholderBrand } from "@/config/site";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import type { SiteNavigation } from "@/components/layout/navigation";
import { Wordmark } from "@/components/layout/wordmark";
import { paymentMethods } from "@/components/commerce/terms";
import type { Dictionary } from "@/i18n/dictionaries/bg";
import { fill } from "@/i18n/fill";
import { openingHoursLabel } from "@/i18n/hours";
import { getLandingAvailability } from "@/lib/catalog/landing-queries";
import { LANDING_PATHS, NO_LANDINGS, type LandingAvailability } from "@/lib/catalog/landings";
import { TCHIBO_PAIR } from "@/lib/catalog/related-landings";
import { href, routes } from "@/lib/routes";

/*
 * Below `lg` a footer link is a 44 px row, a target a finger can hit; from
 * `lg` a 28 px one, so a column of twelve stays a short block.
 */
const COLUMN_HEAD = "font-sans text-2xs font-semibold tracking-[0.06em] text-ink-500 uppercase";
const LINK =
  "flex min-h-11 items-center text-sm text-ink-700 underline-offset-4 hover:text-ink-900 hover:underline lg:min-h-7";

function FooterLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <li className="break-inside-avoid">
      <Link href={href} className={LINK}>
        {children}
      </Link>
    </li>
  );
}

/**
 * One group of links: a disclosure on a phone, a column from `md`.
 *
 * A `<details>`, so it opens and closes without JavaScript, closed by default
 * so the phone's footer is three rows rather than a screen of links. From `md`
 * the content is shown whatever the open state
 * (`md:details-content:[content-visibility:visible]`) and the summary — a
 * button to a screen reader — is taken away for a plain heading, so a desktop
 * visitor is never told that a visible column is "collapsed".
 *
 * Both swaps are behind one check, `supports-[selector(::details-content)]`:
 * whether the browser can style the part of a `<details>` that opens. Where it
 * cannot, the summary stays on every width, so a section is still a disclosure
 * that opens — never a heading over links nobody can reach. (Written out in
 * full each time: Tailwind only generates a class it can read in the source.)
 */
function FooterSection({
  title,
  className,
  listClassName = "",
  children,
}: {
  title: string;
  className?: string;
  listClassName?: string;
  children: ReactNode;
}) {
  return (
    <nav aria-label={title} className={className}>
      <details className="group border-b border-line md:border-b-0 md:details-content:block md:details-content:[content-visibility:visible]">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 md:supports-[selector(::details-content)]:hidden [&::-webkit-details-marker]:hidden">
          <h2 className={COLUMN_HEAD}>{title}</h2>
          <svg
            aria-hidden
            viewBox="0 0 16 16"
            className="h-4 w-4 shrink-0 text-ink-500 transition-transform group-open:rotate-180"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </summary>
        <h2 className={`hidden ${COLUMN_HEAD} md:supports-[selector(::details-content)]:block`}>
          {title}
        </h2>
        <ul className={`pb-3 md:mt-3 md:pb-0 ${listClassName}`}>{children}</ul>
      </details>
    </nav>
  );
}

/**
 * Site footer.
 *
 * The same shelves as the header, in the same order — systems first — so the
 * bottom of a long page offers the way on that the top did. Then the help a
 * first-time customer looks for down here: how to find the right capsule, what
 * delivery costs, how to reach a person. Every link in the page's locale, every
 * word from its dictionary.
 *
 * After the shelves come the two listings that cut across all of them — decaf
 * and cheapest per cup — each only while it lists something, like the shelves
 * themselves. Which of them exist is the one thing the footer reads for
 * itself; `SiteFooter` does the read and `SiteFooterView` is the markup, so
 * the markup renders in a test without a database.
 */
export async function SiteFooter(props: { navigation: SiteNavigation; dict: Dictionary }) {
  return <SiteFooterView {...props} landings={await getLandingAvailability()} />;
}

export function SiteFooterView({
  navigation,
  dict,
  landings = NO_LANDINGS,
}: {
  navigation: SiteNavigation;
  dict: Dictionary;
  /** Which landing listings exist right now. None, unless the caller knows. */
  landings?: LandingAvailability;
}) {
  const year = new Date().getFullYear();
  const { footer } = dict;
  // Empty until the business has said how an order is paid for; the line below
  // is then left out rather than filled with a guess.
  const payment = paymentMethods();
  const { capsules, pods, beans, links, locale } = navigation;
  const hours = openingHoursLabel(dict.hours.days);
  const { legal } = siteConfig;
  const companyLine: ReadonlyArray<{ text: string; wrap?: boolean }> = [
    { text: legal.companyName },
    { text: `${footer.companyId} ${legal.companyId}` },
    ...(legal.vatId ? [{ text: `${footer.vatId} ${legal.vatId}` }] : []),
    { text: legal.address, wrap: true },
  ];

  return (
    <footer className="border-t border-line bg-paper-sunken">
      <div className="shell py-10 lg:py-12">
        {/*
          Two tiers from `md`: who we are and how to reach us, then the links.
          Five columns side by side left each of them too narrow for its
          longest item at every width below a wide desktop.
        */}
        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:gap-x-12">
          <div>
            <Wordmark />
            <p className="mt-3 max-w-md text-sm text-ink-500">{dict.site.description}</p>
            <LanguageSwitcher locale={locale} label={dict.language.label} className="mt-4" />
          </div>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 text-sm">
            <dt className="text-ink-500">{footer.phone}</dt>
            <dd>
              <a
                href={`tel:${siteConfig.contact.phoneHref}`}
                className="inline-flex min-h-11 items-center font-medium whitespace-nowrap text-pine-700 tabular-nums underline-offset-4 hover:underline lg:min-h-8"
              >
                {siteConfig.contact.phone}
              </a>
            </dd>
            <dt className="text-ink-500">{footer.email}</dt>
            <dd className="min-w-0">
              <a
                href={`mailto:${siteConfig.contact.email}`}
                className="inline-flex min-h-11 items-center font-medium whitespace-nowrap text-pine-700 underline-offset-4 hover:underline lg:min-h-8"
              >
                {siteConfig.contact.email}
              </a>
            </dd>
            {hours && (
              <>
                <dt className="py-3 text-ink-500 lg:py-1.5">{footer.hours}</dt>
                <dd className="py-3 whitespace-nowrap text-ink-700 lg:py-1.5">{hours}</dd>
              </>
            )}
          </dl>
        </div>

        <div className="mt-8 border-t border-line md:grid md:grid-cols-3 md:gap-x-8 md:gap-y-8 md:pt-8 lg:grid-cols-4">
          <FooterSection
            title={footer.shop}
            className="md:col-span-3 lg:col-span-2"
            listClassName="md:columns-3 md:gap-x-8 lg:columns-2"
          >
            {capsules?.systems.map((system) => (
              <FooterLink key={system.id} href={system.href}>
                {/* The rail calls the group "Капсули" and names the systems
                    under it. Down here each link stands alone, so it is the
                    listing's own name: „Капсули за Nespresso“, never „Капсули
                    Nespresso“, which would pass a compatible capsule off as
                    the system owner's. */}
                {system.listingName}
              </FooterLink>
            ))}
            {pods && <FooterLink href={pods.href}>{pods.listingName}</FooterLink>}
            {beans && <FooterLink href={beans.href}>{beans.listingName}</FooterLink>}
            {landings.counts.decaf > 0 && (
              <FooterLink href={href(locale, LANDING_PATHS.decaf)}>{footer.decaf}</FooterLink>
            )}
            {landings.counts.cheapest > 0 && (
              <FooterLink href={href(locale, LANDING_PATHS.cheapest)}>
                {footer.cheapestPerCup}
              </FooterLink>
            )}
            {landings.counts.lavazzaCapsules > 0 && (
              <FooterLink href={href(locale, LANDING_PATHS.lavazzaCapsules)}>
                {footer.lavazzaCapsules}
              </FooterLink>
            )}
            {landings.counts.lavazzaBeans > 0 && (
              <FooterLink href={href(locale, LANDING_PATHS.lavazzaBeans)}>
                {footer.lavazzaBeans}
              </FooterLink>
            )}
            {/* A machine page, there whatever the catalog holds. */}
            <FooterLink href={href(locale, routes.machineBrand(TCHIBO_PAIR.machineBrand))}>
              {footer.tchibo}
            </FooterLink>
            {navigation.otherCategories.map((category) => (
              <FooterLink key={category.href} href={category.href}>
                {category.label}
              </FooterLink>
            ))}
            <FooterLink href={navigation.vending.href}>{navigation.vending.label}</FooterLink>
            {/* Only while it lists something, as the sitemap lists it. */}
            {navigation.hasConsumables && (
              <FooterLink href={navigation.consumables.href}>
                {navigation.consumables.label}
              </FooterLink>
            )}
            <FooterLink href={links.brands.href}>{links.brands.label}</FooterLink>
            {navigation.hasPromotions && (
              <FooterLink href={links.promotions.href}>{links.promotions.label}</FooterLink>
            )}
          </FooterSection>

          <FooterSection title={footer.help}>
            <FooterLink href={links.findByMachine.href}>{links.findByMachine.label}</FooterLink>
            <FooterLink href={links.wizard.href}>{links.wizard.label}</FooterLink>
            <FooterLink href={links.delivery.href}>{links.delivery.label}</FooterLink>
            <FooterLink href={links.contact.href}>{links.contact.label}</FooterLink>
            {navigation.hasJournal && (
              <FooterLink href={links.journal.href}>{links.journal.label}</FooterLink>
            )}
          </FooterSection>

          <FooterSection title={footer.legal}>
            <FooterLink href={links.terms}>{footer.terms}</FooterLink>
            <FooterLink href={links.privacy}>{footer.privacy}</FooterLink>
            <FooterLink href={links.cookies}>{footer.cookies}</FooterLink>
          </FooterSection>
        </div>
      </div>

      <div className="border-t border-line">
        <div className="shell flex flex-col gap-x-8 gap-y-2 py-5 text-xs text-ink-500 md:flex-row md:flex-wrap md:items-baseline md:justify-between">
          <p>
            {fill(footer.copyright, {
              year,
              owner: legal.isComplete ? legal.companyName : siteConfig.name,
            })}
          </p>
          {payment.length > 0 && (
            <p>
              {fill(footer.payment, {
                methods: payment.map((method) => footer.paymentMethods[method.id]).join(", "),
              })}
            </p>
          )}
          {legal.isComplete ? (
            /*
             * One line where it fits, its own line under the two above where
             * it does not. Every part but the address is unbreakable, so a
             * narrow screen breaks the line between parts — never inside a
             * company number — and only the address may run on.
             */
            <p className="md:basis-full">
              {companyLine.map((part, index) => (
                <Fragment key={index}>
                  {index > 0 && " · "}
                  <span className={part.wrap ? undefined : "whitespace-nowrap"}>{part.text}</span>
                </Fragment>
              ))}
            </p>
          ) : (
            /*
             * Company registration details are shown only when they are real.
             * Inventing a company number to fill the gap would be a legal
             * problem, not a cosmetic one, so the gap is stated instead — as a
             * caution, which is what it is. Clay means a reduced price.
             */
            <p className="self-start rounded-xs bg-caution-100 px-2 py-1 font-medium text-caution md:self-auto">
              {footer.companyPending}
            </p>
          )}
        </div>
      </div>

      {usingPlaceholderBrand() && process.env.NODE_ENV !== "production" && (
        <div className="bg-caution-100 py-2 text-center text-xs text-caution">
          Бележка за разработка: попълнете правните данни в <code>src/config/site.ts</code> преди
          пускане.
        </div>
      )}
    </footer>
  );
}
