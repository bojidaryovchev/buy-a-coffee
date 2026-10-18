import Link from "next/link";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

/**
 * Shared UI primitives.
 *
 * Small and deliberately unstyled beyond the design tokens. There is no
 * component library here because the surface is small enough that one would
 * cost more than it saves.
 */

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

/* --- Button ------------------------------------------------------------- */

/**
 * `accent` is the gold button: the single most important action in a viewport,
 * on `pine-900` or on a white panel, never directly on `paper` (DESIGN.md,
 * "The One Gold Rule" and "The Gold Ground Rule").
 *
 * `on-pine` is the secondary action on a `pine-900` band. It is a named variant
 * rather than something `secondary` turns into inside `.on-pine`, because a
 * white card can sit on a pine band, and its secondary button must stay dark
 * on white.
 */
export type ButtonVariant = "primary" | "accent" | "secondary" | "ghost" | "danger" | "on-pine";
export type ButtonSize = "sm" | "md" | "lg";

/*
 * Disabled is a flat sunken fill with readable text (6.24:1), not opacity. Its
 * edge is an inset ring rather than a border, so a button that goes disabled
 * while its form submits keeps its exact width.
 *
 * A label never wraps (`whitespace-nowrap`): a two-line button reads as two
 * buttons, and its height jumps out of line with its neighbours. Where a label
 * is longer than the room it is given, the button grows or the layout around
 * it changes (it stacks, or takes the full width) — never the text. The
 * responsive sweep checks this at every width the design supports.
 */
const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-sm font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:border-line disabled:bg-paper-sunken disabled:text-ink-500 disabled:inset-ring disabled:inset-ring-line";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-pine-900 text-paper hover:bg-pine-700",
  accent:
    "bg-gold-500 font-semibold text-ink-900 hover:bg-gold-600 in-[.on-pine]:hover:bg-gold-300",
  secondary: "border border-line-strong bg-paper-raised text-ink-900 hover:bg-paper-sunken",
  ghost: "text-ink-700 hover:bg-paper-sunken hover:text-ink-900",
  danger: "bg-critical text-paper hover:bg-critical/90",
  "on-pine": "border border-pine-200 text-paper hover:bg-pine-700",
};

/*
 * Minimum heights with padding, never fixed heights: a visitor who enlarges
 * text grows the button instead of overflowing it.
 *
 * Below `lg` a screen is assumed to be touched, and every control is at least
 * 44 px tall (DESIGN.md, "The Touch Target Rule"); `sm` is the only size below
 * that, so it is the only one that changes: 44 px on a phone or tablet, 40 px
 * from `lg`, where a pointer is precise and a row of cards or a toolbar is
 * denser.
 */
const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "min-h-11 px-3 py-1.5 text-sm lg:min-h-10",
  md: "min-h-11 px-5 py-2.5 text-base",
  /*
   * On a phone a lone action is full width (DESIGN.md, "Buttons", Phone), so
   * its side padding is only the least room beside the label; below `sm` it is
   * 12 px, which is what lets „Намерете кафе за вашата машина“ fit unbroken at
   * 320 px.
   */
  lg: "min-h-12 px-3 py-3 text-base sm:px-6",
};

/** A button's classes, for the rare control that can be neither `Button` nor `ButtonLink`. */
export function buttonClasses({
  variant = "primary",
  size = "md",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}): string {
  return cx(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className);
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentPropsWithoutRef<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={buttonClasses({ variant, size, className })} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentPropsWithoutRef<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link className={buttonClasses({ variant, size, className })} {...props} />;
}

/* --- Badge -------------------------------------------------------------- */

/**
 * `reduction` marks a price that went down, and nothing else. `accent` is its
 * older name and renders identically; it stays because callers use it.
 */
export type BadgeTone = "neutral" | "positive" | "caution" | "critical" | "reduction" | "accent";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-paper-sunken text-ink-700",
  positive: "bg-pine-100 text-pine-900",
  caution: "bg-caution-100 text-caution",
  critical: "bg-critical-100 text-critical",
  reduction: "bg-clay-600 text-paper-raised",
  accent: "bg-clay-600 text-paper-raised",
};

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex min-h-5 items-center rounded-xs px-1.5 text-2xs font-semibold tracking-[0.06em] uppercase",
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * A reason: a phrase, not a label. The shape of a badge, but in sentence case
 * and without letter-spacing, because a reason is always a sentence fragment
 * ("интензивност 8 от 12") and an uppercased sentence is hard to read.
 */
