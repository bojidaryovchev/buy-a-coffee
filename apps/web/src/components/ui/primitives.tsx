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
 */
const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-sm font-medium transition-colors disabled:cursor-not-allowed disabled:border-line disabled:bg-paper-sunken disabled:text-ink-500 disabled:inset-ring disabled:inset-ring-line";

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
 * Minimum heights with padding, never fixed heights: a label that wraps, or a
 * visitor who enlarges text, grows the button instead of overflowing it.
 */
const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "min-h-9 px-3 py-1.5 text-sm",
  md: "min-h-11 px-5 py-2.5 text-base",
  lg: "min-h-12 px-6 py-3 text-base",
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

const CHIP_BASE =
  "inline-flex min-h-9 items-center gap-1.5 rounded-sm border px-3 text-sm transition-colors";

const CHIP_KINDS: Record<ChipKind, string> = {
  choice: "border-line bg-paper-raised font-medium text-ink-900 hover:border-pine-500",
  filter: "border-line-strong bg-paper-raised text-ink-700 hover:border-ink-900 hover:text-ink-900",
  answer: "border-line-strong bg-paper-raised text-ink-700 hover:border-ink-900 hover:text-ink-900",
};

const CHIP_SELECTED = "border-pine-900 bg-pine-900 font-medium text-paper";

/**
 * A chip is always a link.
 *
 *  - `choice` goes to another listing (a system, a brand). `selected` marks the
 *    listing being viewed; `count` follows the label.
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
  children: ReactNode;
}) {
  const isSelected = kind === "choice" && selected;
  return (
    <Link
      aria-current={isSelected ? "page" : undefined}
      className={cx(CHIP_BASE, isSelected ? CHIP_SELECTED : CHIP_KINDS[kind], className)}
      {...props}
    >
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

  return (
    <nav aria-label="Навигационен път" className="py-4">
      <ol className="flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={`${item.name}-${index}`} className="flex items-center gap-1.5">
              {item.href && !isLast ? (
                <Link
                  href={item.href}
                  className="underline-offset-4 hover:text-ink-900 hover:underline"
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
    <nav aria-label="Страниране" className="mt-10 flex items-center justify-center gap-1">
      {page > 1 && (
        <Link
          href={buildHref(page - 1)}
          rel="prev"
          className="inline-flex min-h-10 items-center rounded-sm border border-line-strong px-3 text-sm hover:bg-paper-sunken"
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
              "inline-flex min-h-10 min-w-10 items-center justify-center rounded-sm border px-3 text-sm tabular-nums",
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
          className="inline-flex min-h-10 items-center rounded-sm border border-line-strong px-3 text-sm hover:bg-paper-sunken"
        >
          Напред
        </Link>
      )}
    </nav>
  );
}
