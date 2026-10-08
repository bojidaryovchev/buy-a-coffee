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
  marked_missing: "Липсва",
  removed: "Премахнат",
  restored: "Възстановен",
};

/** A status or change type this file does not know yet is shown as it is. */
export const runStatusLabel = (status: string): string => RUN_STATUS_LABEL[status] ?? status;
export const changeTypeLabel = (type: string): string => CHANGE_TYPE_LABEL[type] ?? type;

/** `moved_count` is added to `sync_runs` by another change; read it if there. */
export function optionalCount(row: object, key: string): number | null {
  const value = (row as Record<string, unknown>)[key];
  return typeof value === "number" ? value : null;
}
