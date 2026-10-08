import { afterEach, describe, expect, it } from "vitest";
import { checkCronAuth, guardCron } from "@/lib/cron-auth";

const SECRET = "s3cret-value-for-tests";

describe("checkCronAuth", () => {
  it("accepts the exact bearer header", () => {
    expect(checkCronAuth(`Bearer ${SECRET}`, SECRET)).toBe("ok");
  });

  it("pretends the route does not exist when no secret is configured", () => {
    expect(checkCronAuth(`Bearer ${SECRET}`, undefined)).toBe("not_found");
    expect(checkCronAuth(`Bearer ${SECRET}`, "")).toBe("not_found");
    expect(checkCronAuth(null, undefined)).toBe("not_found");
  });

  it("does not let an empty secret match an empty bearer", () => {
    expect(checkCronAuth("Bearer ", "")).toBe("not_found");
  });

  it.each([
    ["a missing header", null],
    ["an empty header", ""],
    ["the secret without the scheme", SECRET],
    ["another scheme", `Basic ${SECRET}`],
    ["a lower-case scheme", `bearer ${SECRET}`],
    ["a wrong secret of the same length", `Bearer ${"x".repeat(SECRET.length)}`],
    ["a prefix of the secret", `Bearer ${SECRET.slice(0, -1)}`],
    ["the secret with a suffix", `Bearer ${SECRET}x`],
  ])("rejects %s", (_name, header) => {
    expect(checkCronAuth(header, SECRET)).toBe("unauthorized");
  });
});

describe("guardCron", () => {
  const original = process.env.CRON_SECRET;
  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  const request = (authorization?: string) =>
    new Request("https://example.test/api/cron/x", {
      headers: authorization ? { authorization } : {},
    });

  it("answers 404 with no secret configured", () => {
    delete process.env.CRON_SECRET;
    expect(guardCron(request(`Bearer ${SECRET}`))?.status).toBe(404);
  });

  it("answers 401 for a wrong or absent header", () => {
    process.env.CRON_SECRET = SECRET;
    expect(guardCron(request())?.status).toBe(401);
    expect(guardCron(request("Bearer nope"))?.status).toBe(401);
  });

  it("lets a correct header through", () => {
    process.env.CRON_SECRET = SECRET;
    expect(guardCron(request(`Bearer ${SECRET}`))).toBeNull();
  });
});
