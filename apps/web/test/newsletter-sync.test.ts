import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The mirror into Resend, against a stand-in SDK.
 *
 * Nothing here reaches Resend. What is pinned is the order of calls the live
 * API has to answer — create, else update, join the segment, opt in to the
 * topic — the ways it must degrade, and above all the one field it must never
 * send: the Resend account is shared by four sites, so the contact's
 * account-wide `unsubscribed` flag is never written, in either direction.
 */

const sdk = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  get: vi.fn(),
  segmentsList: vi.fn(),
  segmentsAdd: vi.fn(),
  topicsUpdate: vi.fn(),
}));

vi.mock("resend", () => ({
  Resend: class {
    contacts = {
      create: sdk.create,
      update: sdk.update,
      get: sdk.get,
      segments: { list: sdk.segmentsList, add: sdk.segmentsAdd },
      topics: { update: sdk.topicsUpdate },
    };
  },
}));

const next = vi.hoisted(() => ({ after: vi.fn() }));
vi.mock("next/server", () => ({ after: next.after }));

const {
  contactProperties,
  PROPERTY_KEYS,
  PROPERTY_PREFIX,
  pushSubscribed,
  syncSubscribed,
  syncSubscribedLater,
  syncUnsubscribed,
  syncUnsubscribedLater,
} = await import("@/lib/newsletter/sync");

const ok = <T>(data: T) => ({ data, error: null, headers: null });
const fail = (message: string) => ({
  data: null,
  error: { message, name: "validation_error", statusCode: 422 },
  headers: null,
});

const subscriber = {
  id: "6f1c2b9e-3a47-4d8e-9b1a-2c3d4e5f6a7b",
  email: "ivan@firma.bg",
  unsubscribeToken: "a".repeat(64),
};

/** Every argument any writing call was given — for the check that the
 *  account-wide flag never appears in any of them. */
const everyPayload = () =>
  [sdk.create, sdk.update, sdk.segmentsAdd, sdk.topicsUpdate].flatMap((fn) =>
    fn.mock.calls.map(([arg]) => arg as Record<string, unknown>),
  );

/** An address another of the four sites already has as a contact. */
function existingContact({ globallyUnsubscribed = false } = {}) {
  sdk.create.mockResolvedValue(fail("Contact already exists"));
  sdk.update.mockResolvedValue(ok({ id: "c_old", object: "contact" }));
  sdk.segmentsList.mockResolvedValue(
    ok({ object: "list", data: [{ id: "seg_other" }], has_more: false }),
  );
  sdk.segmentsAdd.mockResolvedValue(ok({ id: "seg_news" }));
  sdk.topicsUpdate.mockResolvedValue(ok({ id: "c_old" }));
  sdk.get.mockResolvedValue(ok({ id: "c_old", unsubscribed: globallyUnsubscribed }));
}

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("RESEND_NEWSLETTER_SEGMENT_ID", "seg_news");
  vi.stubEnv("RESEND_NEWSLETTER_TOPIC_ID", "topic_bac");
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  /* The account-wide flag, checked after EVERY test in this file rather than
     in one of them: whatever path a test drove, it must not have touched it.
     Collected before the reset and asserted after it, so a failure here is
     the one test's and does not leak its calls into the next. */
  const payloads = everyPayload();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  vi.restoreAllMocks();
  for (const payload of payloads) {
    expect(payload).not.toHaveProperty("unsubscribed");
  }
});

describe("contact properties", () => {
  it("carry our own unsubscribe link for this subscriber, under this site's name", () => {
    const url = new URL(contactProperties(subscriber).bac_unsubscribe_url!);
    expect(url.pathname).toBe("/bg/byuletin/otpisvane");
    expect(url.searchParams.get("token")).toBe(subscriber.unsubscribeToken);
  });

  it("never write an unprefixed key another site could also be writing", () => {
    /* Properties are account-wide: an unprefixed `unsubscribe_url` from
       buy-a-vend would replace ours and send our readers to its page. */
    expect(PROPERTY_PREFIX).toBe("bac_");
    for (const key of Object.keys(contactProperties(subscriber))) {
      expect(key.startsWith(PROPERTY_PREFIX), key).toBe(true);
    }
  });

  it("use keys Resend accepts", () => {
    /* Letters, digits and underscores, at most 50 — or every create and update
       naming them is refused. */
    for (const key of Object.values(PROPERTY_KEYS)) {
      expect(key).toMatch(/^[A-Za-z0-9_]{1,50}$/);
    }
  });
});

