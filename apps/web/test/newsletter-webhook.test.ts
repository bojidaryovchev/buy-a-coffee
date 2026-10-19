import { createHmac, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as ResendModule from "resend";

/**
 * The contact webhook, signed the way Resend signs it.
 *
 * The signature is computed here from first principles — the svix scheme, an
 * HMAC-SHA256 over `id.timestamp.body` with the base64 key after `whsec_` — and
 * checked by the REAL SDK, so the test fails if either side's idea of the
 * scheme drifts. Only the SDK's topic lookup is replaced, so nothing reaches
 * Resend, and the database half is a pair of spies: what is under test is
 * which events reach it and why. The stale rule itself is SQL, and is pinned
 * against a real database in `newsletter-resend.integration.test.ts`.
 *
 * The account is shared by four sites, so the cases that matter most are the
 * ones where the right answer is to do nothing.
 */

const store = vi.hoisted(() => ({
  findSubscriberByEmail: vi.fn(),
  unsubscribeByEmail: vi.fn(),
}));
vi.mock("@/lib/forms/unsubscribe", () => store);

const topics = vi.hoisted(() => ({ list: vi.fn() }));

/* The real SDK — its `webhooks.verify` is part of what is tested — with the one
   network call the handler makes swapped for a spy. */
vi.mock("resend", async (importOriginal) => {
  const actual = await importOriginal<typeof ResendModule>();
  class Resend extends actual.Resend {
    constructor(key?: string) {
      super(key);
      this.contacts.topics.list = topics.list;
    }
  }
  return { ...actual, Resend };
});

const { handleContactEvent } = await import("@/lib/newsletter/webhook");
const { POST } = await import("@/app/api/resend/contacts/route");

const KEY = randomBytes(24);
const SECRET = `whsec_${KEY.toString("base64")}`;

function sign(body: string, key = KEY) {
  const id = `msg_${randomBytes(6).toString("hex")}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return { id, timestamp, signature: `v1,${signature}` };
}

function contactEvent(
  type: string,
  data: Partial<{ email: string; unsubscribed: boolean }> = {},
  createdAt = "2026-10-19T09:00:00.000Z",
): string {
  return JSON.stringify({
    type,
    created_at: createdAt,
    data: {
      id: "c_1",
      audience_id: "",
      segment_ids: ["seg_1"],
      created_at: "2026-10-01T09:00:00.000Z",
      updated_at: createdAt,
      email: "Ivan@Firma.bg",
      unsubscribed: false,
      ...data,
    },
  });
}

const subscriber = {
  id: "6f1c2b9e-3a47-4d8e-9b1a-2c3d4e5f6a7b",
  consentAt: new Date("2026-10-01T10:00:00.000Z"),
  unsubscribedAt: null,
};

const topicList = (subscription: "opt_in" | "opt_out") => ({
  data: {
    object: "list",
    has_more: false,
    data: [
      /* Another site's topic on the same contact, opted out — which must not be
         mistaken for ours. */
      { id: "topic_bav", name: "Buy-a-Vend", description: null, subscription: "opt_out" },
      { id: "topic_bac", name: "Buy a Coffee", description: null, subscription },
    ],
  },
  error: null,
  headers: null,
});

const deliver = (body: string) => handleContactEvent(body, sign(body));

beforeEach(() => {
  vi.stubEnv("RESEND_CONTACTS_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("RESEND_NEWSLETTER_TOPIC_ID", "topic_bac");
  store.findSubscriberByEmail.mockResolvedValue(subscriber);
  store.unsubscribeByEmail.mockResolvedValue("unsubscribed");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe("signature", () => {
  it("refuses a body signed with another key", async () => {
    const body = contactEvent("contact.updated", { unsubscribed: true });
    const result = await handleContactEvent(body, sign(body, randomBytes(24)));

    expect(result.status).toBe("unauthorized");
    expect(store.unsubscribeByEmail).not.toHaveBeenCalled();
  });

  it("refuses a body changed after signing", async () => {
    /* The bytes are what is signed — which is why the route reads the body as
       text and never round-trips it through JSON. */
    const body = contactEvent("contact.updated", { unsubscribed: false });
    const headers = sign(body);
    const tampered = body.replace('"unsubscribed":false', '"unsubscribed":true');

    expect((await handleContactEvent(tampered, headers)).status).toBe("unauthorized");
    expect(store.unsubscribeByEmail).not.toHaveBeenCalled();
  });

  it("is not satisfied by the inbound-mail secret", async () => {
    /* Two endpoints, two secrets: RESEND_WEBHOOK_SECRET verifies nothing here. */
    vi.stubEnv("RESEND_CONTACTS_WEBHOOK_SECRET", "");
    vi.stubEnv("RESEND_WEBHOOK_SECRET", SECRET);

    expect((await deliver(contactEvent("contact.deleted"))).status).toBe("failed");
    expect(store.unsubscribeByEmail).not.toHaveBeenCalled();
  });

  it("fails loudly without a secret, so Resend retries instead of dropping it", async () => {
    vi.stubEnv("RESEND_CONTACTS_WEBHOOK_SECRET", "");
    const body = contactEvent("contact.updated", { unsubscribed: true });

    expect((await deliver(body)).status).toBe("failed");
  });
});

describe("leaving this site's list", () => {
  it("records an opt-out of our topic, read from Resend because the payload has none", async () => {
    topics.list.mockResolvedValue(topicList("opt_out"));

    const result = await deliver(contactEvent("contact.updated", {}, "2026-10-18T07:30:00.000Z"));

    expect(result).toEqual({
      status: "unsubscribed",
      event: "contact.updated",
      reason: "topic_opt_out",
    });
    expect(topics.list).toHaveBeenCalledWith(expect.objectContaining({ email: "ivan@firma.bg" }));
    expect(store.unsubscribeByEmail).toHaveBeenCalledWith(
      "ivan@firma.bg",
      new Date("2026-10-18T07:30:00.000Z"),
    );
  });

  it("ignores an update while our topic is still opted in", async () => {
    /* Our own signup sync produces exactly this event — and another site's
       opt-out on the same contact must not be read as ours. */
    topics.list.mockResolvedValue(topicList("opt_in"));

    expect((await deliver(contactEvent("contact.updated"))).status).toBe("ignored");
    expect(store.unsubscribeByEmail).not.toHaveBeenCalled();
  });

  it("ignores a contact with no choice recorded on our topic", async () => {
    topics.list.mockResolvedValue({
      data: { object: "list", has_more: false, data: [] },
      error: null,
      headers: null,
    });

    expect((await deliver(contactEvent("contact.updated"))).status).toBe("ignored");
    expect(store.unsubscribeByEmail).not.toHaveBeenCalled();
  });

  it("fails when the topics cannot be read, so the opt-out is retried rather than lost", async () => {
    topics.list.mockResolvedValue({
      data: null,
      error: { message: "rate limited", name: "rate_limit_exceeded", statusCode: 429 },
      headers: null,
    });

    expect((await deliver(contactEvent("contact.updated"))).status).toBe("failed");
    expect(store.unsubscribeByEmail).not.toHaveBeenCalled();
  });
});

describe("contact.topics.updated", () => {
  /* The event Resend fires when a topic subscription changes - the preference
     page behind {{{RESEND_UNSUBSCRIBE_URL}}} included. Its payload names the
     changed topics, so the answer is read from it with no API call. */
  const topicsEvent = (changed: { id: string; subscription: string }[]) =>
    JSON.stringify({
      type: "contact.topics.updated",
      created_at: "2026-10-18T07:30:00.000Z",
      data: { email: "Ivan@Firma.bg", topics: changed },
    });

  it("records an opt-out of our topic straight from the payload", async () => {
    const result = await deliver(topicsEvent([{ id: "topic_bac", subscription: "opt_out" }]));

    expect(result).toEqual({
      status: "unsubscribed",
      event: "contact.topics.updated",
      reason: "topic_opt_out",
    });
    expect(topics.list).not.toHaveBeenCalled();
    expect(store.unsubscribeByEmail).toHaveBeenCalledWith(
      "ivan@firma.bg",
      new Date("2026-10-18T07:30:00.000Z"),
    );
  });

  it("ignores another site's topic opting out on the same contact", async () => {
    const result = await deliver(topicsEvent([{ id: "topic_bav", subscription: "opt_out" }]));

    expect(result.status).toBe("ignored");
    expect(store.unsubscribeByEmail).not.toHaveBeenCalled();
  });

  it("ignores our topic being switched on", async () => {
    // Our own signup sync produces exactly this event.
    const result = await deliver(topicsEvent([{ id: "topic_bac", subscription: "opt_in" }]));

    expect(result.status).toBe("ignored");
    expect(store.unsubscribeByEmail).not.toHaveBeenCalled();
  });
});

describe("leaving everything", () => {
  it("records 'unsubscribe from everything' without asking about topics", async () => {
    const result = await deliver(contactEvent("contact.updated", { unsubscribed: true }));

    expect(result).toMatchObject({ status: "unsubscribed", reason: "global_unsubscribe" });
    expect(topics.list).not.toHaveBeenCalled();
  });

  it("treats a deleted contact as an unsubscribe", async () => {
    const result = await deliver(contactEvent("contact.deleted"));

    expect(result).toMatchObject({ status: "unsubscribed", reason: "deleted" });
    expect(store.unsubscribeByEmail).toHaveBeenCalledOnce();
    expect(topics.list).not.toHaveBeenCalled();
  });
});

describe("nothing to do", () => {
  it("spends no API call on another site's contact", async () => {
    /* Webhooks are account-wide: most contact events belong to the other three
       lists. */
    store.findSubscriberByEmail.mockResolvedValue(null);

    expect((await deliver(contactEvent("contact.updated"))).status).toBe("ignored");
    expect(store.findSubscriberByEmail).toHaveBeenCalledWith("ivan@firma.bg");
    expect(topics.list).not.toHaveBeenCalled();
    expect(store.unsubscribeByEmail).not.toHaveBeenCalled();
  });

  it("spends no API call on a subscriber who already left", async () => {
    /* Also the echo of our own unsubscribe sync. */
    store.findSubscriberByEmail.mockResolvedValue({
      ...subscriber,
      unsubscribedAt: new Date("2026-10-10T10:00:00.000Z"),
    });

    expect((await deliver(contactEvent("contact.updated"))).status).toBe("ignored");
    expect(topics.list).not.toHaveBeenCalled();
  });

  it("ignores a topic question when no topic is configured", async () => {
    vi.stubEnv("RESEND_NEWSLETTER_TOPIC_ID", "");

    expect((await deliver(contactEvent("contact.updated"))).status).toBe("ignored");
    expect(topics.list).not.toHaveBeenCalled();
  });

  it("ignores events it does not handle", async () => {
    const body = contactEvent("contact.created", { unsubscribed: true });
    expect((await deliver(body)).status).toBe("ignored");
    expect(store.findSubscriberByEmail).not.toHaveBeenCalled();
  });

  it("lets a newer signup win over an older unsubscribe", async () => {
    /* A retried delivery carries its original time; the person signed up again
       since, and the store says so. */
    store.unsubscribeByEmail.mockResolvedValue("stale");
    const body = contactEvent("contact.updated", { unsubscribed: true }, "2026-09-01T00:00:00Z");

    expect(await deliver(body)).toEqual({
      status: "ignored",
      reason: "older than the latest signup",
    });
    expect(store.unsubscribeByEmail).toHaveBeenCalledWith(
      "ivan@firma.bg",
      new Date("2026-09-01T00:00:00Z"),
    );
  });

  it.each(["already_unsubscribed", "not_found", "stale"] as const)(
    "answers %s with a 200-shaped ignore, so Resend does not retry",
    async (outcome) => {
      store.unsubscribeByEmail.mockResolvedValue(outcome);
      const body = contactEvent("contact.updated", { unsubscribed: true });

      expect((await deliver(body)).status).toBe("ignored");
    },
  );
});

describe("our side failing", () => {
  it("fails when the topic must be checked and there is no key", async () => {
    vi.stubEnv("RESEND_API_KEY", "");

    expect((await deliver(contactEvent("contact.updated"))).status).toBe("failed");
  });

  it("fails when the store does, so the unsubscribe is retried rather than lost", async () => {
    store.unsubscribeByEmail.mockRejectedValue(new Error("connection reset"));
    const body = contactEvent("contact.updated", { unsubscribed: true });

    expect((await deliver(body)).status).toBe("failed");
  });

  it("fails when the lookup does", async () => {
    store.findSubscriberByEmail.mockRejectedValue(new Error("connection reset"));
    expect((await deliver(contactEvent("contact.deleted"))).status).toBe("failed");
  });
});

describe("the route's status codes", () => {
  /* Resend retries on 5xx and gives up on 2xx: "understood, nothing to do" must
     be a 200, and only a failure that a retry could fix a 500. */
  const post = (body: string, headers: Record<string, string>) =>
    POST(
      new Request("https://buy-a-coffee.com/api/resend/contacts", {
        method: "POST",
        body,
        headers,
      }),
    );
  const svix = (signed: ReturnType<typeof sign>) => ({
    "svix-id": signed.id,
    "svix-timestamp": signed.timestamp,
    "svix-signature": signed.signature,
  });

  it("200 for an unsubscribe recorded", async () => {
    const body = contactEvent("contact.deleted");
    const response = await post(body, svix(sign(body)));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ unsubscribed: "contact.deleted", reason: "deleted" });
  });

  it("200 for another site's contact", async () => {
    store.findSubscriberByEmail.mockResolvedValue(null);
    const body = contactEvent("contact.updated");
    expect((await post(body, svix(sign(body)))).status).toBe(200);
  });

  it("400 without the signature headers", async () => {
    expect((await post(contactEvent("contact.deleted"), {})).status).toBe(400);
  });

  it("401 for a bad signature", async () => {
    const body = contactEvent("contact.deleted");
    expect((await post(body, svix(sign(body, randomBytes(24))))).status).toBe(401);
  });

  it("500 for a failure a retry could fix", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    store.unsubscribeByEmail.mockRejectedValue(new Error("connection reset"));
    const body = contactEvent("contact.deleted");
    expect((await post(body, svix(sign(body)))).status).toBe(500);
  });
});
