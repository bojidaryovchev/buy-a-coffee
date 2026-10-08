import type { Metadata } from "next";
import Link from "next/link";
import {
  getSyncRun,
  lastSuccessfulSync,
  listSyncChanges,
  listSyncRuns,
  productsWithoutOwnCopy,
} from "@/lib/admin-queries";
import {
  CHANGE_TYPE_HINT,
  changeTypeLabel,
  formatAgo,
  formatDuration,
  formatStamp,
  isManualLink,
  optionalCount,
  presentRunCounts,
  runStatusLabel,
} from "@/lib/sync-display";
import {
  DEFAULT_SYNC_HEALTH_THRESHOLDS,
  SYNC_CONDITION_LABEL,
  evaluateSyncHealth,
} from "@/lib/sync-health";

export const metadata: Metadata = { title: "Синхронизация" };
export const dynamic = "force-dynamic";

/**
 * Is the catalog current, and if not, why.
 *
 * Read-only, and behind the same session as every other screen in the panel:
 * `(panel)/layout.tsx` redirects anyone not signed in before this renders, and
 * there is nothing here to submit, so there is no action that would need to
 * re-check it.
 *
 * The page asks the same pure question the daily alarm asks
 * (`evaluateSyncHealth`) rather than re-deriving "stale" for itself, so that the
 * email and the screen cannot disagree about whether something is wrong.
 *
 * The selected run travels in the query string (`?run=`), not in client state:
 * every row is a link, and the page works exactly the same without JavaScript.
 */

