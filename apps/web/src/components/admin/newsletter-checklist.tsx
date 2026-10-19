import type { DeliverabilityNote } from "@/lib/newsletter/deliverability";

/**
 * "Преди изпращане": the deliverability notes for the letter as it stands
 * (`lib/newsletter/deliverability.ts`), recomputed as the owner types.
 *
 * Advice, not a gate: nothing here disables a button. Caution colours, the
 * panel's "needs a look" pair, never `critical`, which is kept for errors.
 * Shown under the composer and again, shorter, inside the send confirmation,
 * which is the last place to see it.
 */
export function NewsletterChecklist({
  notes,
  id,
  compact = false,
}: {
  notes: readonly DeliverabilityNote[];
  id: string;
  compact?: boolean;
}) {
  const titleId = `${id}-title`;
  if (compact) {
    if (notes.length === 0) return null;
    return (
      <div aria-labelledby={titleId} className="mt-3 rounded-sm bg-paper-raised p-3 text-sm">
        <p id={titleId} className="font-semibold text-caution">
          Преди да изпратите: {notes.length === 1 ? "1 забележка" : `${notes.length} забележки`}
        </p>
        <ul className="mt-1 list-disc pl-5 text-ink-900">
          {/* By position: two identical block lines make two identical notes. */}
          {notes.map((note, index) => (
            <li key={index}>{note.title}</li>
          ))}
        </ul>
        <p className="mt-1 text-xs text-ink-500">
          Подробностите са в „Преди изпращане“ по-горе. Писмото може да бъде изпратено и така.
        </p>
      </div>
    );
  }
  return (
    <section
      aria-labelledby={titleId}
      className="rounded-md border border-line bg-paper-raised p-4"
      data-testid="newsletter-checklist"
    >
      <h2 id={titleId} className="text-sm font-semibold text-ink-900">
        Преди изпращане
      </h2>
      <p className="mt-1 text-xs text-ink-500">
        Неща, заради които пощата може да сложи писмото в „Спам“ или „Промоции“. Не пречат на
        изпращането.
      </p>
      <div aria-live="polite">
        {notes.length === 0 ? (
          <p className="mt-3 rounded-sm bg-pine-100 px-3 py-2 text-sm text-pine-900">
            Няма забележки.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {notes.map((note, index) => (
              <li key={index} className="rounded-sm bg-caution-100 px-3 py-2 text-sm text-ink-900">
                <p className="font-semibold text-caution">{note.title}</p>
                <p className="mt-0.5">{note.detail}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
