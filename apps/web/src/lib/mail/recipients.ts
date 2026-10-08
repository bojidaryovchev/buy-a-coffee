/**
 * Who a message was addressed to — the pure half of the inbound filter.
 *
 * Separate from `inbound.ts` and with no imports, for the reason `threading.ts`
 * is: `inbound.ts` is `server-only` and pulls in the database, and the question
 * "is this ours?" should be testable with a handful of strings.
 *
 * The question exists because the mail provider's account holds several
 * domains and its webhook fires for mail to any of them. Without it the
 * mailbox fills with other people's correspondence.
 */

/** The bare, lowercased addresses inside one header value or list item. */
export function extractAddresses(value: string): string[] {
  if (typeof value !== "string") return [];

  /* `"Name" <a@b>` — the angle brackets are the address, and whatever precedes
     them is a display name that may itself contain an `@` or a comma
     (`"info@shop.bg" <x@evil.example>` is addressed to evil.example). */
  const angled = [...value.matchAll(/<([^<>]*)>/g)].map((m) => m[1] ?? "");
  /* What is left once quoted names and bracketed addresses are removed may still
     hold bare addresses (`"Doe, John" <a@b>, c@d`). */
  const bare = value
    .replace(/"(?:[^"\\]|\\.)*"/g, " ")
    .replace(/<[^<>]*>/g, " ")
    .split(/[\s,;]+/);
  const candidates = [...angled, ...bare];

  return candidates.map((c) => c.trim().toLowerCase()).filter((c) => c.includes("@"));
}

/** The domain of one address: everything after the last `@`, no trailing dot. */
export function domainOf(address: string): string {
  return address
    .slice(address.lastIndexOf("@") + 1)
    .trim()
    .replace(/\.$/, "")
    .toLowerCase();
}

/**
 * Is any address in any of the lists at `domain`?
 *
 * Exact match: `a@sub.shop.bg` and `a@shop.bg.evil.example` are not `shop.bg`.
 * Every list is considered — to, cc, bcc and the envelope recipients
 * (`received_for`) — because a message can reach us as a Bcc or through a
 * forwarding rule with our address in none of the visible headers. A list the
 * provider omitted (`null`/`undefined`) is simply empty.
 */
export function isAddressedToDomain(
  lists: ReadonlyArray<ReadonlyArray<string> | null | undefined>,
  domain: string,
): boolean {
  const wanted = domain.trim().replace(/\.$/, "").toLowerCase();
  if (!wanted) return false;
  return lists.some((list) =>
    (list ?? []).some((item) => extractAddresses(item).some((a) => domainOf(a) === wanted)),
  );
}

/** Does this list name any address at all? */
export function hasAddresses(
  lists: ReadonlyArray<ReadonlyArray<string> | null | undefined>,
): boolean {
  return lists.some((list) => (list ?? []).some((item) => extractAddresses(item).length > 0));
}

/** Is the sender at `domain`? Same exact-match rule as the recipients. */
export function isSentFromDomain(from: string, domain: string): boolean {
  return isAddressedToDomain([[from]], domain);
}
