import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { autoReplySignal } from "@/lib/mail/auto-reply";
import type * as StoreModule from "@/lib/mail/store";

/**
 * Machine answers to our mail — out-of-office replies, autoresponders — are
 * recognised by their headers and neither filed in the mailbox (where each
 * would wait for a reply) nor forwarded to the owner's phone.
 */

describe("autoReplySignal", () => {
  it.each([
    [{ "Auto-Submitted": "auto-replied" }, "Auto-Submitted"],
    [{ "auto-submitted": "auto-generated; type=vacation" }, "Auto-Submitted"],
    [{ "AUTO-SUBMITTED": "auto-notified" }, "Auto-Submitted"],
    [{ Precedence: "bulk" }, "Precedence"],
    [{ Precedence: "auto_reply" }, "Precedence"],
    [{ precedence: "JUNK" }, "Precedence"],
    [{ "X-Autoreply": "yes" }, "x-autoreply"],
    [{ "X-Autorespond": "" }, "x-autorespond"],
    [{ "X-Auto-Response-Suppress": "All" }, "X-Auto-Response-Suppress"],
    [{ "X-Auto-Response-Suppress": "DR, RN, NRN, OOF, AutoReply" }, "X-Auto-Response-Suppress"],
  ])("recognises %o", (headers, signal) => {
    expect(autoReplySignal(headers)).toContain(signal);
  });

  it.each([
    [null],
    [{}],
    [{ "Auto-Submitted": "no" }],
    [{ "Auto-Submitted": "No" }],
    [{ Precedence: "list" }],
    [{ "X-Auto-Response-Suppress": "DR, RN, NRN" }],
    [{ "In-Reply-To": "<a@example.bg>", Subject: "Re: Вашата заявка A1B2C3D4" }],
  ])("lets a person's message through: %o", (headers) => {
    expect(autoReplySignal(headers)).toBeNull();
  });
});

/* -- the inbound webhook, end to end with stand-ins -------------------------- */

const resend = vi.hoisted(() => ({
  verify: vi.fn(),
  get: vi.fn(),
  attachments: vi.fn(),
  send: vi.fn(),
}));
vi.mock("resend", () => ({
  Resend: class {
    webhooks = { verify: resend.verify };
    emails = {
      receiving: { get: resend.get, attachments: { list: resend.attachments } },
      send: resend.send,
    };
  },
}));

const store = vi.hoisted(() => ({
  addMessage: vi.fn(),
  createThread: vi.fn(),
  matchThread: vi.fn(async () => null),
}));
vi.mock("@/lib/mail/store", async (importOriginal) => ({
  ...(await importOriginal<typeof StoreModule>()),
  ...store,
}));
vi.mock("@/lib/db", () => ({ db: {} }));

vi.stubEnv("RESEND_API_KEY", "re_test");
vi.stubEnv("RESEND_WEBHOOK_SECRET", "whsec_test");
vi.stubEnv("MAIL_TO", "owner@example.org");
const { handleInboundEmail } = await import("@/lib/mail/inbound");

afterAll(() => vi.unstubAllEnvs());

function received(headers: Record<string, string>) {
  resend.verify.mockReturnValue({
    type: "email.received",
    created_at: "2026-10-19T10:00:00Z",
    data: {
      email_id: "rcv_1",
      from: "Мария <maria@example.bg>",
      to: ["info@buy-a-coffee.com"],
      cc: [],
      bcc: [],
      received_for: ["info@buy-a-coffee.com"],
    },
  });
  resend.get.mockResolvedValue({
    data: {
      from: "Мария <maria@example.bg>",
      to: ["info@buy-a-coffee.com"],
      cc: [],
      bcc: [],
      received_for: ["info@buy-a-coffee.com"],
      reply_to: [],
      subject: "Re: Вашата заявка A1B2C3D4",
      text: "Здравейте",
      html: "<p>Здравейте</p>",
      created_at: "2026-10-19T10:00:00Z",
      message_id: "<m1@example.bg>",
      headers,
    },
    error: null,
  });
  resend.attachments.mockResolvedValue({ data: { data: [] }, error: null });
  resend.send.mockResolvedValue({ data: { id: "fwd_1" }, error: null });
}

const deliver = () => handleInboundEmail("{}", { id: "msg_1", timestamp: "1", signature: "v1,x" });

describe("an inbound auto-reply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  it("is neither filed nor forwarded", async () => {
    received({ "Auto-Submitted": "auto-replied", "X-Auto-Response-Suppress": "OOF" });
    const result = await deliver();
    expect(result).toMatchObject({
      status: "ignored",
      reason: expect.stringContaining("автоматичен"),
    });
    expect(store.addMessage).not.toHaveBeenCalled();
    expect(store.createThread).not.toHaveBeenCalled();
    expect(resend.send).not.toHaveBeenCalled();
  });

  it("lets a person's reply through to the mailbox and the forward", async () => {
    received({ "In-Reply-To": "<a@example.bg>" });
    const result = await deliver();
    expect(result).toEqual({ status: "forwarded", id: "fwd_1" });
    expect(store.addMessage).toHaveBeenCalledOnce();
    expect(resend.send).toHaveBeenCalledOnce();
  });
});