describe("syncSubscribed", () => {
  it.each(["RESEND_API_KEY", "RESEND_NEWSLETTER_SEGMENT_ID", "RESEND_NEWSLETTER_TOPIC_ID"])(
    "skips without %s and calls nothing",
    async (name) => {
      vi.stubEnv(name, "");
      expect((await syncSubscribed(subscriber)).status).toBe("skipped");
      expect(sdk.create).not.toHaveBeenCalled();
    },
  );

  it("creates a new contact in the segment, opted in to this site's topic", async () => {
    sdk.create.mockResolvedValue(ok({ id: "c_new", object: "contact" }));

    expect(await syncSubscribed(subscriber)).toEqual({ status: "synced", contactId: "c_new" });
    expect(sdk.create).toHaveBeenCalledWith({
      email: "ivan@firma.bg",
      segments: [{ id: "seg_news" }],
      topics: [{ id: "topic_bac", subscription: "opt_in" }],
      properties: { bac_unsubscribe_url: expect.stringContaining("token=") },
    });
    expect(sdk.update).not.toHaveBeenCalled();
  });

  it("brings an existing contact into the segment and the topic", async () => {
    existingContact();

    expect(await syncSubscribed(subscriber)).toEqual({ status: "synced", contactId: "c_old" });
    expect(sdk.update).toHaveBeenCalledWith({
      email: "ivan@firma.bg",
      properties: { bac_unsubscribe_url: expect.any(String) },
    });
    expect(sdk.segmentsAdd).toHaveBeenCalledWith({ email: "ivan@firma.bg", segmentId: "seg_news" });
    expect(sdk.topicsUpdate).toHaveBeenCalledWith({
      email: "ivan@firma.bg",
      topics: [{ id: "topic_bac", subscription: "opt_in" }],
    });
  });

  it("does not add a contact to a segment it is already in", async () => {
    existingContact();
    sdk.segmentsList.mockResolvedValue(
      ok({ object: "list", data: [{ id: "seg_news" }], has_more: false }),
    );

    expect((await syncSubscribed(subscriber)).status).toBe("synced");
    expect(sdk.segmentsAdd).not.toHaveBeenCalled();
  });

  it("leaves a contact that unsubscribed from everything unsubscribed, and says so", async () => {
    /* Someone who used "unsubscribe from all" on another site's mail. A signup
       here opts them in to our topic and goes no further: the account-wide
       flag is theirs. The afterEach check is what proves it stayed put. */
    existingContact({ globallyUnsubscribed: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect((await syncSubscribed(subscriber)).status).toBe("synced");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("newsletter.globally_unsubscribed"));
  });

  it("fails if the topic cannot be set — the topic is the subscription", async () => {
    existingContact();
    sdk.topicsUpdate.mockResolvedValue(fail("Topic not found"));

    expect((await syncSubscribed(subscriber)).status).toBe("failed");
  });

  it("retries without a property Resend has not been told about", async () => {
    /* With the property: both calls refused. Without: the create goes through. */
    sdk.create
      .mockResolvedValueOnce(fail("Property bac_unsubscribe_url does not exist"))
      .mockResolvedValueOnce(ok({ id: "c_plain", object: "contact" }));
    sdk.update.mockResolvedValueOnce(fail("Property bac_unsubscribe_url does not exist"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(await syncSubscribed(subscriber)).toEqual({ status: "synced", contactId: "c_plain" });
    expect(sdk.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        properties: undefined,
        topics: [{ id: "topic_bac", subscription: "opt_in" }],
      }),
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("bac_unsubscribe_url"));
  });

  it("reports a failure instead of throwing", async () => {
    sdk.create.mockResolvedValue(fail("Invalid API key"));
    sdk.update.mockResolvedValue(fail("Invalid API key"));
    sdk.segmentsList.mockResolvedValue(fail("Invalid API key"));

    expect((await syncSubscribed(subscriber)).status).toBe("failed");
  });

  it("logs by id, never by address", async () => {
    sdk.create.mockRejectedValue(new Error("network down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(pushSubscribed(subscriber)).resolves.toBeUndefined();
    const line = String(error.mock.calls[0]?.[0]);
    expect(line).toContain("newsletter.sync_failed");
    expect(line).toContain(subscriber.id);
    expect(line).not.toContain(subscriber.email);
  });
});

describe("syncUnsubscribed", () => {
  it("opts the contact out of this site's topic, and out of nothing else", async () => {
    sdk.topicsUpdate.mockResolvedValue(ok({ id: "c_old" }));

    expect((await syncUnsubscribed(subscriber)).status).toBe("synced");
    expect(sdk.topicsUpdate).toHaveBeenCalledWith({
      email: "ivan@firma.bg",
      topics: [{ id: "topic_bac", subscription: "opt_out" }],
    });
    /* Not the contact: leaving one site's list must not silence the others. */
    expect(sdk.update).not.toHaveBeenCalled();
    expect(sdk.create).not.toHaveBeenCalled();
  });

  it("needs no segment — the segment is left as it is", async () => {
    vi.stubEnv("RESEND_NEWSLETTER_SEGMENT_ID", "");
    sdk.topicsUpdate.mockResolvedValue(ok({ id: "c_old" }));

    expect((await syncUnsubscribed(subscriber)).status).toBe("synced");
  });

  it.each(["RESEND_API_KEY", "RESEND_NEWSLETTER_TOPIC_ID"])("skips without %s", async (name) => {
    vi.stubEnv(name, "");
    expect((await syncUnsubscribed(subscriber)).status).toBe("skipped");
    expect(sdk.topicsUpdate).not.toHaveBeenCalled();
  });

  it("reports a failure instead of throwing", async () => {
    sdk.topicsUpdate.mockResolvedValue(fail("Contact not found"));
    expect((await syncUnsubscribed(subscriber)).status).toBe("failed");
  });
});

describe("after the response", () => {
  it("hands the subscribe to after(), and runs nothing before it", async () => {
    sdk.create.mockResolvedValue(ok({ id: "c_new", object: "contact" }));

    syncSubscribedLater(subscriber);
    expect(next.after).toHaveBeenCalledOnce();
    expect(sdk.create).not.toHaveBeenCalled();

    await next.after.mock.calls[0]![0]();
    expect(sdk.create).toHaveBeenCalledOnce();
  });

  it("hands the unsubscribe to after()", async () => {
    sdk.topicsUpdate.mockResolvedValue(ok({ id: "c_old" }));

    syncUnsubscribedLater(subscriber);
    await next.after.mock.calls[0]![0]();
    expect(sdk.topicsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ topics: [{ id: "topic_bac", subscription: "opt_out" }] }),
    );
  });

  it("schedules nothing when it is not configured, and says why", () => {
    vi.stubEnv("RESEND_NEWSLETTER_TOPIC_ID", "");
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    syncSubscribedLater(subscriber);
    syncUnsubscribedLater(subscriber);
    expect(next.after).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(2);
    expect(String(info.mock.calls[0]?.[0])).toContain("newsletter.sync_skipped");
  });

  it("never throws outside a request, where after() does", () => {
    /* A script or a test calling an action directly: the row is written, and
       the copy is not worth failing it for. */
    next.after.mockImplementation(() => {
      throw new Error("`after` was called outside a request scope.");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(() => syncSubscribedLater(subscriber)).not.toThrow();
    expect(() => syncUnsubscribedLater(subscriber)).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("newsletter.sync_not_scheduled"));
    expect(sdk.create).not.toHaveBeenCalled();
  });
});