export function ReasonBadge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex min-h-5 items-center rounded-xs bg-pine-100 px-1.5 text-xs font-medium text-pine-900",
        className,
      )}
    >
      {children}
    </span>
  );
}

/* --- Availability ------------------------------------------------------- */

/** The one mapping of availability to words and tone. */
export function AvailabilityBadge({ availability }: { availability: string }) {
  switch (availability) {
    case "in_stock":
      return <Badge tone="positive">В наличност</Badge>;
    case "out_of_stock":
      // Sold out is a fact, not an error: neutral, so that red stays in forms.
      return <Badge tone="neutral">Изчерпан</Badge>;
    case "preorder":
      return <Badge tone="caution">По поръчка</Badge>;
    default:
      // Never claim stock we do not know about.
      return <Badge tone="neutral">Попитайте ни</Badge>;
  }
}

/* --- Chip --------------------------------------------------------------- */

export type ChipKind = "choice" | "filter" | "answer";

/*
 * A chip is one unit: its label and count never wrap inside it
 * (`whitespace-nowrap`); a row of chips wraps between chips instead, or
 * scrolls. 44 px tall below `lg` (a touch target), 36 px from `lg`.
 */
const CHIP_BASE =
  "inline-flex min-h-11 items-center gap-1.5 rounded-sm border px-3 text-sm whitespace-nowrap transition-colors lg:min-h-9";

const CHIP_KINDS: Record<ChipKind, string> = {
  choice: "border-line bg-paper-raised font-medium text-ink-900 hover:border-pine-500",
  filter: "border-line-strong bg-paper-raised text-ink-700 hover:border-ink-900 hover:text-ink-900",
  answer: "border-line-strong bg-paper-raised text-ink-700 hover:border-ink-900 hover:text-ink-900",
};

const CHIP_SELECTED = "border-pine-900 bg-pine-900 font-medium text-paper";

/**
 * A chip is always a link.
 *
 *  - `choice` goes to another listing (a system, a brand) or to a section of
 *    the page. `selected` marks the listing being viewed; `count` follows the
 *    label, and `countLabel` says what it counts to a screen reader;
 *    `leading` goes before the label (a system's icon, with `data-system`
 *    on the chip).
 *  - `filter` removes one active filter, and says so to a screen reader.
 *  - `answer` (wizard) goes back to the question that set it; `label` names
 *    that question.
 *
 * Removing a filter is not destructive, so no kind turns red on hover.
 */
export function ChipLink({
  kind = "choice",
  selected = false,
  label,
  count,
  countLabel,
  leading,
  className,
  children,
  ...props
}: Omit<ComponentPropsWithoutRef<typeof Link>, "children"> & {
  kind?: ChipKind;
  /** `choice` only. */
  selected?: boolean;
  /** `answer` only: the question this answers, shown before the value. */
  label?: string;
  /** `choice` only. */
  count?: number;
  /** `choice` only: read after the count by a screen reader (" продукта"). */
  countLabel?: string;
  /** Before the label, `aria-hidden` by the caller: a system's icon. */
  leading?: ReactNode;
  children: ReactNode;
}) {
  const isSelected = kind === "choice" && selected;
  return (
    <Link
      aria-current={isSelected ? "page" : undefined}
      className={cx(CHIP_BASE, isSelected ? CHIP_SELECTED : CHIP_KINDS[kind], className)}
      {...props}
    >
      {leading}
      {kind === "answer" && label && (
        <span className="text-2xs font-semibold tracking-[0.06em] text-ink-500 uppercase">
          {label}
        </span>
      )}
      <span>{children}</span>
      {kind === "choice" && count !== undefined && (
        <span
          className={cx("text-2xs tabular-nums", isSelected ? "text-pine-200" : "text-ink-300")}
        >
          {count}
          {countLabel && <span className="sr-only">{countLabel}</span>}
        </span>
      )}
      {kind === "filter" && (
        <>
          <svg
            aria-hidden
            viewBox="0 0 12 12"
            className="h-3 w-3 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
          </svg>
          <span className="sr-only">— премахни филтъра</span>
        </>
      )}
      {kind === "answer" && <span className="sr-only">— промяна на отговора</span>}
    </Link>
  );
}

