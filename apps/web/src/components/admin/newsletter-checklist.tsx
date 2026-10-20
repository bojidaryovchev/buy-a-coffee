import type { DeliverabilityNote } from "@/lib/newsletter/deliverability";

/**
 * "Преди изпращане": the notes for the letter as it stands
 * (`lib/newsletter/deliverability.ts`), recomputed as the owner types.
 *
 * Two kinds. What stops the send — a block that is not the letter the owner
 * meant, a letter with nothing in it, one too large for Gmail — comes first
 * and says so in `critical`, as a form's errors do: the server refuses the
 * send while it holds. Everything else is advice and warnings in caution
 * colours, the panel's "needs a look" pair: a section left empty, a product
 * sold out since, a letter within a month of the last, what spam filters
 * weigh. Nothing here disables a button; the server is the one that refuses.
 * Shown under the composer and again, shorter, inside the send confirmation,
 * which is the last place to see it.
 */

/** Blocking first, each kind in the order it was found. */
const ordered = (notes: readonly DeliverabilityNote[]) => [
  ...notes.filter((note) => note.blocksSend),
  ...notes.filter((note) => !note.blocksSend),
];

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
  const shown = ordered(notes);
  const blocking = shown.filter((note) => note.blocksSend).length;
  if (compact) {
    if (shown.length === 0) return null;
    return (
      <div aria-labelledby={titleId} className="mt-3 rounded-sm bg-paper-raised p-3 text-sm">
        <p id={titleId} className="font-semibold text-caution">
          Преди да изпратите: {shown.length === 1 ? "1 забележка" : `${shown.length} забележки`}
        </p>
        <ul className="mt-1 list-disc pl-5 text-ink-900">
          {/* By position: two identical block lines make two identical notes. */}
          {shown.map((note, index) => (
            <li key={index}>
              {note.blocksSend && <span className="font-semibold text-critical">Спира: </span>}
              {note.title}
            </li>
          ))}
        </ul>
        <p className="mt-1 text-xs text-ink-500">
          Подробностите са в „Преди изпращане“ по-горе.{" "}
          {blocking > 0
            ? "Отбелязаното със „Спира“ трябва да се поправи, иначе изпращането няма да започне."
            : "Писмото може да бъде изпратено и така."}
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
        Какво да проверите. Отбелязаното със „Спира изпращането“ трябва да се поправи; останалото са
        съвети — неща, заради които писмото излиза по-кратко или пощата може да го сложи в „Спам“.
      </p>
      <div aria-live="polite">
        {shown.length === 0 ? (
          <p className="mt-3 rounded-sm bg-pine-100 px-3 py-2 text-sm text-pine-900">
            Няма забележки.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {shown.map((note, index) =>
              note.blocksSend ? (
                <li
                  key={index}
                  className="rounded-sm bg-critical-100 px-3 py-2 text-sm text-ink-900"
                >
                  <p className="text-xs font-semibold text-critical">Спира изпращането</p>
                  <p className="font-semibold text-critical">{note.title}</p>
                  <p className="mt-0.5">{note.detail}</p>
                </li>
              ) : (
                <li
                  key={index}
                  className="rounded-sm bg-caution-100 px-3 py-2 text-sm text-ink-900"
                >
                  <p className="font-semibold text-caution">{note.title}</p>
                  <p className="mt-0.5">{note.detail}</p>
                </li>
              ),
            )}
          </ul>
        )}
      </div>
    </section>
  );
}
