import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/primitives";
import { siteConfig } from "@/config/site";
import { lookupToken } from "@/lib/forms/unsubscribe";
import { maskEmail } from "@/lib/forms/unsubscribe-token";
import { unsubscribe } from "./actions";
import type { Locale } from "@/i18n/config";
import { localeFrom, type LangParams } from "@/i18n/params";
import { href, routes } from "@/lib/routes";

/**
 * /bg/byuletin/otpisvane?token=… (the old `/newsletter/unsubscribe?token=…` in
 * mail already sent answers 308 here, token and all).
 *
 * A GET shows what would happen and changes nothing; the button is a POST. Mail
 * scanners and link previewers open every URL in a message, so a link that
 * unsubscribed on GET would unsubscribe people who never clicked.
 *
 * What a visitor can learn is bounded: with a valid token, their own address,
 * masked; with anything else, one calm sentence that does not say whether the
 * token never existed or was already used. `?status=` carries only the result
 * of the POST and no data.
 *
 * `noindex` here, and a `same-origin` referrer policy so the token in the URL is
 * not handed to anything off the site. (Not `no-referrer`: that makes the
 * browser send `Origin: null` on the POST below, and Next.js refuses a server
 * action whose origin it cannot match.) Nothing is added to robots.txt: a
 * Disallow line would only advertise the path.
 */
export const metadata: Metadata = {
  title: "Отписване от бюлетина",
  robots: { index: false, follow: false },
  referrer: "same-origin",
};
export const dynamic = "force-dynamic";

type Params = { token?: string | string[]; status?: string | string[] };

const one = (value: string | string[] | undefined): string | undefined =>
  typeof value === "string" ? value : undefined;

function Shell({
  locale,
  title,
  children,
}: {
  locale: Locale;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="shell max-w-xl py-16 md:py-24">
      <h1 className="font-display text-3xl font-semibold text-ink-900">{title}</h1>
      <div className="mt-4 space-y-4 text-base text-ink-700">{children}</div>
      <p className="mt-8 text-sm">
        <Link
          href={href(locale, routes.home)}
          className="text-pine-700 underline underline-offset-4"
        >
          Към началото
        </Link>
      </p>
    </div>
  );
}

export default async function UnsubscribePage({
  params: routeParams,
  searchParams,
}: {
  params: Promise<LangParams>;
  searchParams: Promise<Params>;
}) {
  const locale = await localeFrom(routeParams);
  const params = await searchParams;
  const status = one(params.status);

  if (status === "done") {
    return (
      <Shell locale={locale} title="Отписахте се">
        <p>
          Няма да ви изпращаме повече бюлетина. Може да се запишете отново от долната част на сайта.
        </p>
      </Shell>
    );
  }

  if (status === "busy") {
    return (
      <Shell locale={locale} title="Опитайте отново след малко">
        <p>
          В момента не можем да обработим заявката. Върнете се към писмото и натиснете връзката
          отново след няколко минути.
        </p>
      </Shell>
    );
  }

  const token = one(params.token);
  const lookup = status === "invalid" ? ({ state: "unusable" } as const) : await lookupToken(token);

  if (lookup.state === "unusable" || !token) {
    return (
      <Shell locale={locale} title="Връзката не е активна">
        <p>Тази връзка не е валидна или вече е използвана.</p>
        <p>
          Ако още получавате писма от нас, които не искате, пишете ни на{" "}
          <a
            href={`mailto:${siteConfig.contact.email}`}
            className="text-pine-700 underline underline-offset-4"
          >
            {siteConfig.contact.email}
          </a>{" "}
          и ще ви отпишем.
        </p>
      </Shell>
    );
  }

  return (
    <Shell locale={locale} title="Отписване от бюлетина">
      <p>
        Адрес: <strong className="font-semibold text-ink-900">{maskEmail(lookup.email)}</strong>
      </p>
      <p>
        Ще спрем да ви изпращаме бюлетина на този адрес. Не се променя нищо, докато не потвърдите.
      </p>
      <form action={unsubscribe}>
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="locale" value={locale} />
        <Button type="submit" size="lg" className="w-full sm:w-auto">
          Отпиши ме
        </Button>
      </form>
    </Shell>
  );
}
