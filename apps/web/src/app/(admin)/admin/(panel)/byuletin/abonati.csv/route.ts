import { isSignedIn } from "@/lib/auth";
import { consentSourceLabel } from "@/lib/forms/consent";
import { allSubscribers } from "@/lib/newsletter/campaigns";

/**
 * The subscriber list as a spreadsheet: `/admin/byuletin/abonati.csv`, the
 * active subscribers; `?vsichki=1`, everybody, with the date each one left.
 *
 * The export is the whole consent record — who, when, how — because that is
 * what makes the list usable anywhere else. It defaults to the active
 * subscribers so that a file somebody imports into another tool to send from
 * does not quietly bring back the people who left.
 *
 * Shaped for Excel set to Bulgarian, which is who opens it: semicolons
 * (a comma is that locale's decimal separator, and Excel would put every row
 * in one cell), a byte-order mark so the Cyrillic is read as UTF-8, and dates
 * as `YYYY-MM-DD HH:MM` UTC. A field that a spreadsheet would read as a
 * formula (`=`, `+`, `-`, `@` first) is prefixed with an apostrophe; an
 * address is typed by a stranger.
 */

/** Written as an escape: the character itself is invisible in an editor. */
const BOM = String.fromCharCode(0xfeff);

function field(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

const stamp = (date: Date | null): string =>
  date ? date.toISOString().slice(0, 16).replace("T", " ") : "";

export async function GET(request: Request) {
  if (!(await isSignedIn())) return new Response("Няма достъп", { status: 401 });

  const everybody = new URL(request.url).searchParams.get("vsichki") === "1";
  const rows = await allSubscribers(everybody);

  const header = [
    "Имейл",
    "Съгласие (UTC)",
    "Как е дадено",
    ...(everybody ? ["Отписан (UTC)"] : []),
  ];
  const lines = rows.map((row) =>
    [
      row.email,
      stamp(row.consentAt),
      consentSourceLabel(row.consentSource),
      ...(everybody ? [stamp(row.unsubscribedAt)] : []),
    ]
      .map(field)
      .join(";"),
  );
  const csv = `${BOM}${[header.map(field).join(";"), ...lines].join("\r\n")}\r\n`;
  const day = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="abonati-${everybody ? "vsichki-" : ""}${day}.csv"`,
      "cache-control": "private, no-store",
    },
  });
}
