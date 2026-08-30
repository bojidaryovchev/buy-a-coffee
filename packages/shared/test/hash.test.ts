import { describe, expect, it } from "vitest";
import { semanticHash, sha256Hex, shortHash, stableStringify } from "../src/hash.ts";

describe("sha256Hex", () => {
  it("matches the known digest of the empty string", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe("stableStringify", () => {
  it("is insensitive to key order", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });

  it("sorts nested keys too", () => {
    expect(stableStringify({ x: { b: 1, a: 2 } })).toBe(stableStringify({ x: { a: 2, b: 1 } }));
  });

  it("preserves array order, which is meaningful", () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it("omits undefined but keeps null", () => {
    expect(stableStringify({ a: undefined, b: null })).toBe('{"b":null}');
  });

  it("serialises bigint and Date deterministically", () => {
    expect(stableStringify({ a: 10n })).toBe('{"a":"10"}');
    expect(stableStringify({ d: new Date("2024-01-01T00:00:00.000Z") })).toBe(
      '{"d":"2024-01-01T00:00:00.000Z"}',
    );
  });
});

describe("semanticHash", () => {
  it("is stable for equivalent inputs", () => {
    expect(semanticHash({ name: "a", price: "1.00" })).toBe(
      semanticHash({ price: "1.00", name: "a" }),
    );
  });

  it("changes when any field changes", () => {
    expect(semanticHash({ price: "1.00" })).not.toBe(semanticHash({ price: "1.01" }));
  });

  it("distinguishes null from missing", () => {
    expect(semanticHash({ a: null })).not.toBe(semanticHash({}));
  });

  it("distinguishes the string 1 from the number 1", () => {
    expect(semanticHash({ a: 1 })).not.toBe(semanticHash({ a: "1" }));
  });
});

describe("shortHash", () => {
  it("truncates", () => {
    expect(shortHash(sha256Hex("x"), 8)).toHaveLength(8);
  });
});
