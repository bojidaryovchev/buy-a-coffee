import { describe, expect, it } from "vitest";
import {
  contactSchema,
  newsletterSchema,
  normalizePhone,
  orderInquirySchema,
  toFieldErrors,
} from "@/lib/forms/schemas";
import { createRateLimiter, idempotencyKey } from "@/lib/rate-limit";

/**
 * Form validation is the gate on every public write endpoint. These tests pin
 * the rules that keep bad or hostile input out of the database.
 */

describe("normalizePhone", () => {
  it("converts the national form to international", () => {
    expect(normalizePhone("0888123456")).toBe("+359888123456");
    expect(normalizePhone("0888 123 456")).toBe("+359888123456");
  });

  it("strips formatting characters", () => {
    expect(normalizePhone("+359 (888) 123-456")).toBe("+359888123456");
  });

  it("leaves an already-international number alone", () => {
    expect(normalizePhone("+359888123456")).toBe("+359888123456");
  });
});

describe("orderInquirySchema", () => {
  const valid = { productSlug: "coffee-1", phone: "0888 123 456", quantity: 2 };

  it("accepts a minimal valid enquiry", () => {
    const result = orderInquirySchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.phone).toBe("+359888123456");
      expect(result.data.quantity).toBe(2);
    }
  });

  it("defaults the quantity to one", () => {
    const result = orderInquirySchema.safeParse({ productSlug: "x", phone: "0888123456" });
    expect(result.success && result.data.quantity).toBe(1);
  });

  it("rejects an obviously invalid phone number", () => {
    for (const phone of ["", "123", "not a phone", "++++++"]) {
      expect(orderInquirySchema.safeParse({ ...valid, phone }).success).toBe(false);
    }
  });

  it("rejects an absurd quantity", () => {
    expect(orderInquirySchema.safeParse({ ...valid, quantity: 0 }).success).toBe(false);
    expect(orderInquirySchema.safeParse({ ...valid, quantity: 1000 }).success).toBe(false);
  });

  it("bounds the notes field", () => {
    expect(orderInquirySchema.safeParse({ ...valid, notes: "x".repeat(2000) }).success).toBe(false);
  });

  it("rejects a filled honeypot", () => {
    // A bot that fills every field is caught here and stores nothing.
    const result = orderInquirySchema.safeParse({ ...valid, website: "http://spam.test" });
    expect(result.success).toBe(false);
    if (!result.success) expect(toFieldErrors(result.error).website).toBeDefined();
  });

  it("accepts an empty honeypot", () => {
    expect(orderInquirySchema.safeParse({ ...valid, website: "" }).success).toBe(true);
  });

  it("accepts an optional email but rejects a malformed one", () => {
    expect(orderInquirySchema.safeParse({ ...valid, email: "" }).success).toBe(true);
    expect(orderInquirySchema.safeParse({ ...valid, email: "a@b.co" }).success).toBe(true);
    expect(orderInquirySchema.safeParse({ ...valid, email: "not-an-email" }).success).toBe(false);
  });
});

describe("newsletterSchema", () => {
  it("normalises the email address", () => {
    const result = newsletterSchema.safeParse({ email: "  Person@Example.COM " });
    expect(result.success && result.data.email).toBe("person@example.com");
  });

  it("rejects an invalid address", () => {
    expect(newsletterSchema.safeParse({ email: "nope" }).success).toBe(false);
    expect(newsletterSchema.safeParse({ email: "" }).success).toBe(false);
  });

  it("rejects a filled honeypot", () => {
    expect(newsletterSchema.safeParse({ email: "a@b.co", website: "spam" }).success).toBe(false);
  });
});

describe("contactSchema", () => {
  const valid = {
    name: "Ada",
    email: "ada@example.com",
    message: "I would like to know more about your beans.",
  };

  it("accepts a valid message", () => {
    expect(contactSchema.safeParse(valid).success).toBe(true);
  });

  it("requires a message of reasonable length", () => {
    expect(contactSchema.safeParse({ ...valid, message: "hi" }).success).toBe(false);
    expect(contactSchema.safeParse({ ...valid, message: "x".repeat(5000) }).success).toBe(false);
  });

  it("requires a name", () => {
    expect(contactSchema.safeParse({ ...valid, name: "A" }).success).toBe(false);
  });

  it("treats the phone as optional", () => {
    expect(contactSchema.safeParse({ ...valid, phone: "" }).success).toBe(true);
    expect(contactSchema.safeParse({ ...valid, phone: "0888123456" }).success).toBe(true);
  });
});

describe("toFieldErrors", () => {
  it("returns one message per field", () => {
    const result = contactSchema.safeParse({ name: "", email: "bad", message: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = toFieldErrors(result.error);
      expect(Object.keys(errors).sort()).toEqual(["email", "message", "name"]);
    }
  });
});

describe("createRateLimiter", () => {
  it("allows up to the limit and then blocks", () => {
    const now = 0;
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000, now: () => now });
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(false);
  });

  it("keeps separate counters per key", () => {
    const now = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => now });
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("b").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(false);
  });

  it("resets once the window has passed", () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => now });
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(false);
    now = 1001;
    expect(limiter.check("a").allowed).toBe(true);
  });

  it("reports the remaining allowance", () => {
    const now = 0;
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => now });
    expect(limiter.check("a").remaining).toBe(1);
    expect(limiter.check("a").remaining).toBe(0);
    expect(limiter.check("a").remaining).toBe(0);
  });
});

describe("idempotencyKey", () => {
  it("collapses repeated submissions inside one window", () => {
    // A double-clicked button must not create two orders.
    const a = idempotencyKey(["inquiry", "+359888123456", "/coffee/"], 300_000, 1_000_000);
    const b = idempotencyKey(["inquiry", "+359888123456", "/coffee/"], 300_000, 1_000_100);
    expect(a).toBe(b);
  });

  it("allows a genuine second order in a later window", () => {
    const a = idempotencyKey(["inquiry", "+359888123456", "/coffee/"], 300_000, 1_000_000);
    const b = idempotencyKey(["inquiry", "+359888123456", "/coffee/"], 300_000, 2_000_000);
    expect(a).not.toBe(b);
  });

  it("distinguishes different products and callers", () => {
    const base = idempotencyKey(["inquiry", "+359888123456", "/a/"], 300_000, 1_000_000);
    expect(idempotencyKey(["inquiry", "+359888123456", "/b/"], 300_000, 1_000_000)).not.toBe(base);
    expect(idempotencyKey(["inquiry", "+359888999999", "/a/"], 300_000, 1_000_000)).not.toBe(base);
  });
});
