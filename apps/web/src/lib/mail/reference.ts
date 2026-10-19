/**
 * The short reference a stored record goes by, and the subjects built from it.
 *
 * In a module of its own, with no imports, because three different places
 * need the same eight characters: the success message after an order, the
 * confirmation mail, and the admin panel — and the first two must not pull the
 * mailbox's database code in with them. `reply.ts` re-exports all three, so
 * nothing that imported them from there had to change.
 */

/**
 * A short reference the customer can quote and the shop can read out.
 *
 * The primary keys here are `uuid`, which is right for a key and useless in a
 * subject line — nobody reads thirty-six characters back over the phone. Eight
 * hex characters of the same id is unambiguous across any volume this shop will
 * ever see, and stays a pure function of the row, which is what the subject
 * matching in `reply.ts` depends on.
 */
export const recordReference = (id: string): string => id.slice(0, 8).toUpperCase();

/**
 * The subject a record's conversation carries.
 *
 * Built from the reference rather than from the product or the customer, because
 * it is the ONE part of the thread that has to be reproducible: nothing links a
 * record to a thread — no column, no join — and the conversation is found again
 * by asking the mailbox for this correspondent and this normalised subject. A
 * subject derived from anything editable would hand the customer a second thread
 * on their second reply.
 *
 * The confirmation mail after an order goes out under the order's subject too,
 * so a customer who answers it and the shop answering from the panel end up in
 * the same conversation.
 */
export const orderThreadSubject = (id: string): string => `Вашата заявка ${recordReference(id)}`;
export const contactThreadSubject = (id: string): string =>
  `Вашето съобщение ${recordReference(id)}`;
