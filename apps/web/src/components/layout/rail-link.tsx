"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { isCurrentSection } from "@/components/layout/navigation";

/**
 * One link in the header rail, which knows whether the visitor is in its
 * section.
 *
 * A client component for exactly one reason: a layout is not told the path of
 * the page inside it, so the current section can only be read in the browser.
 * Nothing moves when the marker arrives — the underline's two pixels are
 * always there, transparent.
 *
 * Not colour alone: the current item carries `aria-current`, `"page"` on the
 * page the link points at and `"true"` on a page beneath it.
 */
export function RailLink({
  href,
  children,
  tone = "ink",
  sections = [],
  except = [],
}: {
  href: string;
  children: ReactNode;
  /** Clay is for the promotions link and nothing else. */
  tone?: "ink" | "clay";
  /** Other paths that belong to this item: the systems under "Капсули". */
  sections?: readonly string[];
  /** Paths beneath `href` that are a rail item of their own. */
  except?: readonly string[];
}) {
  const pathname = usePathname();
  const exact = pathname === href;
  const within =
    exact || [href, ...sections].some((path) => isCurrentSection(pathname, path, except));

  const colour =
    tone === "clay" ? "text-clay-600" : within ? "text-ink-900" : "text-ink-700 hover:text-ink-900";

  return (
    <Link
      href={href}
      aria-current={exact ? "page" : within ? "true" : undefined}
      className={`inline-flex items-center gap-1.5 border-b-2 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
        within ? "border-pine-900" : "border-transparent hover:border-pine-500"
      } ${colour}`}
    >
      {children}
    </Link>
  );
}
