import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdminConfigured, isSignedIn } from "@/lib/auth";
import { signOut } from "@/lib/admin-actions";
import { countAwaitingReply } from "@/lib/mail/store";
import { siteConfig } from "@/config/site";

/**
 * The signed-in shell.
 *
 * A second group inside `/admin` — `(panel)` — so that `/admin/vhod` can share
 * the noindex and the title template without also being wrapped in a header
 * that redirects anyone not signed in. A login page behind a login gate is a
 * redirect loop.
 *
 * Operate mode: scanability, speed and native expectations outrank expression.
 * No hero, no marketing chrome, nothing that costs a tap. The shop's own
 * typography and colour tokens, because they are already in the stylesheet and
 * a second visual language for one operator would be work with no reader.
 */
export default async function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  if (!isAdminConfigured()) {
    return (
      <div className="shell max-w-2xl py-20">
        <h1 className="font-display text-3xl font-semibold text-ink-900">
          Администрацията е изключена
        </h1>
        <p className="mt-4 leading-relaxed text-ink-500">
          Не е зададена променлива <code className="font-mono text-sm">ADMIN_PASSWORD</code>.
          Панелът е недостъпен, докато не бъде конфигурирана. Това е нарочно: парола по подразбиране
          е по-лоша от липсващ панел.
        </p>
      </div>
    );
  }

  if (!(await isSignedIn())) redirect("/admin/vhod");

  /**
   * The one number worth a query on every page.
   *
   * Not decoration: the panel has four screens and only one of them can be
   * *owed* something. Without it the operator has to open Поща to find out
   * whether opening Поща was necessary, which is the question a nav item should
   * answer rather than pose.
   */
  const waiting = await countAwaitingReply();

  return (
    <div className="flex min-h-dvh flex-col bg-paper-sunken">
      <header className="border-b border-line bg-paper-raised">
        <div className="shell flex flex-wrap items-center gap-x-6 gap-y-2 py-3">
          <Link href="/admin" className="font-display font-semibold tracking-tight select-none">
            {siteConfig.name}
            <span className="font-sans font-normal text-ink-500"> · Администрация</span>
          </Link>

          <nav className="flex items-center gap-4 text-sm">
            <Link href="/admin/zayavki" className="text-ink-500 hover:text-ink-900">
              Заявки
            </Link>
            <Link href="/admin/sabshteniya" className="text-ink-500 hover:text-ink-900">
              Съобщения
            </Link>
            <Link href="/admin/poshta" className="text-ink-500 hover:text-ink-900">
              Поща
              {waiting > 0 && (
                <span className="ml-1.5 rounded-sm bg-clay-100 px-1.5 py-0.5 text-xs font-semibold text-clay-600 tabular-nums">
                  {waiting}
                </span>
              )}
            </Link>
            <Link href="/admin/byuletin" className="text-ink-500 hover:text-ink-900">
              Бюлетин
            </Link>
          </nav>

          {/* Out to the shop. Same tab, no target="_blank": this is navigation
              between our own pages, and the back button is a better answer than
              a window nobody asked for. The session is a cookie, so coming back
              costs one press. */}
          <Link href="/" className="ml-auto text-sm text-ink-500 hover:text-ink-900">
            Към сайта
          </Link>
          <form action={signOut}>
            <button type="submit" className="text-sm text-ink-500 hover:text-ink-900">
              Изход
            </button>
          </form>
        </div>
      </header>

      <main className="shell flex-1 py-8">{children}</main>
    </div>
  );
}
