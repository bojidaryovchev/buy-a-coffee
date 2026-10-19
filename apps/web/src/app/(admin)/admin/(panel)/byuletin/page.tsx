import type { Metadata } from "next";
import Link from "next/link";
import { absoluteUrl, siteConfig } from "@/config/site";
import { unsubscribeSubscriber } from "@/lib/admin-actions";
import { consentSourceLabel } from "@/lib/forms/consent";
import { ResyncForm } from "@/components/admin/resync-form";
import { createNewsletter } from "@/lib/newsletter/actions";
import {
  isStale,
  listCampaigns,
  listSubscribersPage,
  subscriberCounts,
  type CampaignRow,
} from "@/lib/newsletter/campaigns";
import {
  CAMPAIGN_STATUS_LABEL,
  CAMPAIGN_STATUS_TONE,
  subscribersWord,
  utcStamp,
} from "@/lib/newsletter/status";
import { newsletterSyncStatus, PROPERTY_KEYS, PROPERTY_PREFIX } from "@/lib/newsletter/sync";

export const metadata: Metadata = { title: "Бюлетин" };
export const dynamic = "force-dynamic";
/* "Копирай списъка в Resend" runs in the request, for up to 200 s
   (`resync.ts`); an action has the lifetime of the page it is used on. */
export const maxDuration = 300;

/**
 * The newsletter: the list, and what has been sent to it.
 *
 * The owner writes and sends from here (`Нов бюлетин` → the composer at
 * `/admin/byuletin/[id]`). It used to send from Resend's Broadcasts, with this
 * screen explaining how; sending from our own panel means each reader's own
 * unsubscribe link and one-click header, our table as the only list, and a
 * record of every copy (`lib/newsletter/send.ts` says why that matters).
 *
 * The list is paged, not capped like the panel's other lists: it is the one
 * that is exported and sent to, where a silent "first 200" would be a wrong
 * answer. `consentSource` and `consentAt` are shown because they are the
 * record that makes mailing somebody lawful; unsubscribing stamps a date and
 * keeps the row — see `unsubscribeSubscriber`.
 *
 * Resend holds a copy of the list (`lib/newsletter/sync.ts`) for its own
 * pages, which is where an unsubscribe made in Resend comes from; the send
 * itself asks only this table. The copy's configuration and its repair
 * ("Копирай списъка в Resend") are at the bottom, folded.
 */

const PAGE_SIZE = 100;

type Params = { page?: string | string[]; vsichki?: string | string[] };

const one = (value: string | string[] | undefined): string | undefined =>
  typeof value === "string" ? value : undefined;

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded-sm bg-paper-sunken px-1 py-0.5 font-mono text-[0.9em] text-ink-900 wrap-anywhere">
      {children}
    </code>
  );
}

function campaignLine(campaign: CampaignRow): string {
  if (campaign.status === "draft") return `Чернова · променена ${utcStamp(campaign.updatedAt)}`;
  const parts = [
    `${campaign.sentCount} от ${campaign.recipientCount} изпратени`,
    ...(campaign.failedCount > 0 ? [`${campaign.failedCount} неуспешни`] : []),
    utcStamp(campaign.sentAt ?? campaign.startedAt ?? campaign.updatedAt),
  ];
  return parts.join(" · ");
}

