"use client";

import { useActionState } from "react";
import { syncAllSubscribers, type ResyncState } from "@/lib/newsletter/actions";

/**
 * "Копирай списъка в Resend": the repair for subscribers whose copy into
 * Resend failed. Runs in the request and reports what it did; a long list
 * stops on its own and the next press carries on from there.
 */

const INITIAL: ResyncState = {};

export function ResyncForm({ disabled }: { disabled: boolean }) {
  const [state, formAction, pending] = useActionState(syncAllSubscribers, INITIAL);
  const report = state.report;
  const more = report && report.next !== null;
  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="after" value={more ? report.next! : ""} />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || disabled}
          aria-busy={pending || undefined}
          className="inline-flex min-h-11 items-center rounded-sm border border-line-strong bg-paper-raised px-4 py-2 text-sm font-medium whitespace-nowrap text-ink-900 transition-colors hover:bg-paper-sunken disabled:cursor-not-allowed disabled:text-ink-500"
        >
          {pending
            ? "Копира се…"
            : more
              ? `Продължи копирането (${report.remaining})`
              : "Копирай списъка в Resend"}
        </button>
        <span className="text-sm text-ink-500">
          Безопасно е да се натисне повторно. Може да отнеме няколко минути.
        </span>
      </div>
      <div aria-live="polite" className="text-sm">
        {state.error && <p className="font-medium text-critical">{state.error}</p>}
        {report && (
          <p className="text-ink-700 tabular-nums">
            Копирани: {report.synced} · неуспешни: {report.failed} · пропуснати: {report.skipped}
            {more ? ` · остават: ${report.remaining}` : " · готово"}
            {report.firstError ? `. Първа грешка: ${report.firstError}` : ""}
          </p>
        )}
      </div>
    </form>
  );
}
