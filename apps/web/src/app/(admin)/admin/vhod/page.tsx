import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/admin/login-form";
import { isAdminConfigured, isSignedIn } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Вход",
  robots: { index: false, follow: false },
};

/**
 * Outside `(panel)` on purpose: that layout redirects anyone not signed in, and
 * a login page behind a login gate is a redirect loop.
 */
export default async function AdminLoginPage() {
  if (!isAdminConfigured()) {
    return (
      <div className="shell max-w-2xl py-20">
        <h1 className="font-display text-3xl font-semibold text-ink-900">
          Администрацията е изключена
        </h1>
        <p className="mt-4 leading-relaxed text-ink-500">
          Не е зададена променлива <code className="font-mono text-sm">ADMIN_PASSWORD</code>.
        </p>
      </div>
    );
  }

  if (await isSignedIn()) redirect("/admin");

  return (
    <div className="shell flex max-w-sm flex-col justify-center py-24">
      <h1 className="font-display text-2xl font-semibold text-ink-900">Вход в администрацията</h1>
      <div className="mt-6">
        <LoginForm />
      </div>
    </div>
  );
}
