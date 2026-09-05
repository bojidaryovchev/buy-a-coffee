import { describe, expect, it } from "vitest";
import { headerValue, normalizeSubject, parseAddress, parseMessageIds } from "@/lib/mail/threading";

/**
 * The rule this file guards: a customer's reply lands in the thread it belongs
 * to.
 *
 * These four functions decide that, and none of them fails loudly. A missed
 * reply prefix does not throw — it files a reply as a brand-new conversation,
 * and the panel then shows one thread waiting for an answer that was already
 * given in the other. A mis-parsed address does not throw either; it just files
 * `Ivan@` and `ivan@` as two different people.
 *
 * They live in `lib/mail/threading.ts` rather than in `store.ts` precisely so
 * this file can import them without `@/lib/db` opening a connection pool.
 */

const SUBJECT = "Поръчка на кафе";

describe("normalizeSubject", () => {
  it.each([
    ["Re:", "English, and most clients"],
    ["RE:", "English, uppercased by Outlook"],
    ["Fwd:", "English forward"],
    ["FW:", "English forward, Outlook"],
    ["Отн:", "Bulgarian, regarding"],
    ["Относно:", "Bulgarian, spelled out"],
    ["Пр:", "Bulgarian, forwarded"],
  ])("strips %s — %s", (prefix) => {
    expect(normalizeSubject(`${prefix} ${SUBJECT}`)).toBe(normalizeSubject(SUBJECT));
  });

  it("strips a stack of prefixes, mixed across languages", () => {
    /* What a thread looks like by the third exchange when the customer's client
       writes Bulgarian prefixes and ours writes English ones. */
    expect(normalizeSubject(`Отн: Re: Fwd: ${SUBJECT}`)).toBe(normalizeSubject(SUBJECT));
  });

  it("strips Outlook's numbered form", () => {
    expect(normalizeSubject(`Re[2]: ${SUBJECT}`)).toBe(normalizeSubject(SUBJECT));
  });

  it("tolerates the space some clients put before the colon", () => {
    expect(normalizeSubject(`Re : ${SUBJECT}`)).toBe(normalizeSubject(SUBJECT));
  });

  it("folds case and runs of whitespace", () => {
    expect(normalizeSubject("  ПОРЪЧКА   на кафе ")).toBe(normalizeSubject(SUBJECT));
  });

  /* The other direction, and the one that costs a merged conversation rather
     than a split one: a subject that merely BEGINS with a prefix-shaped word
     must survive intact. */
  it("leaves a word that only looks like a prefix", () => {
    expect(normalizeSubject("Refill за машината")).toBe("refill за машината");
    expect(normalizeSubject("Препоръка за кафе")).toBe("препоръка за кафе");
  });

  it("keeps two different subjects apart", () => {
    expect(normalizeSubject("Re: Поръчка на кафе")).not.toBe(
      normalizeSubject("Re: Поръчка на чай"),
    );
  });

  /* The reference in an enquiry reply's subject is what finds the thread again
     — see `orderThreadSubject`. It has to survive being replied to. */
  it("recovers a record reference through a reply", () => {
    expect(normalizeSubject("Re: Вашата заявка A1B2C3D4")).toBe(
      normalizeSubject("Вашата заявка A1B2C3D4"),
    );
  });
});

describe("parseMessageIds", () => {
  it("reads every id out of a References chain", () => {
    expect(parseMessageIds("<a@example.bg> <b@example.bg>\r\n <c@example.bg>")).toEqual([
      "<a@example.bg>",
      "<b@example.bg>",
      "<c@example.bg>",
    ]);
  });

  it("returns nothing for a header that is absent", () => {
    /* Common enough to be the normal case: plenty of clients send In-Reply-To
       and no References, or neither. The matcher then falls back to the
       subject, which is why the tests above matter. */
    expect(parseMessageIds(null)).toEqual([]);
    expect(parseMessageIds(undefined)).toEqual([]);
    expect(parseMessageIds("")).toEqual([]);
  });
});

describe("headerValue", () => {
  it("ignores the case senders send headers in", () => {
    const headers = { "In-Reply-To": "<a@example.bg>", REFERENCES: "<b@example.bg>" };
    expect(headerValue(headers, "in-reply-to")).toBe("<a@example.bg>");
    expect(headerValue(headers, "references")).toBe("<b@example.bg>");
  });

  it("returns undefined rather than throwing on no headers at all", () => {
    expect(headerValue(null, "references")).toBeUndefined();
    expect(headerValue({}, "references")).toBeUndefined();
  });
});

describe("parseAddress", () => {
  it("splits a display name from the address", () => {
    expect(parseAddress('"Иван Иванов" <Ivan@Example.BG>')).toEqual({
      name: "Иван Иванов",
      address: "ivan@example.bg",
    });
  });

  it("handles an unquoted display name", () => {
    expect(parseAddress("Иван Иванов <ivan@example.bg>")).toEqual({
      name: "Иван Иванов",
      address: "ivan@example.bg",
    });
  });

  it("handles a bare address", () => {
    expect(parseAddress("ivan@example.bg")).toEqual({ name: null, address: "ivan@example.bg" });
  });

  /* The address is a lookup key, so casing must not create a second
     correspondent; the name is content, so it must not be touched. */
  it("lowercases the address and leaves the name alone", () => {
    expect(parseAddress("MARIA Petrova <MARIA@Example.BG>")).toEqual({
      name: "MARIA Petrova",
      address: "maria@example.bg",
    });
  });
});
