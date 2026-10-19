import { describe, expect, it, vi } from "vitest";
import { newsletterFixture } from "@/emails/fixtures";
import {
  BATCH_SIZE,
  MAX_ATTEMPTS,
  batchKey,
  chunk,
  classifyError,
  composeCampaign,
  mayHaveBeenProcessed,
  personalise,
  retryDelayMs,
  sendWithRetry,
  singleKey,
  type BatchClient,
  type BatchResponse,
} from "@/lib/newsletter/batch";
import {
  listUnsubscribeHeaders,
  oneClickUnsubscribeUrl,
  unsubscribeUrl,
} from "@/lib/newsletter/links";
import {
  isNewsletterUpload,
  newsletterContentSchema,
  newsletterDraftSchema,
  resolveIntent,
} from "@/lib/newsletter/schemas";

/**
 * The newsletter sender's rules, short of a database: what each copy carries,
 * how copies are grouped and keyed, and when a request is tried again. The
 * same rules against a real database — claiming, recording, resuming — are
 * `newsletter-campaigns.integration.test.ts`.
 */

const CAMPAIGN = "6f1c2b9e-3a47-4d8e-9b1a-2c3d4e5f6a7b";
const TOKEN_A = "a".repeat(64);
const TOKEN_B = "b".repeat(64);
const envelope = { from: "Buy a Coffee <info@buy-a-coffee.com>", campaignId: CAMPAIGN };

