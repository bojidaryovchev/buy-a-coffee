import Link from "next/link";
import { cx } from "@/components/ui/primitives";
import { STEP_LABELS, STEP_SEQUENCE, type WizardStep } from "@/lib/recommend/answers";

/**
 * Wizard chrome.
 *
 * Every control is an ordinary link. There is no client component anywhere in
 * this flow, which is not an aesthetic choice: the answers live in the URL, so
 * links are all that is needed, and a questionnaire that works with JavaScript
 * disabled also works on a bad connection, in a webview, and for a visitor who
 * arrives on step four from a message someone sent them.
 */

export function StepProgress({
  step,
  visibleSteps,
}: {
  step: WizardStep;
  /** Steps actually being asked; a short-circuited flow asks fewer. */
  visibleSteps?: readonly WizardStep[];
}) {
  const steps = visibleSteps ?? STEP_SEQUENCE;
  const currentIndex = steps.indexOf(step);

  return (
    <nav aria-label="Напредък" className="mb-8">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs tracking-wide uppercase">
        {steps.map((entry, index) => {
          const state =
            currentIndex < 0 || index < currentIndex
              ? "done"
              : index === currentIndex
                ? "current"
                : "todo";
          return (
            <li key={entry} className="flex items-center gap-2">
              {index > 0 && (
                <span aria-hidden className="text-ink-300">
                  ·
                </span>
              )}
              <span
                aria-current={state === "current" ? "step" : undefined}
                className={cx(
                  state === "current" && "font-semibold text-pine-900",
                  state === "done" && "text-ink-500",
                  state === "todo" && "text-ink-300",
                )}
              >
                {STEP_LABELS[entry]}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function StepHeading({ title, description }: { title: string; description?: string }) {
  return (
    <header className="mb-6">
      <h1 className="font-display text-2xl font-semibold text-ink-900 md:text-3xl">{title}</h1>
      {description && <p className="mt-2 max-w-prose text-base text-ink-500">{description}</p>}
    </header>
  );
}

export interface WizardOption {
  readonly href: string;
  readonly label: string;
  readonly detail?: string;
  /** Small right-aligned note, such as a product count. */
  readonly meta?: string;
  readonly selected?: boolean;
}

/**
 * The answer list.
 *
 * Options are large link targets with the explanation inside them rather than
 * beside them, because the explanation is what the visitor is choosing between
 * — "силно" alone does not distinguish anything.
 */
export function OptionList({
  options,
  columns = 1,
}: {
  options: readonly WizardOption[];
  columns?: 1 | 2;
}) {
  return (
    <ul className={cx("grid gap-3", columns === 2 && "sm:grid-cols-2")}>
      {options.map((option) => (
        <li key={option.href + option.label}>
          <Link
            href={option.href}
            className={cx(
              "flex h-full items-baseline justify-between gap-4 rounded-md border bg-paper-raised px-4 py-4 transition-colors",
              option.selected
                ? "border-pine-500 bg-pine-100"
                : "border-line hover:border-pine-500 hover:bg-paper-sunken",
            )}
          >
            <span className="min-w-0">
              <span className="block font-display text-lg font-semibold text-ink-900">
                {option.label}
              </span>
              {option.detail && (
                <span className="mt-1 block text-sm text-ink-500">{option.detail}</span>
              )}
            </span>
            {option.meta && (
              <span className="shrink-0 text-2xs tracking-wide text-ink-300 uppercase">
                {option.meta}
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * The answers so far, each one a link back to the question that set it.
 *
 * Shown on every step after the first. Without it a wizard is a black box:
 * changing one answer means starting over, and the visitor cannot see what the
 * recommendation is actually based on.
 */
export function AnswerSummary({
  entries,
}: {
  entries: ReadonlyArray<{ label: string; value: string; href: string }>;
}) {
  if (entries.length === 0) return null;

  return (
    <section aria-label="Вашите отговори" className="mb-6">
      <ul className="flex flex-wrap gap-2">
        {entries.map((entry) => (
          <li key={entry.label}>
            <Link
              href={entry.href}
              className="inline-flex items-baseline gap-1.5 rounded-sm border border-line bg-paper-raised px-3 py-1.5 text-sm text-ink-700 hover:border-pine-500"
            >
              <span className="text-2xs tracking-wide text-ink-300 uppercase">{entry.label}</span>
              <span className="font-medium text-ink-900">{entry.value}</span>
              <span aria-hidden className="text-ink-300">
                ✕
              </span>
              <span className="sr-only">— промяна на отговора</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A plain, non-alarming notice. Used to tell the truth about a gap. */
export function WizardNotice({
  tone = "neutral",
  title,
  children,
}: {
  tone?: "neutral" | "caution";
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cx(
        "rounded-md border px-4 py-3 text-sm",
        tone === "caution"
          ? "border-clay-500/40 bg-clay-100 text-clay-600"
          : "border-line bg-paper-sunken text-ink-700",
      )}
    >
      {title && <p className="font-semibold text-ink-900">{title}</p>}
      <div className={cx(title && "mt-1")}>{children}</div>
    </div>
  );
}
