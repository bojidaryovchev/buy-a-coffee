import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Breadcrumbs } from "@/components/ui/primitives";
import {
  AnswerSummary,
  OptionList,
  StepHeading,
  StepProgress,
  WizardNotice,
  type WizardOption,
} from "@/components/wizard/wizard-ui";
import {
  BUDGET_OPTIONS,
  REQUIREMENT_OPTIONS,
  STEP_SEQUENCE,
  TASTE_OPTIONS,
  VOLUME_OPTIONS,
  currentStep,
  parseWizardAnswers,
  wizardHref,
  type RawWizardParams,
  type RequirementAnswer,
  type WizardAnswers,
  type WizardStep,
} from "@/lib/recommend/answers";
import {
  BREWING_SYSTEMS,
  getBrewingSystem,
  systemsForMethod,
  type BrewMethod,
} from "@/lib/recommend/systems";
import { getSystemAvailability, listRecommendationCandidates } from "@/lib/catalog/queries";
import { answerChips } from "@/lib/recommend/summary";
import { pluralize } from "@/lib/catalog/format";
import { siteConfig } from "@/config/site";

export const revalidate = 300;

/**
 * The wizard.
 *
 * One route for every question. Which question is shown is derived from the
 * answers already in the URL rather than stored anywhere, so there is no step
 * cursor to fall out of sync with the answers, and an edited or shared link
 * can never land somebody on a step that contradicts what it says.
 *
 * The result lives on its own route so that "here is what I was recommended"
 * is a link a person can send, and so the answered wizard and the
 * recommendation can be cached and indexed differently.
 */

interface PageProps {
  searchParams: Promise<RawWizardParams>;
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const answers = parseWizardAnswers(await searchParams);
  const started = answers.brew !== null;

  return {
    title: "Кое кафе е за вас",
    description:
      "Няколко въпроса за машината и вкуса ви, и ви казваме кое кафе от асортимента ни пасва — с цена на чаша, не на опаковка.",
    alternates: { canonical: "/wizard" },
    /*
     * Only the unanswered wizard is indexed. Every partially answered
     * permutation is the same page with different state, and letting search
     * engines collect them would be the filtered-listing problem again.
     */
    robots: started ? { index: false, follow: true } : undefined,
  };
}

const BREW_METHOD_OPTIONS: ReadonlyArray<{
  value: BrewMethod;
  label: string;
  detail: string;
}> = [
  {
    value: "capsule",
    label: "С капсули",
    detail: "Слагате капсула и машината прави останалото.",
  },
  {
    value: "beans",
    label: "На зърна",
    detail: "Автоматична машина с мелачка, или мелите сами.",
  },
  {
    value: "pod",
    label: "С хартиени дози",
    detail: "Еспресо машина с цедка за дози 44 мм.",
  },
];

export default async function WizardPage({ searchParams }: PageProps) {
  const answers = parseWizardAnswers(await searchParams);
  const availability = await getSystemAvailability();

  const system = getBrewingSystem(answers.system);
  const candidateCount = system ? availability[system.id] : null;
  const step = currentStep(answers, { candidateCount });

  if (step === "result") redirect(wizardHref(answers, "/wizard/result"));

  const breadcrumbs = [
    { name: "Начало", href: "/" },
    { name: "Кое кафе е за вас", href: "/wizard" },
  ];

  return (
    <div className="shell pb-16">
      <Breadcrumbs items={breadcrumbs} />

      <div className="mx-auto max-w-2xl">
        <StepProgress step={step} visibleSteps={visibleSteps(answers)} />
        <AnswerSummary entries={answerChips(answers)} />

        {step === "brew" && <BrewStep answers={answers} />}
        {step === "system" && <SystemStep answers={answers} availability={availability} />}
        {step === "taste" && <TasteStep answers={answers} />}
        {step === "volume" && <VolumeStep answers={answers} />}
        {step === "preferences" && <PreferencesStep answers={answers} />}
      </div>
    </div>
  );
}

/**
 * Which steps this visitor will actually be asked.
 *
 * Someone who answered "on beans" is never shown a system question, because
 * there is only one bean system; showing a one-option question would be
 * bureaucracy. The progress indicator has to agree with that, or it counts
 * down to a step that never arrives.
 */
function visibleSteps(answers: WizardAnswers): readonly WizardStep[] {
  const skipsSystem = answers.brew !== null && systemsForMethod(answers.brew).length <= 1;
  return skipsSystem ? STEP_SEQUENCE.filter((step) => step !== "system") : STEP_SEQUENCE;
}

/* --- Steps -------------------------------------------------------------- */

function BrewStep({ answers }: { answers: WizardAnswers }) {
  const options: WizardOption[] = BREW_METHOD_OPTIONS.map((option) => {
    const systems = systemsForMethod(option.value);
    /*
     * A method with exactly one system answers the next question too. Beans
     * are beans; there is nothing to disambiguate, so asking would be a step
     * that exists only to be clicked through.
     */
    const only = systems.length === 1 ? systems[0] : undefined;
    return {
      href: wizardHref({ ...answers, brew: option.value, system: only?.id ?? null }),
      label: option.label,
      detail: option.detail,
    };
  });

  return (
    <>
      <StepHeading
        title="Как правите кафето си?"
        description="Първо най-важното: това решава кое изобщо може да влезе в машината ви."
      />
      <OptionList options={options} />

      <div className="mt-6">
        <WizardNotice>
          Не сте сигурни?{" "}
          <Link href="/wizard/machines" className="underline">
            Намерете машината си по марка и модел
          </Link>{" "}
          и ще ви кажем какво пасва.
        </WizardNotice>
      </div>
    </>
  );
}

