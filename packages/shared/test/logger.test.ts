import { describe, expect, it } from "vitest";
import { createLogger, redact, scrubSecretsInString } from "../src/logger.ts";

function capture(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
}

describe("createLogger", () => {
  it("emits one JSON object per line", () => {
    const { lines, write } = capture();
    createLogger({ write, now: () => new Date("2026-01-01T00:00:00Z") }).info("hello", { a: 1 });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({
      level: "info",
      time: "2026-01-01T00:00:00.000Z",
      msg: "hello",
      a: 1,
    });
  });

  it("respects the level threshold", () => {
    const { lines, write } = capture();
    const log = createLogger({ write, level: "warn" });
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(lines.map((l) => JSON.parse(l).level)).toEqual(["warn", "error"]);
  });

  it("stamps child context onto every line", () => {
    const { lines, write } = capture();
    createLogger({ write }).child({ syncRunId: "run-1" }).info("x", { stage: "fetch" });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.syncRunId).toBe("run-1");
    expect(parsed.stage).toBe("fetch");
  });

  it("never writes secrets", () => {
    const { lines, write } = capture();
    createLogger({ write }).info("connecting", {
      databaseUrl: "postgres://user:pw@host/db",
      password: "hunter2",
      "x-tenant-key": "kz1_secret",
      phone: "0888123456",
      safe: "visible",
    });
    const line = lines[0]!;
    expect(line).not.toContain("hunter2");
    expect(line).not.toContain("kz1_secret");
    expect(line).not.toContain("0888123456");
    expect(line).toContain("visible");
    expect(JSON.parse(line).databaseUrl).toBe("[redacted]");
  });

  it("scrubs a connection string embedded in a message", () => {
    const { lines, write } = capture();
    createLogger({ write }).error("failed on postgres://u:p@h:5432/db while syncing");
    expect(lines[0]).not.toContain("u:p@h");
    expect(lines[0]).toContain("[redacted]");
  });

  it("serialises Error objects usefully", () => {
    const { lines, write } = capture();
    createLogger({ write }).error("boom", { err: new TypeError("bad input") });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.err.name).toBe("TypeError");
    expect(parsed.err.message).toBe("bad input");
  });

  it("does not throw on circular structures", () => {
    const { lines, write } = capture();
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(() => createLogger({ write }).info("c", { circular })).not.toThrow();
    expect(lines).toHaveLength(1);
  });
});

describe("redact", () => {
  it("limits recursion depth", () => {
    let deep: Record<string, unknown> = { value: 1 };
    for (let i = 0; i < 20; i += 1) deep = { nested: deep };
    expect(JSON.stringify(redact(deep))).toContain("depth-limited");
  });

  it("truncates very large arrays", () => {
    const result = redact(Array.from({ length: 1000 }, (_, i) => i)) as unknown[];
    expect(result).toHaveLength(200);
  });

  it("stringifies bigint", () => {
    expect(redact(5n)).toBe("5");
  });
});

describe("scrubSecretsInString", () => {
  it("masks AWS access key ids", () => {
    expect(scrubSecretsInString("key AKIAIOSFODNN7EXAMPLE here")).toContain("[redacted-aws-key]");
  });
});
