/**
 * Words for the sync page. Pure, so the Bulgarian plurals can be tested.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Bulgarian counts: one takes the singular, everything else the plural. */
const unit = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * "преди 3 часа". Coarse on purpose: the question is whether the catalog is
 * hours or weeks old, not how many seconds.
 */
export function formatAgo(from: Date, now: Date): string {
  const ms = now.getTime() - from.getTime();
  if (ms < MINUTE) return "току-що";
  if (ms < HOUR) return `преди ${unit(Math.floor(ms / MINUTE), "минута", "минути")}`;
  if (ms < DAY) return `преди ${unit(Math.floor(ms / HOUR), "час", "часа")}`;
  return `преди ${unit(Math.floor(ms / DAY), "ден", "дни")}`;
}

/** "2 мин 05 сек", "14 сек", "—" when the run has not finished. */
export function formatDuration(ms: number | null): string {
  if (ms === null || ms < 0) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} сек`;
  const minutes = Math.floor(seconds / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return `${minutes} мин ${rest} сек`;
}

/** UTC, minute precision, like the other panel screens. */
export const formatStamp = (at: Date): string => at.toISOString().slice(0, 16).replace("T", " ");

export const RUN_STATUS_LABEL: Record<string, string> = {
  running: "Тече",
  succeeded: "Успешна",
  partial: "Частична",
  failed: "Неуспешна",
  aborted: "Прекъсната",
};

export const CHANGE_TYPE_LABEL: Record<string, string> = {
  created: "Нов",
  updated: "Обновен",
  moved: "Преместен",
  enriched: "Допълнен",
  marked_missing: "Липсва",
  removed: "Премахнат",
  restored: "Възстановен",
};

/** A status or change type this file does not know yet is shown as it is. */
export const runStatusLabel = (status: string): string => RUN_STATUS_LABEL[status] ?? status;
export const changeTypeLabel = (type: string): string => CHANGE_TYPE_LABEL[type] ?? type;

/** What the types above mean, for the line under the changes table. Only the
    ones a reader could not guess from the word. */
export const CHANGE_TYPE_HINT: Record<string, string> = {
  moved:
    "продуктът е последван до нов адрес на източника — същият запис, без да се създава нов и без да се губи адресът на страницата му.",
  enriched: "към продукта са добавени факти, прочетени от страницата му при източника.",
};

/**
 * Count columns on `sync_runs` that arrive with other changes. A column the
 * database does not have yet is simply absent from the row, and the page shows
 * nothing for it rather than a column of dashes; a column that exists is shown
 * even when it is zero, because "none moved" is an answer.
 */
export const OPTIONAL_RUN_COUNTS = [
  { key: "movedCount", label: "Преместени" },
  { key: "enrichedCount", label: "Допълнени" },
  { key: "enrichFailedCount", label: "Неуспешни допълвания" },
] as const;

/** The optional columns present on at least one of these rows, in display order. */
export function presentRunCounts(
  rows: readonly object[],
): Array<(typeof OPTIONAL_RUN_COUNTS)[number]> {
  return OPTIONAL_RUN_COUNTS.filter((column) =>
    rows.some((row) => optionalCount(row, column.key) !== null),
  );
}

/** `moved_count` and its siblings are added to `sync_runs` by other changes;
    read them if they are there. */
export function optionalCount(row: object, key: string): number | null {
  const value = (row as Record<string, unknown>)[key];
  return typeof value === "number" ? value : null;
}

/** A run `catalog:link` wrote by hand: it records a link, not a reading of the source. */
export function isManualLink(row: { metadata?: unknown }): boolean {
  const metadata = row.metadata;
  return (
    typeof metadata === "object" &&
    metadata !== null &&
    (metadata as { kind?: unknown }).kind === "manual_link"
  );
}
