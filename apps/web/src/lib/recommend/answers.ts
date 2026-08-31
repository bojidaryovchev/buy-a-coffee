import { z } from "zod";
import { BREWING_SYSTEMS, type BrewMethod, type BrewingSystemId } from "./systems";

/**
 * Wizard state.
 *
 * The whole questionnaire lives in the URL, for the same reasons the catalog
 * filters do: every step is shareable and bookmarkable, the back button works
 * without a state machine in the browser, a result can be sent to someone over
 * the phone, and the entire flow runs with JavaScript switched off.
 *
 * Nothing is stored server-side and nothing is remembered between visits. The
 * answers are not personal data and there is no reason to keep them.
 *
 * Every parameter degrades to "not answered" rather than to an error. A
 * mangled link should drop the visitor back into the wizard, never onto an
 * error page.
 */

/** How much coffee gets drunk. Drives pack size, and how much per-cup price matters. */
export const VOLUME_OPTIONS = [
  {
    value: "light",
    label: "1–2 чаши на ден",
    detail: "Един човек, сутрин",
    /** Servings a pack should cover comfortably. */
    servingsTarget: 60,
  },
  {
    value: "regular",
    label: "3–5 чаши на ден",
    detail: "Двама души или един запален",
    servingsTarget: 120,
  },
  {
    value: "heavy",
    label: "6 или повече на ден",
    detail: "Семейство, офис или заведение",
    servingsTarget: 250,
  },
] as const;

export type VolumeAnswer = (typeof VOLUME_OPTIONS)[number]["value"];

/**
 * Taste, asked through concrete descriptions rather than a bare
 * weak/medium/strong scale.
 *
 * "Strong" means high caffeine to one person and bitter to another, so the
 * abstract word sorts people badly. Anchoring each option in a situation —
 * with milk in the morning, a classic Italian espresso — is what makes the
 * answers comparable between visitors.
 *
 * `intensityTarget` is a fraction of whatever scale the product declares,
 * because the source publishes intensity on at least four different scales
 * (out of 5, 10, 12 and 13).
 */
export const TASTE_OPTIONS = [
  {
    value: "mild",
    label: "Меко и балансирано",
    detail: "За сутрин, често с мляко. Без горчивина.",
    strength: "weak",
    intensityTarget: 0.35,
  },
  {
    value: "classic",
    label: "Класическо еспресо",
    detail: "Плътно, с крема, каквото се пие в Италия.",
    strength: "medium",
    intensityTarget: 0.6,
  },
  {
    value: "intense",
    label: "Силно и наситено",
    detail: "Максимален характер, събужда веднага.",
    strength: "strong",
    intensityTarget: 0.9,
  },
] as const;

export type TasteAnswer = (typeof TASTE_OPTIONS)[number]["value"];

/**
 * What matters about price.
 *
 * There is deliberately no "premium" option. We have no ratings, no cupping
 * scores and no reason to claim that a dearer coffee is a better one, so an
 * option that quietly sorted by price descending would be an invention. The
 * honest third choice is "price is not the point".
 */
export const BUDGET_OPTIONS = [
  { value: "cheap", label: "Възможно най-изгодно на чаша" },
  { value: "balanced", label: "Баланс между цена и вкус" },
  { value: "any", label: "Цената не е водеща" },
] as const;

export type BudgetAnswer = (typeof BUDGET_OPTIONS)[number]["value"];

/**
 * Opt-in requirements. Never defaulted on, and only ever offered when the
 * remaining candidates can actually satisfy them.
 */
export const REQUIREMENT_OPTIONS = [
  { value: "decaf", label: "Без кофеин" },
  { value: "flavoured", label: "Ароматизирано (ванилия, лешник и подобни)" },
  { value: "plain", label: "Без ароматизатори" },
] as const;

export type RequirementAnswer = (typeof REQUIREMENT_OPTIONS)[number]["value"];

export interface WizardAnswers {
  /** Step one: capsules, beans or pods. */
  readonly brew: BrewMethod | null;
  readonly system: BrewingSystemId | null;
  /** Machine model the system was derived from, kept so the result can say so. */
  readonly machine: string | null;
  readonly taste: TasteAnswer | null;
  readonly volume: VolumeAnswer | null;
  readonly budget: BudgetAnswer | null;
  readonly requirements: readonly RequirementAnswer[];
}

const BREW_METHODS: readonly BrewMethod[] = ["capsule", "beans", "pod"];
const SYSTEM_IDS = new Set<string>(BREWING_SYSTEMS.map((system) => system.id));

const oneOf = <T extends string>(values: readonly T[]) =>
  z
    .string()
    .optional()
    .transform((value): T | null => {
      const normalized = value?.trim().toLowerCase();
      return normalized && (values as readonly string[]).includes(normalized)
        ? (normalized as T)
        : null;
    });

/** A slug-shaped free parameter: bounded, and never interpolated into SQL. */
const slugParam = z
  .string()
  .optional()
  .transform((value) => {
    const normalized = (value ?? "").trim().toLowerCase();
    return /^[a-z0-9-]{1,64}$/.test(normalized) ? normalized : null;
  });

