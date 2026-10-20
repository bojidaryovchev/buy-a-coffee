import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { composeNewsletterEmail } from "@/emails/newsletter";
import { CampaignAutoRefresh, ResumeForm } from "@/components/admin/campaign-progress";
import { NewsletterComposer } from "@/components/admin/newsletter-composer";
import { listCapitalisedNames } from "@/lib/catalog/queries";
import { MAIL_FROM, NOTIFY_TO } from "@/lib/mail/identity";
import { deleteNewsletter, duplicateNewsletter } from "@/lib/newsletter/actions";
import {
  countActiveSubscribers,
  deliveryCounts,
  getCampaign,
  draftVersion,
  isResumable,
  isStale,
  listDeliveries,
} from "@/lib/newsletter/campaigns";
import { unsubscribeUrl } from "@/lib/newsletter/links";
import { campaignFiles, campaignSnapshot } from "@/lib/newsletter/product-blocks";
import { dayWords, lastDay, periodMonthName } from "@/lib/newsletter/sofia";
import { lastLetterStart, promotionDays } from "@/lib/newsletter/template-data";
import {
  CAMPAIGN_STATUS_LABEL,
  CAMPAIGN_STATUS_TONE,
  DELIVERY_STATUS_LABEL,
  DELIVERY_STATUS_TONE,
  subscribersWord,
  utcStamp,
} from "@/lib/newsletter/status";

export const metadata: Metadata = { title: "Бюлетин" };
export const dynamic = "force-dynamic";
/**
 * The send runs in `after()` of the action this page's buttons call, and an
 * action has the lifetime of the page it is used on. Five minutes covers the
 * sender's own budget (`runCampaign`, 200 s of requests) with room to finish
 * writing; a list too long for one run stops cleanly and is continued with a
 * press.
 */
export const maxDuration = 300;

/**
 * One newsletter. A draft opens in the composer; anything else is the record
 * of the send — progress while it goes, then who got it, who did not and why,
 * and the message exactly as it went out. Either can be copied into a new
 * draft ("Дублирай"); a draft can be thrown away, after a second press.
 */

const PAGE_SIZE = 100;

type Params = { page?: string | string[] };

const SMALL_BUTTON =
  "inline-flex min-h-11 items-center rounded-sm border border-line-strong px-3 py-1.5 text-sm font-medium whitespace-nowrap text-ink-700 transition-colors hover:border-ink-300 hover:text-ink-900";

function DuplicateForm({ id }: { id: string }) {
  return (
    <form action={duplicateNewsletter}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" className={SMALL_BUTTON}>
        Дублирай
      </button>
    </form>
  );
}

/**
 * "Изтрий черновата", behind a second press: a `<details>`, so it asks
 * without script as well as with it. The answer is the only `danger` button
 * on the page (DESIGN.md, "Buttons").
 */
