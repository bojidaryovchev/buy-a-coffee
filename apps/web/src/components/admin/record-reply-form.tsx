"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { replyToRecord, type RecordReplyState } from "@/lib/admin-actions";

/**
 * Answering a stored enquiry, from the screen that shows it.
 *
 * Nearly `ReplyForm`, and not merged with it, because the two differ in the one
 * place a merge would have to paper over: this one addresses a **record** and
 * that one addresses a **thread**. The action reads the customer's address off
 * the row rather than taking it from this form, which is why there is no
 * recipient field here and why a shared component would need a discriminator
 * threaded through every prop.
 *
 * On success it does not clear silently: it names the conversation that now
 * exists and links to it. The first reply to an enquiry is the moment a record
 * turns into a thread, and the operator should be told where it went rather
 * than discovering later that Поща has grown an entry.
 */

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 rounded-sm bg-pine-700 px-5 py-2.5 text-sm font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-60"
    >
      {pending ? "Изпраща се..." : "Изпрати"}
    </button>
  );
}

export function RecordReplyForm({
  recordId,
  kind,
  recipient,
  sender,
}: {
  recordId: string;
  kind: "order" | "contact";
  recipient: string;
  sender: string;
}) {
  const [state, action] = useActionState<RecordReplyState, FormData>(replyToRecord, {});
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.sent) form.current?.reset();
  }, [state]);

  return (
    <form
      ref={form}
      action={action}
      className="mt-6 rounded-md border border-line-strong bg-paper-raised p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <label htmlFor="body" className="text-sm font-semibold text-ink-900">
          Отговори по имейл
        </label>
        <p className="text-sm text-ink-500">
          до {recipient} · от {sender}
        </p>
      </div>

      <input type="hidden" name="recordId" value={recordId} />
      <input type="hidden" name="kind" value={kind} />

      <textarea
        id="body"
        name="body"
        rows={7}
        required
        placeholder="Напишете отговора..."
        className="mt-2 w-full rounded-sm border border-line-strong bg-paper px-3.5 py-3 text-base leading-relaxed focus:border-pine-500 focus:outline-none"
      />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <label className="text-sm text-ink-500">
          <span className="block font-medium text-ink-900">Прикачени файлове</span>
          <input
            type="file"
            name="files"
            multiple
            className="mt-1 max-w-full text-sm file:mr-3 file:min-h-9 file:rounded-sm file:border file:border-line-strong file:bg-paper file:px-3 file:text-sm file:font-medium"
          />
        </label>
        <Submit />
      </div>

      {state.error && (
        <p role="alert" className="mt-3 text-sm font-medium text-critical">
          {state.error}
        </p>
      )}
      {state.sent && (
        <p role="status" className="mt-3 text-sm font-medium text-ink-500">
          Изпратено.{" "}
          {state.threadId && (
            <>
              Разговорът продължава в{" "}
              <Link href={`/admin/poshta/${state.threadId}`} className="underline">
                Поща
              </Link>
              .
            </>
          )}
        </p>
      )}
    </form>
  );
}
