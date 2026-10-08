import Link from "next/link";
import type { ReactNode } from "react";
import { siteConfig, usingPlaceholderBrand } from "@/config/site";
import { NewsletterForm } from "@/components/forms/newsletter-form";
import {
  BRANDS,
  CONTACT,
  DELIVERY,
  FIND_BY_MACHINE,
  JOURNAL,
  PROMOTIONS,
  WIZARD,
  type SiteNavigation,
} from "@/components/layout/navigation";
import { Wordmark } from "@/components/layout/wordmark";
import { paymentMethods } from "@/components/commerce/terms";

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
 * delivery costs, how to reach a person.
 */
export function SiteFooter({ navigation }: { navigation: SiteNavigation }) {
  const year = new Date().getFullYear();
  // Empty until the business has said how an order is paid for; the line below
  // is then left out rather than filled with a guess.
  const payment = paymentMethods();
  const { capsules, pods, beans } = navigation;

  return (
    <footer className="mt-20 border-t border-line bg-paper-sunken">
      <div className="shell grid grid-cols-1 gap-x-8 gap-y-10 py-12 sm:grid-cols-2 lg:grid-cols-12">
        <div className="sm:col-span-2 lg:col-span-3">
          <Wordmark />
          <p className="mt-3 max-w-xs text-sm text-ink-500">{siteConfig.description}</p>
          <dl className="mt-5 space-y-1.5 text-sm">
            <div className="flex gap-2">
              <dt className="text-ink-500">Телефон</dt>
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
              <dt className="text-ink-500">Имейл</dt>
              <dd className="min-w-0">
                <a
                  href={`mailto:${siteConfig.contact.email}`}
                  className="font-medium break-words text-pine-700 underline-offset-4 hover:underline"
                >
                  {siteConfig.contact.email}
                </a>
              </dd>
            </div>
            {siteConfig.contact.hours && (
              <div className="flex gap-2">
                <dt className="text-ink-500">Работно време</dt>
                <dd className="text-ink-700">{siteConfig.contact.hours}</dd>
              </div>
            )}
          </dl>
        </div>

        <nav aria-label="Магазин" className="lg:col-span-2">
          <h2 className={COLUMN_HEAD}>Магазин</h2>
          <ul className="mt-3 space-y-1">
            {capsules?.systems.map((system) => (
              <FooterLink key={system.id} href={system.href}>
                {/* The rail calls the group "Капсули" and names the systems
                    under it; out of that context the word has to come along. */}
                Капсули {system.name}
              </FooterLink>
            ))}
            {pods && <FooterLink href={pods.href}>{pods.name}</FooterLink>}
            {beans && <FooterLink href={beans.href}>{beans.name}</FooterLink>}
            {navigation.otherCategories.map((category) => (
              <FooterLink key={category.href} href={category.href}>
                {category.label}
              </FooterLink>
            ))}
            <FooterLink href={navigation.vending.href}>{navigation.vending.label}</FooterLink>
            <FooterLink href={navigation.consumables.href}>
              {navigation.consumables.label}
            </FooterLink>
            <FooterLink href={BRANDS.href}>{BRANDS.label}</FooterLink>
            {navigation.hasPromotions && (
              <FooterLink href={PROMOTIONS.href}>{PROMOTIONS.label}</FooterLink>
            )}
          </ul>
        </nav>

        <nav aria-label="Помощ" className="lg:col-span-2">
          <h2 className={COLUMN_HEAD}>Помощ</h2>
          <ul className="mt-3 space-y-1">
            <FooterLink href={FIND_BY_MACHINE.href}>{FIND_BY_MACHINE.label}</FooterLink>
            <FooterLink href={WIZARD.href}>{WIZARD.label}</FooterLink>
            <FooterLink href={DELIVERY.href}>{DELIVERY.label}</FooterLink>
            <FooterLink href={CONTACT.href}>{CONTACT.label}</FooterLink>
            {navigation.hasJournal && <FooterLink href={JOURNAL.href}>{JOURNAL.label}</FooterLink>}
          </ul>
        </nav>

        <nav aria-label="Правна информация" className="lg:col-span-2">
          <h2 className={COLUMN_HEAD}>Правна информация</h2>
          <ul className="mt-3 space-y-1">
            <FooterLink href="/terms">Общи условия</FooterLink>
            <FooterLink href="/privacy">Поверителност</FooterLink>
            <FooterLink href="/cookies">Бисквитки</FooterLink>
          </ul>
        </nav>

        {siteConfig.features.newsletter && (
          <div className="sm:col-span-2 lg:col-span-3">
            <h2 className={COLUMN_HEAD}>Бъдете в течение</h2>
            <p className="mt-3 text-sm text-ink-500">
              Кратки съобщения за новите попълнения. Не повече от веднъж месечно.
            </p>
            <div className="mt-3">
              <NewsletterForm source="footer" />
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-line">
        <div className="shell flex flex-col gap-x-8 gap-y-2 py-5 text-xs text-ink-500 md:flex-row md:flex-wrap md:items-center md:justify-between">
          <p>
            © {year} {siteConfig.legal.isComplete ? siteConfig.legal.companyName : siteConfig.name}.
            Всички права запазени.
          </p>
          {payment.length > 0 && <p>Плащане: {payment.map((method) => method.label).join(", ")}</p>}
          {siteConfig.legal.isComplete ? (
            <p>
              {siteConfig.legal.companyName} · ЕИК {siteConfig.legal.companyId}
              {siteConfig.legal.vatId ? ` · ДДС № ${siteConfig.legal.vatId}` : ""} ·{" "}
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
              Фирмените данни още не са попълнени
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
