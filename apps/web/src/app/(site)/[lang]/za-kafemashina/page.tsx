import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs, SectionHeading } from "@/components/ui/primitives";
import { WizardNotice } from "@/components/wizard/wizard-ui";
import { CapsuleDiagram, hasCapsuleDiagram } from "@/components/wizard/capsule-diagrams";
import { MACHINE_BRANDS } from "@/content/machines";
import { BREWING_SYSTEMS } from "@/lib/recommend/systems";
import { JsonLd } from "@/components/seo/json-ld";
import { breadcrumbJsonLd } from "@/lib/seo/json-ld";
import { pluralize } from "@/lib/catalog/format";
import { siteConfig } from "@/config/site";
import { localeFrom, type LangParams } from "@/i18n/params";
import { pageAlternates } from "@/lib/seo/alternates";
import { shareMetadata } from "@/lib/seo/share";
import { href, routes } from "@/lib/routes";

/**
 * "Which capsules fit my machine", by brand.
 *
 * This is the one part of the wizard that deserves to be indexed. "Кои капсули
 * пасват на Krups Piccolo" is a question people type into a search engine, and
 * answering it plainly is both a service and the way someone arrives here at
 * all. The pages are static — they depend on our own compatibility data, not
 * on the catalog — so they cost nothing to serve.
 *
 * A model is listed even when nothing we sell fits it. The person with a
 * Vertuo gets a straight answer instead of an empty search result.
 */

interface PageProps {
  params: Promise<LangParams>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const locale = await localeFrom(params);
  const title = "Кои капсули пасват на моята машина";
  const description =
    "Изберете марката и модела на кафемашината си и вижте коя система капсули приема — и какво от нашия асортимент пасва.";
  return {
    title,
    description,
    alternates: pageAlternates(locale, routes.machines),
    ...shareMetadata({ locale, title, description, path: href(locale, routes.machines) }),
  };
}

export default async function MachinesIndexPage({ params }: PageProps) {
  const locale = await localeFrom(params);
  const breadcrumbs = [
    { name: "Начало", href: href(locale, routes.home) },
    { name: "Кое кафе е за вас", href: href(locale, routes.wizard) },
    { name: "Машини", href: href(locale, routes.machines) },
  ];

  return (
    <div className="shell pb-16">
      <JsonLd id="ld-breadcrumbs" data={breadcrumbJsonLd(breadcrumbs)} />
      <Breadcrumbs items={breadcrumbs} />

      <SectionHeading
        as="h1"
        title="Коя капсула пасва на вашата машина?"
        description="Изберете марката на машината си. Ако не сте сигурни коя система използва, моделът ще ви каже."
      />

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {MACHINE_BRANDS.map((brand) => (
          <li key={brand.slug}>
            <Link
              href={href(locale, routes.machineBrand(brand.slug))}
              className="flex h-full flex-col rounded-md border border-line bg-paper-raised px-4 py-4 transition-colors hover:border-pine-500"
            >
              <span className="font-display text-base font-semibold text-ink-900">
                {brand.name}
              </span>
              <span className="mt-1 text-2xs tracking-wide text-ink-300 uppercase">
                {pluralize(brand.models.length, "модел", "модела")}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <section className="mt-12 max-w-3xl">
        <h2 className="font-display text-xl font-semibold text-ink-900">
          Системите, за които предлагаме кафе
        </h2>
        {/*
         * The drawings share one scale with each other, not with the screen,
         * and saying so is what stops someone measuring their capsule against
         * a phone and concluding it is the wrong one.
         */}
        <p className="mt-2 max-w-prose text-sm text-ink-500">
          Рисунките са схематични и в един и същ мащаб помежду си, с капака нагоре. Не са в реален
          размер на екрана — сравнявайте формата и коя капсула е по-голяма.
        </p>
        <dl className="mt-6 divide-y divide-line border-y border-line">
          {BREWING_SYSTEMS.map((system) => (
            <div
              key={system.id}
              className="flex flex-col gap-x-8 gap-y-3 py-5 sm:flex-row sm:items-center"
            >
              <div className="min-w-0 sm:flex-1">
                <dt className="font-medium text-ink-900">{system.name}</dt>
                <dd className="mt-1 text-sm text-ink-500">{system.recognise}</dd>
              </div>
              {hasCapsuleDiagram(system.id) && (
                /* Fixed column, so the side profiles line up down the page. */
                <dd className="sm:w-80 sm:shrink-0">
                  <CapsuleDiagram system={system} />
                </dd>
              )}
            </div>
          ))}
        </dl>
      </section>

      <div className="mt-10 max-w-prose">
        <WizardNotice>
          Не намирате машината си? Обадете ни се на{" "}
          <a href={`tel:${siteConfig.contact.phoneHref}`} className="underline">
            {siteConfig.contact.phone}
          </a>{" "}
          — кажете какво пише на нея и ще ви кажем какво пасва.
        </WizardNotice>
      </div>
    </div>
  );
}
