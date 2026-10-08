import { describe, expect, it } from "vitest";
import { findDuplicateKeys, parseEnvText } from "../scripts/env-lib.mjs";

/**
 * The rule this file guards: a key declared twice in one env file is an error.
 *
 * Node's loader lets the last one win silently, which is how a localhost
 * DATABASE_URL once sat below a remote one and was one `env:push --apply` away
 * from production.
 */

const REMOTE = "postgres://user:remote-password@db.example.com:5432/catalog";
const LOCAL = "postgres://catalog:local-password@localhost:5433/catalog";

describe("findDuplicateKeys", () => {
  it("reports both line numbers of a repeated key", () => {
    const text = `DATABASE_URL=${REMOTE}\nOTHER=1\n\nDATABASE_URL=${LOCAL}\n`;
    expect(findDuplicateKeys(text)).toEqual([{ key: "DATABASE_URL", firstLine: 1, line: 4 }]);
  });

  it("sees through export, spacing and CRLF line endings", () => {
    const text = "export A=1\r\n  A = 2\r\n";
    expect(findDuplicateKeys(text)).toEqual([{ key: "A", firstLine: 1, line: 2 }]);
  });

  it("is silent for distinct keys, comments and a commented-out copy", () => {
    const text = `# DATABASE_URL=${LOCAL}\nDATABASE_URL=${REMOTE}\nOTHER=1\n`;
    expect(findDuplicateKeys(text)).toEqual([]);
  });

  it("does not mistake a line inside a multi-line quoted value for a key", () => {
    const text = 'KEY="first\nA=1\nlast"\nA=2\n';
    expect(findDuplicateKeys(text)).toEqual([]);
  });
});

describe("parseEnvText", () => {
  it("throws naming the file, the key and both lines", () => {
    expect(() =>
      parseEnvText(`DATABASE_URL=${REMOTE}\nX=1\nDATABASE_URL=${LOCAL}\n`, ".env"),
    ).toThrow(/\.env: DATABASE_URL is declared twice \(line 1 and line 3\)/);
  });

  it("never prints a value", () => {
    let message = "";
    try {
      parseEnvText(`DATABASE_URL=${REMOTE}\nDATABASE_URL=${LOCAL}\n`, ".env.local");
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(".env.local");
    expect(message).not.toContain("remote-password");
    expect(message).not.toContain("local-password");
    expect(message).not.toContain("db.example.com");
  });

  it("parses a clean file", () => {
    expect(parseEnvText("A=1\nB=two\n", ".env")).toEqual({ A: "1", B: "two" });
  });
});
