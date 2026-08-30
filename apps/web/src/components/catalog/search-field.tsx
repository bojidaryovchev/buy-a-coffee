"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { MAX_QUERY_LENGTH } from "@/lib/catalog/filters";
import { useAnalytics } from "@/components/analytics-provider";

/**
 * Header search.
 *
 * A real `<form>` with a `GET` action, so it works before hydration and with
 * JavaScript disabled — the browser submits to `/search?q=...` on its own. The
 * client code only upgrades that: it navigates without a full reload and keeps
 * the field in sync when the URL changes.
 *
 * There is no type-ahead dropdown. The reference site debounces a client-side
 * filter over a fully-loaded catalog; ours queries a database, and firing a
 * request per keystroke would be a poor trade for a catalog this size.
 */
export function SearchField({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(searchParams.get("q") ?? "");
  const analytics = useAnalytics();

  // Keep the field in step with the URL (back button, filter chips, etc).
  useEffect(() => {
    setValue(searchParams.get("q") ?? "");
  }, [searchParams]);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = value.trim().slice(0, MAX_QUERY_LENGTH);
    if (!query) {
      router.push("/search");
      return;
    }
    analytics.track({ name: "search", query, resultCount: -1 });
    router.push(`/search?q=${encodeURIComponent(query)}`);
  };

  return (
    <form role="search" action="/search" method="get" onSubmit={submit} className="w-full">
      <label htmlFor={inputId} className="sr-only">
        Търсене на продукти
      </label>
      <div className="flex h-11 items-stretch overflow-hidden rounded-sm border border-line-strong bg-paper-raised focus-within:border-pine-700">
        <input
          ref={inputRef}
          id={inputId}
          name="q"
          type="search"
          autoFocus={autoFocus}
          value={value}
          maxLength={MAX_QUERY_LENGTH}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Търсете кафе, марки, капсули…"
          className="min-w-0 flex-1 bg-transparent px-3.5 text-base outline-none placeholder:text-ink-300"
          autoComplete="off"
        />
        <button
          type="submit"
          className="flex shrink-0 items-center gap-1.5 bg-pine-900 px-4 text-sm font-medium text-paper hover:bg-pine-700"
        >
          <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="M16.5 16.5L21 21" strokeLinecap="round" />
          </svg>
          <span className="sr-only sm:not-sr-only">Търси</span>
        </button>
      </div>
    </form>
  );
}
