import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MIN_ADMIN_PASSWORD_LENGTH } from "@/lib/auth";
import { AdminDisabled, DISABLED_MESSAGE } from "@/components/admin/admin-disabled";
import {
  FORM_CONSENT_SOURCES,
  OPERATOR_CONSENT_BASES,
  OPERATOR_CONSENT_BASIS_CODES,
  consentSourceLabel,
  isOperatorConsentBasis,
} from "@/lib/forms/consent";
import { contactSchema, orderInquirySchema } from "@/lib/forms/schemas";
import { isPlausibleToken, maskEmail } from "@/lib/forms/unsubscribe-token";
import { MANUAL_LINK_RUN_KIND, evaluateSyncHealth, type SyncRunSnapshot } from "@/lib/sync-health";
import {
  CHANGE_TYPE_LABEL,
  OPTIONAL_RUN_COUNTS,
  changeTypeLabel,
  isManualLink,
  presentRunCounts,
} from "@/lib/sync-display";
import {
  MAIL_THREAD_DONE,
  contactAgeBasis,
  retentionCutoff,
  selectExpired,
  selectExpiredThreads,
} from "@/lib/retention";
import { privacyPolicy } from "@/content/legal";

describe("the consent checkbox in the schemas", () => {
  const order = { productSlug: "x", phone: "0888123456" };
  const contact = { name: "Мария", email: "m@example.test", message: "Здравейте, имам въпрос." };

  it("is unticked unless the browser sent it", () => {
    expect(orderInquirySchema.parse(order).newsletterConsent).toBe(false);
    expect(contactSchema.parse(contact).newsletterConsent).toBe(false);
  });

  it("is ticked for what a checkbox sends", () => {
    expect(orderInquirySchema.parse({ ...order, newsletterConsent: "on" }).newsletterConsent).toBe(
      true,
    );
    expect(contactSchema.parse({ ...contact, newsletterConsent: "on" }).newsletterConsent).toBe(
      true,
    );
  });

  it("cannot be the reason a form is refused", () => {
    for (const odd of [null, "", "off", "no", "false", 7, {}]) {
      expect(orderInquirySchema.safeParse({ ...order, newsletterConsent: odd }).success).toBe(true);
      expect(contactSchema.safeParse({ ...contact, newsletterConsent: odd }).success).toBe(true);
    }
  });
});

describe("consent sources", () => {
  it("names every code the forms and the panel can write", () => {
    for (const code of Object.keys(FORM_CONSENT_SOURCES)) {
      expect(consentSourceLabel(code)).toBe(
        FORM_CONSENT_SOURCES[code as keyof typeof FORM_CONSENT_SOURCES],
      );
    }
    for (const code of OPERATOR_CONSENT_BASIS_CODES) {
      expect(consentSourceLabel(code)).toContain("Записано от оператор");
    }
  });

  it("offers the operator a short fixed list, including phone and email", () => {
    expect(OPERATOR_CONSENT_BASIS_CODES.length).toBeGreaterThanOrEqual(2);
    expect(OPERATOR_CONSENT_BASIS_CODES.length).toBeLessThanOrEqual(5);
    expect(OPERATOR_CONSENT_BASIS_CODES).toContain("operator:phone");
    expect(OPERATOR_CONSENT_BASIS_CODES).toContain("operator:email");
  });

  it("accepts only a listed basis", () => {
    expect(isOperatorConsentBasis("operator:phone")).toBe(true);
    for (const bad of [
      "",
      "phone",
      "footer",
      "operator:",
      null,
      undefined,
      3,
      "toString",
      "__proto__",
    ]) {
      expect(isOperatorConsentBasis(bad)).toBe(false);
    }
    expect(Object.keys(OPERATOR_CONSENT_BASES)).toEqual([...OPERATOR_CONSENT_BASIS_CODES]);
  });

  it("shows an unknown or missing source as what it is", () => {
    expect(consentSourceLabel(null)).toBe("Не е записан");
    expect(consentSourceLabel("something_old")).toContain("something_old");
  });
});

describe("unsubscribe tokens", () => {
  it("accepts what the database generates and rejects the rest", () => {
    expect(isPlausibleToken("a".repeat(64))).toBe(true);
    expect(isPlausibleToken("0123456789abcdef".repeat(4))).toBe(true);
    for (const bad of [
      "",
      "short",
      "x".repeat(200),
      "has space ".repeat(8),
      "a/b".repeat(20),
      null,
      undefined,
      5,
      ["a".repeat(64)],
    ]) {
      expect(isPlausibleToken(bad)).toBe(false);
    }
  });

  it("masks an address without giving it away", () => {
    expect(maskEmail("petar@example.test")).toBe("pe***@example.test");
    expect(maskEmail("a@example.test")).toBe("a***@example.test");
    expect(maskEmail("not-an-address")).toBe("***");
  });
});