/* --- Empty state -------------------------------------------------------- */

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-md border border-dashed border-line-strong bg-paper-raised px-6 py-12 text-center md:py-16">
      <svg
        aria-hidden
        viewBox="0 0 48 48"
        className="mb-4 h-10 w-10 text-ink-300"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <circle cx="21" cy="21" r="13" />
        <path d="M31 31l10 10" strokeLinecap="round" />
      </svg>
      <h2 className="font-display text-lg font-semibold text-ink-900 md:text-xl">{title}</h2>
      {description && <p className="mt-2 max-w-sm text-sm text-ink-500">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/* --- Section heading ---------------------------------------------------- */

export function SectionHeading({
  title,
  description,
  action,
  as: Tag = "h2",
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  as?: "h1" | "h2" | "h3";
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <Tag className="font-display text-2xl font-semibold text-ink-900 md:text-3xl">{title}</Tag>
        {description && <p className="mt-1.5 max-w-prose text-sm text-ink-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/* --- Breadcrumbs -------------------------------------------------------- */

export function Breadcrumbs({ items }: { items: ReadonlyArray<{ name: string; href?: string }> }) {
  if (items.length === 0) return null;

  /*
   * Below `lg` the trail is one line that scrolls sideways, and every step is
   * a 44 px row, so each link is a target a finger can hit (DESIGN.md, "The
   * Touch Target Rule") without a long product trail stacking three 44 px
   * lines above the page. It runs to the screen's edges (the negative margins
   * cancel the shell's padding); `py-1` keeps the focus ring inside the
   * scroller. From `lg` it is the wrapping line of 12 px text it always was.
   */
  return (
    <nav aria-label="Навигационен път" className="lg:py-4">
      <ol className="-mx-4 flex items-center gap-x-1.5 overflow-x-auto px-4 py-1 text-xs text-ink-500 [scrollbar-width:none] md:-mx-8 md:px-8 lg:mx-0 lg:flex-wrap lg:gap-y-1.5 lg:overflow-visible lg:p-0">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li
              key={`${item.name}-${index}`}
              className="flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap lg:min-h-0 lg:shrink lg:whitespace-normal"
            >
              {item.href && !isLast ? (
                <Link
                  href={item.href}
                  className="inline-flex min-h-11 items-center underline-offset-4 hover:text-ink-900 hover:underline lg:min-h-0"
                >
                  {item.name}
                </Link>
              ) : (
                <span
                  className={isLast ? "text-ink-700" : undefined}
                  aria-current={isLast ? "page" : undefined}
                >
                  {item.name}
                </span>
              )}
              {!isLast && (
                <span aria-hidden className="text-ink-300">
                  /
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/* --- Pagination --------------------------------------------------------- */

/**
 * Real links, not buttons: pagination must work without JavaScript, be
 * crawlable, and support opening a page in a new tab.
 */
export function Pagination({
  page,
  pageCount,
  buildHref,
}: {
  page: number;
  pageCount: number;
  buildHref: (page: number) => string;
}) {
  if (pageCount <= 1) return null;

  const windowSize = 2;
  const pages: Array<number | "gap"> = [];
  for (let index = 1; index <= pageCount; index += 1) {
    const withinWindow = Math.abs(index - page) <= windowSize;
    if (index === 1 || index === pageCount || withinWindow) {
      pages.push(index);
    } else if (pages[pages.length - 1] !== "gap") {
      pages.push("gap");
    }
  }

  return (
    <nav aria-label="Страниране" className="mt-10 flex flex-wrap items-center justify-center gap-1">
      {page > 1 && (
        <Link
          href={buildHref(page - 1)}
          rel="prev"
          className="inline-flex min-h-11 items-center rounded-sm border border-line-strong px-3 text-sm hover:bg-paper-sunken lg:min-h-10"
        >
          Назад
        </Link>
      )}

      {pages.map((entry, index) =>
        entry === "gap" ? (
          <span key={`gap-${index}`} className="px-2 text-sm text-ink-300" aria-hidden>
            …
          </span>
        ) : (
          <Link
            key={entry}
            href={buildHref(entry)}
            aria-current={entry === page ? "page" : undefined}
            className={cx(
              "inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm border px-3 text-sm tabular-nums lg:min-h-10 lg:min-w-10",
              entry === page
                ? "border-pine-900 bg-pine-900 text-paper"
                : "border-line-strong hover:bg-paper-sunken",
            )}
          >
            {entry}
          </Link>
        ),
      )}

      {page < pageCount && (
        <Link
          href={buildHref(page + 1)}
          rel="next"
          className="inline-flex min-h-11 items-center rounded-sm border border-line-strong px-3 text-sm hover:bg-paper-sunken lg:min-h-10"
        >
          Напред
        </Link>
      )}
    </nav>
  );
}
