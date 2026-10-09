import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { LoginForm } from "@/components/admin/login-form";
import { AdminDisabled } from "@/components/admin/admin-disabled";
import { adminGate, isAdminConfigured, isSignedIn } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Вход",
  robots: { index: false, follow: false },
};

/**
 * Outside `(panel)` on purpose: that layout redirects anyone not signed in, and
 * a login page behind a login gate is a redirect loop.
 */
export default async function AdminLoginPage() {
  /* Decided per request, never at build time. Without this, a build made with
     no admin password renders the "disabled" notice once, as a static page, and
     serves it even after the password is set on the host. */
  await connection();

  /* `isAdminConfigured` first: it is what writes the reason to the server log
     on a deployment that is misconfigured. */
  if (!isAdminConfigured()) {
    const gate = adminGate();
    return <AdminDisabled reason={gate.enabled ? "no_password" : gate.reason} />;
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
