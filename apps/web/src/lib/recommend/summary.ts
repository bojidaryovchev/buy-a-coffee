import { getMachineModel } from "@/content/machines";
import {
  BUDGET_OPTIONS,
  REQUIREMENT_OPTIONS,
  TASTE_OPTIONS,
  VOLUME_OPTIONS,
  wizardHref,
  withoutAnswer,
  type WizardAnswers,
} from "./answers";
import { getBrewingSystem } from "./systems";

export interface AnswerChip {
  readonly label: string;
  readonly value: string;
  /** Where the chip goes: back to the question that set it, with it cleared. */
  readonly href: string;
}

/**
 * The answers so far, as removable chips.
 *
 * Every chip links back to its own question with that answer cleared, so a
 * visitor can change one thing without restarting. This is also the only place
 * that decides what "clearing an answer" means when answers imply each other —
 * a machine model implies a system, so dropping the system has to drop the
 * model too or the two would contradict one another.
 */
export function answerChips(answers: WizardAnswers): readonly AnswerChip[] {
  const chips: AnswerChip[] = [];

  const system = getBrewingSystem(answers.system);
  if (system) {
    const machine = getMachineModel(answers.machine);
    chips.push({
      label: "Машина",
      value: machine ? `${machine.brand.name} ${machine.model.name}` : system.name,
      href: wizardHref({ ...withoutAnswer(answers, "system"), machine: null, brew: null }),
    });
  }

  const taste = TASTE_OPTIONS.find((option) => option.value === answers.taste);
  if (taste) {
    chips.push({
      label: "Вкус",
      value: taste.label,
      href: wizardHref(withoutAnswer(answers, "taste")),
    });
  }

  const volume = VOLUME_OPTIONS.find((option) => option.value === answers.volume);
  if (volume) {
    chips.push({
      label: "Количество",
      value: volume.label,
      href: wizardHref(withoutAnswer(answers, "volume")),
    });
  }

  const budget = BUDGET_OPTIONS.find((option) => option.value === answers.budget);
  if (budget) {
    chips.push({
      label: "Цена",
      value: budget.label,
      href: wizardHref(withoutAnswer(answers, "budget")),
    });
  }

  for (const requirement of answers.requirements) {
    const option = REQUIREMENT_OPTIONS.find((entry) => entry.value === requirement);
    if (!option) continue;
    chips.push({
      label: "Изискване",
      value: option.label,
      href: wizardHref({
        ...answers,
        requirements: answers.requirements.filter((entry) => entry !== requirement),
      }),
    });
  }

  return chips;
}
