import { INQUIRY_STATUSES, INQUIRY_STATUS_LABEL, type InquiryStatus } from "@/lib/inquiry-status";

/**
 * The status control, as buttons rather than a `<select>`.
 *
 * Five values, and the operator's hand is usually on a phone rather than a
 * mouse: a row of tap targets is one press, a select is three and a scroll.
 * Each button is its own form so the whole thing works with no JavaScript —
 * which is not theoretical here, since this panel is opened on whatever device
 * is nearest.
 *
 * The current status is rendered as a disabled button rather than omitted, so
 * the row does not reflow when it changes and the operator can see what the
 * record is now without reading it off somewhere else.
 */
export function StatusPicker({
  id,
  current,
  action,
}: {
  id: string;
  current: InquiryStatus;
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {INQUIRY_STATUSES.map((status) => {
        const active = status === current;
        return (
          <form key={status} action={action}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="status" value={status} />
            <button
              type="submit"
              disabled={active}
              className={`min-h-11 rounded-sm border px-3.5 py-2 text-sm font-medium transition-colors ${
                active
                  ? "cursor-default border-pine-500 bg-pine-100 text-pine-700"
                  : "border-line-strong text-ink-500 hover:border-ink-300 hover:text-ink-900"
              }`}
            >
              {INQUIRY_STATUS_LABEL[status]}
            </button>
          </form>
        );
      })}
    </div>
  );
}
