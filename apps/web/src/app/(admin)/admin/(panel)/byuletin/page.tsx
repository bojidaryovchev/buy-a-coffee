import type { Metadata } from "next";
import { absoluteUrl, siteConfig } from "@/config/site";
import { listSubscribers } from "@/lib/admin-queries";
import { unsubscribeSubscriber } from "@/lib/admin-actions";
import { consentSourceLabel } from "@/lib/forms/consent";
import { newsletterSyncStatus, PROPERTY_KEYS, PROPERTY_PREFIX } from "@/lib/newsletter/sync";

export const metadata: Metadata = { title: "Бюлетин" };
export const dynamic = "force-dynamic";

/**
 * Newsletter subscribers.
 *
 * A list, the consent behind every row, and one action — and deliberately no
 * composer. Sending happens in Resend's Broadcasts, which already has what a
 * newsletter needs and this panel would build badly: unsubscribe links in every
 * message, bounce and complaint handling, suppression, and a sending reputation
 * kept apart from the order replies that actually matter. Every row written
 * here is mirrored there as a contact (`lib/newsletter/sync.ts`), and an
 * unsubscribe made there comes back (`lib/newsletter/webhook.ts`).
 *
 * What this screen is for is what Resend cannot do: seeing who is on the list
 * and how each person agreed, and taking somebody off it when they ask by phone
 * or in a reply rather than by clicking a link. Above the list, how to send,
 * and which of the variables the mirror needs are set — so a half-configured
 * sync shows here, not only in the logs.
 *
 * `consentSource` and `consentAt` are shown because they are the record that
 * makes acting on a subscription lawful: every row answers "who agreed, when,
 * and how". Unsubscribing stamps a date rather than deleting the row, so that
 * record survives the unsubscribe — see `unsubscribeSubscriber`.
 */

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded-sm bg-paper-sunken px-1 py-0.5 font-mono text-[0.9em] text-ink-900 wrap-anywhere">
      {children}
    </code>
  );
}

