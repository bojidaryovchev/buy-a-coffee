"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { signIn, type LoginState } from "@/lib/admin-actions";
import { INPUT_CLASS, LABEL_CLASS } from "@/components/forms/field-styles";
import { Button } from "@/components/ui/primitives";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending} aria-busy={pending} className="w-full">
      {pending ? "Проверка…" : "Вход"}
    </Button>
  );
}

export function LoginForm() {
  const [state, action] = useActionState<LoginState, FormData>(signIn, {});

  return (
    <form action={action} className="flex flex-col gap-4">
      <div>
        <label htmlFor="password" className={LABEL_CLASS}>
          Парола
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          autoFocus
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? "password-error" : undefined}
          className={INPUT_CLASS}
        />
      </div>

      {state.error && (
        <p id="password-error" role="alert" className="-mt-3 text-sm text-critical">
          {state.error}
        </p>
      )}

      <Submit />
    </form>
  );
}
