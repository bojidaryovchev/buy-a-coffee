import Link from "next/link";
import { ChipLink, cx } from "@/components/ui/primitives";
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
      {/*
        The steps are separated by dots, and on a phone the list wraps. So
        that no line starts with a dot, every step carries one that hangs in
        the 16 px gap before it (`-ml-4` into `gap-x-4`), and the list clips
        what falls outside it: the dot of whichever step begins a line hangs
        off the left edge and is cut off; every other one sits between two
        steps.
      */}
      <ol className="flex flex-wrap items-center gap-x-4 gap-y-1 overflow-hidden text-2xs tracking-wide uppercase">
        {steps.map((entry, index) => {
          const state =
            currentIndex < 0 || index < currentIndex
              ? "done"
              : index === currentIndex
                ? "current"
                : "todo";
          return (
            <li key={entry} className="-ml-4 flex items-center">
              <span aria-hidden className="w-4 shrink-0 text-center text-ink-300">
                ·
              </span>
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
  /** A short note about the option, such as a product count. */
  readonly meta?: string;
  readonly selected?: boolean;
  /**
   * A small picture shown before the label. It sits inside the link, so it
   * must be decorative: the label is already the link's name.
   */
  readonly figure?: React.ReactNode;
}

/*
 * Where an option's note goes is decided by the card's own width, not the
 * window's: the same card is full width on a phone and half a two-column grid
 * on a laptop. Each `li` is a size container; from `@md` (28rem, 448 px) of
 * card there is room for the note on the right, unbroken, level with the
 * label's first line, and the label wraps beside it. Below that the note goes
 * under the label, on its own line — so it is never squeezed into a narrow
 * column of its own, and it never breaks mid-phrase (`whitespace-nowrap`).
 */
const OPTION_BODY =
  "flex min-w-0 flex-1 flex-col gap-1 @md:flex-row @md:items-baseline @md:justify-between @md:gap-4";
const OPTION_META = "text-xs whitespace-nowrap text-ink-500 tabular-nums @md:shrink-0";

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
        <li key={option.href + option.label} className="@container">
          <Link
            href={option.href}
            className={cx(
              "flex h-full min-h-16 items-center gap-4 rounded-md border bg-paper-raised p-4 transition-colors",
              option.selected
                ? "border-pine-500 bg-pine-100"
                : "border-line hover:border-pine-500 hover:bg-paper-sunken",
            )}
          >
            {option.figure}
            <span className={OPTION_BODY}>
              <span className="min-w-0">
                <span className="block font-display text-lg font-semibold text-ink-900">
                  {option.label}
                </span>
                {option.detail && (
                  <span className="mt-1 block text-sm text-ink-500">{option.detail}</span>
                )}
              </span>
              {option.meta && <span className={OPTION_META}>{option.meta}</span>}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export interface WizardToggle {
  readonly href: string;
  readonly label: string;
  /** What choosing it leaves, such as „4 продукта“. */
  readonly meta?: string;
  readonly selected: boolean;
}

/**
 * Options that switch on and off and keep the visitor on the step: the
 * wizard's optional requirements.
 *
 * Each is a link to the same step with the option added or removed, with
 * `aria-pressed` for its state and a check box drawn the way the catalog's
 * filters draw theirs, so it reads as a switch rather than as an answer that
 * moves on. Its note follows the same rule as an option's (see `OPTION_BODY`).
 */
export function ToggleOptionList({ options }: { options: readonly WizardToggle[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {options.map((option) => (
        <li key={option.href + option.label} className="@container">
          <Link
            href={option.href}
            aria-pressed={option.selected}
            className={cx(
              "flex h-full min-h-12 items-center gap-3 rounded-md border px-4 py-3 text-base transition-colors",
              option.selected
                ? "border-pine-500 bg-pine-100"
                : "border-line bg-paper-raised hover:border-pine-500 hover:bg-paper-sunken",
            )}
          >
            <span
              aria-hidden
              className={cx(
                "flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-xs border",
                option.selected
                  ? "border-pine-900 bg-pine-900 text-paper"
                  : "border-line-strong bg-paper-raised",
              )}
            >
              {option.selected && (
                <svg
                  viewBox="0 0 12 12"
                  className="h-3 w-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <path d="M2 6.5l2.5 2.5L10 3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            <span className={OPTION_BODY}>
              <span
                className={cx(
                  "min-w-0",
                  option.selected ? "font-medium text-pine-900" : "text-ink-900",
                )}
              >
                {option.label}
              </span>
              {option.meta && <span className={OPTION_META}>{option.meta}</span>}
            </span>
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
      {/*
        On a phone one scrolling row, as DESIGN.md asks of a row of chips that
        would run past two lines: five answers would otherwise stack into five
        rows above the question. Wrapped from `md`. `relative` contains the
        chips' screen-reader text, which is absolutely positioned and would
        otherwise escape the scroll container and widen the page.
      */}
      <ul className="relative -mx-4 flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 py-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
        {entries.map((entry) => (
          // Not the label: every requirement chip is „Изискване“. What a chip
          // clears is its own, so its href is.
          <li key={entry.href} className="shrink-0 snap-start">
            <ChipLink kind="answer" href={entry.href} label={entry.label}>
              {entry.value}
            </ChipLink>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * A plain, non-alarming notice. Used to tell the truth about a gap.
 *
 * The caution tone is amber, not clay: clay means a price went down, and
 * nothing else on the site.
 */
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
          ? "border-caution bg-caution-100 text-ink-900"
          : "border-line bg-paper-sunken text-ink-700",
      )}
    >
      {title && (
        <p className={cx("font-semibold", tone === "caution" ? "text-caution" : "text-ink-900")}>
          {title}
        </p>
      )}
      <div className={cx(title && "mt-1")}>{children}</div>
    </div>
  );
}
