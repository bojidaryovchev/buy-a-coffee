import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ConfigError,
  DEFAULT_USER_AGENT,
  assertCrawlerIdentity,
  crawlerContactProblem,
  loadConfig,
} from "../src/config.ts";

const REAL =
  "KafeZonaCatalogSync/0.1 (+catalog synchronisation for an authorised reseller; contact: sync@acme-coffee.bg)";

describe("crawlerContactProblem", () => {
  it("rejects the shipped default", () => {
    expect(crawlerContactProblem(DEFAULT_USER_AGENT)).toMatch(/placeholder/);
    expect(crawlerContactProblem(DEFAULT_USER_AGENT)).toContain("ops@example.com");
  });

  it("accepts a real mailbox", () => {
    expect(crawlerContactProblem(REAL)).toBeNull();
  });

  it("accepts a real URL instead of a mailbox", () => {
    expect(crawlerContactProblem("Bot/1.0 (+https://acme-coffee.bg/crawler)")).toBeNull();
  });

  it.each([
    "Bot/1.0 (contact: someone@example.com)",
    "Bot/1.0 (contact: someone@example.org)",
    "Bot/1.0 (contact: someone@mail.example.net)",
    "Bot/1.0 (contact: someone@corp.example)",
    "Bot/1.0 (contact: someone@corp.test)",
    "Bot/1.0 (contact: someone@corp.invalid)",
    "Bot/1.0 (contact: someone@localhost)",
    "Bot/1.0 (+http://localhost:3000/about)",
    "Bot/1.0 (+https://example.com/bot)",
    "Bot/1.0 (+http://127.0.0.1/bot)",
  ])("rejects a contact on a reserved host: %s", (agent) => {
    expect(crawlerContactProblem(agent)).toMatch(/placeholder/);
  });

  it("rejects a user agent that names no contact at all", () => {
    expect(crawlerContactProblem("Bot/1.0")).toMatch(/no e-mail address or URL/);
    expect(crawlerContactProblem("Bot/1.0 (contact: ask the office)")).toMatch(
      /no e-mail address or URL/,
    );
  });

  it("rejects a template that was only half filled in", () => {
    expect(crawlerContactProblem("Bot/1.0 (contact: <your-email>, sync@acme-coffee.bg)")).toMatch(
      /template/,
    );
    expect(crawlerContactProblem("Bot/1.0 (contact: changeme@acme-coffee.bg)")).toMatch(/template/);
  });

  it("rejects a real contact kept next to a placeholder one", () => {
    expect(crawlerContactProblem("Bot/1.0 (sync@acme-coffee.bg; ops@example.com)")).toMatch(
      /placeholder/,
    );
  });
});

describe("assertCrawlerIdentity", () => {
  it("refuses a run that writes while the contact is a placeholder, and says what to set", () => {
    const config = loadConfig({}, {});
    expect(config.userAgent).toBe(DEFAULT_USER_AGENT);

    let error: unknown;
    try {
      assertCrawlerIdentity(config, { writes: true });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const message = (error as Error).message;
    expect(message).toContain("CRAWL_USER_AGENT");
    expect(message).toContain("ops@example.com");
    expect(message).toContain("contact:");
    expect(message).toContain("--dry-run");
  });

  it("lets a dry run or a test through with the placeholder", () => {
    expect(() => assertCrawlerIdentity(loadConfig({}, {}), { writes: false })).not.toThrow();
  });

  it("lets a run that writes through once the contact is real", () => {
    const config = loadConfig({}, { CRAWL_USER_AGENT: REAL });
    expect(() => assertCrawlerIdentity(config, { writes: true })).not.toThrow();
  });
});

describe("loadConfig", () => {
  it("keeps working with the placeholder by default, so tests and dry runs need no setup", () => {
    expect(() => loadConfig({}, {})).not.toThrow();
    expect(() => loadConfig({}, {}, { writes: false })).not.toThrow();
  });

  it("refuses to load for a run that writes when the user agent is still the placeholder", () => {
    expect(() => loadConfig({}, {}, { writes: true })).toThrow(ConfigError);
    expect(() =>
      loadConfig({}, { CRAWL_USER_AGENT: "Bot/1.0 (a@example.com)" }, { writes: true }),
    ).toThrow(/CRAWL_USER_AGENT/);
  });

  it("loads for a run that writes once CRAWL_USER_AGENT is real", () => {
    const config = loadConfig({}, { CRAWL_USER_AGENT: REAL }, { writes: true });
    expect(config.userAgent).toBe(REAL);
  });

  it("reports a bad value of an unrelated setting before the identity", () => {
    expect(() => loadConfig({}, { CRAWL_CONCURRENCY: "0" }, { writes: true })).toThrow(
      /CRAWL_CONCURRENCY/,
    );
  });
});

describe(".env.example", () => {
  const example = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env.example"),
    "utf8",
  );

  it("documents the setting, and its default is the placeholder the rule refuses", () => {
    const line = example.split(/\r?\n/).find((entry) => entry.startsWith("CRAWL_USER_AGENT="));
    expect(line).toBeDefined();
    expect(line?.slice("CRAWL_USER_AGENT=".length)).toBe(DEFAULT_USER_AGENT);
    expect(example).toMatch(/refuses to start/);
    expect(example).toMatch(/--dry-run/);
  });
});
