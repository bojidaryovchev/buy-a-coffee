"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { signIn, type LoginState } from "@/lib/admin-actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-12 w-full rounded-sm bg-pine-700 text-sm font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-60"
    >
      {pending ? "Проверка..." : "Вход"}
    </button>
  );
}

export function LoginForm() {
  const [state, action] = useActionState<LoginState, FormData>(signIn, {});

  return (
    <form action={action} className="flex flex-col gap-4">
      <div>
        <label htmlFor="password" className="block text-sm font-semibold text-ink-900">
          Парола
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          autoFocus
          className="mt-2 h-12 w-full rounded-sm border border-line-strong bg-paper-raised px-3.5 text-base focus:border-pine-500 focus:outline-none"
        />
      </div>

      {state.error && (
        <p role="alert" className="text-sm font-medium text-critical">
          {state.error}
        </p>
      )}

      <Submit />
    </form>
  );
}
