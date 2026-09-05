"use client";

import { useEffect } from "react";
import { siteConfig } from "@/config/site";

/**
 * Route error boundary.
 *
 * Shows a plain apology and a retry, never a stack trace: `error.message` from
 * a server component is deliberately opaque in production, and surfacing raw
 * error text to visitors leaks internals for no benefit. The `digest` is shown
 * because it is the identifier that links this page to the server log.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(
      JSON.stringify({ level: "error", msg: "route.error", digest: error.digest ?? null }),
    );
  }, [error]);

  return (
    <div className="shell flex min-h-[60vh] flex-col items-center justify-center py-20 text-center">
      <h1 className="font-display text-3xl font-semibold text-ink-900">Нещо се обърка</h1>
      <p className="mt-2 max-w-md text-base text-ink-500">
        Страницата не можа да се зареди. Обикновено е временно — моля, опитайте отново.
      </p>

      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-11 items-center rounded-sm bg-pine-900 px-5 text-base font-medium text-paper hover:bg-pine-700"
        >
          Опитай отново
        </button>
        <a
          href="/"
          className="inline-flex h-11 items-center rounded-sm border border-line-strong px-5 text-base font-medium"
        >
          Към началната страница
        </a>
      </div>

      <p className="mt-8 text-sm text-ink-500">
        Ако продължава, обадете ни се на{" "}
        <a
          href={`tel:${siteConfig.contact.phoneHref}`}
          className="text-pine-700 underline underline-offset-4"
        >
          {siteConfig.contact.phone}
        </a>
        .
      </p>

      {error.digest && <p className="mt-4 text-xs text-ink-300">Референция: {error.digest}</p>}
    </div>
  );
}
