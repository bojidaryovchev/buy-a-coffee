import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/ui/primitives";
import { JsonLd } from "@/components/seo/json-ld";
import { deliveryFaq, orderingSteps } from "@/components/commerce/delivery-content";
import { absoluteUrl, siteConfig } from "@/config/site";
import {
  deliverySection,
  paymentSection,
  settledParagraphs,
  withdrawalSection,
} from "@/content/legal";
import { breadcrumbJsonLd } from "@/lib/seo/json-ld";
import { SHARE_CARD } from "@/lib/seo/share-card";

/**
 * Delivery and payment.
 *
 * The plain-language companion to the terms: how an order happens, what
 * delivery costs, how it is paid for and how a return works.
 *
 * The delivery, payment and returns paragraphs are not written here. They are
 * the sections `content/legal.ts` generates for the terms page, printed
 * without their open-question markers — so this page cannot promise something
 * the terms do not, and a term the business has not set is simply not
 * mentioned. Only the steps and the FAQ are this page's own.
 */

const TITLE = "Доставка и плащане";
const DESCRIPTION = "Как се поръчва, колко струва доставката, как се плаща и как се връща поръчка.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/delivery" },
  /* Without this the page would share under the home page's title and
     address, which is what the layout's `openGraph` describes. A page-level
     `openGraph` replaces the layout's rather than merging with it, so the
     image has to be restated too — see `lib/seo/share-card.ts`. */
  openGraph: {
    type: "website",
    siteName: siteConfig.name,
    title: TITLE,
    description: DESCRIPTION,
    url: "/delivery",
    locale: siteConfig.locale.replace("-", "_"),
    images: [{ url: absoluteUrl(SHARE_CARD) }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: absoluteUrl(SHARE_CARD) }],
  },
};

const breadcrumbs = [
  { name: "Начало", href: "/" },
  { name: TITLE, href: "/delivery" },
];

function Paragraphs({ paragraphs }: { paragraphs: readonly string[] }) {
  return (
    <>
      {paragraphs.map((paragraph) => (
        <p key={paragraph} className="mt-3 text-base leading-relaxed text-ink-700">
          {paragraph}
        </p>
      ))}
    </>
  );
}

export default function DeliveryPage() {
  const steps = orderingSteps();
  const delivery = deliverySection();
  const payment = paymentSection();
  const withdrawal = withdrawalSection();
  const faq = deliveryFaq();

  return (
    <div className="shell pb-16">
      <JsonLd id="ld-breadcrumbs" data={breadcrumbJsonLd(breadcrumbs)} />
      <Breadcrumbs items={breadcrumbs} />

      <article className="max-w-(--container-measure)">
        <h1 className="font-display text-3xl font-semibold text-ink-900 md:text-4xl">{TITLE}</h1>
        <p className="mt-2 text-base text-ink-500">
          Поръчката тук е телефонен номер и едно обаждане. Ето какво следва след него.
        </p>

        <div className="mt-8 space-y-8">
          <section>
            <h2 className="font-display text-xl font-semibold text-ink-900">Как се поръчва</h2>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-base leading-relaxed text-ink-700">
              {steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-ink-900">{delivery.heading}</h2>
            <Paragraphs paragraphs={settledParagraphs(delivery)} />
          </section>

          {payment && (
            <section>
              <h2 className="font-display text-xl font-semibold text-ink-900">{payment.heading}</h2>
              <Paragraphs paragraphs={settledParagraphs(payment)} />
            </section>
          )}

          <section>
            <h2 className="font-display text-xl font-semibold text-ink-900">Връщане</h2>
            <Paragraphs paragraphs={settledParagraphs(withdrawal)} />
            <p className="mt-3 text-base leading-relaxed text-ink-700">
              Пълният текст, включително случаите, в които правото на отказ не важи, и редът за
              рекламации, е в{" "}
              <Link
                href="/terms"
                className="font-medium text-pine-700 underline underline-offset-2 hover:no-underline"
              >
                Общите условия
              </Link>
              .
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-ink-900">
              Често задавани въпроси
            </h2>
            <div className="mt-1 divide-y divide-line">
              {faq.map((entry) => (
                <div key={entry.question} className="py-4">
                  <h3 className="font-sans text-base font-semibold text-ink-900">
                    {entry.question}
                  </h3>
                  <p className="mt-1.5 text-base leading-relaxed text-ink-700">{entry.answer}</p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-ink-900">Още въпроси?</h2>
            <p className="mt-3 text-base leading-relaxed text-ink-700">
              Обадете ни се на{" "}
              <a
                href={`tel:${siteConfig.contact.phoneHref}`}
                className="font-medium text-pine-700 underline-offset-4 hover:underline"
              >
                {siteConfig.contact.phone}
              </a>{" "}
              или ни пишете през{" "}
              <Link
                href="/contact"
                className="font-medium text-pine-700 underline underline-offset-2 hover:no-underline"
              >
                страницата за контакт
              </Link>
              .
            </p>
          </section>
        </div>
      </article>
    </div>
  );
}