function SystemStep({
  answers,
  availability,
}: {
  answers: WizardAnswers;
  availability: Readonly<Record<string, number>>;
}) {
  const systems = answers.brew ? systemsForMethod(answers.brew) : BREWING_SYSTEMS;

  /*
   * A system we hold nothing for is not offered. Listing it would send the
   * visitor down three more questions to reach an empty page, and the honest
   * moment to say "we do not stock that" is before they answer anything else.
   */
  const stocked = systems.filter((system) => (availability[system.id] ?? 0) > 0);
  const unstocked = systems.filter((system) => (availability[system.id] ?? 0) === 0);

  const options: WizardOption[] = stocked.map((system) => ({
    href: wizardHref({ ...answers, system: system.id }),
    label: system.name,
    detail: system.summary,
    meta: pluralize(availability[system.id] ?? 0, "продукт", "продукта"),
  }));

  return (
    <>
      <StepHeading
        title="Коя система използва машината ви?"
        description="Капсулите не са взаимозаменяеми — това е единственото нещо тук, което трябва да е точно."
      />
      {options.length > 0 ? (
        <OptionList options={options} />
      ) : (
        <WizardNotice tone="caution" title="Нямаме нищо за този вид машина">
          Обадете ни се на{" "}
          <a href={siteConfig.contact.phoneHref} className="underline">
            {siteConfig.contact.phone}
          </a>{" "}
          и ще проверим какво можем да поръчаме.
        </WizardNotice>
      )}

      <div className="mt-6 space-y-4">
        <WizardNotice>
          Не знаете коя е?{" "}
          <Link href="/wizard/machines" className="underline">
            Изберете марката и модела на машината си
          </Link>{" "}
          — ние знаем какво пасва на всяка.
        </WizardNotice>

        {unstocked.length > 0 && (
          <p className="text-sm text-ink-500">
            В момента не предлагаме {unstocked.map((system) => system.name).join(", ")}.
          </p>
        )}
      </div>
    </>
  );
}

function TasteStep({ answers }: { answers: WizardAnswers }) {
  const options: WizardOption[] = TASTE_OPTIONS.map((option) => ({
    href: wizardHref({ ...answers, taste: option.value }),
    label: option.label,
    detail: option.detail,
  }));

  return (
    <>
      <StepHeading
        title="Кое е най-близо до вкуса ви?"
        description="Изберете по усещането, не по думата — „силно“ значи различно нещо за всеки."
      />
      <OptionList options={options} />
    </>
  );
}

function VolumeStep({ answers }: { answers: WizardAnswers }) {
  const options: WizardOption[] = VOLUME_OPTIONS.map((option) => ({
    href: wizardHref({ ...answers, volume: option.value }),
    label: option.label,
    detail: option.detail,
  }));

  return (
    <>
      <StepHeading
        title="Колко кафе се изпива?"
        description="От това зависи кой размер опаковка има смисъл — и колко ще ви излиза чашата."
      />
      <OptionList options={options} />
    </>
  );
}

/**
 * The last step: optional requirements, then the answer that finishes the
 * wizard.
 *
 * Requirements are toggles that keep the visitor on this step; choosing how
 * much price matters is what completes it. Nothing here is preselected, and an
 * option nothing in stock can satisfy is not offered at all — a checkbox that
 * guarantees an empty result is worse than no checkbox.
 */
async function PreferencesStep({ answers }: { answers: WizardAnswers }) {
  const system = getBrewingSystem(answers.system);
  const candidates = system ? await listRecommendationCandidates(system) : [];

  const counts = {
    decaf: candidates.filter((product) => product.attributes.decaf === "yes").length,
    flavoured: candidates.filter((product) => product.attributes.aromas === "yes").length,
    plain: candidates.filter((product) => product.attributes.aromas !== "yes").length,
  } satisfies Record<RequirementAnswer, number>;

  const available = REQUIREMENT_OPTIONS.filter((option) => counts[option.value] > 0);

  const toggleHref = (value: RequirementAnswer) => {
    const active = answers.requirements.includes(value);
    const next = active
      ? answers.requirements.filter((entry) => entry !== value)
      : [...answers.requirements.filter((entry) => !contradicts(entry, value)), value];
    return wizardHref({ ...answers, requirements: next });
  };

  return (
    <>
      <StepHeading
        title="Нещо задължително?"
        description="По желание. Показваме само неща, които наистина имаме за вашата машина."
      />

      {available.length > 0 && (
        <ul className="mb-8 grid gap-3 sm:grid-cols-2">
          {available.map((option) => {
            const selected = answers.requirements.includes(option.value);
            return (
              <li key={option.value}>
                <Link
                  href={toggleHref(option.value)}
                  aria-pressed={selected}
                  className={`flex items-center justify-between gap-3 rounded-md border px-4 py-3 text-sm transition-colors ${
                    selected
                      ? "border-pine-500 bg-pine-100 text-pine-900"
                      : "border-line bg-paper-raised text-ink-700 hover:border-pine-500"
                  }`}
                >
                  <span>{option.label}</span>
                  <span className="text-2xs tracking-wide text-ink-300 uppercase">
                    {selected ? "избрано" : pluralize(counts[option.value], "продукт", "продукта")}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <h2 className="mb-3 font-display text-lg font-semibold text-ink-900">
        Колко тежи цената при избора?
      </h2>
      <OptionList
        options={BUDGET_OPTIONS.map((option) => ({
          href: wizardHref({ ...answers, budget: option.value }, "/wizard/result"),
          label: option.label,
        }))}
      />
    </>
  );
}

/** "Flavoured" and "no flavourings" cannot both be selected. */
function contradicts(existing: RequirementAnswer, incoming: RequirementAnswer): boolean {
  const pair = new Set([existing, incoming]);
  return pair.has("flavoured") && pair.has("plain");
}
