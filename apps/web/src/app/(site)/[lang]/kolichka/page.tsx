import type { Metadata } from "next";
import { NewsletterBandOff } from "@/components/layout/newsletter-band";
import { Breadcrumbs } from "@/components/ui/primitives";
import { siteConfig } from "@/config/site";
import { localeFrom, type LangParams } from "@/i18n/params";
import { pageAlternates } from "@/lib/seo/alternates";
import { shareMetadata } from "@/lib/seo/share";
import { href, routes } from "@/lib/routes";
import { CartView } from "./_components/cart-view";
import { NOINDEX } from "@/lib/seo/robots";
import { pageTitle } from "@/lib/seo/title";

/**
 * The cart, at `/bg/kolichka`.
 *
 * What a customer has collected, what it adds up to today, and one form that
 * sends it all as one order request — a phone number, and the shop calls back.
 * There is still no checkout and no payment (`PRODUCT.md`): the cart gathers
 * the order, the call confirms it.
 *
 * The page is a frame around a client component. The cart is in the browser
 * (`lib/cart/store.ts`), so the server has nothing to render into it; the
 * products' names and prices are asked for when the page opens
 * (`/api/cart`), never remembered from an earlier visit.
 *
 * `noindex`, and not in the sitemap (`app/sitemap.ts` lists pages, and this is
 * not one of them): every visitor's cart is a different page, and an empty one
 * is all a crawler would see. Canonical and share tags are still declared,
 * like every page, so a shared link to it presents itself correctly.
 */

const TITLE = "Количка";
const DESCRIPTION = "Продуктите, които сте избрали, и заявка за поръчка с един телефонен номер.";

interface PageProps {
  params: Promise<LangParams>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const locale = await localeFrom(params);
  return {
    title: pageTitle(TITLE),
    description: DESCRIPTION,
    alternates: pageAlternates(locale, routes.cart),
    ...shareMetadata({
      locale,
      title: TITLE,
      description: DESCRIPTION,
      path: href(locale, routes.cart),
    }),
    robots: NOINDEX,
  };
}

export default async function CartPage({ params }: PageProps) {
  const locale = await localeFrom(params);

  return (
    <div className="shell pb-16">
      {/* The order form asks for the newsletter already, as a check box. */}
      <NewsletterBandOff />
      <Breadcrumbs
        items={[
          { name: "Начало", href: href(locale, routes.home) },
          { name: TITLE, href: href(locale, routes.cart) },
        ]}
      />

      <h1 className="font-display text-3xl font-semibold text-ink-900 md:text-4xl">{TITLE}</h1>

      <div className="mt-6 md:mt-8">
        {/*
          The cart is in the browser and cannot be read without a script. Say
          so, and say what works: every product page's quick order is a plain
          form, and the phone number is on every page. The cart's skeleton is
          not drawn then, because it would wait for ever.
        */}
        <noscript>
          <div className="rounded-md border border-line bg-caution-100 p-4 md:p-5">
            <p className="text-sm text-ink-700">
              Количката работи с включен JavaScript. Без него можете да поръчате от страницата на
              всеки продукт — оставяте номер и ви се обаждаме — или да ни се обадите на{" "}
              <a
                href={`tel:${siteConfig.contact.phoneHref}`}
                className="font-medium whitespace-nowrap text-ink-900 underline underline-offset-2 hover:no-underline"
              >
                {siteConfig.contact.phone}
              </a>
              .
            </p>
          </div>
        </noscript>
        <div className="noscript:hidden">
          <CartView locale={locale} />
        </div>
      </div>
    </div>
  );
}