const STATUS_TONE: Record<string, string> = {
  succeeded: "bg-pine-100 text-pine-700",
  running: "bg-paper-sunken text-ink-500",
  partial: "bg-caution-100 text-caution",
  failed: "bg-caution-100 text-caution",
  aborted: "bg-caution-100 text-caution",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AdminSyncPage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string | string[] }>;
}) {
  const { run: requested } = await searchParams;
  const requestedId = typeof requested === "string" && UUID.test(requested) ? requested : null;

  const now = new Date();
  const [runs, lastGood, withoutCopy] = await Promise.all([
    listSyncRuns(20),
    lastSuccessfulSync(),
    productsWithoutOwnCopy(),
  ]);

  /* A run outside the twenty shown can still be opened by id; the default is the
     newest, which is the one an operator who has just been mailed wants. */
  const selected = requestedId
    ? (runs.find((r) => r.id === requestedId) ?? (await getSyncRun(requestedId)))
    : (runs[0] ?? null);
  const changes = selected ? await listSyncChanges(selected.id) : null;

  const problems = evaluateSyncHealth(runs, now);
  const maxAgeMs =
    DEFAULT_SYNC_HEALTH_THRESHOLDS.syncIntervalMs * DEFAULT_SYNC_HEALTH_THRESHOLDS.missedIntervals +
    DEFAULT_SYNC_HEALTH_THRESHOLDS.slackMs;
  const stale = !lastGood || now.getTime() - lastGood.at.getTime() > maxAgeMs;
  const extraCounts = presentRunCounts(runs);
  const hintedTypes = [...new Set((changes?.rows ?? []).map((c) => c.changeType))].filter(
    (type) => type in CHANGE_TYPE_HINT,
  );

  return (
    <>
      <div>
        <h1 className="font-display text-3xl font-semibold text-ink-900">Синхронизация</h1>
        <p className="mt-1 text-base text-ink-500">
          Как каталогът се обновява от източника и дали последният опит е минал добре.
        </p>
      </div>

      {/* Answer first: when, how long ago, and whether that is a problem. */}
      <section
        aria-labelledby="sync-now"
        className={`mt-8 rounded-md border bg-paper-raised p-5 ${
          stale || problems.length > 0 ? "border-caution" : "border-line"
        }`}
      >
        <h2 id="sync-now" className="text-sm font-semibold text-ink-900">
          Последна успешна синхронизация
        </h2>
        {lastGood ? (
          <p className="mt-1 text-2xl font-semibold text-ink-900">
            {formatAgo(lastGood.at, now)}
            <span className="ml-3 text-sm font-normal text-ink-500 tabular-nums">
              {formatStamp(lastGood.at)} UTC
            </span>
          </p>
        ) : (
          <p className="mt-1 text-2xl font-semibold text-ink-900">Още няма успешна</p>
        )}

        {stale && (
          <p className="mt-3 text-sm text-ink-700">
            <strong className="font-semibold">Каталогът е остарял.</strong> Синхронизацията се пуска
            на всеки шест часа; повече от {Math.round(maxAgeMs / 3_600_000)} часа без успешна значи,
            че планираната задача е спряла или не успява. Проверете я в хранилището (GitHub Actions)
            — планираните задачи се изключват сами след 60 дни без активност в хранилището.
          </p>
        )}

        {problems.length > 0 ? (
          <div className="mt-4">
            <p className="text-sm font-semibold text-ink-900">Какво не е наред сега</p>
            <ul className="mt-1 list-disc pl-5 text-sm text-ink-700">
              {problems.map((p) => (
                <li key={p.condition}>
                  <span className="font-medium">{SYNC_CONDITION_LABEL[p.condition]}.</span>{" "}
                  {p.summary}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-sm text-ink-500">
              Какво да направите — в „Какво да правя, когато“ по-долу.
            </p>
          </div>
        ) : (
          !stale && <p className="mt-3 text-sm text-ink-500">Нищо за отбелязване.</p>
        )}
      </section>

      <section aria-labelledby="sync-runs" className="mt-10">
        <h2 id="sync-runs" className="font-display text-xl font-semibold text-ink-900">
          Последните {runs.length || 20} изпълнения
        </h2>

        {runs.length === 0 ? (
          <p className="mt-4 rounded-md border border-dashed border-line-strong bg-paper-raised p-10 text-center text-ink-500">
            Синхронизацията още не е пускана.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-md border border-line bg-paper-raised">
            <table className="w-full min-w-[60rem] text-left text-sm">
              <caption className="sr-only">
                Последните изпълнения на синхронизацията, най-новите първи
              </caption>
              <thead className="border-b border-line text-ink-500">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Начало (UTC)
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Състояние
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Продължителност
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Нови
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Обновени
                  </th>
                  {extraCounts.map((column) => (
                    <th key={column.key} scope="col" className="px-3 py-2 text-right font-medium">
                      {column.label}
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Липсващи
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Премахнати
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Предпазител
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    <span className="sr-only">Промени</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr
                    key={r.id}
                    className={`border-b border-line last:border-0 ${
                      selected?.id === r.id ? "bg-paper-sunken" : ""
                    }`}
                  >
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                      {formatStamp(r.startedAt)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span
                        className={`rounded-sm px-1.5 py-0.5 text-xs font-semibold ${
                          STATUS_TONE[r.status] ?? "bg-paper-sunken text-ink-500"
                        }`}
                      >
                        {runStatusLabel(r.status)}
                      </span>
                      {r.dryRun && <span className="ml-2 text-xs text-ink-500">проба</span>}
                      {isManualLink(r) && (
                        <span className="ml-2 text-xs text-ink-500">ръчно свързване</span>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                      {formatDuration(r.durationMs)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.createdCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.updatedCount}</td>
                    {extraCounts.map((column) => (
                      <td key={column.key} className="px-3 py-2 text-right tabular-nums">
                        {optionalCount(r, column.key) ?? "—"}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right tabular-nums">{r.missingCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.removedCount}</td>
                    <td className="px-3 py-2 text-ink-700">
                      {r.circuitBreakerTripped ? (
                        <>
                          <span className="font-semibold">Отворен.</span>{" "}
                          {r.circuitBreakerReason ?? "Без записана причина."}
                        </>
                      ) : (
                        <span className="text-ink-500">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Link
                        href={`/admin/sinhron?run=${r.id}#promeni`}
                        aria-current={selected?.id === r.id ? "true" : undefined}
                        className="text-pine-700 underline"
                      >
                        Промени
                        <span className="sr-only"> от {formatStamp(r.startedAt)}</span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="sync-changes" id="promeni" className="mt-10 scroll-mt-6">
        <h2 id="sync-changes" className="font-display text-xl font-semibold text-ink-900">
          Какво е променено
          {selected && (
            <span className="ml-2 text-base font-normal text-ink-500 tabular-nums">
              {formatStamp(selected.startedAt)} UTC
            </span>
          )}
        </h2>

        {selected?.errorSummary && (
          <p className="mt-3 rounded-md border border-line bg-paper-raised p-4 text-sm whitespace-pre-wrap text-ink-700">
            <span className="font-semibold">Грешка: </span>
            {selected.errorSummary}
          </p>
        )}

        {!selected ? (
          <p className="mt-4 text-sm text-ink-500">Няма избрано изпълнение.</p>
        ) : changes && changes.total === 0 ? (
          <p className="mt-4 text-sm text-ink-500">
            Това изпълнение не е променило нито един продукт.
            {selected.dryRun && " (Пробно изпълнение: нищо не се записва.)"}
          </p>
        ) : (
          changes && (
            <>
              <div className="mt-4 overflow-x-auto rounded-md border border-line bg-paper-raised">
                <table className="w-full min-w-[36rem] text-left text-sm">
                  <caption className="sr-only">
                    Промените по продукти за избраното изпълнение
                  </caption>
                  <thead className="border-b border-line text-ink-500">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Промяна
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Продукт
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Полета
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {changes.rows.map((c) => (
                      <tr key={c.id} className="border-b border-line last:border-0">
                        <td className="px-3 py-2 whitespace-nowrap">
                          {changeTypeLabel(c.changeType)}
                        </td>
                        <td className="px-3 py-2">
                          {c.productName && c.productSlug ? (
                            <Link
                              href={`/products/${c.productSlug}`}
                              className="text-pine-700 underline"
                            >
                              {c.productName}
                            </Link>
                          ) : (
                            <span className="text-ink-700">
                              {c.productName ?? "(изтрит продукт)"}
                            </span>
                          )}
                          <span className="ml-2 font-mono text-xs text-ink-500">{c.sourceKey}</span>
                        </td>
                        <td className="px-3 py-2 text-ink-700">
                          {c.changeType !== "created" && c.changedFields.length > 0
                            ? c.changedFields.join(", ")
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {hintedTypes.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm text-ink-500">
                  {hintedTypes.map((type) => (
                    <li key={type}>
                      <span className="font-medium text-ink-700">{changeTypeLabel(type)}</span> —{" "}
                      {CHANGE_TYPE_HINT[type]}
                    </li>
                  ))}
                </ul>
              )}
              {changes.total > changes.rows.length && (
                <p className="mt-2 text-sm text-ink-500">
                  Показани са {changes.rows.length} от {changes.total} промени.
                </p>
              )}
            </>
          )
        )}
      </section>

      <section aria-labelledby="sync-copy" className="mt-10">
        <h2 id="sync-copy" className="font-display text-xl font-semibold text-ink-900">
          Продукти без собствено описание
        </h2>
        <p className="mt-1 text-sm text-ink-700">
          <span className="text-2xl font-semibold text-ink-900 tabular-nums">
            {withoutCopy.total}
          </span>{" "}
          активни продукта още нямат собствено кратко описание — сайтът за тях няма какво да покаже
          освен текста на източника.
        </p>
        {withoutCopy.sample.length > 0 && (
          <>
            <ul className="mt-3 columns-1 gap-6 text-sm sm:columns-2">
              {withoutCopy.sample.map((p) => (
                <li key={p.id} className="py-0.5">
                  <Link href={`/products/${p.slug}`} className="text-pine-700 underline">
                    {p.name}
                  </Link>
                </li>
              ))}
            </ul>
            {withoutCopy.total > withoutCopy.sample.length && (
              <p className="mt-2 text-sm text-ink-500">
                и още {withoutCopy.total - withoutCopy.sample.length}.
              </p>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="sync-help" className="mt-10 mb-4">
        <h2 id="sync-help" className="font-display text-xl font-semibold text-ink-900">
          Какво да правя, когато
        </h2>
        <dl className="mt-4 flex flex-col gap-3">
          <div className="rounded-md border border-line bg-paper-raised p-4">
            <dt className="font-semibold text-ink-900">Предпазителят е отворен</dt>
            <dd className="mt-1 text-sm leading-relaxed text-ink-700">
              Каталогът е запазен и нищо не е премахнато — клиентите виждат последното добро
              състояние, така че няма спешност за тях. Прочетете причината в колоната „Предпазител“,
              преди да направите нещо. Ако източникът наистина е намалял, вдигнете{" "}
              <code className="font-mono">SYNC_BREAKER_MAX_DISAPPEARED_RATIO</code> за едно
              изпълнение или изчакайте броячът на липсващите продукти да нарасне сам.
            </dd>
          </div>
          <div className="rounded-md border border-line bg-paper-raised p-4">
            <dt className="font-semibold text-ink-900">Каталогът идва от резервния източник</dt>
            <dd className="mt-1 text-sm leading-relaxed text-ink-700">
              Това значи, че <code className="font-mono">catalog_source</code> е минал от{" "}
              <code className="font-mono">filter_init</code> на{" "}
              <code className="font-mono">listing_html</code>: структурираните данни на източника са
              изчезнали и синхронизацията се държи на резервния разчитач. Възстановете образците
              (fixtures), пуснете тестовете на разчитача, за да видите какво точно се е променило, и
              поправете разчитача — не теста.
            </dd>
          </div>
          <div className="rounded-md border border-line bg-paper-raised p-4">
            <dt className="font-semibold text-ink-900">Сигурността на разчитането пада</dt>
            <dd className="mt-1 text-sm leading-relaxed text-ink-700">
              Същият сигнал като предходния, но по-рано: страниците на източника вече не се разчитат
              уверено. Действието е същото — образци, тестове на разчитача, поправка на разчитача.
            </dd>
          </div>
        </dl>
      </section>
    </>
  );
}
