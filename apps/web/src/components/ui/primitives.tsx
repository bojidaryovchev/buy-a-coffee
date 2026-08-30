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

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-pine-900 text-paper hover:bg-pine-700",
  secondary: "border border-line-strong bg-paper-raised text-ink-900 hover:bg-paper-sunken",
  ghost: "text-ink-700 hover:bg-paper-sunken hover:text-ink-900",
  danger: "bg-critical text-paper hover:opacity-90",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-5 text-base",
  lg: "h-12 px-6 text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentPropsWithoutRef<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={cx(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentPropsWithoutRef<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link className={cx(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)} {...props} />;
}

/* --- Badge -------------------------------------------------------------- */

type BadgeTone = "neutral" | "positive" | "caution" | "critical" | "accent";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-paper-sunken text-ink-700",
  positive: "bg-pine-100 text-pine-900",
  caution: "bg-clay-100 text-clay-600",
  critical: "bg-critical/10 text-critical",
  accent: "bg-clay-500 text-paper",
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
        "inline-flex items-center rounded-xs px-1.5 py-0.5 text-2xs font-medium tracking-wide uppercase",
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* --- Availability ------------------------------------------------------- */

export function AvailabilityBadge({ availability }: { availability: string }) {
  switch (availability) {
    case "in_stock":
      return <Badge tone="positive">В наличност</Badge>;
    case "out_of_stock":
      return <Badge tone="critical">Изчерпан</Badge>;
    case "preorder":
      return <Badge tone="caution">По поръчка</Badge>;
    default:
      // Never claim stock we do not know about.
      return <Badge tone="neutral">Попитайте ни</Badge>;
  }
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
    <div className="flex flex-col items-center rounded-md border border-dashed border-line-strong bg-paper-raised px-6 py-16 text-center">
      <svg aria-hidden viewBox="0 0 48 48" className="mb-4 h-10 w-10 text-ink-300" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="21" cy="21" r="13" />
        <path d="M31 31l10 10" strokeLinecap="round" />
      </svg>
      <h2 className="font-display text-xl font-semibold text-ink-900">{title}</h2>
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
                <Link href={item.href} className="underline-offset-4 hover:text-ink-900 hover:underline">
                  {item.name}
                </Link>
              ) : (
                <span className={isLast ? "text-ink-700" : undefined} aria-current={isLast ? "page" : undefined}>
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
          className="inline-flex h-10 items-center rounded-sm border border-line px-3 text-sm hover:bg-paper-sunken"
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
              "inline-flex h-10 min-w-10 items-center justify-center rounded-sm border px-3 text-sm",
              entry === page
                ? "border-pine-900 bg-pine-900 text-paper"
                : "border-line hover:bg-paper-sunken",
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
          className="inline-flex h-10 items-center rounded-sm border border-line px-3 text-sm hover:bg-paper-sunken"
        >
          Напред
        </Link>
      )}
    </nav>
  );
}
