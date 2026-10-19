import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/primitives";
import { LABEL_CLASS, TEXTAREA_CLASS } from "@/components/forms/field-styles";
import { DEFAULT_LOCALE } from "@/i18n/config";
import { productHref } from "@/lib/routes";
import { COPY_GIVE_UP_AFTER, type ResearchRow, loadCopyReview } from "@/lib/copy-review";
import {
  applyResearchedPack,
  clearPackOverride,
  requestNewCopy,
  retryProduct,
  saveEditedCopy,
} from "@/lib/copy-review-actions";
import { formatAgo } from "@/lib/sync-display";

export const metadata: Metadata = { title: "Текстове" };
export const dynamic = "force-dynamic";

/**
 * The catalog copywriter's work, for the owner to check.
 *
 * Three questions, in the order they need an answer: is a researched pack
 * size waiting for a decision; which products could the copywriter not
 * handle; and what did it write lately. Every action is a plain form, so the
 * screen works without JavaScript like the rest of the panel.
 */

const VERDICT_LABEL: Record<string, string> = {
  confirmed: "потвърден",
  corrected: "поправен",
  inconclusive: "неясен",
};

const UNIT_LABEL: Record<string, string> = { g: "г", ml: "мл", pc: "бр." };

const CONFIDENCE_LABEL: Record<string, string> = {
  high: "висока",
  medium: "средна",
  low: "ниска",
};

/** The facts research checks, as the skill names them. */
const FIELD_LABEL: Record<string, string> = {
  arabicaPercent: "Арабика",
  origin: "Произход",
  roast: "Изпичане",
  intensity: "Интензивност",
  compatibility: "Съвместимост",
  decaf: "Без кофеин",
  ingredients: "Състав",
  other: "Друго",
};