describe("the admin 'disabled' screen", () => {
  const reasons = ["no_password", "short_password", "no_session_secret"] as const;

  it("has a different message for each reason, naming the setting to change", () => {
    expect(new Set(reasons.map((r) => DISABLED_MESSAGE[r])).size).toBe(3);
    expect(DISABLED_MESSAGE.no_password).toContain("ADMIN_PASSWORD");
    expect(DISABLED_MESSAGE.short_password).toContain("ADMIN_PASSWORD");
    expect(DISABLED_MESSAGE.short_password).toContain(String(MIN_ADMIN_PASSWORD_LENGTH));
    expect(DISABLED_MESSAGE.no_session_secret).toContain("ADMIN_SESSION_SECRET");
  });

  it("renders the message for the reason it is given, under one h1", () => {
    for (const reason of reasons) {
      const html = renderToStaticMarkup(createElement(AdminDisabled, { reason }));
      expect(html.match(/<h1/g)).toHaveLength(1);
      expect(html).toContain("Администрацията е изключена");
      expect(html).toContain(DISABLED_MESSAGE[reason].slice(0, 30));
    }
  });

  it("tells a public reader nothing about the values it is about", () => {
    const secret = "sup3r-secret-value";
    process.env.ADMIN_PASSWORD = secret;
    process.env.ADMIN_SESSION_SECRET = secret;
    try {
      for (const reason of reasons) {
        const html = renderToStaticMarkup(createElement(AdminDisabled, { reason }));
        expect(html).not.toContain(secret);
        // No length of the password that is set, no "same as the password".
        expect(html).not.toMatch(/\bе \d+ знака|съвпада|еднаква/);
      }
    } finally {
      delete process.env.ADMIN_PASSWORD;
      delete process.env.ADMIN_SESSION_SECRET;
    }
  });
});

describe("sync health ignores a manual link", () => {
  const NOW = new Date("2026-10-10T12:00:00Z");
  const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
  const base = (h: number, over: Partial<SyncRunSnapshot> = {}): SyncRunSnapshot => ({
    status: "succeeded",
    dryRun: false,
    startedAt: hoursAgo(h),
    completedAt: hoursAgo(h - 0.1),
    circuitBreakerTripped: false,
    catalogSource: "filter_init",
    parserConfidence: "1.000",
    imagesFailed: 0,
    ...over,
  });
  const manual = (h: number): SyncRunSnapshot =>
    base(h, { metadata: { kind: MANUAL_LINK_RUN_KIND } });
  const conditions = (runs: SyncRunSnapshot[]) =>
    evaluateSyncHealth(runs, NOW).map((f) => f.condition);

  it("a recent manual link does not hide that the sync has gone quiet", () => {
    expect(conditions([manual(0.5), base(30)])).toEqual(["no_recent_success"]);
  });

  it("a manual link alone is no sync at all", () => {
    const findings = evaluateSyncHealth([manual(1)], NOW);
    expect(findings.map((f) => f.condition)).toEqual(["no_recent_success"]);
    expect(findings[0]?.summary).toMatch(/нито една/);
  });

  it("does not become the latest run: a failed real sync is still reported", () => {
    expect(conditions([manual(0.2), base(1, { status: "failed" }), base(7)])).toEqual([
      "latest_failed",
    ]);
  });

  it("a real run beside a manual link is judged on its own", () => {
    expect(conditions([manual(0.2), base(1)])).toEqual([]);
  });

  it("other metadata does not matter, and a missing column is a real run", () => {
    expect(conditions([base(1, { metadata: { kind: "scheduled" } })])).toEqual([]);
    expect(conditions([base(1, { metadata: null })])).toEqual([]);
    expect(conditions([base(1)])).toEqual([]);
  });
});

describe("the sync page's labels", () => {
  it("labels the moved change type and counts in Bulgarian", () => {
    expect(changeTypeLabel("moved")).toBe(CHANGE_TYPE_LABEL.moved);
    expect(changeTypeLabel("moved")).toMatch(/[а-я]/i);
    expect(OPTIONAL_RUN_COUNTS.map((c) => c.key)).toEqual([
      "movedCount",
      "enrichedCount",
      "enrichFailedCount",
    ]);
    for (const column of OPTIONAL_RUN_COUNTS) expect(column.label).toMatch(/^[А-Я]/);
  });

  it("shows only the count columns the rows actually have, even at zero", () => {
    expect(presentRunCounts([{ createdCount: 1 }])).toEqual([]);
    expect(presentRunCounts([{ movedCount: 0 }]).map((c) => c.key)).toEqual(["movedCount"]);
    expect(
      presentRunCounts([
        { movedCount: 1 },
        { movedCount: 0, enrichedCount: 4, enrichFailedCount: 0 },
      ]).map((c) => c.key),
    ).toEqual(["movedCount", "enrichedCount", "enrichFailedCount"]);
  });

  it("tolerates a column that is present but not a number", () => {
    expect(presentRunCounts([{ enrichedCount: null }, { enrichedCount: "3" }])).toEqual([]);
  });

  it("recognises a run written by a manual link", () => {
    expect(isManualLink({ metadata: { kind: "manual_link" } })).toBe(true);
    expect(isManualLink({ metadata: { kind: "other" } })).toBe(false);
    expect(isManualLink({ metadata: {} })).toBe(false);
    expect(isManualLink({})).toBe(false);
    expect(isManualLink({ metadata: null })).toBe(false);
  });
});

