/**
 * Deciding which conversation a message belongs to — the pure half.
 *
 * Separate from `store.ts` and with no imports, deliberately. Everything here
 * is a string function, and `store.ts` opens a database connection at module
 * scope through `@/lib/db`; a test that wants to know whether "Отн: поръчка"
 * and "поръчка" match should not have to stand up Postgres to find out.
 *
 * It is also the logic most worth testing. A miss here does not throw — it
 * quietly files a reply as a new conversation, and the panel then shows one
 * thread waiting for an answer that was already given in the other.
 */

/**
 * "Re: Re: Отн: поръчка" and "поръчка" are the same conversation.
 *
 * Bulgarian customers send both the English and the Bulgarian prefixes, often
 * mixed, because the reply prefix comes from whatever client the sender uses
 * and not from the language they write in.
 *
 * The list is deliberately short. This shop sells only in Bulgaria
 * (`siteConfig.locale`), so the German `AW:`, Finnish `VS:` and the rest that
 * sell-a-vend has to strip would be fifteen prefixes nobody will ever send —
 * and every extra entry is a chance to fold two real subjects into one.
 *
 * `Re[2]:` is Outlook's numbered form and is stripped with the rest.
 */
const REPLY_PREFIX = /^\s*(re|fwd|fw|отн|относно|пр)\s*(\[\d+\])?\s*:\s*/i;

export function normalizeSubject(subject: string): string {
  let value = subject.trim();
  /* Loop: each Reply adds another prefix, and long threads accumulate them. */
  while (REPLY_PREFIX.test(value)) value = value.replace(REPLY_PREFIX, "");
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/** The `<...>` ids out of a References or In-Reply-To header. */
export function parseMessageIds(header: string | undefined | null): string[] {
  if (!header) return [];
  return [...header.matchAll(/<[^<>\s]+>/g)].map((m) => m[0]);
}

/** Header lookup that does not care about case, because senders do not. */
export function headerValue(
  headers: Record<string, string> | null | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value;
  }
  return undefined;
}

/**
 * `"Иван Иванов" <ivan@example.bg>` taken apart.
 *
 * The address is lowercased because it is used as a key — a thread is found
 * again by correspondent, and `Ivan@` and `ivan@` are the same person. The name
 * is left exactly as written.
 */
export function parseAddress(header: string): { name: string | null; address: string } {
  const angle = header.match(/<([^>]+)>/);
  /* Both halves of the guard matter under noUncheckedIndexedAccess: no match at
     all is a bare address, and a match whose group somehow did not capture is
     not an address to silently invent one from. */
  const address = angle?.[1];
  if (!angle || address === undefined) {
    return { name: null, address: header.trim().toLowerCase() };
  }

  const name = header.slice(0, angle.index).trim().replace(/^"|"$/g, "").trim();
  return { name: name || null, address: address.trim().toLowerCase() };
}