function DeleteDraft({ id }: { id: string }) {
  return (
    <details className="group relative">
      <summary
        className={`${SMALL_BUTTON} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
      >
        Изтрий черновата
      </summary>
      <div className="mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-md border border-line-strong bg-paper-raised p-4 text-sm sm:absolute sm:right-0 sm:z-10">
        <p className="font-semibold text-ink-900">Да изтрием ли черновата?</p>
        <p className="mt-1 text-ink-700">
          Текстът и списъкът с продукти се губят. Качените файлове остават в хранилището.
        </p>
        <form action={deleteNewsletter} className="mt-3">
          <input type="hidden" name="id" value={id} />
          <button
            type="submit"
            className="inline-flex min-h-11 items-center rounded-sm bg-critical px-4 py-2 text-sm font-semibold whitespace-nowrap text-paper transition-colors hover:bg-critical/90"
          >
            Да, изтрий
          </button>
        </form>
      </div>
    </details>
  );
}

/** Where a draft came from, in a line: the month's letter, a promotion's, or nothing to say. */
function originLine(
  campaign: { template: string | null; autoPeriod: string | null },
  promotion: { name: string; label: string | null; endsAt: Date } | null,
): string | null {
  if (campaign.template === "monthly") {
    return campaign.autoPeriod
      ? `Месечният бюлетин за ${periodMonthName(campaign.autoPeriod)}, подготвен автоматично: прегледайте текста и продуктите, махнете каквото не искате и го изпратете.`
      : "Месечен бюлетин: новото в магазина и промоциите.";
  }
  if (campaign.template === "promotion") {
    return promotion
      ? `Обява за промоцията „${promotion.name}“${promotion.label ? ` (за клиентите: „${promotion.label}“)` : ""}, до ${dayWords(lastDay(promotion.endsAt))}.`
      : "Обява за промоция, която вече я няма.";
  }
  return null;
}

function BackLink() {
  return (
    <Link
      href="/admin/byuletin"
      className="inline-flex min-h-11 items-center text-sm text-pine-700 underline underline-offset-4 lg:min-h-7"
    >
      ← Бюлетин
    </Link>
  );
}

export default async function AdminCampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Params>;
}) {
  const { id } = await params;
  const campaign = await getCampaign(id);
  if (!campaign) notFound();

  if (campaign.status === "draft") {
    const [activeCount, capitalised, lastLetter, promotion] = await Promise.all([
      countActiveSubscribers(),
      listCapitalisedNames(),
      lastLetterStart(),
      promotionDays(campaign.promotionId),
    ]);
    const origin = originLine(campaign, promotion);
    return (
      <>
        <BackLink />
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-semibold text-ink-900">
              {campaign.subject || "Нов бюлетин"}
            </h1>
            {origin && <p className="mt-1 max-w-prose text-base text-ink-700">{origin}</p>}
            <p className="mt-1 max-w-prose text-base text-ink-500">
              Формата за абониране обещава писмо веднъж месечно: новите кафета и текущите промоции.
              Пазете това обещание.
            </p>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            <DuplicateForm id={campaign.id} />
            <DeleteDraft id={campaign.id} />
          </div>
        </div>

        <NewsletterComposer
          campaign={{
            id: campaign.id,
            version: draftVersion(campaign),
            subject: campaign.subject,
            preheader: campaign.preheader,
            body: campaign.body,
            attachments: campaignFiles(campaign.attachments),
          }}
          activeCount={activeCount}
          sender={MAIL_FROM}
          testRecipient={NOTIFY_TO || null}
          canSend={Boolean(process.env.RESEND_API_KEY)}
          canUpload={Boolean(process.env.BLOB_READ_WRITE_TOKEN)}
          capitalised={capitalised}
          lastLetterAt={lastLetter?.toISOString() ?? null}
          promotion={
            promotion
              ? {
                  startsAt: promotion.startsAt.toISOString(),
                  endsAt: promotion.endsAt.toISOString(),
                  stoppedAt: promotion.stoppedAt?.toISOString() ?? null,
                }
              : null
          }
        />
      </>
    );
  }

  const query = await searchParams;
  const requested = Number(typeof query.page === "string" ? query.page : "1");
  const counts = await deliveryCounts(campaign.id);
  const pages = Math.max(1, Math.ceil(counts.total / PAGE_SIZE));
  const page = Number.isInteger(requested) && requested >= 1 ? Math.min(requested, pages) : 1;
  const deliveries = await listDeliveries(campaign.id, { page, pageSize: PAGE_SIZE });

  const stale = isStale(campaign);
  const running = campaign.status === "sending" && !stale;
  const waiting = counts.pending + counts.sending;
  const accepted = counts.sent + counts.bounced + counts.complained;
  const answered = accepted + counts.failed + counts.skipped;
  const percent = counts.total > 0 ? Math.round((answered / counts.total) * 100) : 100;

  /* The message as it went out, drawn by the same template with a link that
     unsubscribes nobody — and with the products and prices of its snapshot,
     not today's catalog. */
  const products = campaignSnapshot(campaign.attachments);
  const { html: sentHtml } = await composeNewsletterEmail(
    {
      subject: campaign.subject,
      preheader: campaign.preheader,
      body: campaign.body,
      attachments: campaignFiles(campaign.attachments),
      products,
    },
    { unsubscribeUrl: unsubscribeUrl("pregled") },
  );

  const stats: { label: string; value: number }[] = [
    { label: "Получатели", value: campaign.recipientCount },
    { label: "Изпратени", value: accepted },
    { label: "Неуспешни", value: counts.failed },
    { label: "Пропуснати", value: counts.skipped },
    { label: "Чакат", value: waiting },
    /* Known only after the send, by webhook; shown once there is one. */
    ...(counts.bounced > 0 ? [{ label: "Върнати", value: counts.bounced }] : []),
    ...(counts.complained > 0 ? [{ label: "Оплаквания", value: counts.complained }] : []),
  ];

  return (
    <>
      <BackLink />
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold text-ink-900">
            {campaign.subject || "Без тема"}
          </h1>
          <p className="mt-1 text-sm text-ink-500 tabular-nums">
            {campaign.startedAt && <>Започнат {utcStamp(campaign.startedAt)} UTC</>}
            {campaign.sentAt && <> · приключен {utcStamp(campaign.sentAt)} UTC</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`rounded-sm px-2 py-1 text-sm font-semibold ${
              stale ? CAMPAIGN_STATUS_TONE.partial : CAMPAIGN_STATUS_TONE[campaign.status]
            }`}
          >
            {stale ? "Прекъснат" : CAMPAIGN_STATUS_LABEL[campaign.status]}
          </span>
          <DuplicateForm id={campaign.id} />
        </div>
      </div>

      <section
        aria-labelledby="progress-title"
        className="mt-6 rounded-md border border-line bg-paper-raised p-5"
      >
        <h2 id="progress-title" className="sr-only">
          Ход на изпращането
        </h2>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
          {stats.map((stat) => (
            <div key={stat.label}>
              <dt className="text-xs text-ink-500">{stat.label}</dt>
              <dd className="text-2xl font-semibold text-ink-900 tabular-nums">{stat.value}</dd>
            </div>
          ))}
        </dl>
        <div
          role="progressbar"
          aria-label="Писма с отговор"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="mt-4 h-2 overflow-hidden rounded-xs bg-paper-sunken"
        >
          <div className="h-full bg-pine-700" style={{ width: `${percent}%` }} />
        </div>
        <p className="mt-2 text-xs text-ink-500 tabular-nums">
          {answered} от {counts.total} {subscribersWord(counts.total)} с отговор ({percent}%).
          „Изпратени“ са приетите от Resend. „Върнати“ (адресът не съществува) и „Оплаквания“
          (отбелязано като спам) идват от Resend след изпращането и отписват човека.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <CampaignAutoRefresh active={running} />
          {stale && (
            <p className="rounded-sm bg-caution-100 px-3 py-2 text-sm text-ink-900">
              Изпращането не е напредвало повече от 10 минути — процесът, който го водеше, е спрял.
              Продължете го: никой няма да получи писмото два пъти.
            </p>
          )}
          {campaign.lastError && !running && (
            <p className="rounded-sm bg-caution-100 px-3 py-2 text-sm text-ink-900">
              <span className="font-semibold text-caution">Последна грешка: </span>
              {campaign.lastError}
            </p>
          )}
          {isResumable(campaign, waiting) && (
            <ResumeForm campaignId={campaign.id} waiting={waiting} />
          )}
        </div>
      </section>

      <section aria-labelledby="deliveries-title" className="mt-8">
        <h2 id="deliveries-title" className="font-display text-xl font-semibold text-ink-900">
          Получатели
        </h2>
        <p className="mt-1 text-sm text-ink-500">
          Първо тези, които не са го получили. „Пропуснато“ — абонатът се е отписал, преди да дойде
          редът му.
        </p>
        <div className="mt-3 overflow-x-auto rounded-md border border-line bg-paper-raised">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="border-b border-line text-left text-xs tracking-wide text-ink-500 uppercase">
              <tr>
                <th className="px-4 py-3 font-medium">Имейл</th>
                <th className="px-4 py-3 font-medium">Състояние</th>
                <th className="px-4 py-3 font-medium">Изпратено (UTC)</th>
                <th className="px-4 py-3 font-medium">Бележка</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.rows.map((row) => (
                <tr key={row.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 break-all text-ink-900">{row.email}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-sm px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap ${DELIVERY_STATUS_TONE[row.status]}`}
                    >
                      {DELIVERY_STATUS_LABEL[row.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-ink-500 tabular-nums">{utcStamp(row.sentAt)}</td>
                  <td className="px-4 py-3 text-ink-700">{row.error ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <nav
            aria-label="Страници"
            className="mt-3 flex items-center justify-between gap-3 text-sm"
          >
            {page > 1 ? (
              <Link
                href={`/admin/byuletin/${campaign.id}?page=${page - 1}`}
                className="inline-flex min-h-11 items-center text-pine-700 underline underline-offset-4"
              >
                ← Предишни
              </Link>
            ) : (
              <span />
            )}
            <span className="text-ink-500 tabular-nums">
              Страница {page} от {pages}
            </span>
            {page < pages ? (
              <Link
                href={`/admin/byuletin/${campaign.id}?page=${page + 1}`}
                className="inline-flex min-h-11 items-center text-pine-700 underline underline-offset-4"
              >
                Следващи →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </section>

      <section aria-labelledby="message-title" className="mt-8">
        <h2 id="message-title" className="font-display text-xl font-semibold text-ink-900">
          Писмото
        </h2>
        <p className="mt-1 text-sm text-ink-500">
          Както е изпратено. Всяко копие носи собствената връзка за отписване на получателя.
          {products && products.blocks.length > 0 && (
            <>
              {" "}
              Продуктите и цените в него са от {utcStamp(new Date(products.resolvedAt))} UTC, когато
              започна изпращането.
            </>
          )}
        </p>
        <div className="mt-3 overflow-hidden rounded-md border border-line bg-paper">
          <iframe
            title="Изпратеният бюлетин"
            sandbox=""
            srcDoc={sentHtml}
            className="block h-[48rem] w-full border-0 bg-paper"
          />
        </div>
      </section>
    </>
  );
}