describe("retention: when a contact message closed", () => {
  const NOW = new Date("2026-10-15T09:00:00Z");
  const monthsAgo = (months: number): Date => {
    const d = new Date(NOW.getTime());
    d.setUTCMonth(d.getUTCMonth() - months);
    return d;
  };
  const message = (id: string, status: string, createdAt: Date, closedAt: Date | null = null) => ({
    id,
    status,
    createdAt,
    closedAt,
  });

  it("measures from the closing when there is one", () => {
    // Written 14 months ago, closed 2 months ago: not due for another 10.
    const out = selectExpired({
      now: NOW,
      orders: [],
      contacts: [message("recent-close", "converted", monthsAgo(14), monthsAgo(2))],
    });
    expect(out.contactIds).toEqual([]);
  });

  it("deletes one closed more than 12 months ago", () => {
    const out = selectExpired({
      now: NOW,
      orders: [],
      contacts: [message("old-close", "converted", monthsAgo(20), monthsAgo(13))],
    });
    expect(out.contactIds).toEqual(["old-close"]);
  });

  it("falls back to the creation date for a row that predates the column", () => {
    const out = selectExpired({
      now: NOW,
      orders: [],
      contacts: [
        message("legacy-old", "spam", monthsAgo(13)),
        message("legacy-young", "spam", monthsAgo(11)),
      ],
    });
    expect(out.contactIds).toEqual(["legacy-old"]);
    expect(contactAgeBasis({ createdAt: monthsAgo(13), closedAt: null })).toEqual(monthsAgo(13));
  });

  it("keeps the boundary exact: on the cutoff stays, just before it goes", () => {
    const cutoff = retentionCutoff(NOW);
    const out = selectExpired({
      now: NOW,
      orders: [],
      contacts: [
        message("on", "converted", monthsAgo(30), cutoff),
        message("before", "converted", monthsAgo(30), new Date(cutoff.getTime() - 1)),
      ],
    });
    expect(out.contactIds).toEqual(["before"]);
  });

  it("never selects an open message, however old, and counts it for a person", () => {
    const out = selectExpired({
      now: NOW,
      orders: [],
      contacts: [
        message("open", "new", monthsAgo(30)),
        message("contacted", "contacted", monthsAgo(30)),
      ],
    });
    expect(out.contactIds).toEqual([]);
    expect(out.awaitingDecision.contacts).toBe(2);
  });
});

describe("retention: the mailbox", () => {
  const NOW = new Date("2026-10-15T09:00:00Z");
  const monthsAgo = (months: number): Date => {
    const d = new Date(NOW.getTime());
    d.setUTCMonth(d.getUTCMonth() - months);
    return d;
  };
  const thread = (id: string, status: string, lastMessageAt: Date) => ({
    id,
    status,
    lastMessageAt,
  });
  const pick = (threads: ReturnType<typeof thread>[]) =>
    selectExpiredThreads({ now: NOW, threads });

  it("selects a done thread whose last message is over 12 months old", () => {
    expect(pick([thread("a", MAIL_THREAD_DONE, monthsAgo(13))])).toEqual(["a"]);
  });

  it("keeps a done thread with a recent last message, however old it began", () => {
    expect(pick([thread("a", "done", monthsAgo(11))])).toEqual([]);
  });

  it("never selects an open thread", () => {
    expect(pick([thread("a", "open", monthsAgo(13)), thread("b", "open", monthsAgo(120))])).toEqual(
      [],
    );
  });

  it("measures from the cutoff exactly", () => {
    const cutoff = retentionCutoff(NOW);
    expect(
      pick([
        thread("on", "done", cutoff),
        thread("before", "done", new Date(cutoff.getTime() - 1)),
      ]),
    ).toEqual(["before"]);
  });

  it("selects nothing from an empty mailbox, and keeps a status it does not know", () => {
    expect(pick([])).toEqual([]);
    expect(pick([thread("a", "archived", monthsAgo(30))])).toEqual([]);
  });
});

describe("the privacy policy states the mailbox rule and the consent record", () => {
  const text = JSON.stringify(privacyPolicy);

  it("says how long the mailbox is kept, in the agreed words", () => {
    expect(text).toContain(
      "Кореспонденцията, водена на адреса за контакт на магазина (писмата, които ни пишете, и отговорите ни), пазим до 12 месеца след последното писмо в разговора, след като той е приключен.",
    );
  });

  it("mentions the checkboxes and that an enquiry is not consent", () => {
    expect(text).toContain("отметката за бюлетина във формата за поръчка или за контакт");
    expect(text).toContain("не са съгласие за бюлетина");
  });
});
