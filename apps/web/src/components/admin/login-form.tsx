"use client";

import { signIn, type LoginState } from "@/lib/admin-actions";
import { loginSchema } from "@/lib/forms/admin-schemas";
import { INPUT_CLASS, LABEL_CLASS } from "@/components/forms/field-styles";
import { useActionForm } from "@/components/forms/use-schema-form";
import { Button } from "@/components/ui/primitives";

function Submit({ pending }: { pending: boolean }) {
  return (
    <Button type="submit" size="lg" disabled={pending} aria-busy={pending} className="w-full">
      {pending ? "Проверка…" : "Вход"}
    </Button>
  );
}

/** Every refusal of a sign-in is about the one field there is. */
const fieldErrorsOf = (state: LoginState) => (state.error ? { password: state.error } : undefined);

const INITIAL: LoginState = {};

/**
 * The panel's sign-in: `loginSchema` in the browser and in `signIn`, so an
 * empty field is refused here with the same words, without a request and
 * without counting as a guess.
 */
export function LoginForm() {
  const {
    formAction,
    form: { register },
    formProps,
    pending,
    errorOf,
    ariaFor,
  } = useActionForm({
    schema: loginSchema,
    action: signIn,
    initialState: INITIAL,
    fieldErrorsOf,
  });
  const error = errorOf("password");

  return (
    <form {...formProps} action={formAction} className="flex flex-col gap-4">
      <div>
        <label htmlFor="password" className={LABEL_CLASS}>
          Парола
        </label>
        <input
          id="password"
          {...register("password")}
          type="password"
          required
          autoComplete="current-password"
          autoFocus
          {...ariaFor("password", "password")}
          className={INPUT_CLASS}
        />
      </div>

      {error && (
        <p id="password-error" role="alert" className="-mt-3 text-sm text-critical">
          {error}
        </p>
      )}

      <Submit pending={pending} />
    </form>
  );
}
