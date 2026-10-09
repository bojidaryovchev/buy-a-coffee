import Link from "next/link";
import type { ReactNode } from "react";
import { siteConfig, usingPlaceholderBrand } from "@/config/site";
import { NewsletterForm } from "@/components/forms/newsletter-form";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import type { SiteNavigation } from "@/components/layout/navigation";
import { Wordmark } from "@/components/layout/wordmark";
import { paymentMethods } from "@/components/commerce/terms";
import type { Dictionary } from "@/i18n/dictionaries/bg";
import { fill } from "@/i18n/fill";
import { openingHoursLabel } from "@/i18n/hours";
import { getLandingAvailability } from "@/lib/catalog/landing-queries";
import { LANDING_PATHS, NO_LANDINGS, type LandingAvailability } from "@/lib/catalog/landings";
import { href } from "@/lib/routes";

const COLUMN_HEAD = "text-2xs font-semibold tracking-[0.06em] text-ink-500 uppercase";
const LINK = "text-sm text-ink-700 underline-offset-4 hover:text-ink-900 hover:underline";

function FooterLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <li>
      {/* The row is 24 px tall whatever the text does, so two links are never
          closer than a fingertip can tell apart. */}
      <Link href={href} className={`inline-flex min-h-6 items-center ${LINK}`}>
        {children}
      </Link>
    </li>
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

  return (
    <footer className="mt-20 border-t border-line bg-paper-sunken">
      <div className="shell grid grid-cols-1 gap-x-8 gap-y-10 py-12 sm:grid-cols-2 lg:grid-cols-12">
        <div className="sm:col-span-2 lg:col-span-3">
          <Wordmark />
          <p className="mt-3 max-w-xs text-sm text-ink-500">{dict.site.description}</p>
          <dl className="mt-5 space-y-1.5 text-sm">
            <div className="flex gap-2">
              <dt className="text-ink-500">{footer.phone}</dt>
              <dd>
                <a
                  href={`tel:${siteConfig.contact.phoneHref}`}
                  className="font-medium text-pine-700 tabular-nums underline-offset-4 hover:underline"
                >
                  {siteConfig.contact.phone}
                </a>
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-ink-500">{footer.email}</dt>
              <dd className="min-w-0">
                <a
                  href={`mailto:${siteConfig.contact.email}`}
                  className="font-medium break-words text-pine-700 underline-offset-4 hover:underline"
                >
                  {siteConfig.contact.email}
                </a>
              </dd>
            </div>
            {hours && (
              <div className="flex gap-2">
                <dt className="text-ink-500">{footer.hours}</dt>
                <dd className="text-ink-700">{hours}</dd>
              </div>
            )}
          </dl>
          <LanguageSwitcher locale={locale} label={dict.language.label} className="mt-5" />
        </div>

        <nav aria-label={footer.shop} className="lg:col-span-2">
          <h2 className={COLUMN_HEAD}>{footer.shop}</h2>
          <ul className="mt-3 space-y-1">
            {capsules?.systems.map((system) => (
              <FooterLink key={system.id} href={system.href}>
                {/* The rail calls the group "Капсули" and names the systems
                    under it; out of that context the word has to come along. */}
                {fill(footer.systemCapsules, { system: system.name })}
              </FooterLink>
            ))}
            {pods && <FooterLink href={pods.href}>{pods.name}</FooterLink>}
            {beans && <FooterLink href={beans.href}>{beans.name}</FooterLink>}
            {landings.counts.decaf > 0 && (
              <FooterLink href={href(locale, LANDING_PATHS.decaf)}>{footer.decaf}</FooterLink>
            )}
            {landings.counts.cheapest > 0 && (
              <FooterLink href={href(locale, LANDING_PATHS.cheapest)}>
                {footer.cheapestPerCup}
              </FooterLink>
            )}
            {navigation.otherCategories.map((category) => (
              <FooterLink key={category.href} href={category.href}>
                {category.label}
              </FooterLink>
            ))}
            <FooterLink href={navigation.vending.href}>{navigation.vending.label}</FooterLink>
            <FooterLink href={navigation.consumables.href}>
              {navigation.consumables.label}
            </FooterLink>
            <FooterLink href={links.brands.href}>{links.brands.label}</FooterLink>
            {navigation.hasPromotions && (
              <FooterLink href={links.promotions.href}>{links.promotions.label}</FooterLink>
            )}
          </ul>
        </nav>

        <nav aria-label={footer.help} className="lg:col-span-2">
          <h2 className={COLUMN_HEAD}>{footer.help}</h2>
          <ul className="mt-3 space-y-1">
            <FooterLink href={links.findByMachine.href}>{links.findByMachine.label}</FooterLink>
            <FooterLink href={links.wizard.href}>{links.wizard.label}</FooterLink>
            <FooterLink href={links.delivery.href}>{links.delivery.label}</FooterLink>
            <FooterLink href={links.contact.href}>{links.contact.label}</FooterLink>
            {navigation.hasJournal && (
              <FooterLink href={links.journal.href}>{links.journal.label}</FooterLink>
            )}
          </ul>
        </nav>

        <nav aria-label={footer.legal} className="lg:col-span-2">
          <h2 className={COLUMN_HEAD}>{footer.legal}</h2>
          <ul className="mt-3 space-y-1">
            <FooterLink href={links.terms}>{footer.terms}</FooterLink>
            <FooterLink href={links.privacy}>{footer.privacy}</FooterLink>
            <FooterLink href={links.cookies}>{footer.cookies}</FooterLink>
          </ul>
        </nav>

        {siteConfig.features.newsletter && (
          <div className="sm:col-span-2 lg:col-span-3">
            <h2 className={COLUMN_HEAD}>{footer.newsletterHeading}</h2>
            <p className="mt-3 text-sm text-ink-500">{footer.newsletterBody}</p>
            <div className="mt-3">
              <NewsletterForm source="footer" />
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-line">
        <div className="shell flex flex-col gap-x-8 gap-y-2 py-5 text-xs text-ink-500 md:flex-row md:flex-wrap md:items-center md:justify-between">
          <p>
            {fill(footer.copyright, {
              year,
              owner: siteConfig.legal.isComplete ? siteConfig.legal.companyName : siteConfig.name,
            })}
          </p>
          {payment.length > 0 && (
            <p>
              {fill(footer.payment, {
                methods: payment.map((method) => footer.paymentMethods[method.id]).join(", "),
              })}
            </p>
          )}
          {siteConfig.legal.isComplete ? (
            <p>
              {siteConfig.legal.companyName} · {footer.companyId} {siteConfig.legal.companyId}
              {siteConfig.legal.vatId ? ` · ${footer.vatId} ${siteConfig.legal.vatId}` : ""} ·{" "}
              {siteConfig.legal.address}
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
