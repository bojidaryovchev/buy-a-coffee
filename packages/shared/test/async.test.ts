import { describe, expect, it, vi } from "vitest";
import { Deadline, backoffDelayMs, mapWithConcurrency, retry, sleep } from "../src/async.ts";

describe("sleep", () => {
  it("resolves after the delay", async () => {
    const started = Date.now();
    await sleep(20);
    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(sleep(1000, controller.signal)).rejects.toThrow(/abort/i);
  });

  it("rejects when aborted mid-flight", async () => {
    const controller = new AbortController();
    const promise = sleep(5000, controller.signal);
    setTimeout(() => controller.abort(), 10);
    await expect(promise).rejects.toThrow(/abort/i);
  });
});

describe("backoffDelayMs", () => {
  it("grows exponentially and stays within the cap", () => {
    expect(backoffDelayMs(0, { baseMs: 100, maxMs: 10_000, random: () => 1 })).toBe(100);
    expect(backoffDelayMs(1, { baseMs: 100, maxMs: 10_000, random: () => 1 })).toBe(200);
    expect(backoffDelayMs(5, { baseMs: 100, maxMs: 10_000, random: () => 1 })).toBe(3200);
    expect(backoffDelayMs(50, { baseMs: 100, maxMs: 10_000, random: () => 1 })).toBe(10_000);
  });

  it("applies full jitter so retries do not synchronise", () => {
    expect(backoffDelayMs(3, { baseMs: 100, maxMs: 10_000, random: () => 0 })).toBe(0);
    expect(backoffDelayMs(3, { baseMs: 100, maxMs: 10_000, random: () => 0.5 })).toBe(400);
  });
});

describe("retry", () => {
  it("returns the first successful value", async () => {
    const fn = vi.fn(async () => "ok");
    await expect(retry(fn, { attempts: 3, baseDelayMs: 1, maxDelayMs: 2 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries until success", async () => {
    let calls = 0;
    const value = await retry(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error("boom");
        return calls;
      },
      { attempts: 5, baseDelayMs: 1, maxDelayMs: 2 },
    );
    expect(value).toBe(3);
  });

  it("gives up after the configured attempts and rethrows the last error", async () => {
    const fn = vi.fn(async () => {
      throw new Error("always");
    });
    await expect(retry(fn, { attempts: 3, baseDelayMs: 1, maxDelayMs: 2 })).rejects.toThrow("always");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("stops immediately for non-retryable errors", async () => {
    const fn = vi.fn(async () => {
      throw new Error("404");
    });
    await expect(
      retry(fn, { attempts: 5, baseDelayMs: 1, maxDelayMs: 2, isRetryable: () => false }),
    ).rejects.toThrow("404");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("reports each retry", async () => {
    const onRetry = vi.fn();
    let calls = 0;
    await retry(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error("x");
        return 1;
      },
      { attempts: 5, baseDelayMs: 1, maxDelayMs: 2, onRetry },
    );
    expect(onRetry).toHaveBeenCalledTimes(2);
  });
});

describe("mapWithConcurrency", () => {
  it("preserves input order in the output", async () => {
    const results = await mapWithConcurrency([30, 10, 20], 3, async (ms) => {
      await sleep(ms);
      return ms;
    });
    expect(results.map((r) => (r.ok ? r.value : null))).toEqual([30, 10, 20]);
  });

  it("never exceeds the concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await sleep(5);
      active -= 1;
      return null;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it("isolates failures instead of aborting the batch", async () => {
    const results = await mapWithConcurrency([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("bad");
      return n;
    });
    expect(results[0]).toEqual({ ok: true, value: 1 });
    expect(results[1]?.ok).toBe(false);
    expect(results[2]).toEqual({ ok: true, value: 3 });
  });

  it("handles an empty input", async () => {
    await expect(mapWithConcurrency([], 4, async () => 1)).resolves.toEqual([]);
  });

  it("clamps a nonsensical concurrency to at least one", async () => {
    const results = await mapWithConcurrency([1, 2], 0, async (n) => n);
    expect(results.map((r) => (r.ok ? r.value : null))).toEqual([1, 2]);
  });
});

describe("Deadline", () => {
  it("reports remaining budget from an injected clock", () => {
    let now = 1000;
    const deadline = new Deadline(500, () => now);
    expect(deadline.remainingMs).toBe(500);
    expect(deadline.expired).toBe(false);
    now = 1400;
    expect(deadline.remainingMs).toBe(100);
    now = 1600;
    expect(deadline.remainingMs).toBe(0);
    expect(deadline.expired).toBe(true);
  });
});
