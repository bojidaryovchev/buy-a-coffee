import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Breadcrumbs, ButtonLink, SectionHeading } from "@/components/ui/primitives";
import { WizardNotice } from "@/components/wizard/wizard-ui";
import { JsonLd } from "@/components/seo/json-ld";
import { breadcrumbJsonLd } from "@/lib/seo/json-ld";
import { MACHINE_BRANDS, getMachineBrand, type MachineModel } from "@/content/machines";
import { getSystemAvailability } from "@/lib/catalog/queries";
import { getBrewingSystem, getUnsupportedSystem, isSupportedSystem } from "@/lib/recommend/systems";
import { wizardHref } from "@/lib/recommend/answers";
import { pluralize } from "@/lib/catalog/format";
import { siteConfig } from "@/config/site";

export const revalidate = 300;

/**
 * One machine brand, with every model we can identify.
 *
 * The models are grouped by the system they take, because that is the actual
 * answer: several brands make machines for three incompatible systems, and a
 * flat alphabetical list would bury the only fact the visitor came for.
 *
 * Models we cannot supply are shown in their own group with the reason
 * spelled out. Hiding them would leave someone searching for their machine and
 * finding nothing, which reads as "this shop is broken" rather than "this shop
 * does not stock that".
 */

interface PageProps {
  params: Promise<{ brand: string }>;
}

export function generateStaticParams() {
  return MACHINE_BRANDS.map((brand) => ({ brand: brand.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { brand: slug } = await params;
  const brand = getMachineBrand(slug);
  if (!brand) return { title: "Марката не е намерена", robots: { index: false, follow: true } };

  return {
    title: `Кафе за машини ${brand.name}`,
    description: `Коя капсула пасва на всеки модел ${brand.name} — и какво от асортимента ни можете да поръчате за него.`,
    alternates: { canonical: `/wizard/machines/${brand.slug}` },
  };
}

export default async function MachineBrandPage({ params }: PageProps) {
  const { brand: slug } = await params;
  const brand = getMachineBrand(slug);
  if (!brand) notFound();

  const availability = await getSystemAvailability();

  /* Group models by system, preserving the order they are written in. */
  const groups = new Map<string, MachineModel[]>();
  for (const model of brand.models) {
    const existing = groups.get(model.system);
    if (existing) existing.push(model);
    else groups.set(model.system, [model]);
  }

  const supported = [...groups.entries()].filter(([system]) => isSupportedSystem(system as never));
  const unsupported = [...groups.entries()].filter(
    ([system]) => !isSupportedSystem(system as never),
  );

  const breadcrumbs = [
    { name: "Начало", href: "/" },
    { name: "Кое кафе е за вас", href: "/wizard" },
    { name: "Машини", href: "/wizard/machines" },
    { name: brand.name, href: `/wizard/machines/${brand.slug}` },
  ];

  return (
    <div className="shell pb-16">
      <JsonLd id="ld-breadcrumbs" data={breadcrumbJsonLd(breadcrumbs)} />
      <Breadcrumbs items={breadcrumbs} />

      <SectionHeading as="h1" title={`Кафе за машини ${brand.name}`} description={brand.summary} />

      <div className="max-w-3xl space-y-10">
        {supported.map(([systemId, models]) => {
          const system = getBrewingSystem(systemId);
          if (!system) return null;
          const count = availability[system.id] ?? 0;

          return (
            <section key={systemId}>
              <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="font-display text-xl font-semibold text-ink-900">{system.name}</h2>
                <span className="text-sm text-ink-500">
                  {count > 0
                    ? `${pluralize(count, "продукт", "продукта")} в наличност`
                    : "в момента нямаме наличност"}
                </span>
              </div>
              <p className="mb-4 max-w-prose text-sm text-ink-500">{system.recognise}</p>

              <ul className="mb-4 flex flex-wrap gap-2">
                {models.map((model) => (
                  <li
                    key={model.slug}
                    className="inline-flex items-center gap-2 rounded-sm border border-line bg-paper-raised px-3 py-1.5 text-sm text-ink-700"
                  >
                    {model.name}
                    {model.crossFormat && <Badge tone="neutral">съвместим формат</Badge>}
                  </li>
                ))}
              </ul>

              {models.some((model) => model.crossFormat) && (
                <p className="mb-4 max-w-prose text-sm text-ink-500">
                  Тези машини приемат същия формат капсула. Капсулите не са произведени от
                  производителя на машината, а са съвместими по размер и форма.
                </p>
              )}

              {models.some((model) => model.note) && (
                <ul className="mb-4 max-w-prose space-y-1 text-sm text-ink-500">
                  {models
                    .filter((model) => model.note)
                    .map((model) => (
                      <li key={`${model.slug}-note`}>
                        <span className="font-medium text-ink-700">{model.name}:</span> {model.note}
                      </li>
                    ))}
                </ul>
              )}

              {count > 0 ? (
                <div className="flex flex-wrap gap-3">
                  <ButtonLink href={wizardHref({ system: system.id, brew: system.method })}>
                    Изберете кафе за {system.name}
                  </ButtonLink>
                  <ButtonLink href={`/categories/${system.categorySlugs[0]}`} variant="secondary">
                    Вижте всички
                  </ButtonLink>
                </div>
              ) : (
                <WizardNotice tone="caution">
                  В момента нямаме нищо за тази система. Обадете ни се на{" "}
                  <a href={siteConfig.contact.phoneHref} className="underline">
                    {siteConfig.contact.phone}
                  </a>{" "}
                  и ще проверим какво можем да поръчаме.
                </WizardNotice>
              )}
            </section>
          );
        })}

        {unsupported.length > 0 && (
          <section>
            <h2 className="mb-3 font-display text-xl font-semibold text-ink-900">
              Модели, за които не предлагаме кафе
            </h2>
            <div className="space-y-4">
              {unsupported.map(([systemId, models]) => {
                const system = getUnsupportedSystem(systemId);
                return (
                  <div key={systemId} className="rounded-md border border-line bg-paper-sunken p-4">
                    <p className="font-medium text-ink-900">{system?.name ?? systemId}</p>
                    <p className="mt-1 text-sm text-ink-700">{system?.explanation}</p>
                    <p className="mt-2 text-sm text-ink-500">
                      {models.map((model) => model.name).join(", ")}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <p className="text-sm text-ink-500">
          Не намирате модела си?{" "}
          <Link href="/wizard/machines" className="underline">
            Вижте другите марки
          </Link>{" "}
          или ни се обадете на{" "}
          <a href={siteConfig.contact.phoneHref} className="underline">
            {siteConfig.contact.phone}
          </a>
          .
        </p>
      </div>
    </div>
  );
}