describe("the one-click headers (RFC 8058)", () => {
  it("point at the endpoint with the reader's token, and say a POST is enough", () => {
    expect(listUnsubscribeHeaders(TOKEN_A)).toEqual({
      "List-Unsubscribe": `<${oneClickUnsubscribeUrl(TOKEN_A)}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    expect(oneClickUnsubscribeUrl(TOKEN_A)).toMatch(
      new RegExp(`^https?://[^/]+/api/newsletter/unsubscribe\\?token=${TOKEN_A}$`),
    );
  });

  it("is a different address from the page in the footer, which asks first", () => {
    expect(unsubscribeUrl(TOKEN_A)).toMatch(
      new RegExp(`/bg/byuletin/otpisvane\\?token=${TOKEN_A}$`),
    );
    expect(unsubscribeUrl(TOKEN_A)).not.toBe(oneClickUnsubscribeUrl(TOKEN_A));
  });
});

describe("a reader's copy", () => {
  it("carries that reader's link in both parts, the headers and the tags", async () => {
    const template = await composeCampaign(newsletterFixture);
    const copy = personalise(template, { email: "ivan@example.bg", token: TOKEN_A }, envelope);
    expect(copy.to).toBe("ivan@example.bg");
    expect(copy.subject).toBe(newsletterFixture.subject);
    expect(copy.html).toContain(unsubscribeUrl(TOKEN_A));
    expect(copy.text).toContain(`Отписване: ${unsubscribeUrl(TOKEN_A)}`);
    expect(copy.headers).toEqual(listUnsubscribeHeaders(TOKEN_A));
    expect(copy.tags).toEqual([
      { name: "category", value: "newsletter" },
      { name: "campaign", value: CAMPAIGN },
    ]);
  });

  it("is not scoped to a Resend topic: our list decides who is mailed", async () => {
    /* A topic-scoped copy is dropped by Resend for anybody not opted in to
       the topic there — a subscriber whose sync failed, one from before the
       topic — while we would record it as sent. */
    const template = await composeCampaign(newsletterFixture);
    const copy = personalise(template, { email: "ivan@example.bg", token: TOKEN_A }, envelope);
    expect(Object.keys(copy)).not.toContain("topicId");
    expect(Object.keys(copy)).not.toContain("topic_id");
  });

  it("never carries another reader's token", async () => {
    const template = await composeCampaign(newsletterFixture);
    const a = personalise(template, { email: "a@example.bg", token: TOKEN_A }, envelope);
    const b = personalise(template, { email: "b@example.bg", token: TOKEN_B }, envelope);
    expect(a.html).not.toContain(TOKEN_B);
    expect(b.html).not.toContain(TOKEN_A);
    expect(b.html.replaceAll(TOKEN_B, TOKEN_A)).toBe(a.html);
    expect("topicId" in a).toBe(false);
  });

  it("is refused for a reader without a usable token", async () => {
    const template = await composeCampaign(newsletterFixture);
    expect(() => personalise(template, { email: "a@example.bg", token: "x" }, envelope)).toThrow();
  });
});

describe("grouping and keys", () => {
  it("cuts the list into requests of at most a hundred", () => {
    const ids = Array.from({ length: 205 }, (_, index) => index);
    expect(chunk(ids).map((group) => group.length)).toEqual([BATCH_SIZE, BATCH_SIZE, 5]);
    expect(chunk(ids).flat()).toEqual(ids);
    expect(chunk([])).toEqual([]);
    expect(() => chunk(ids, 0)).toThrow();
  });

  it("keys a request by its deliveries, whatever their order, so a resend is recognised", () => {
    const key = batchKey(CAMPAIGN, ["c", "a", "b"]);
    expect(batchKey(CAMPAIGN, ["a", "b", "c"])).toBe(key);
    expect(key.startsWith(`newsletter/${CAMPAIGN}/`)).toBe(true);
    expect(key.length).toBeLessThanOrEqual(256);
  });

  it("gives a different set, or another campaign, a different key", () => {
    const key = batchKey(CAMPAIGN, ["a", "b", "c"]);
    expect(batchKey(CAMPAIGN, ["a", "b"])).not.toBe(key);
    expect(batchKey("00000000-0000-4000-8000-000000000000", ["a", "b", "c"])).not.toBe(key);
    expect(singleKey(CAMPAIGN, "a")).not.toBe(batchKey(CAMPAIGN, ["a"]));
  });
});

describe("what a refusal means", () => {
  const error = (name: string, statusCode: number | null) => ({ name, statusCode, message: "x" });

  it("retries the network, rate limits, server errors and our own request in flight", () => {
    expect(classifyError(error("application_error", null))).toBe("transient");
    expect(classifyError(error("rate_limit_exceeded", 429))).toBe("transient");
    expect(classifyError(error("internal_server_error", 500))).toBe("transient");
    expect(classifyError(error("concurrent_idempotent_requests", 409))).toBe("transient");
  });

  it("stops on what a person has to fix", () => {
    expect(classifyError(error("invalid_api_key", 403))).toBe("account");
    expect(classifyError(error("daily_quota_exceeded", 429))).toBe("account");
    expect(classifyError(error("invalid_from_address", 422))).toBe("account");
  });

  it("never resends what may already have gone under another payload", () => {
    expect(classifyError(error("invalid_idempotent_request", 409))).toBe("ambiguous");
  });

  it("treats anything else as about the message", () => {
    expect(classifyError(error("validation_error", 422))).toBe("message");
  });

  it("knows which answers leave the outcome open", () => {
    expect(mayHaveBeenProcessed(error("application_error", null))).toBe(true);
    expect(mayHaveBeenProcessed(error("internal_server_error", 500))).toBe(true);
    expect(mayHaveBeenProcessed(error("concurrent_idempotent_requests", 409))).toBe(true);
    expect(mayHaveBeenProcessed(error("rate_limit_exceeded", 429))).toBe(false);
    expect(mayHaveBeenProcessed(error("validation_error", 422))).toBe(false);
    expect(mayHaveBeenProcessed(error("invalid_api_key", 403))).toBe(false);
  });

  it("waits what Retry-After asks, else doubles, and never long", () => {
    expect(retryDelayMs(0, "3")).toBe(3000);
    expect(retryDelayMs(0)).toBe(1000);
    expect(retryDelayMs(3)).toBe(8000);
    expect(retryDelayMs(10)).toBe(20_000);
    expect(retryDelayMs(1, "garbage")).toBe(2000);
  });
});

describe("one request", () => {
  const emails = [{ to: "a@example.bg" }, { to: "b@example.bg" }] as never[];
  const ok = (count: number): BatchResponse => ({
    data: Array.from({ length: count }, (_, index) => ({ id: `re_${index}` })),
    error: null,
  });
  const failing = (name: string, statusCode: number | null): BatchResponse => ({
    data: null,
    error: { name, statusCode, message: name },
    headers: { "retry-after": "1" },
  });
  const client = (...answers: BatchResponse[]) => {
    const send = vi.fn<BatchClient["send"]>();
    for (const answer of answers) send.mockResolvedValueOnce(answer);
    return { send };
  };

  it("is retried with the same key until it goes through", async () => {
    const sleep = vi.fn(async () => {});
    const fake = client(
      failing("rate_limit_exceeded", 429),
      failing("application_error", null),
      ok(2),
    );
    const outcome = await sendWithRetry(fake, emails, "key-1", { sleep });
    expect(outcome).toEqual({ ok: true, ids: ["re_0", "re_1"] });
    expect(fake.send).toHaveBeenCalledTimes(3);
    expect(fake.send.mock.calls.every(([, options]) => options.idempotencyKey === "key-1")).toBe(
      true,
    );
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it("gives up after five transient failures and says so", async () => {
    const fake = client(
      ...Array.from({ length: MAX_ATTEMPTS }, () => failing("internal_server_error", 500)),
    );
    const outcome = await sendWithRetry(fake, emails, "key-1", { sleep: async () => {} });
    expect(outcome).toMatchObject({ ok: false, kind: "transient" });
    expect(fake.send).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });

  it("is not retried when retrying cannot help", async () => {
    const fake = client(failing("validation_error", 422));
    expect(await sendWithRetry(fake, emails, "key-1", { sleep: async () => {} })).toMatchObject({
      ok: false,
      kind: "message",
    });
    expect(fake.send).toHaveBeenCalledTimes(1);
  });

  it("counts an answer without one id per message as unknown, not as sent", async () => {
    const fake = client(ok(1));
    expect(await sendWithRetry(fake, emails, "key-1", { sleep: async () => {} })).toMatchObject({
      ok: false,
      kind: "ambiguous",
    });
  });

  it("gives every attempt its own timeout", async () => {
    const fake = client(failing("application_error", null), ok(2));
    await sendWithRetry(fake, emails, "key-1", { sleep: async () => {}, timeoutMs: 5000 });
    const signals = fake.send.mock.calls.map(([, options]) => options.signal);
    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
    expect(signals[0]).not.toBe(signals[1]);
  });

  it("never waits past the deadline: it stops and says the request may have gone", async () => {
    const sleep = vi.fn(async () => {});
    const clock = 1_000;
    const fake = client(failing("application_error", null), ok(2));
    const outcome = await sendWithRetry(fake, emails, "key-1", {
      sleep,
      now: () => clock,
      deadline: clock + 500, // the 1 s Retry-After would end past it
    });
    expect(outcome).toMatchObject({ ok: false, kind: "transient", maybeSent: true });
    expect(fake.send).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("remembers an unanswered attempt across later refusals", async () => {
    /* The first attempt timed out — it may have reached Resend. A 4xx on the
       next attempt says nothing about the first, so the copies may not be
       released or split. */
    const fake = client(failing("application_error", null), failing("validation_error", 422));
    const outcome = await sendWithRetry(fake, emails, "key-1", { sleep: async () => {} });
    expect(outcome).toMatchObject({ ok: false, kind: "message", maybeSent: true });
  });

  it("knows a plain refusal sent nothing", async () => {
    const fake = client(failing("rate_limit_exceeded", 429), failing("validation_error", 422));
    const outcome = await sendWithRetry(fake, emails, "key-1", { sleep: async () => {} });
    expect(outcome).toMatchObject({ ok: false, kind: "message", maybeSent: false });
  });

  it("treats a thrown error as the network", async () => {
    const send = vi
      .fn<BatchClient["send"]>()
      .mockRejectedValueOnce(new Error("socket"))
      .mockResolvedValueOnce(ok(2));
    expect(await sendWithRetry({ send }, emails, "key-1", { sleep: async () => {} })).toMatchObject(
      {
        ok: true,
      },
    );
  });
});

describe("what the composer may attach", () => {
  it("only files uploaded under newsletter/ on a Blob host", () => {
    expect(
      isNewsletterUpload("https://abc.public.blob.vercel-storage.com/newsletter/x/a-1.pdf"),
    ).toBe(true);
    expect(isNewsletterUpload("https://abc.public.blob.vercel-storage.com/catalog/aa/bb.jpg")).toBe(
      false,
    );
    expect(isNewsletterUpload("http://abc.public.blob.vercel-storage.com/newsletter/a.pdf")).toBe(
      false,
    );
    expect(isNewsletterUpload("https://evil.example/newsletter/a.pdf")).toBe(false);
    expect(
      isNewsletterUpload(
        "https://abc.public.blob.vercel-storage.com.evil.example/newsletter/a.pdf",
      ),
    ).toBe(false);
    expect(isNewsletterUpload("javascript:alert(1)")).toBe(false);
  });

  it("reads the kind from the type, whatever the field claims", () => {
    const parsed = newsletterContentSchema.parse({
      subject: "Тема",
      preheader: "",
      body: "Текст",
      attachments: JSON.stringify([
        {
          url: "https://abc.public.blob.vercel-storage.com/newsletter/x/ceni.pdf",
          name: "Цени.pdf",
          contentType: "application/pdf",
          size: 1000,
          kind: "image",
          alt: "не е снимка",
        },
      ]),
    });
    expect(parsed.attachments[0]).toMatchObject({ kind: "file" });
    expect(parsed.attachments[0]).not.toHaveProperty("alt");
  });

  it("refuses a type a mail client would not draw", () => {
    const result = newsletterContentSchema.safeParse({
      subject: "",
      preheader: "",
      body: "",
      attachments: JSON.stringify([
        {
          url: "https://abc.public.blob.vercel-storage.com/newsletter/x/a.webp",
          name: "a.webp",
          contentType: "image/webp",
          size: 10,
          kind: "image",
        },
      ]),
    });
    expect(result.success).toBe(false);
  });
});

describe("which button was pressed", () => {
  const form = (entries: [string, string][]) => {
    const data = new FormData();
    for (const [name, value] of entries) data.append(name, value);
    return data;
  };

  it("takes the pressed button when the browser posted it", () => {
    expect(
      resolveIntent(
        form([
          ["intentChosen", "save"],
          ["intent", "send"],
        ]),
      ),
    ).toBe("send");
  });

  it("falls back to the hidden field when the browser left the button out", () => {
    /* Safari before 16.4: `new FormData(form, submitter)` ignores the
       submitter, and a press of "send" would otherwise arrive as "save". */
    expect(resolveIntent(form([["intentChosen", "send"]]))).toBe("send");
    expect(resolveIntent(form([["intentChosen", "test"]]))).toBe("test");
  });

  it("saves when it cannot tell, and never acts on a made-up value", () => {
    expect(resolveIntent(form([]))).toBe("save");
    expect(
      resolveIntent(
        form([
          ["intent", "delete"],
          ["intentChosen", "drop"],
        ]),
      ),
    ).toBe("save");
  });

  it("refuses a post without the version the tab was drawn from", () => {
    const result = newsletterDraftSchema.safeParse({
      id: CAMPAIGN,
      subject: "",
      preheader: "",
      body: "",
      attachments: "[]",
    });
    expect(result.success).toBe(false);
  });
});
