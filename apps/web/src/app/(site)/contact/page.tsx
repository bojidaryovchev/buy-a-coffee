import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/ui/primitives";
import { ContactForm } from "@/components/forms/contact-form";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  title: "Контакти",
  description: `Свържете се с ${siteConfig.name}.`,
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <div className="shell pb-16">
      <Breadcrumbs
        items={[
          { name: "Начало", href: "/" },
          { name: "Контакти", href: "/contact" },
        ]}
      />

      <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
        <div>
          <h1 className="font-display text-3xl font-semibold text-ink-900 md:text-4xl">
            Свържете се с нас
          </h1>
          <p className="mt-3 max-w-prose text-base text-ink-500">
            Най-бързият начин да поръчате е бутонът на всяка продуктова страница — оставяте номер и
            ние ви звъним. За всичко останало изберете начина, който ви е удобен.
          </p>

          <dl className="mt-8 space-y-6">
            <div>
              <dt className="text-sm font-medium tracking-wide text-ink-500 uppercase">Телефон</dt>
              <dd className="mt-1">
                <a
                  href={`tel:${siteConfig.contact.phoneHref}`}
                  className="font-display text-2xl font-semibold text-pine-700 underline-offset-4 hover:underline"
                >
                  {siteConfig.contact.phone}
                </a>
                <p className="mt-0.5 text-sm text-ink-500">{siteConfig.contact.hours}</p>
              </dd>
            </div>

            <div>
              <dt className="text-sm font-medium tracking-wide text-ink-500 uppercase">Имейл</dt>
              <dd className="mt-1">
                <a
                  href={`mailto:${siteConfig.contact.email}`}
                  className="text-lg text-pine-700 underline-offset-4 hover:underline"
                >
                  {siteConfig.contact.email}
                </a>
              </dd>
            </div>

            {siteConfig.legal.isComplete && (
              <div>
                <dt className="text-sm font-medium tracking-wide text-ink-500 uppercase">Фирма</dt>
                <dd className="mt-1 text-base text-ink-700">
                  {siteConfig.legal.companyName}
                  <br />
                  {siteConfig.legal.address}
                  <br />
                  ЕИК {siteConfig.legal.companyId}
                </dd>
              </div>
            )}
          </dl>
        </div>

        <div>
          <h2 className="font-display text-xl font-semibold">Изпратете съобщение</h2>
          <p className="mt-1 text-sm text-ink-500">
            Обикновено отговаряме в рамките на един работен ден.
          </p>
          <div className="mt-5">
            <ContactForm />
          </div>
        </div>
      </div>
    </div>
  );
}