export default async function AdminNewsletterPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  const everybody = one(params.vsichki) === "1";
  const requested = Number(one(params.page) ?? "1");

  const [counts, campaigns] = await Promise.all([subscriberCounts(), listCampaigns()]);
  const listed = everybody ? counts.active + counts.unsubscribed : counts.active;
  const pages = Math.max(1, Math.ceil(listed / PAGE_SIZE));
  const page = Number.isInteger(requested) && requested >= 1 ? Math.min(requested, pages) : 1;
  const subscribers = await listSubscribersPage({
    page,
    pageSize: PAGE_SIZE,
    includeUnsubscribed: everybody,
  });

  const sync = newsletterSyncStatus();
  const brand = siteConfig.name;
  const pageHref = (target: number) =>
    `/admin/byuletin?${new URLSearchParams({
      ...(everybody ? { vsichki: "1" } : {}),
      ...(target > 1 ? { page: String(target) } : {}),
    }).toString()}#abonati`;

  /* What a missing variable costs, in the owner's terms rather than ours. */
  const checks: { ok: boolean; name: string; what: string }[] = [
    { ok: sync.apiKey, name: "RESEND_API_KEY", what: "без него нищо не се изпраща" },
    {
      ok: sync.topic,
      name: "RESEND_NEWSLETTER_TOPIC_ID",
      what: `темата на ${brand} в Resend, която копието на списъка следва; без нея нищо не се копира`,
    },
    {
      ok: sync.segment,
      name: "RESEND_NEWSLETTER_SEGMENT_ID",
      what: "по избор: сегмент, в който се копират и абонатите",
    },
    {
      ok: sync.webhook,
      name: "RESEND_CONTACTS_WEBHOOK_SECRET",
      what: "отписванията в Resend, върнатите писма и оплакванията се връщат тук",
    },
    {
      ok: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
      name: "BLOB_READ_WRITE_TOKEN",
      what: "качването на снимки и файлове към бюлетина",
    },
  ];

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold text-ink-900">Бюлетин</h1>
          <p className="mt-1 max-w-prose text-base text-ink-500">
            Бюлетините се пишат и изпращат оттук. По-долу е списъкът и как всеки е дал съгласие;
            отписването се записва с дата и не изтрива съгласието.
          </p>
        </div>
        <p className="text-sm">
          <span className="font-semibold tabular-nums">{counts.active}</span>{" "}
          <span className="text-ink-500">активни</span>
          <span className="text-ink-300"> · </span>
          <span className="font-semibold tabular-nums">{counts.unsubscribed}</span>{" "}
          <span className="text-ink-500">отписани</span>
        </p>
      </div>

      <section aria-labelledby="campaigns-title" className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="campaigns-title" className="font-display text-xl font-semibold text-ink-900">
            Бюлетини
          </h2>
          <form action={createNewsletter}>
            <button
              type="submit"
              className="inline-flex min-h-11 items-center rounded-sm bg-pine-900 px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-pine-700"
            >
              Нов бюлетин
            </button>
          </form>
        </div>

        {campaigns.length === 0 ? (
          <p className="mt-4 rounded-md border border-dashed border-line-strong bg-paper-raised p-8 text-center text-ink-500">
            Още няма бюлетини. „Нов бюлетин“ отваря празна чернова.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {campaigns.map((campaign) => {
              const stale = isStale(campaign);
              return (
                <li key={campaign.id}>
                  <Link
                    href={`/admin/byuletin/${campaign.id}`}
                    className="block rounded-md border border-line bg-paper-raised p-4 transition-colors hover:border-ink-300"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                      <p className="font-semibold text-ink-900">
                        {campaign.subject || "Без тема"}
                        <span
                          className={`ml-2 rounded-sm px-1.5 py-0.5 align-middle text-xs font-semibold ${
                            stale
                              ? CAMPAIGN_STATUS_TONE.partial
                              : CAMPAIGN_STATUS_TONE[campaign.status]
                          }`}
                        >
                          {stale ? "Прекъснат" : CAMPAIGN_STATUS_LABEL[campaign.status]}
                        </span>
                      </p>
                      <p className="text-sm text-ink-500 tabular-nums">{campaignLine(campaign)}</p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="abonati" className="mt-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="abonati" className="font-display text-xl font-semibold text-ink-900">
            Абонати
          </h2>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <Link
              href={everybody ? "/admin/byuletin#abonati" : "/admin/byuletin?vsichki=1#abonati"}
              className="inline-flex min-h-11 items-center text-pine-700 underline underline-offset-4 lg:min-h-7"
            >
              {everybody ? "Само активните" : "Покажи и отписаните"}
            </Link>
            {/* Plain links to a route that answers with a file: no client code. */}
            <a
              href="/admin/byuletin/abonati.csv"
              className="inline-flex min-h-11 items-center text-pine-700 underline underline-offset-4 lg:min-h-7"
            >
              CSV на активните
            </a>
            <a
              href="/admin/byuletin/abonati.csv?vsichki=1"
              className="inline-flex min-h-11 items-center text-pine-700 underline underline-offset-4 lg:min-h-7"
            >
              CSV на всички
            </a>
          </p>
        </div>

        {listed === 0 ? (
          <p className="mt-4 rounded-md border border-dashed border-line-strong bg-paper-raised p-10 text-center text-ink-500">
            Още няма абонати.
          </p>
        ) : (
          <>
            <div className="mt-4 overflow-x-auto rounded-md border border-line bg-paper-raised">
              <table className="w-full min-w-[48rem] text-sm">
                <caption className="sr-only">
                  {everybody ? "Всички абонати" : "Активни абонати"}, страница {page} от {pages}
                </caption>
                <thead className="border-b border-line text-left text-xs tracking-wide text-ink-500 uppercase">
                  <tr>
                    <th className="px-4 py-3 font-medium">Имейл</th>
                    <th className="px-4 py-3 font-medium">Съгласие (UTC)</th>
                    <th className="px-4 py-3 font-medium">Как е дадено</th>
                    <th className="px-4 py-3 font-medium">Състояние</th>
                  </tr>
                </thead>
                <tbody>
                  {subscribers.map((subscriber) => (
                    <tr key={subscriber.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-3 break-all text-ink-900">{subscriber.email}</td>
                      <td className="px-4 py-3 text-ink-500 tabular-nums">
                        {utcStamp(subscriber.consentAt)}
                      </td>
                      <td className="px-4 py-3 text-ink-700">
                        {consentSourceLabel(subscriber.consentSource)}
                      </td>
                      <td className="px-4 py-3">
                        {subscriber.unsubscribedAt ? (
                          <span className="text-ink-500">
                            отписан {subscriber.unsubscribedAt.toISOString().slice(0, 10)}
                          </span>
                        ) : (
                          <form action={unsubscribeSubscriber}>
                            <input type="hidden" name="id" value={subscriber.id} />
                            <button
                              type="submit"
                              className="min-h-11 rounded-sm border border-line-strong px-3 py-1.5 text-sm font-medium text-ink-500 transition-colors hover:border-ink-300 hover:text-ink-900"
                            >
                              Отпиши
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {pages > 1 && (
              <nav
                aria-label="Страници на списъка"
                className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm"
              >
                {page > 1 ? (
                  <Link
                    href={pageHref(page - 1)}
                    className="inline-flex min-h-11 items-center text-pine-700 underline underline-offset-4"
                  >
                    ← По-новите
                  </Link>
                ) : (
                  <span />
                )}
                <span className="text-ink-500 tabular-nums">
                  Страница {page} от {pages} · {listed} {subscribersWord(listed)}
                </span>
                {page < pages ? (
                  <Link
                    href={pageHref(page + 1)}
                    className="inline-flex min-h-11 items-center text-pine-700 underline underline-offset-4"
                  >
                    По-старите →
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            )}
          </>
        )}
      </section>

      <details className="mt-10 rounded-md border border-line bg-paper-raised p-5">
        <summary className="cursor-pointer font-display text-lg font-semibold text-ink-900">
          Връзка с Resend
        </summary>
        <ul className="mt-3 space-y-1.5 text-sm">
          {checks.map((check) => (
            <li key={check.name} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span
                className={`rounded-sm px-1.5 py-0.5 text-xs font-semibold ${
                  check.ok ? "bg-pine-100 text-pine-700" : "bg-caution-100 text-caution"
                }`}
              >
                {check.ok ? "Настроено" : "Липсва"}
              </span>
              <Code>{check.name}</Code>
              <span className="text-ink-500">— {check.what}</span>
            </li>
          ))}
        </ul>

        <h3 className="mt-5 text-sm font-semibold text-ink-900">Кой получава бюлетина</h3>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-700">
          Тукашният списък, и само той: бюлетинът не пита Resend кой е абониран. Отписванията стигат
          до него оттук, с бутона в писмото и — чрез уебхука — от страниците на Resend; върнатите
          писма и оплакванията също отписват човека. Копието на списъка в Resend се пази за неговите
          страници. Resend акаунтът е общ за четирите сайта — {brand}, Buy-a-Vend, Rent-a-Vend и
          Sell-a-Vend — и отписването от {brand} изключва само темата на {brand}, без да спира
          писмата на другите три сайта.
        </p>

        <h3 className="mt-5 text-sm font-semibold text-ink-900">Копие на списъка в Resend</h3>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-500">
          Всеки нов абонат се копира в Resend автоматично. Ако някое копиране не е успяло (или
          абонатите са отпреди темата), това ги копира всички отново.
        </p>
        <ResyncForm disabled={!sync.apiKey || !sync.topic} />

        <h3 className="mt-5 text-sm font-semibold text-ink-900">Еднократна настройка в Resend</h3>
        <ul className="mt-2 max-w-prose list-disc space-y-1 pl-5 text-sm leading-relaxed text-ink-500">
          <li>
            Тема (Topics) за {brand} с абонамент по подразбиране{" "}
            <strong className="text-ink-900">Opt-out</strong> и видимост{" "}
            <strong className="text-ink-900">Private</strong>. Номерът ѝ —{" "}
            <Code>RESEND_NEWSLETTER_TOPIC_ID</Code>.
          </li>
          <li>
            По избор, сегмент за бюлетина на {brand}. Номерът му —{" "}
            <Code>RESEND_NEWSLETTER_SEGMENT_ID</Code>.
          </li>
          <li>
            Свойството <Code>{PROPERTY_KEYS.unsubscribeUrl}</Code>, тип string (Audience →
            Properties). Всички свойства на този сайт започват с <Code>{PROPERTY_PREFIX}</Code>,
            защото акаунтът е общ.
          </li>
          <li>
            Уебхук (Webhooks) към <Code>{absoluteUrl("/api/resend/contacts")}</Code> за{" "}
            <Code>contact.updated</Code>, <Code>contact.topics.updated</Code>,{" "}
            <Code>contact.deleted</Code>, <Code>email.bounced</Code> и <Code>email.complained</Code>
            . Тайната му — <Code>RESEND_CONTACTS_WEBHOOK_SECRET</Code>.
          </li>
        </ul>
      </details>
    </>
  );
}
