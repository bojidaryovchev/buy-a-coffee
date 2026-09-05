import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs, SectionHeading } from "@/components/ui/primitives";
import { WizardNotice } from "@/components/wizard/wizard-ui";
import { MACHINE_BRANDS } from "@/content/machines";
import { BREWING_SYSTEMS } from "@/lib/recommend/systems";
import { JsonLd } from "@/components/seo/json-ld";
import { breadcrumbJsonLd } from "@/lib/seo/json-ld";
import { pluralize } from "@/lib/catalog/format";
import { siteConfig } from "@/config/site";

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

export const metadata: Metadata = {
  title: "Кои капсули пасват на моята машина",
  description:
    "Изберете марката и модела на кафемашината си и вижте коя система капсули приема — и какво от нашия асортимент пасва.",
  alternates: { canonical: "/wizard/machines" },
};

export default function MachinesIndexPage() {
  const breadcrumbs = [
    { name: "Начало", href: "/" },
    { name: "Кое кафе е за вас", href: "/wizard" },
    { name: "Машини", href: "/wizard/machines" },
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
              href={`/wizard/machines/${brand.slug}`}
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

      <section className="mt-12 max-w-prose">
        <h2 className="font-display text-xl font-semibold text-ink-900">
          Системите, за които предлагаме кафе
        </h2>
        <dl className="mt-4 space-y-4">
          {BREWING_SYSTEMS.map((system) => (
            <div key={system.id}>
              <dt className="font-medium text-ink-900">{system.name}</dt>
              <dd className="text-sm text-ink-500">{system.recognise}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="mt-10 max-w-prose">
        <WizardNotice>
          Не намирате машината си? Обадете ни се на{" "}
          <a href={siteConfig.contact.phoneHref} className="underline">
            {siteConfig.contact.phone}
          </a>{" "}
          — кажете какво пише на нея и ще ви кажем какво пасва.
        </WizardNotice>
      </div>
    </div>
  );
}
