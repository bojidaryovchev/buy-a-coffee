import { MIN_ADMIN_PASSWORD_LENGTH, type AdminGate } from "@/lib/auth";

/**
 * The "panel is off" screen, for the login page and the panel layout.
 *
 * `adminGate()` says WHY the panel is off, and the right message is the one that
 * tells the operator what to change. The page is public, though, so each
 * message names the setting and the rule and never a value: not the length of
 * the password that is set, not whether the session secret is missing or equal
 * to it, not any part of either. A stranger learns that the panel is off and
 * what a valid configuration looks like — which is in the repository anyway —
 * and nothing about this deployment's secrets. The full reason is also written
 * to the server log (`isAdminConfigured`), where only the operator reads it.
 */

export type DisabledReason = Exclude<AdminGate, { enabled: true }>["reason"];

export const DISABLED_MESSAGE: Record<DisabledReason, string> = {
  no_password:
    "Не е зададена парола за администрацията (променливата ADMIN_PASSWORD). Панелът е недостъпен, докато не бъде зададена. Това е нарочно: парола по подразбиране е по-лоша от липсващ панел.",
  short_password: `Паролата за администрацията (ADMIN_PASSWORD) не отговаря на изискванията за публичен адрес: трябва да е поне ${MIN_ADMIN_PASSWORD_LENGTH} знака. Панелът е недостъпен, докато не бъде зададена по-дълга.`,
  no_session_secret:
    "За публичен адрес е нужна и отделна тайна за подписване на сесиите (ADMIN_SESSION_SECRET) — собствена дълга случайна стойност, различна от паролата. Панелът е недостъпен, докато не бъде зададена.",
};

export function AdminDisabled({ reason }: { reason: DisabledReason }) {
  return (
    <div className="shell max-w-2xl py-20">
      <h1 className="font-display text-3xl font-semibold text-ink-900">
        Администрацията е изключена
      </h1>
      <p className="mt-4 leading-relaxed text-ink-500">{DISABLED_MESSAGE[reason]}</p>
    </div>
  );
}