function packText(value: string | number, unit: string): string {
  const number = Number(value);
  const shown = Number.isFinite(number) ? String(Number(number.toFixed(4))) : String(value);
  return `${shown} ${UNIT_LABEL[unit] ?? unit}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function Sources({ urls }: { urls: readonly string[] }) {
  if (urls.length === 0) return null;
  return (
    <span className="text-ink-500">
      {" "}
      (
      {urls.map((url, index) => (
        <span key={url}>
          {index > 0 && ", "}
          <a href={url} rel="noopener noreferrer nofollow" className="underline hover:text-ink-900">
            {hostOf(url)}
          </a>
        </span>
      ))}
      )
    </span>
  );
}

function ResearchCard({ row, now }: { row: ResearchRow; now: Date }) {
  // A size that differs from ours and was not applied: the owner decides.
  const waiting = !row.applied && row.heldBack !== null && row.pack !== null;
  return (
    <li
      className={`rounded-md border bg-paper-raised p-4 ${waiting ? "border-caution" : "border-line"}`}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link
          href={productHref(DEFAULT_LOCALE, row)}
          className="font-semibold text-ink-900 hover:underline"
        >
          {row.name}
        </Link>
        <span className="text-sm text-ink-500">
          размер {VERDICT_LABEL[row.verdict] ?? row.verdict}
          {row.checkedAt && ` · ${formatAgo(row.checkedAt, now)}`}
        </span>
      </div>

      {row.reasons.length > 0 && (
        <p className="mt-1 text-sm text-ink-500">Проверен, защото: {row.reasons.join("; ")}</p>
      )}

      <p className="mt-2 text-sm text-ink-900">
        В каталога: {row.before ? packText(row.before.value, row.before.unit) : "няма размер"}
        {row.pack && (
          <>
            {" "}
            → намерен: <strong>{packText(row.pack.value, row.pack.unit)}</strong> (увереност{" "}
            {CONFIDENCE_LABEL[row.pack.confidence] ?? row.pack.confidence})
            <Sources urls={row.pack.sources} />
          </>
        )}
      </p>
      {row.override && (
        <p className="mt-1 text-sm text-pine-700">
          В сила е проученият размер: {packText(row.override.value, row.override.unit)}
        </p>
      )}
      {row.heldBack && !row.applied && (
        <p className="mt-1 text-sm text-caution">Не е приложен автоматично: {row.heldBack}</p>
      )}
      {row.note && <p className="mt-2 text-sm text-ink-700">{row.note}</p>}

      {row.findings.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-sm text-ink-700">
          {row.findings.map((finding) => (
            <li key={finding.field}>
              {FIELD_LABEL[finding.field] ?? finding.field}: при нас „{finding.ours ?? "—"}“,
              намерено „{finding.found}“ (увереност{" "}
              {CONFIDENCE_LABEL[finding.confidence] ?? finding.confidence})
              <Sources urls={finding.sources} />
            </li>
          ))}
        </ul>
      )}

      {(waiting || row.override) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {waiting && (
            <form action={applyResearchedPack}>
              <input type="hidden" name="id" value={row.id} />
              <Button type="submit" size="sm">
                Приложи {packText(row.pack!.value, row.pack!.unit)}
              </Button>
            </form>
          )}
          {row.override && (
            <form action={clearPackOverride}>
              <input type="hidden" name="id" value={row.id} />
              <Button type="submit" size="sm" variant="secondary">
                Върни размера на източника
              </Button>
            </form>
          )}
        </div>
      )}
    </li>
  );
}

export default async function AdminCopyPage() {
  const now = new Date();
  const { counts, recent, failing, research } = await loadCopyReview();

  return (
    <>
      <div>
        <h1 className="font-display text-3xl font-semibold text-ink-900">Текстове</h1>
        <p className="mt-1 max-w-3xl text-base text-ink-500">
          Описанията, които копирайтърът пише след всяка синхронизация, и проверките на размерите на
          опаковките. Текстовете от файла с ръчно писано съдържание не се променят оттук.
        </p>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ["Ръчно писани", counts.hand],
          ["От копирайтъра", counts.ai],
          ["Поправени от вас", counts.edited],
          ["Още без текст", counts.none],
          ["Изоставени", counts.givenUp],
        ].map(([label, value]) => (
          <div key={label} className="rounded-md border border-line bg-paper-raised p-3">
            <dt className="text-xs text-ink-500">{label}</dt>
            <dd className="text-2xl font-semibold text-ink-900 tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="research" className="mt-10">
        <h2 id="research" className="text-lg font-semibold text-ink-900">
          Проверени размери
        </h2>
        <p className="mt-1 text-sm text-ink-500">
          Поправка се прилага сама само при висока увереност и поне два независими източника. Всичко
          останало чака решение тук.
        </p>
        {research.length === 0 ? (
          <p className="mt-3 text-sm text-ink-500">Още няма проверени продукти.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {research.map((row) => (
              <ResearchCard key={row.id} row={row} now={now} />
            ))}
          </ul>
        )}
      </section>

      {failing.length > 0 && (
        <section aria-labelledby="failing" className="mt-10">
          <h2 id="failing" className="text-lg font-semibold text-ink-900">
            Неуспешни опити
          </h2>
          <p className="mt-1 text-sm text-ink-500">
            След {COPY_GIVE_UP_AFTER} неуспешни опита копирайтърът оставя продукта на вас.
          </p>
          <ul className="mt-3 space-y-2">
            {failing.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-start gap-3 rounded-md border border-line bg-paper-raised p-3"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    href={productHref(DEFAULT_LOCALE, row)}
                    className="font-medium text-ink-900 hover:underline"
                  >
                    {row.name}
                  </Link>
                  <p className="text-sm text-ink-500">
                    {row.attempts} {row.attempts === 1 ? "опит" : "опита"}
                    {row.lastError && ` · ${row.lastError}`}
                  </p>
                </div>
                {row.attempts >= COPY_GIVE_UP_AFTER && (
                  <form action={retryProduct}>
                    <input type="hidden" name="id" value={row.id} />
                    <Button type="submit" size="sm" variant="secondary">
                      Опитай отново
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="recent" className="mt-10">
        <h2 id="recent" className="text-lg font-semibold text-ink-900">
          Последно написани
        </h2>
        {recent.length === 0 ? (
          <p className="mt-3 text-sm text-ink-500">Копирайтърът още не е писал.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {recent.map((row) => (
              <li key={row.id} className="rounded-md border border-line bg-paper-raised p-4">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <Link
                    href={productHref(DEFAULT_LOCALE, row)}
                    className="font-semibold text-ink-900 hover:underline"
                  >
                    {row.name}
                  </Link>
                  <span className="text-sm text-ink-500">
                    {row.origin === "edited" ? "поправен от вас" : (row.model ?? "копирайтър")}
                    {row.writtenAt && ` · ${formatAgo(row.writtenAt, now)}`}
                  </span>
                </div>
                <p className="mt-2 text-ink-900">{row.summary}</p>
                {row.paragraphs.map((paragraph) => (
                  <p key={paragraph} className="mt-1 text-sm text-ink-700">
                    {paragraph}
                  </p>
                ))}

                <details className="mt-3">
                  <summary className="cursor-pointer text-sm text-ink-500 hover:text-ink-900">
                    Поправи
                  </summary>
                  <form action={saveEditedCopy} className="mt-3 space-y-3">
                    <input type="hidden" name="id" value={row.id} />
                    <div>
                      <label htmlFor={`summary-${row.id}`} className={LABEL_CLASS}>
                        Кратко описание (едно изречение)
                      </label>
                      <textarea
                        id={`summary-${row.id}`}
                        name="summary"
                        rows={2}
                        required
                        minLength={20}
                        maxLength={300}
                        defaultValue={row.summary}
                        className={TEXTAREA_CLASS}
                      />
                    </div>
                    <div>
                      <label htmlFor={`body-${row.id}`} className={LABEL_CLASS}>
                        Описание (празен ред между абзаците)
                      </label>
                      <textarea
                        id={`body-${row.id}`}
                        name="body"
                        rows={7}
                        required
                        defaultValue={row.paragraphs.join("\n\n")}
                        className={`${TEXTAREA_CLASS} leading-relaxed`}
                      />
                    </div>
                    <Button type="submit" size="sm">
                      Запази
                    </Button>
                  </form>
                </details>

                <form action={requestNewCopy} className="mt-2">
                  <input type="hidden" name="id" value={row.id} />
                  <Button type="submit" size="sm" variant="ghost">
                    Напиши наново при следващото пускане
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