const wizardSchema = z.object({
  brew: oneOf(BREW_METHODS),
  system: z
    .string()
    .optional()
    .transform((value): BrewingSystemId | null => {
      const normalized = value?.trim().toLowerCase();
      return normalized && SYSTEM_IDS.has(normalized) ? (normalized as BrewingSystemId) : null;
    }),
  machine: slugParam,
  taste: oneOf(TASTE_OPTIONS.map((option) => option.value)),
  volume: oneOf(VOLUME_OPTIONS.map((option) => option.value)),
  budget: oneOf(BUDGET_OPTIONS.map((option) => option.value)),
  requirements: z
    .string()
    .optional()
    .transform((value): RequirementAnswer[] => {
      const allowed = new Set<string>(REQUIREMENT_OPTIONS.map((option) => option.value));
      const chosen = [
        ...new Set(
          (value ?? "")
            .split(",")
            .map((entry) => entry.trim().toLowerCase())
            .filter((entry) => allowed.has(entry)),
        ),
      ] as RequirementAnswer[];

      /*
       * "Flavoured" and "no flavourings" cannot both be true. A link carrying
       * both is nonsense rather than a preference, so both are dropped instead
       * of one silently winning.
       */
      if (chosen.includes("flavoured") && chosen.includes("plain")) {
        return chosen.filter((entry) => entry !== "flavoured" && entry !== "plain");
      }
      return chosen.sort();
    }),
});

export type RawWizardParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const EMPTY_ANSWERS: WizardAnswers = {
  brew: null,
  system: null,
  machine: null,
  taste: null,
  volume: null,
  budget: null,
  requirements: [],
};

/** Parse untrusted search params into validated answers. Never throws. */
export function parseWizardAnswers(params: RawWizardParams): WizardAnswers {
  const result = wizardSchema.safeParse({
    brew: firstValue(params.brew),
    system: firstValue(params.system),
    machine: firstValue(params.machine),
    taste: firstValue(params.taste),
    volume: firstValue(params.volume),
    budget: firstValue(params.budget),
    requirements: firstValue(params.requirements),
  });

  if (!result.success) return EMPTY_ANSWERS;

  const answers = result.data;
  /*
   * A system implies its brew method. Someone who arrives from a machine page
   * with `?system=nespresso-original` has answered step one without seeing it,
   * and should not be asked it again.
   */
  const system = BREWING_SYSTEMS.find((entry) => entry.id === answers.system);
  return { ...answers, brew: system ? system.method : answers.brew };
}

/** Serialise answers back into a query string, omitting everything unanswered. */
export function wizardHref(answers: Partial<WizardAnswers>, basePath = "/wizard"): string {
  const params = new URLSearchParams();
  if (answers.brew) params.set("brew", answers.brew);
  if (answers.system) params.set("system", answers.system);
  if (answers.machine) params.set("machine", answers.machine);
  if (answers.taste) params.set("taste", answers.taste);
  if (answers.volume) params.set("volume", answers.volume);
  if (answers.budget) params.set("budget", answers.budget);
  if (answers.requirements && answers.requirements.length > 0) {
    params.set("requirements", [...answers.requirements].sort().join(","));
  }
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

export type WizardStep = "brew" | "system" | "taste" | "volume" | "preferences" | "result";

/**
 * Below this many compatible products, refining questions stop being useful.
 *
 * Three of the systems in this catalog hold three products each. Asking four
 * questions to narrow three items wastes the visitor's time and reads as a
 * form for its own sake, so the wizard jumps straight to showing all of them.
 */
export const SHORT_CIRCUIT_THRESHOLD = 5;

export interface StepContext {
  /** Products compatible with the chosen system. Unknown before one is chosen. */
  readonly candidateCount: number | null;
}

/**
 * The step the visitor is on, derived from what they have answered.
 *
 * Derived rather than stored: with the answers in the URL there is no separate
 * cursor to keep in sync, and an edited link can never land on a step that
 * contradicts its own answers.
 */
export function currentStep(answers: WizardAnswers, context: StepContext): WizardStep {
  if (!answers.brew) return "brew";
  if (!answers.system) return "system";

  // Too few products left to be worth narrowing further.
  if (context.candidateCount !== null && context.candidateCount <= SHORT_CIRCUIT_THRESHOLD) {
    return "result";
  }

  if (!answers.taste) return "taste";
  if (!answers.volume) return "volume";
  if (!answers.budget) return "preferences";
  return "result";
}

/** Ordered steps, for the progress indicator. Excludes the result itself. */
export const STEP_SEQUENCE: readonly WizardStep[] = [
  "brew",
  "system",
  "taste",
  "volume",
  "preferences",
];

export const STEP_LABELS: Record<WizardStep, string> = {
  brew: "Машина",
  system: "Система",
  taste: "Вкус",
  volume: "Количество",
  preferences: "Предпочитания",
  result: "Готово",
};

/** Answers with one field cleared, for the "change this answer" links. */
export function withoutAnswer(answers: WizardAnswers, key: keyof WizardAnswers): WizardAnswers {
  if (key === "requirements") return { ...answers, requirements: [] };
  return { ...answers, [key]: null };
}
