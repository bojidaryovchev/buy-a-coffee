"use client";

import { useEffect } from "react";
import { replyToThread, type ReplyState } from "@/lib/admin-actions";
import { threadReplySchema } from "@/lib/forms/admin-schemas";
import { FieldError } from "@/components/forms/field-error";
import { TEXTAREA_CLASS } from "@/components/forms/field-styles";
import { useActionForm } from "@/components/forms/use-schema-form";

/**
 * The reply box, for a mailbox thread.
 *
 * Deliberately plain text. The people writing to the shop are asking whether
 * something is in stock and what it costs, and a rich text editor would add a
 * toolbar, a sanitiser and a second body format to store in exchange for bold.
 *
 * The one thing it insists on is not losing what was typed: a failed send leaves
 * the text in the box and says why, rather than clearing the form and showing a
 * toast. An empty reply is refused before it is sent, with `threadReplySchema`,
 * the schema `replyToThread` checks with.
 */

function Submit({ pending }: { pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className="min-h-11 rounded-sm bg-pine-700 px-5 py-2.5 text-sm font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-60"
    >
      {pending ? "Изпраща се..." : "Изпрати"}
    </button>
  );
}

const fieldErrorsOf = (state: ReplyState) => state.fieldErrors;

const INITIAL: ReplyState = {};

export function ReplyForm({ threadId, sender }: { threadId: string; sender: string }) {
  const { state, formAction, form, formProps, pending, errorOf, ariaFor } = useActionForm({
    schema: threadReplySchema,
    action: replyToThread,
    initialState: INITIAL,
    fieldErrorsOf,
    defaultValuesOf: () => ({ threadId, body: "" }),
  });
  const { register, reset } = form;

  /* Cleared only on success, and only after the render that reported it: a
     failed send keeps the typed reply exactly where it was. Keyed on the state
     object rather than on `sent`, so a second successful reply clears the box
     as well as the first. `reset` clears the attachments too: with no values
     given it resets the <form> itself. */
  useEffect(() => {
    if (state.sent) reset();
  }, [state, reset]);

  return (
    <form
      {...formProps}
      action={formAction}
      className="mt-6 rounded-md border border-line-strong bg-paper-raised p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <label htmlFor="body" className="text-sm font-semibold text-ink-900">
          Отговор
        </label>
        <p className="text-sm text-ink-500">от {sender}</p>
      </div>

      <input type="hidden" {...register("threadId")} value={threadId} />

      <textarea
        id="body"
        {...register("body")}
        rows={7}
        required
        placeholder="Напишете отговора..."
        {...ariaFor("body", "body")}
        className={`mt-2 ${TEXTAREA_CLASS} leading-relaxed`}
      />
      <FieldError id="body" message={errorOf("body")} />

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
        <Submit pending={pending} />
      </div>

      {state.error && (
        <p role="alert" className="mt-3 text-sm font-medium text-critical">
          {state.error}
        </p>
      )}
      {state.sent && (
        <p role="status" className="mt-3 text-sm font-medium text-ink-500">
          Отговорът е изпратен.
        </p>
      )}
    </form>
  );
}
