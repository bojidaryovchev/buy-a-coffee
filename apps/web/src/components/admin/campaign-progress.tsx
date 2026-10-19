"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { resumeNewsletter, type ResumeState } from "@/lib/newsletter/actions";

/**
 * The live parts of a campaign's page: it re-reads itself while the campaign
 * is sending, and it offers to continue one that stopped.
 *
 * The sender runs in the background after the press that started it, and
 * writes its counts to the campaign after every request. This only asks the
 * server for the page again every few seconds while that is going on — the
 * counts on the page are the database's, never a guess kept in the browser.
 */

export function CampaignAutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => router.refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [active, router]);
  if (!active) return null;
  return (
    <p role="status" className="text-sm text-ink-500">
      Изпраща се. Страницата се обновява сама.
    </p>
  );
}

const INITIAL: ResumeState = {};

/**
 * "Продължи": sends to whoever has no answer yet. Safe to press after any
 * interruption — see `lib/newsletter/send.ts` — and refused by the server if
 * another run is already going. With nobody waiting (a run that died after
 * its last request but before writing the end) it is "Приключи": the run then
 * only writes the outcome.
 */
export function ResumeForm({ campaignId, waiting }: { campaignId: string; waiting: number }) {
  const [state, formAction, pending] = useActionState(resumeNewsletter, INITIAL);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="id" value={campaignId} />
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending || undefined}
        className="inline-flex min-h-11 items-center rounded-sm bg-pine-900 px-5 py-2.5 text-sm font-semibold whitespace-nowrap text-paper transition-colors hover:bg-pine-700 disabled:cursor-not-allowed disabled:bg-paper-sunken disabled:text-ink-500"
      >
        {pending
          ? "Изпраща се…"
          : waiting > 0
            ? `Продължи изпращането (${waiting})`
            : "Приключи изпращането"}
      </button>
      <span className="text-sm text-ink-500">
        {waiting > 0
          ? "Изпраща само на тези, които още не са го получили."
          : "Никой не чака писмото: записва края на изпращането."}
      </span>
      {state.error && (
        <p role="alert" className="basis-full text-sm font-medium text-critical">
          {state.error}
        </p>
      )}
    </form>
  );
}
