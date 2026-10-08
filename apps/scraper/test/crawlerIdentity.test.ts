import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigError } from "@catalog/scraper-core";
import { EXIT, commandWrites, main } from "../src/cli.ts";
import { parseEnrichArgs } from "../src/commands-catalog.ts";
import { handler } from "../src/lambda.ts";
import { createRuntime } from "../src/runtime.ts";

/**
 * The crawler-identity rule, at the three places a run starts: the CLI, the
 * Lambda handler and the runtime they share.
 *
 * Nothing here reaches a database or the network. The refusals happen before
 * a connection is opened, and the runs that are allowed to start are closed
 * again without being used (the connection pool connects lazily).
 */

const REAL_AGENT = "CatalogSync/0.1 (+catalog synchronisation; contact: sync@acme-coffee.bg)";
/** Port 1 on loopback: a pool pointed here is never connected, only built. */
const UNUSED_DATABASE = "postgres://nobody:nothing@127.0.0.1:1/unused";

const ENV_KEYS = ["CRAWL_USER_AGENT", "DATABASE_URL", "DATABASE_URL_SECRET_ARN"] as const;
let saved: Record<string, string | undefined>;
let stderr: string;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  stderr = "";
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderr += String(chunk);
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("commandWrites", () => {
  it.each([
    [["sync"]],
    [["sync", "--no-images"]],
    [["sync", "--dry-run=false"]],
    [["discovery"]],
    [["discovery", "--max-pages", "50"]],
    [["reference"]],
    [["catalog:enrich", "--apply"]],
    [["catalog:enrich", "--limit", "10", "--apply"]],
    [["catalog:link", "some-slug", "/some-key/#1000g", "--apply"]],
  ])("treats %j as a run that writes", (argv) => {
    expect(commandWrites(argv)).toBe(true);
  });

  it.each([
    [["sync", "--dry-run"]],
    [["sync", "--dry-run=true"]],
    [["discovery", "--dry-run"]],
    [["catalog:enrich"]],
    [["catalog:enrich", "--limit", "10"]],
    [["catalog:link", "some-slug", "/some-key/#1000g"]],
    [["catalog:verify"]],
    [["status"]],
    [["images:verify"]],
    [["help"]],
    [[]],
  ])("treats %j as a run that does not", (argv) => {
    expect(commandWrites(argv)).toBe(false);
  });
});

describe("createRuntime", () => {
  it("refuses a run that writes while the contact is the placeholder", async () => {
    // No database is configured at all: had it got that far, the error would
    // be about the connection string, not about the user agent.
    await expect(createRuntime({ writes: true })).rejects.toThrow(ConfigError);
    await expect(createRuntime({ writes: true })).rejects.toThrow(/CRAWL_USER_AGENT/);
  });

  it("starts a run that writes once the contact is real", async () => {
    process.env.CRAWL_USER_AGENT = REAL_AGENT;
    process.env.DATABASE_URL = UNUSED_DATABASE;
    const runtime = await createRuntime({ writes: true, overrides: { logLevel: "error" } });
    expect(runtime.config.userAgent).toBe(REAL_AGENT);
    await runtime.close();
  });

  it("starts a dry run with the placeholder, and by default", async () => {
    process.env.DATABASE_URL = UNUSED_DATABASE;
    for (const options of [{ writes: false }, {}]) {
      const runtime = await createRuntime({ ...options, overrides: { logLevel: "error" } });
      expect(runtime.config.userAgent).toContain("example.com");
      await runtime.close();
    }
  });
});

describe("the CLI", () => {
  it.each([
    [["sync"]],
    [["discovery"]],
    [["reference"]],
    [["catalog:enrich", "--apply"]],
    [["catalog:link", "some-slug", "/some-key/#1000g", "--apply"]],
  ])("exits with a usage error for %j under the placeholder contact", async (argv) => {
    expect(await main(argv)).toBe(EXIT.usage);
    expect(stderr).toContain("CRAWL_USER_AGENT is not acceptable for a run that writes");
    expect(stderr).toContain("ops@example.com");
  });

  it("lets the same commands past the identity check when they will not write", async () => {
    // Each goes on to need a database, which is not configured here — so the
    // failure it reports is that one, proving the identity rule let it through.
    for (const argv of [["sync", "--dry-run"], ["catalog:enrich"], ["catalog:verify"]]) {
      stderr = "";
      expect(await main(argv)).toBe(EXIT.usage);
      expect(stderr).toContain("DATABASE_URL");
      expect(stderr).not.toContain("CRAWL_USER_AGENT");
    }
  });
});

describe("the Lambda handler", () => {
  it("refuses a scheduled sync under the placeholder contact", async () => {
    await expect(handler({})).rejects.toThrow(ConfigError);
    await expect(handler({ job: "sync", dryRun: false })).rejects.toThrow(/CRAWL_USER_AGENT/);
  });

  it("refuses a discovery crawl under the placeholder contact", async () => {
    await expect(handler({ job: "discovery" })).rejects.toThrow(ConfigError);
  });

  it("lets an explicit dry run past the identity check", async () => {
    // Stopped by the missing database instead, before anything is requested.
    await expect(handler({ dryRun: true })).rejects.toThrow(/DATABASE_URL/);
  });
});

describe("catalog:enrich arguments", () => {
  it("plans by default and applies only when told to", () => {
    expect(parseEnrichArgs([])).toEqual({ apply: false, limit: undefined });
    expect(parseEnrichArgs(["--apply"])).toEqual({ apply: true, limit: undefined });
  });

  it("reads --limit in both spellings", () => {
    expect(parseEnrichArgs(["--limit", "25", "--apply"])).toEqual({ apply: true, limit: 25 });
    expect(parseEnrichArgs(["--limit=0"])).toEqual({ apply: false, limit: 0 });
    expect(parseEnrichArgs(["--verbose", "--limit=7"])).toEqual({ apply: false, limit: 7 });
  });

  it("rejects a limit that is not a whole number, and anything it does not know", () => {
    expect(parseEnrichArgs(["--limit"])).toBeNull();
    expect(parseEnrichArgs(["--limit", "ten"])).toBeNull();
    expect(parseEnrichArgs(["--limit=-3"])).toBeNull();
    expect(parseEnrichArgs(["--limit", "--apply"])).toBeNull();
    expect(parseEnrichArgs(["--aply"])).toBeNull();
    expect(parseEnrichArgs(["some-slug"])).toBeNull();
  });
});
