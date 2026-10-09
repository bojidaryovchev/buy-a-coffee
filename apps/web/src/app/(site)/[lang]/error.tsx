"use client";

import { useEffect } from "react";
import { siteConfig } from "@/config/site";
import { Button, ButtonLink } from "@/components/ui/primitives";
import { ERROR_COPY } from "@/i18n/error-copy";
import { fill } from "@/i18n/fill";
import { openingHoursLabel } from "@/i18n/hours";
import { useLocale } from "@/i18n/use-locale";
import { href, routes } from "@/lib/routes";

/**
 * Route error boundary.
 *
 * Says it is not the customer's doing, offers a retry and the way home, and
 * prints the phone number: the customer came to order, and the phone still
 * works when a page does not. In the page's language: an error boundary is a
 * client component and cannot be handed the dictionary, so its few strings are
 * in `i18n/error-copy.ts` and the locale is read off the route.
 *
 * Never a stack trace: `error.message` from a server component is deliberately
 * opaque in production, and surfacing raw error text to visitors leaks
 * internals for no benefit. The `digest` is shown because it is the identifier
 * that links this page to the server log.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const locale = useLocale();
  const copy = ERROR_COPY[locale];
  const hours = openingHoursLabel(copy.days);

  useEffect(() => {
    console.error(
      JSON.stringify({ level: "error", msg: "route.error", digest: error.digest ?? null }),
    );
  }, [error]);

  return (
    <div className="shell flex min-h-[60vh] flex-col items-center justify-center py-16 text-center">
      <h1 className="font-display text-2xl font-semibold text-ink-900 md:text-4xl">{copy.title}</h1>
      <p className="mt-3 max-w-md text-base text-ink-500">{copy.body}</p>

      {/* On a phone the two actions stack at full width, the main one first. */}
      <div className="mt-8 flex w-full max-w-md flex-col gap-3 sm:w-auto sm:max-w-none sm:flex-row sm:justify-center">
        <Button type="button" onClick={reset}>
          {copy.retry}
        </Button>
        <ButtonLink href={href(locale, routes.home)} variant="secondary">
          {copy.home}
        </ButtonLink>
      </div>

      <p className="mt-8 text-sm text-ink-500">
        {copy.phone}{" "}
        <a
          href={`tel:${siteConfig.contact.phoneHref}`}
          className="font-medium text-pine-700 tabular-nums underline underline-offset-4"
        >
          {siteConfig.contact.phone}
        </a>
        {hours && <> ({hours})</>}
      </p>

      {error.digest && (
        <p className="mt-4 text-xs text-ink-300">
          {fill(copy.reference, { digest: error.digest })}
        </p>
      )}
    </div>
  );
}
