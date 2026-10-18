"use client";

import { Button } from "@/components/ui/primitives";
import { useSchemaForm } from "@/components/forms/use-schema-form";
import { unsubscribeSchema } from "@/lib/forms/schemas";

const SUBMIT_LABEL = "Отпиши ме";
const PENDING_LABEL = "Изпраща се…";

/**
 * The button on the unsubscribe page.
 *
 * Nothing on it is typed: the token and the locale are the page's. It is still
 * checked with `unsubscribeSchema`, the schema the action checks with, so a
 * page drawn with a token that cannot be ours says so here instead of posting
 * it. The action answers with a redirect to the result page, with JavaScript
 * or without; with it, the button is disabled and says so until the answer
 * arrives, at the width it had.
 */
export function UnsubscribeForm({
  token,
  locale,
  action,
}: {
  token: string;
  locale: string;
  action: (formData: FormData) => Promise<void>;
}) {
  const {
    form: { register },
    formProps,
    pending,
    errorOf,
  } = useSchemaForm({
    schema: unsubscribeSchema,
    send: action,
    defaultValues: { token, locale },
  });
  const problem = errorOf("token") ?? errorOf("locale");

  return (
    <form {...formProps} action={action}>
      <input type="hidden" {...register("token")} value={token} />
      <input type="hidden" {...register("locale")} value={locale} />
      <Button
        type="submit"
        size="lg"
        disabled={pending}
        aria-busy={pending || undefined}
        className="w-full sm:w-auto"
      >
        <span className="grid">
          <span className={`col-start-1 row-start-1 ${pending ? "invisible" : ""}`}>
            {SUBMIT_LABEL}
          </span>
          <span
            aria-hidden={!pending}
            className={`col-start-1 row-start-1 ${pending ? "" : "invisible"}`}
          >
            {PENDING_LABEL}
          </span>
        </span>
      </Button>
      <p aria-live="polite" className="mt-2 text-sm">
        {problem && <span className="text-critical">{problem}</span>}
      </p>
    </form>
  );
}
