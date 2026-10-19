import { headerValue } from "./threading";

/**
 * Is an incoming message a machine's answer rather than a person's?
 *
 * Every order confirmation and every newsletter goes to a real inbox, and a
 * share of those inboxes answer by themselves: "I'm on leave until Monday",
 * "this address is no longer monitored", a ticket number. Filed in the mailbox
 * as an inbound message, each would open a conversation the panel counts as
 * waiting for a reply, and be forwarded to the owner's phone — the newsletter
 * alone could bring in dozens. None of them is somebody asking something.
 *
 * The headers a mail system sets on what it sends by itself, by the standard
 * first:
 *
 *   Auto-Submitted             RFC 3834: anything but `no` (auto-replied,
 *                              auto-generated, auto-notified)
 *   Precedence                 `bulk`, `auto_reply`, `junk`
 *   X-Autoreply, X-Autorespond present at all (older autoresponders)
 *   X-Auto-Response-Suppress   Microsoft's, naming `All` or `OOF`: Exchange
 *                              and Outlook mark their own out-of-office
 *                              replies with it
 *
 * Returns which header gave it away, for the log line, or null for a person.
 * No imports beyond the header reader, so the decision is unit-tested as it
 * stands (`test/auto-reply.test.ts`).
 */
export function autoReplySignal(headers: Record<string, string> | null | undefined): string | null {
  const read = (name: string) => headerValue(headers, name)?.trim();

  const autoSubmitted = read("auto-submitted");
  if (autoSubmitted && autoSubmitted.split(";")[0]!.trim().toLowerCase() !== "no") {
    return `Auto-Submitted: ${autoSubmitted}`;
  }

  const precedence = read("precedence")?.toLowerCase();
  if (precedence && ["bulk", "auto_reply", "junk"].includes(precedence)) {
    return `Precedence: ${precedence}`;
  }

  for (const name of ["x-autoreply", "x-autorespond"]) {
    if (read(name) !== undefined) return name;
  }

  const suppress = read("x-auto-response-suppress");
  if (suppress) {
    const values = suppress.split(/[\s,]+/).map((value) => value.toLowerCase());
    if (values.includes("all") || values.includes("oof")) {
      return `X-Auto-Response-Suppress: ${suppress}`;
    }
  }

  return null;
}