export default async function AdminNewsletterPage() {
  const subscribers = await listSubscribers();
  const active = subscribers.filter((s) => !s.unsubscribedAt);
  const sync = newsletterSyncStatus();
  const brand = siteConfig.name;

  /* What a missing variable costs, in the owner's terms rather than ours. */
  const checks: { ok: boolean; name: string; what: string }[] = [
    {
      ok: sync.apiKey,
      name: "RESEND_API_KEY",
      what: "без него нищо не стига до Resend",
    },
    {
      ok: sync.segment,
      name: "RESEND_NEWSLETTER_SEGMENT_ID",
      what: "сегментът, в който влизат абонатите; без него не се синхронизират",
    },
    {
      ok: sync.topic,
      name: "RESEND_NEWSLETTER_TOPIC_ID",
      what: `темата на ${brand} — кой е абониран за този сайт; без нея не се синхронизират`,
    },
    {
      ok: sync.webhook,
      name: "RESEND_CONTACTS_WEBHOOK_SECRET",
      what: "отписванията, направени в Resend, се връщат тук",
    },
  ];

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold text-ink-900">Бюлетин</h1>
          <p className="mt-1 max-w-prose text-base text-ink-500">
            Списъкът и как всеки е дал съгласие. Самият бюлетин се пише и изпраща от Resend.
            Отписването се записва с дата, а не изтрива съгласието.
          </p>
        </div>
        <p className="text-sm">
          <span className="font-semibold tabular-nums">{active.length}</span>{" "}
          <span className="text-ink-500">активни</span>
        </p>
      </div>

      <section className="mt-8 rounded-md border border-line bg-paper-raised p-5">
        <h2 className="font-display text-xl font-semibold text-ink-900">Как се изпраща бюлетин</h2>
        <ol className="mt-3 max-w-prose list-decimal space-y-2 pl-5 text-sm leading-relaxed text-ink-700">
          <li>
            В Resend отворете <strong className="text-ink-900">Broadcasts</strong> и създайте нов
            бюлетин. Оттук не се изпраща нищо.
          </li>
          <li>
            Изпратете го до сегмента на бюлетина (номерът е в{" "}
            <Code>RESEND_NEWSLETTER_SEGMENT_ID</Code>){" "}
            <strong className="text-ink-900">и задължително до темата на {brand}</strong> (номерът е
            в <Code>RESEND_NEWSLETTER_TOPIC_ID</Code>). Всеки, който се запише — от формата в
            долната част на сайта, с отметка при поръчка, в количката или във формата за контакт,
            или добавен от вас от заявка или съобщение — влиза и в двете автоматично.
          </li>
          <li>
            Защо темата е задължителна: Resend акаунтът е общ за четирите сайта — {brand},
            Buy-a-Vend, Rent-a-Vend и Sell-a-Vend — и един човек може да е абонат на няколко от тях.
            Темата е това, което казва кой иска бюлетина на <em>този</em> сайт. Бюлетин без тема
            отива и до хора, които са се отписали от нас или никога не са се записвали тук.
          </li>
          <li>
            <strong className="text-ink-900">
              Всеки бюлетин трябва да съдържа връзката за отписване на Resend:{" "}
              <Code>{"{{{RESEND_UNSUBSCRIBE_URL}}}"}</Code>.
            </strong>{" "}
            Без нея не изпращайте — отписването с едно натискане е задължително. В бюлетин, изпратен
            до темата, връзката отваря настройките на Resend, където човекът се отписва само от
            темата на {brand} и продължава да получава писмата на другите три сайта. Отписаният се
            отбелязва тук, с дата. Ако избере „отписване от всичко“, се отписва и тук — и от другите
            сайтове.
          </li>
          <li>
            По желание, втора връзка към нашата страница за отписване — тя също отписва само от
            темата на {brand}: <Code>{`{{{contact.${PROPERTY_KEYS.unsubscribeUrl}}}}`}</Code>. Не
            замества тази на Resend.
          </li>
          <li>
            Всички свойства на този сайт в Resend започват с <Code>{PROPERTY_PREFIX}</Code>.
            Акаунтът е общ и свойствата също: без представката другите сайтове биха записвали върху
            нашите. Не използвайте в бюлетина свойства без нея.
          </li>
          <li>
            Формата обещава кратко писмо, когато се появи ново кафе, и{" "}
            <strong className="text-ink-900">не повече от веднъж месечно</strong>. Пазете това
            обещание.
          </li>
        </ol>

        <h3 className="mt-5 text-sm font-semibold text-ink-900">Еднократна настройка в Resend</h3>
        <ul className="mt-2 max-w-prose list-disc space-y-1 pl-5 text-sm leading-relaxed text-ink-500">
          <li>
            Тема (Topics) за {brand} с абонамент по подразбиране{" "}
            <strong className="text-ink-900">Opt-out</strong> — бюлетинът стига само до хората,
            записани от този сайт. Това не може да се промени след създаването. Видимост{" "}
            <strong className="text-ink-900">Private</strong>, за да не я виждат абонатите на
            другите три сайта в своите настройки. Номерът ѝ —{" "}
            <Code>RESEND_NEWSLETTER_TOPIC_ID</Code>.
          </li>
          <li>
            Сегмент за бюлетина на {brand}. Номерът му — <Code>RESEND_NEWSLETTER_SEGMENT_ID</Code>.
          </li>
          <li>
            Свойството <Code>{PROPERTY_KEYS.unsubscribeUrl}</Code>, тип string (Audience →
            Properties). Докато го няма, абонатите се добавят без него и втората връзка остава
            празна.
          </li>
          <li>
            Уебхук (Webhooks) към <Code>{absoluteUrl("/api/resend/contacts")}</Code> за{" "}
            <Code>contact.updated</Code> и <Code>contact.deleted</Code>. Тайната, която Resend
            показва — <Code>RESEND_CONTACTS_WEBHOOK_SECRET</Code>. Отделен е от уебхука за входящата
            поща и има своя тайна.
          </li>
        </ul>
        <p className="mt-2 max-w-prose text-sm text-ink-500">
          Отписването оттук или от нашата страница никога не спира писмата на другите сайтове:
          изключва се само темата на {brand}. Човек, който в Resend се е отписал „от всичко“, не
          получава бюлетина дори да се запише отново тук — това може да се върне само от Resend.
        </p>

        <h3 className="mt-5 text-sm font-semibold text-ink-900">Връзка с Resend</h3>
        <ul className="mt-2 space-y-1.5 text-sm">
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
      </section>

      {subscribers.length === 0 ? (
        <p className="mt-10 rounded-md border border-dashed border-line-strong bg-paper-raised p-10 text-center text-ink-500">
          Още няма абонати.
        </p>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-md border border-line bg-paper-raised">
          <table className="w-full min-w-[48rem] text-sm">
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
                  <td className="px-4 py-3 text-ink-900">{subscriber.email}</td>
                  <td className="px-4 py-3 text-ink-500 tabular-nums">
                    {subscriber.consentAt.toISOString().slice(0, 16).replace("T", " ")}
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
      )}
    </>
  );
}
