import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Breadcrumbs, ButtonLink, EmptyState } from "@/components/ui/primitives";
import { AnswerSummary, WizardNotice } from "@/components/wizard/wizard-ui";
import { RecommendationCard } from "@/components/wizard/recommendation-card";
import { WizardAnalytics } from "@/components/wizard/wizard-analytics";
import { getSystemAvailability, listRecommendationCandidates } from "@/lib/catalog/queries";
import {
  SHORT_CIRCUIT_THRESHOLD,
  parseWizardAnswers,
  wizardHref,
  type RawWizardParams,
} from "@/lib/recommend/answers";
import { answerChips } from "@/lib/recommend/summary";
import { scoreRecommendations } from "@/lib/recommend/score";
import { getBrewingSystem } from "@/lib/recommend/systems";
import { getMachineModel } from "@/content/machines";
import { pluralize } from "@/lib/catalog/format";
import { siteConfig } from "@/config/site";
import { shippingLocale, type LangParams } from "@/i18n/params";
import { pageAlternates } from "@/lib/seo/alternates";
import { shareMetadata } from "@/lib/seo/share";
import { categoryHref, href, routes, systemCategory } from "@/lib/routes";
import { NOINDEX } from "@/lib/seo/robots";
import { pageTitle } from "@/lib/seo/title";

export const revalidate = 300;

/**
 * The recommendation.
 *
 * Three suggestions rather than one: a single answer reads as a guess, and the
 * visitor has no way to see what the alternatives would have been. Three, each
 * carrying the reasons it was chosen, reads as advice.
 *
 * The page is `noindex` because it is one of thousands of answer permutations
 * of the same page, the same reason filtered listings are. It stays a real,
 * shareable URL: someone should be able to send their result to whoever
 * actually buys the coffee.
 */

interface PageProps {
  params: Promise<LangParams>;
  searchParams: Promise<RawWizardParams>;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<LangParams>;
}): Promise<Metadata> {
  const locale = shippingLocale((await params).lang);
  const title = "Вашата препоръка";
  return {
    title: pageTitle(title),
    // Every answered permutation consolidates on the unanswered wizard.
    alternates: pageAlternates(locale, routes.wizard),
    // Shared, it is attributed to the same address the canonical names.
    ...shareMetadata({ locale, title, path: href(locale, routes.wizard) }),
    robots: NOINDEX,
  };
}

export default async function WizardResultPage({ params, searchParams }: PageProps) {
  const locale = shippingLocale((await params).lang);
  const answers = parseWizardAnswers(await searchParams);
  const system = getBrewingSystem(answers.system);

  // Nothing to recommend against without a system; send them back to step one.
  if (!system) redirect(href(locale, routes.wizard));

  const [candidates, availability] = await Promise.all([
    listRecommendationCandidates(system),
    getSystemAvailability(),
  ]);

  const result = scoreRecommendations(answers, candidates);
  const machine = getMachineModel(answers.machine);
  const shortCircuited = (availability[system.id] ?? 0) <= SHORT_CIRCUIT_THRESHOLD;

  const breadcrumbs = [
    { name: "Начало", href: href(locale, routes.home) },
    { name: "Кое кафе е за вас", href: href(locale, routes.wizard) },
    { name: "Вашата препоръка" },
  ];

  return (
    <div className="shell pb-16">
      <Breadcrumbs items={breadcrumbs} />
      <WizardAnalytics
        system={system.id}
        taste={answers.taste}
        volume={answers.volume}
        budget={answers.budget}
        requirements={answers.requirements}
        resultCount={result.picks.length}
        relaxed={result.relaxed.map((constraint) => constraint.key)}
        factsUsed={result.factsUsed}
      />

      <div className="mx-auto max-w-3xl">
        <header className="mb-6">
          <h1 className="font-display text-2xl font-semibold text-ink-900 md:text-3xl">
            {shortCircuited ? "Ето какво имаме за вашата машина" : "Ето какво бихме ви предложили"}
          </h1>
          <p className="mt-2 max-w-prose text-base text-ink-500">
            {machine
              ? `За ${machine.brand.name} ${machine.model.name} — система ${system.name}.`
              : `За система ${system.name}.`}{" "}
            {shortCircuited
              ? "За тази система асортиментът ни е малък, затова ги показваме всичките, вместо да ви задаваме въпроси."
              : "Подредени по това колко пасват на отговорите ви."}
          </p>
        </header>

        <AnswerSummary
          entries={answerChips(answers).map((chip) => ({ ...chip, href: href(locale, chip.href) }))}
        />

        {result.relaxed.length > 0 && (
          <div className="mb-6 space-y-3">
            {result.relaxed.map((constraint) => (
              <WizardNotice
                key={constraint.key}
                tone="caution"
                title="Не можахме да изпълним всичко"
              >
                {constraint.message}
              </WizardNotice>
            ))}
          </div>
        )}

        {result.picks.length === 0 ? (
          <EmptyState
            title="Нямаме подходящо предложение"
            description="Обадете ни се и ще намерим нещо за машината ви."
            action={<ButtonLink href={href(locale, routes.contact)}>Свържете се с нас</ButtonLink>}
          />
        ) : (
          <ol aria-label="Препоръки" className="space-y-4">
            {result.picks.map((entry, index) => (
              <li key={entry.product.id}>
                <RecommendationCard
                  locale={locale}
                  entry={entry}
                  rank={index + 1}
                  emphasis={index === 0}
                  headingLevel="h2"
                />
              </li>
            ))}
          </ol>
        )}

        {result.alternative && (
          <section className="mt-10">
            <h2 className="mb-3 font-display text-lg font-semibold text-ink-900">
              Различно, но си заслужава
            </h2>
            <p className="mb-3 max-w-prose text-sm text-ink-500">
              Не е точно това, което описахте — затова пък е от друга марка и с друг характер.
            </p>
            <RecommendationCard locale={locale} entry={result.alternative} />
          </section>
        )}

        <footer className="mt-12 space-y-4 border-t border-line pt-8">
          {/*
            The way to the whole shelf is a link, not a button: its label names
            the count and the system („… 35 продукта за Lavazza A Modo Mio“),
            longer than a phone is wide, and a button's label never wraps.
          */}
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6">
            <Link
              href={categoryHref(locale, systemCategory(system))}
              className="inline-flex min-h-11 items-center text-base font-medium text-pine-700 underline underline-offset-4 hover:text-pine-900"
            >
              <span>
                Вижте всички {pluralize(availability[system.id] ?? 0, "продукт", "продукта")} за{" "}
                <span className="whitespace-nowrap">{system.name}</span>
              </span>
            </Link>
            <ButtonLink href={href(locale, wizardHref({}))} variant="secondary">
              Започнете отначало
            </ButtonLink>
          </div>

          <p className="text-sm text-ink-500">
            Не сте убедени? Обадете ни се на{" "}
            <a href={`tel:${siteConfig.contact.phoneHref}`} className="underline">
              {siteConfig.contact.phone}
            </a>{" "}
            и ще го обсъдим. Или{" "}
            <Link href={href(locale, routes.machines)} className="underline">
              проверете отново коя система е машината ви
            </Link>
            .
          </p>
        </footer>
      </div>
    </div>
  );
}
