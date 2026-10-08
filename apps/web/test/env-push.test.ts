import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  classifyExtras,
  describeLocalOnlyValues,
  findLocalOnlyValues,
  localOnlyHostReason,
} from "../scripts/env-lib.mjs";
import { retired } from "../env.schema.mjs";

/**
 * The rule this file guards: env:push never sends a value that only works on the
 * developer's machine to a deployed target, and never prints a credential saying
 * so.
 */

const GUARDED = ["DATABASE_URL", "NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_IMAGE_BASE_URL"] as const;
const TARGET_SETS = [["production"], ["preview"], ["production", "preview"]];

const wrap = (name: string, value: string, target: string[]) => ({
  spec: { name },
  entry: { key: name, value, target },
});

describe("localOnlyHostReason", () => {
  it.each([
    "http://localhost:3000",
    "https://LOCALHOST",
    "http://127.0.0.1:3000",
    "http://[::1]:3000",
    "postgres://catalog:pw@localhost:5433/catalog",
    "postgres://catalog:pw@db:5432/catalog",
    "http://web",
  ])("refuses %s", (value) => {
    expect(localOnlyHostReason(value)).toEqual(expect.any(String));
  });

  it.each([
    "https://buy-a-coffee.com",
    "https://d111111abcdef8.cloudfront.net",
    "postgres://u:pw@ep-cool-name.eu-central-1.aws.neon.tech/catalog?sslmode=require",
    "not a url",
  ])("lets %s through", (value) => {
    expect(localOnlyHostReason(value)).toBeNull();
  });
});

describe("findLocalOnlyValues", () => {
  for (const name of GUARDED) {
    for (const target of TARGET_SETS) {
      it(`refuses a localhost ${name} for ${target.join(", ")}`, () => {
        const problems = findLocalOnlyValues([wrap(name, "http://localhost:3000", target)]);
        expect(problems).toHaveLength(1);
        expect(problems[0]?.name).toBe(name);
        expect(problems[0]?.targets).toEqual(target);
      });
    }
  }

  it("passes a legitimate remote value for every guarded variable", () => {
    const desired = GUARDED.map((name) => wrap(name, "https://real.example.com/x", ["production"]));
    expect(findLocalOnlyValues(desired)).toEqual([]);
  });

  it("ignores variables that are not places, and entries with no target", () => {
    expect(
      findLocalOnlyValues([
        wrap("RATE_LIMIT_SALT", "http://localhost", ["production"]),
        wrap("DATABASE_URL", "http://localhost", []),
      ]),
    ).toEqual([]);
  });

  it("says which variable and why, without printing the credential", () => {
    const text = describeLocalOnlyValues(
      findLocalOnlyValues([
        wrap("DATABASE_URL", "postgres://catalog:hunter2@localhost:5433/catalog", ["production"]),
      ]),
    );
    expect(text).toContain("DATABASE_URL");
    expect(text).toContain("production");
    expect(text).toContain('host "localhost"');
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("5433");
  });
});

describe("classifyExtras", () => {
  it("separates retired names from unknown ones", () => {
    const existing = [
      { key: "NEXT_PUBLIC_SITE_INDEXABLE", target: ["production"] },
      { key: "SOMETHING_NEW", target: ["production"] },
      { key: "DATABASE_URL", target: ["production"] },
    ];
    const result = classifyExtras(existing, new Set(["DATABASE_URL"]), retired);
    expect(result.retired.map((e: { key: string }) => e.key)).toEqual([
      "NEXT_PUBLIC_SITE_INDEXABLE",
    ]);
    expect(result.retired[0].why).toEqual(expect.any(String));
    expect(result.unknown.map((e: { key: string }) => e.key)).toEqual(["SOMETHING_NEW"]);
  });

  it("lists both variables the codebase no longer reads", () => {
    expect(retired.map((r: { name: string }) => r.name).sort()).toEqual([
      "NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY",
      "NEXT_PUBLIC_SITE_INDEXABLE",
    ]);
  });
});

/* The command itself, offline and from an empty directory so no real .env file
   is read. It must refuse, exit non-zero and say nothing secret. */
describe("env-push --offline", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "env-push-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const script = path.resolve(import.meta.dirname, "../scripts/env-push.mjs");

  const run = (env: Record<string, string>) =>
    spawnSync(process.execPath, [script, "--offline"], {
      cwd: dir,
      env: { PATH: process.env.PATH ?? "", ...env } as unknown as NodeJS.ProcessEnv,
      encoding: "utf8",
    });

  it("refuses a localhost DATABASE_URL", () => {
    const result = run({ DATABASE_URL: "postgres://catalog:hunter2@localhost:5433/catalog" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("DATABASE_URL");
    expect(result.stderr).toContain("localhost");
    expect(result.stderr + result.stdout).not.toContain("hunter2");
  });

  it("accepts a remote DATABASE_URL", () => {
    const result = run({ DATABASE_URL: "postgres://u:hunter2@db.example.com/catalog" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("DATABASE_URL");
    expect(result.stdout).not.toContain("hunter2");
  });

  it("refuses a file that declares DATABASE_URL twice", () => {
    writeFileSync(
      path.join(dir, ".env"),
      "DATABASE_URL=postgres://u:p@db.example.com/x\nDATABASE_URL=postgres://u:p@localhost/x\n",
    );
    const result = run({});
    rmSync(path.join(dir, ".env"));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(".env: DATABASE_URL is declared twice (line 1 and line 2)");
  });
});
