import { describe, expect, it } from "vitest";
import { normalizeForComparison } from "@catalog/shared";
import {
  type ReviewContext,
  correctionHeldBack,
  differsFromStored,
  independentHosts,
  paragraphsToHtml,
  reviewBatch,
  siteOf,
} from "../src/catalog/copywriter/apply.ts";
import { auditGeneratedCopy, statedPackSizes } from "../src/catalog/copywriter/audit.ts";
import {
  ClaudeRunError,
  childEnvironment,
  claudeArgs,
  classifyFailure,
  exitFailure,
  parseClaudeEnvelope,
} from "../src/catalog/copywriter/claude.ts";
import {
  COPY_OUTPUT_JSON_SCHEMA,
  type CopyResearch,
  type CopyWorkItem,
  LIMITS,
  copyOutputSchema,
} from "../src/catalog/copywriter/contract.ts";
import { MAX_RESEARCH_PER_BATCH, scrubForLog, toBatches } from "../src/catalog/copywriter/run.ts";
import {
  type CopyCandidate,
  MAX_COPY_ATTEMPTS,
  copySourceHash,
  readStoredResearch,
  researchBasis,
  researchReasons,
  selectCopyWork,
} from "../src/catalog/copywriter/select.ts";
import { createSourceCheck, printsNumber } from "../src/catalog/copywriter/verify.ts";

/* --- Fixtures ------------------------------------------------------------- */

let sequence = 0;

function candidate(overrides: Partial<CopyCandidate> = {}): CopyCandidate {
  sequence += 1;
  return {
    id: `id-${sequence}`,
    slug: `product-${sequence}`,
    status: "active",
    name: `Lavazza Crema e Aroma ${sequence} 1кг.`,
    sourceKey: `/product-${sequence}/`,
    brandName: "Lavazza",
    brandSourceKey: "lavazza",
    categoryKeys: ["kafe-na-zarna"],
    descriptionText:
      "Lavazza Crema e Aroma is a rich blend of arabica and robusta with notes of chocolate.",
    summary: null,
    bodyParagraphs: [],
    weightValue: "1000.0000",
    weightUnit: "g",
    price: "20.00",
    arabicaPercent: 60,
    origin: null,
    roast: null,
    attributes: {},
    characteristics: [],
    sourceData: {},
    copyOrigin: null,
    copySourceHash: null,
    copyAttempts: 0,
    packOverrideValue: null,
    research: null,
    lastChangedAt: new Date("2026-10-01T00:00:00Z"),
    ...overrides,
  };
}

function workItem(overrides: Partial<CopyWorkItem> = {}): CopyWorkItem {
  return {
    id: "id-x",
    slug: "product-x",
    title: "Lavazza Crema e Aroma",
    brand: "Lavazza",
    format: "Кафе на зърна",
    kind: "roasted",
    pack: { label: "1 кг", inName: null, inPackField: null, mayState: true },
    priceEur: "20.00",
    facts: { arabicaPercent: 60, origin: null, roast: null, attributes: {}, characteristics: [] },
    sourceDescription:
      "Lavazza Crema e Aroma is a rich blend of arabica and robusta with notes of chocolate.",
    siblingSummaries: [],
    task: { writeCopy: true, research: false, researchReasons: [] },
    ...overrides,
  };
}

const GOOD_COPY = {
  summary:
    "Италиански бленд с 60 % арабика — кадифено тяло, гъста крема и шоколадов оттенък в чашата.",
  body: [
    "Съставът съчетава арабика с робуста: първата носи аромата, втората плътността и кремата.",
    "Килограмовата опаковка е удобна за офис или за дом с автоматична кафемашина, където се пият по няколко чаши на ден.",
  ],
};

const HIGH_CORRECTION: CopyResearch = {
  verdict: "corrected",
  pack: {
    value: 20,
    unit: "pc",
    confidence: "high",
    sources: ["https://www.illy.com/tin-20", "https://shop.example.de/illy-20"],
  },
  findings: [],
  note: "The manufacturer and a German shop both list 20 pods.",
};

type Pack = NonNullable<CopyResearch["pack"]>;
const HIGH_PACK = HIGH_CORRECTION.pack as Pack;
const withPack = (pack: Partial<Pack>, research: Partial<CopyResearch> = {}): CopyResearch => ({
  ...HIGH_CORRECTION,
  ...research,
  pack: { ...HIGH_PACK, ...pack },
});

const withBody = (...extra: string[]) => ({ ...GOOD_COPY, body: [...GOOD_COPY.body, ...extra] });

const pass = async () => null;

/* --- The model call --------------------------------------------------------- */

describe("claude CLI arguments", () => {
  const args = claudeArgs("batch-1.json", { model: "claude-opus-5-5", maxTurns: 80 });
  const value = (flag: string) => args[args.indexOf(flag) + 1];

  it("invokes the skill on the batch file", () => {
    expect(value("-p")).toBe("/catalog-copy batch-1.json");
  });

  it("passes the output contract as one JSON argument", () => {
    expect(JSON.parse(value("--json-schema") as string)).toEqual(COPY_OUTPUT_JSON_SCHEMA);
  });

  it("allows reading the workspace and the web, and nothing that runs or writes", () => {
    expect(value("--tools")).toBe("Read,WebSearch,WebFetch");
    expect(value("--allowedTools")).toBe("Read(./**),WebSearch,WebFetch");
    expect(args.join(" ")).not.toMatch(/Bash|Edit|Write|bypassPermissions/);
    expect(args).toContain("--strict-mcp-config");
    expect(value("--permission-mode")).toBe("dontAsk");
    expect(value("--permission-prompts")).toBe("none");
  });

  it("hands the CLI none of this process's secrets", () => {
    const env = childEnvironment({
      PATH: "/usr/bin",
      Path: "C:\\Windows",
      HOME: "/home/runner",
      SystemRoot: "C:\\Windows",
      CLAUDE_CODE_OAUTH_TOKEN: "token",
      ANTHROPIC_API_KEY: "",
      DATABASE_URL: "postgres://user:secret@host/db",
      BLOB_READ_WRITE_TOKEN: "blob",
      GITHUB_TOKEN: "gh",
    });
    expect(env).toEqual({
      PATH: "/usr/bin",
      Path: "C:\\Windows",
      HOME: "/home/runner",
      SystemRoot: "C:\\Windows",
      CLAUDE_CODE_OAUTH_TOKEN: "token",
    });
  });

  it("strips the line breaks a token picks up when copied out of a terminal", () => {
    const env = childEnvironment({
      CLAUDE_CODE_OAUTH_TOKEN: " sk-ant-oat01-abc\n  def\r\nghi \n",
    });
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("sk-ant-oat01-abcdefghi");
  });
});

describe("parseClaudeEnvelope", () => {
  it("returns the structured output, cost and turns", () => {
    const parsed = parseClaudeEnvelope(
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "done",
        structured_output: { products: [] },
        total_cost_usd: 0.42,
        num_turns: 7,
      }),
    );
    expect(parsed).toEqual({ output: { products: [] }, costUsd: 0.42, turns: 7 });
  });

  it("classifies running out of turns as the batch's failure", () => {
    try {
      parseClaudeEnvelope(
        JSON.stringify({ subtype: "error_max_turns", is_error: true, result: "usage limit" }),
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ClaudeRunError);
      expect((error as ClaudeRunError).failure).toBe("batch");
    }
  });

  it("classifies by what the CLI says, not by any number on a page", () => {
    expect(classifyFailure("Invalid API key · Please run /login")).toBe("setup");
    expect(classifyFailure("API Error: 401 authentication_error")).toBe("setup");
    expect(classifyFailure("Claude AI usage limit reached|1760000000")).toBe("service");
    expect(classifyFailure("API Error: 529 Overloaded")).toBe("service");
    expect(classifyFailure("API Error: 500 Internal server error")).toBe("service");
    expect(classifyFailure("Connection error.")).toBe("service");
    // A web page's 403, or "catalog in" in prose, is nobody's sign-in problem.
    expect(classifyFailure("WebFetch returned 403 for the shop's page")).toBe("unknown");
    expect(classifyFailure("added the item to the catalog in stock")).toBe("unknown");
    expect(classifyFailure("The model returned something odd")).toBe("unknown");
  });

  it("knows the service's and the network's failures, with or without a status", () => {
    // https://code.claude.com/docs/en/errors: server errors, usage limits, network.
    for (const said of [
      "Request timed out",
      "API Error: No response from API",
      "API Error: Repeated 529 Overloaded errors",
      "Opus is experiencing high load",
      "API Error: Stream idle timeout - no chunks received",
      "Server error mid-response. The response above may be incomplete.",
      "Connection lost mid-response",
      "Response stalled mid-stream",
      "Part of the response never arrived",
      "API Error: Content block not found",
      "API returned an empty or malformed response",
      "You've hit your session limit · resets 3pm",
      "You've hit your weekly limit",
      "You've hit your Opus limit",
      "You've hit your org's monthly spend limit",
      "You've hit your team's shared budget",
      "spend limit reached",
      "Server is temporarily limiting requests",
      "Request rejected (429)",
      "API Error: Connection lost before a response was produced. Try again.",
      "API Error: The response stalled before a response was produced. Try again.",
      "API Error: Connection to the API was lost (EPIPE). This is usually temporary",
      "Connection to the API was lost (UND_ERR_SOCKET)",
      "Unable to connect to API (EHOSTUNREACH)",
      "Unable to connect to Anthropic services",
      "Connection refused — is a firewall blocking api.anthropic.com? (ConnectionRefused)",
      "Couldn't connect through your proxy",
      "Socket is closed",
      "SSL certificate verification failed",
    ]) {
      expect(classifyFailure(said), said).toBe("service");
    }
  });

  it("knows billing, version and organization-policy refusals as setup", () => {
    for (const said of [
      // As 2.1.302 prints them.
      "Credit balance too low · Add funds: https://platform.claude.com/settings/billing",
      "It looks like your version of Claude Code (2.1.302) needs an update. A newer version (2.1.400 or higher) is required to continue.",
      // As the error reference lists them.
      "Credit balance is too low",
      "Usage credits required for 1M context",
      "Claude Code 2.1.302 is older than the minimum version required by your organization's policy",
      "Claude Code 2.1.302 does not support this model; version 2.1.400 or newer is required",
      "Claude Code 2.1.400 or later is required for your organization",
      "Your organization's settings need an update",
      "Claude Code can't start this session yet",
      "Your Claude session has expired. Sign in again to continue (claude auth login).",
    ]) {
      expect(classifyFailure(said), said).toBe("setup");
    }
  });

  it("knows the CLI's account refusals as setup, never the batch's doing", () => {
    // What Claude Code 2.1.302 printed from 2026-11-17, when the token's
    // organization lost Claude Code access. Read as the batch's failure, it
    // charged every product an attempt and gave up on 20 of them.
    expect(
      classifyFailure(
        "Your organization has disabled Claude subscription access for Claude Code · Use an Anthropic API key instead, or ask your admin to enable access",
      ),
    ).toBe("setup");
    // The other refusals at https://code.claude.com/docs/en/errors#authentication-errors,
    // as `-p` words them.
    for (const said of [
      "Failed to authenticate: OAuth token revoked. Please log in again or contact your administrator.",
      "Failed to authenticate: OAuth session expired and could not be refreshed",
      "Failed to authenticate. API Error: 401 OAuth access token is invalid.",
      "Your account is on hold and can't use Claude Code. View details or appeal: https://claude.ai/restricted",
      "Your organization has disabled API key authentication · Unset ANTHROPIC_API_KEY to use your claude.ai account instead",
      "Your ANTHROPIC_API_KEY belongs to a disabled organization · Update or unset the environment variable",
      "API Error: 400 This organization has been disabled.",
      "Your account does not have access to Claude. Please login again or contact your administrator.",
    ]) {
      expect(classifyFailure(said), said).toBe("setup");
    }
  });

  it("falls back on what the failed envelope records when the wording is new", () => {
    // The fields Claude Code 2.1.302 prints for a refused request (captured
    // with an invalid token), with a message no pattern knows.
    const failure = (fields: Record<string, unknown>) => {
      try {
        parseClaudeEnvelope(
          JSON.stringify({
            type: "result",
            subtype: "success",
            is_error: true,
            terminal_reason: "api_error",
            result: "Something the CLI has never said before",
            ...fields,
          }),
        );
      } catch (error) {
        expect(error).toBeInstanceOf(ClaudeRunError);
        return (error as ClaudeRunError).failure;
      }
      return expect.unreachable();
    };
    // The status of our own request to the model, never of a page it fetched.
    expect(failure({ api_error_status: 401, total_cost_usd: 0.2 })).toBe("setup");
    expect(failure({ api_error_status: 403, total_cost_usd: 0.2 })).toBe("setup");
    expect(failure({ api_error_status: 429, total_cost_usd: 0.2 })).toBe("service");
    expect(failure({ api_error_status: 529, total_cost_usd: 0 })).toBe("service");
    // Refused before the model's first answer: it had not read the batch file.
    expect(failure({ api_error_status: 404, total_cost_usd: 0 })).toBe("setup");
    expect(failure({ total_cost_usd: 0 })).toBe("setup");
    // Once the model may have read the batch, nothing says whose fault it is.
    expect(failure({ api_error_status: 400, total_cost_usd: 0.31 })).toBe("unknown");
    expect(failure({})).toBe("unknown");
    // Out of turns stays the batch's, whatever else the envelope says.
    expect(failure({ subtype: "error_max_turns", total_cost_usd: 0 })).toBe("batch");
  });

  it("reads a crash from its errors, and never takes its zero cost for a refusal", () => {
    // The shape 2.1.302's crash handler prints: no `result`, `errors` instead,
    // and a cost of 0 however far the run got - the model may have read the
    // batch and be researching it.
    const crash = (errors: unknown) =>
      JSON.stringify({
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        num_turns: 0,
        duration_ms: 0,
        duration_api_ms: 0,
        total_cost_usd: 0,
        errors,
      });
    // As the crash handler fills `errors`: the crash's own message, then what
    // the CLI logged during the session (stack traces and all), and the
    // `[session_crash]` line last - here past the 2000 characters a failure
    // keeps.
    const logged = Array.from(
      { length: 4 },
      (_, n) =>
        `Error: connect ETIMEDOUT 203.0.113.${n}:443\n${"    at Socket.emit (node:events:519:28)\n".repeat(12)}`,
    );
    const real = (line: string) => crash(["TypeError: x is not a function", ...logged, line]);
    try {
      parseClaudeEnvelope(real("[session_crash] error_name=TypeError api_error_status=none"));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ClaudeRunError);
      // Not "service": a timeout the CLI logged earlier is not this crash.
      expect((error as ClaudeRunError).failure).toBe("unknown");
      expect((error as ClaudeRunError).message).toBe(
        "Claude run failed (error_during_execution): [session_crash] error_name=TypeError api_error_status=none",
      );
      expect((error as ClaudeRunError).detail).toMatch(/^\[session_crash\][^\n]*\nTypeError: x/);
    }
    // A crash that records the refused request's status is still that refusal.
    expect(() =>
      parseClaudeEnvelope(real("[session_crash] error_name=APIError api_error_status=403")),
    ).toThrow(expect.objectContaining({ failure: "setup" }));
    expect(() =>
      parseClaudeEnvelope(real("[session_crash] error_name=APIError api_error_status=529")),
    ).toThrow(expect.objectContaining({ failure: "service" }));
    // Without the line, the crash's own message is all there is.
    expect(() => parseClaudeEnvelope(crash(["TypeError: x is not a function"]))).toThrow(
      expect.objectContaining({
        failure: "unknown",
        message: "Claude run failed (error_during_execution): TypeError: x is not a function",
      }),
    );
    // Errors that are not text are not read; the message says there was none.
    expect(() => parseClaudeEnvelope(crash([{ code: 1 }, "  "]))).toThrow(
      expect.objectContaining({
        failure: "unknown",
        message: expect.stringMatching(/no message$/),
      }),
    );
  });

  it("reads a CLI that refused to start from its stderr, in its own words", () => {
    // How 2.1.302 refuses to run once the service wants a newer version: on
    // stderr only, with nothing on stdout.
    const outdated = exitFailure(
      1,
      "\nIt looks like your version of Claude Code (2.1.302) needs an update.\nA newer version (2.1.400 or higher) is required to continue.\n\nTo update, please run:\n    claude update\n",
    );
    expect(outdated.failure).toBe("setup");
    expect(outdated.message).toBe(
      "Claude exited with code 1: It looks like your version of Claude Code (2.1.302) needs an update.",
    );
    expect(
      exitFailure(1, "TypeError: undefined is not an object\n    at main (cli.js:1:1)"),
    ).toEqual(
      expect.objectContaining({
        failure: "unknown",
        message: "Claude exited with code 1: TypeError: undefined is not an object",
      }),
    );
    expect(exitFailure(null, "")).toEqual(
      expect.objectContaining({ failure: "unknown", message: "Claude exited with code null" }),
    );
  });

  it("rejects output without structured data", () => {
    expect(() => parseClaudeEnvelope("not json")).toThrow(ClaudeRunError);
    expect(() => parseClaudeEnvelope(JSON.stringify({ subtype: "success", result: "hi" }))).toThrow(
      /no structured output/,
    );
  });
});

describe("output contract", () => {
  it("the JSON schema and the zod schema describe the same object", () => {
    const sample = {
      products: [
        { id: "a", copy: GOOD_COPY, research: null },
        { id: "b", copy: null, research: HIGH_CORRECTION },
      ],
    };
    expect(copyOutputSchema.safeParse(sample).success).toBe(true);
    const item = COPY_OUTPUT_JSON_SCHEMA.properties.products.items;
    expect([...item.required].sort()).toEqual(["copy", "id", "research"]);
    const research = item.properties.research.anyOf[1];
    expect([...research.required].sort()).toEqual(Object.keys(HIGH_CORRECTION).sort());
    expect(research.properties.note.maxLength).toBe(LIMITS.note);
    expect(research.properties.findings.items.properties.found.maxLength).toBe(LIMITS.value);
  });

  it("trims an over-long finding and drops a source that is not an address", () => {
    const parsed = copyOutputSchema.parse({
      products: [
        {
          id: "a",
          copy: null,
          research: {
            ...HIGH_CORRECTION,
            findings: [
              {
                field: "ingredients",
                ours: null,
                found: "x".repeat(500),
                confidence: "high",
                sources: ["Open Food Facts EAN 8000070", "https://world.openfoodfacts.org/p/1"],
              },
            ],
          },
        },
      ],
    });
    const finding = parsed.products[0]?.research?.findings[0];
    expect(finding?.found).toHaveLength(LIMITS.value);
    expect(finding?.sources).toEqual(["https://world.openfoodfacts.org/p/1"]);
  });
});

/* --- Selection -------------------------------------------------------------- */

describe("selectCopyWork", () => {
  it("writes copy for a product with none, never over a person's", () => {
    const fresh = candidate();
    const hand = candidate({ copyOrigin: "hand", summary: "Ръчно написан текст за продукта." });
    const edited = candidate({ copyOrigin: "edited", summary: "Поправен текст." });
    // An override of unknown origin - only a body, say - is a person's too.
    const unknown = candidate({ bodyParagraphs: ["Абзац, написан отнякого."] });
    const plan = selectCopyWork([fresh, hand, edited, unknown], { limit: 10 });
    expect(plan.items.map((item) => item.slug)).toEqual([fresh.slug]);
    // Not even when asked by name with --force.
    const forced = selectCopyWork([hand], { limit: 10, slugs: [hand.slug], force: true });
    expect(forced.items).toHaveLength(0);
  });

  it("rewrites machine copy only when its facts changed", () => {
    const current = candidate({ copyOrigin: "ai", summary: "Текст." });
    const upToDate = { ...current, copySourceHash: copySourceHash(current) };
    const stale = { ...current, id: "stale", slug: "stale", copySourceHash: "old" };
    const plan = selectCopyWork([upToDate, stale], { limit: 10 });
    expect(plan.items.map((item) => item.slug)).toEqual(["stale"]);
  });

  it("does not see a stored 18.0000 and a written 18 as different facts", () => {
    const stored = candidate({ weightValue: "18.0000", weightUnit: "pc" });
    expect(copySourceHash(stored)).toBe(copySourceHash({ ...stored, weightValue: "18" }));
  });

  it("researches a product whose name and pack field disagree, first", () => {
    const plain = candidate({ lastChangedAt: new Date("2026-10-10T00:00:00Z") });
    const tin = candidate({
      weightValue: "18.0000",
      weightUnit: "pc",
      sourceData: { packSizeConflict: { inName: "18 бр.", inPackField: "100 бр." } },
    });
    const plan = selectCopyWork([plain, tin], { limit: 10 });
    expect(plan.items[0]?.slug).toBe(tin.slug);
    expect(plan.items[0]?.task.research).toBe(true);
    expect(plan.items[0]?.task.researchReasons[0]).toMatch(/18 бр\..*100 бр\./);
    expect(plan.items[0]?.pack).toMatchObject({
      label: "18 бр.",
      inName: "18 бр.",
      inPackField: "100 бр.",
      mayState: true,
    });
  });

  it("researches again only when the supplier's pack statements change", () => {
    const tin = candidate({
      sourceData: {
        packField: "100 бр.",
        weightCanonical: "18pc",
        packSizeConflict: { inName: "18 бр.", inPackField: "100 бр." },
      },
    });
    const checked = {
      ...tin,
      research: { basis: researchBasis(tin), heldBack: null, applied: true, rejected: [] },
    };
    // Not on a price change, nor on a description change, nor on our own correction.
    expect(researchReasons({ ...checked, price: "25.00" }, new Map())).toEqual([]);
    expect(researchReasons({ ...checked, descriptionText: "New text." }, new Map())).toEqual([]);
    expect(
      researchReasons({ ...checked, weightValue: "20", packOverrideValue: "20" }, new Map()),
    ).toEqual([]);
    // The supplier repackages: check again, and say why.
    const repackaged = {
      ...checked,
      packOverrideValue: "20",
      sourceData: { packField: "16 бр.", weightCanonical: "16pc" },
    };
    expect(researchReasons(repackaged, new Map())).toEqual([
      "доставчикът промени данните за опаковката, откакто размерът ни беше поправен",
    ]);
  });

  it("forbids stating the size while an earlier check left it unsettled", () => {
    const disputed = candidate({
      research: { basis: "old", heldBack: "увереността е средна", applied: false, rejected: [] },
    });
    const plan = selectCopyWork([disputed], { limit: 10 });
    expect(plan.items[0]?.pack.mayState).toBe(false);
  });

  it("flags a price per cup far from its format's", () => {
    const normal = Array.from({ length: 6 }, () => candidate({ price: "20.00" }));
    // Same 1 kg pack at a twentieth of the price: a misread size, not a bargain.
    const odd = candidate({ price: "1.00" });
    const plan = selectCopyWork([...normal, odd], { limit: 20 });
    const item = plan.items.find((entry) => entry.slug === odd.slug);
    expect(item?.task.research).toBe(true);
    expect(item?.task.researchReasons.join(" ")).toMatch(/ под /);
  });

  it("gives up after repeated failures, and honours the limit", () => {
    const failing = candidate({ copyAttempts: MAX_COPY_ATTEMPTS });
    const others = Array.from({ length: 5 }, () => candidate());
    const plan = selectCopyWork([failing, ...others], { limit: 3 });
    expect(plan.givenUp).toEqual([failing.slug]);
    expect(plan.items).toHaveLength(3);
    expect(plan.deferred).toBe(2);
  });

  it("shows the model its siblings' summaries, not its own", () => {
    const own = candidate({ copyOrigin: "ai", summary: "Собственият текст.", copySourceHash: "x" });
    const sibling = candidate({ copyOrigin: "hand", summary: "Текстът на съседа." });
    const plan = selectCopyWork([own, sibling], { limit: 10 });
    expect(plan.items[0]?.siblingSummaries).toEqual(["Текстът на съседа."]);
  });

  it("reads a stored check defensively, treating an old version as unchecked", () => {
    expect(readStoredResearch({ version: 1, basis: "x", applied: true })).toMatchObject({
      basis: null,
      applied: true,
    });
    expect(
      readStoredResearch({
        version: 2,
        basis: "x",
        heldBack: "confidence is low",
        rejected: [{ value: 20, unit: "pc" }, { value: "junk" }],
      }),
    ).toEqual({
      basis: "x",
      heldBack: "confidence is low",
      applied: false,
      rejected: [{ value: 20, unit: "pc" }],
    });
  });
});

/* --- The audit ---------------------------------------------------------------- */

describe("auditGeneratedCopy", () => {
  const audit = (
    copy = GOOD_COPY,
    item = workItem(),
    context: Partial<{ summaries: Map<string, string>; bodies: Map<string, string[]> }> = {},
  ) =>
    auditGeneratedCopy(item, copy, item.pack, {
      summaries: context.summaries ?? new Map(),
      bodies: context.bodies ?? new Map(),
    });

  it("passes original Bulgarian copy", () => {
    expect(audit()).toEqual({ ok: true, problems: [] });
  });

  it("rejects the source's own words", () => {
    const item = workItem({
      sourceDescription:
        "Кафе с богат вкус и плътна крема, подходящо за еспресо машини и автоматични кафемашини у дома, в офиса и в малки заведения с ежедневна консумация.",
    });
    const copy = {
      summary: "Кафе с богат вкус и плътна крема, подходящо за еспресо машини у дома и в офиса.",
      body: GOOD_COPY.body,
    };
    const result = audit(copy, item);
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toMatch(/поредни думи|изразите на източника/);
  });

  it("does not count naming the product as copying a short source", () => {
    const item = workItem({
      title: "Lavazza Crema e Aroma Espresso Bar Edition",
      sourceDescription: "Lavazza Crema e Aroma Espresso Bar Edition 1 кг.",
    });
    const copy = {
      ...GOOD_COPY,
      summary:
        "Lavazza Crema e Aroma Espresso Bar Edition е бленд с кадифено тяло и гъста крема в чашата.",
    };
    expect(audit(copy, item).problems).not.toContainEqual(expect.stringMatching(/source/));
  });

  it("rejects prices in Bulgarian, where \\b would not see them", () => {
    expect(audit(withBody("Струва под 40 лв. на килограм, а това е изгодно.")).problems).toContain(
      "текстът споменава цена или валута",
    );
    expect(audit(withBody("Цената е около 20 евро за килограм кафе.")).problems).toContain(
      "текстът споменава цена или валута",
    );
  });

  it("rejects naming the source shop or a web address, but not an ordinary phrase", () => {
    expect(audit(withBody("Предлага се и в КафеЗона, както и на сайта ни.")).problems).toContain(
      "текстът назовава магазина източник",
    );
    expect(
      audit(withBody("Повече за кафето ще намерите на lavazza.com в раздела.")).problems,
    ).toContain("текстът съдържа уеб адрес");
    expect(audit(withBody("Подходящо за малка кафе зона в офиса, до хладилника.")).ok).toBe(true);
  });

  it("rejects a pack size other than the product's, but not a dose", () => {
    expect(audit(withBody("Опаковка 500 г цели зърна за дома.")).problems.join(" ")).toMatch(
      /посочва опаковка от 500 г/,
    );
    expect(audit(withBody("За една чаша еспресо са нужни около 7 г смляно кафе.")).ok).toBe(true);
    expect(audit(withBody("Опаковка от 1 кг, или 1 000 грама цели зърна.")).ok).toBe(true);
  });

  it("accepts parts of the pack beside the pack itself", () => {
    const item = workItem({
      pack: { label: "16 бр.", inName: null, inPackField: null, mayState: true },
    });
    const copy = withBody("В кутията има 16 капсули: 8 капсули кафе и 8 капсули мляко за лате.");
    expect(audit(copy, item).ok).toBe(true);
  });

  it("states no size at all while the size is disputed", () => {
    const item = workItem({
      pack: { label: "1 кг", inName: null, inPackField: null, mayState: false },
    });
    expect(audit(withBody("Опаковка от 1 кг цели зърна за дома."), item).problems).toContain(
      "посочва размер на опаковката, докато размерът е спорен",
    );
    expect(audit(GOOD_COPY, item).ok).toBe(true);
  });

  it("rejects another product's summary, not the product's own", () => {
    const worn = (by: string) => new Map([[normalizeForComparison(GOOD_COPY.summary), by]]);
    expect(audit(GOOD_COPY, workItem(), { summaries: worn("other") }).problems).toContain(
      "краткото описание е същото като на друг продукт",
    );
    expect(audit(GOOD_COPY, workItem(), { summaries: worn("id-x") }).ok).toBe(true);
  });

  it("rejects a paragraph that repeats another product's", () => {
    const bodies = new Map([["other", [GOOD_COPY.body[1] as string]]]);
    expect(audit(GOOD_COPY, workItem(), { bodies }).problems.join(" ")).toMatch(
      /абзац 2 повтаря \d+ поредни думи от описанието на друг продукт/,
    );
    const own = new Map([["id-x", [...GOOD_COPY.body]]]);
    expect(audit(GOOD_COPY, workItem(), { bodies: own }).ok).toBe(true);
  });

  it("reads pack sizes in the forms copy writes them", () => {
    expect(
      statedPackSizes(
        "16 капсули, 1 кг, 250 г, 10 бр., 500 грама, 1 килограм, 16 броя, 1 литър, 1 000 г, 1,5 кг",
      ),
    ).toEqual([
      { value: "16", unit: "pc" },
      { value: "1000", unit: "g" },
      { value: "250", unit: "g" },
      { value: "10", unit: "pc" },
      { value: "500", unit: "g" },
      { value: "1000", unit: "g" },
      { value: "16", unit: "pc" },
      { value: "1000", unit: "ml" },
      { value: "1000", unit: "g" },
      { value: "1500", unit: "g" },
    ]);
  });
});

/* --- Judging an answer -------------------------------------------------------- */

describe("correctionHeldBack", () => {
  const current = { value: "100.0000", unit: "pc" };

  it("lets a confident, independently sourced, plausible correction through", () => {
    expect(correctionHeldBack(HIGH_CORRECTION, current)).toBeNull();
  });

  it("holds back anything less", () => {
    expect(correctionHeldBack(withPack({ confidence: "medium" }), current)).toMatch(/увереността/);
    const supplierOnly = withPack({
      sources: ["https://kafezona.com/illy", "https://www.illy.com/tin-20", "https://illy.com/x"],
    });
    expect(correctionHeldBack(supplierOnly, current)).toMatch(/1 независим източник/);
    expect(correctionHeldBack(withPack({ value: 5000 }), current)).toMatch(/правдоподобна/);
    expect(correctionHeldBack(withPack({ value: 2 }), current)).toMatch(/пъти/);
    expect(correctionHeldBack(withPack({}, { verdict: "inconclusive" }), current)).toMatch(
      /неубедителна/,
    );
  });

  it("leaves a change of unit, or a first size, to a person", () => {
    // A 250 g bag "corrected" to 1 piece would make the whole bag one cup.
    expect(correctionHeldBack(withPack({ value: 1 }), { value: "250", unit: "g" })).toMatch(
      /мерната единица/,
    );
    expect(correctionHeldBack(HIGH_CORRECTION, { value: null, unit: null })).toMatch(
      /потвърждава от човек/,
    );
  });

  it("never applies a size the owner turned down", () => {
    expect(correctionHeldBack(HIGH_CORRECTION, current, [{ value: 20, unit: "pc" }])).toMatch(
      /собственикът избра/,
    );
  });

  it("compares the size found with the stored one, rounded as it will be stored", () => {
    expect(differsFromStored(HIGH_PACK, { value: "20.0000", unit: "pc" })).toBe(false);
    expect(differsFromStored(HIGH_PACK, { value: "100.0000", unit: "pc" })).toBe(true);
    expect(differsFromStored(HIGH_PACK, { value: "20", unit: "g" })).toBe(true);
    expect(differsFromStored(HIGH_PACK, { value: null, unit: null })).toBe(true);
    const ounces = { ...HIGH_PACK, value: 340.1942775, unit: "g" as const };
    expect(differsFromStored(ounces, { value: "340.0000", unit: "g" })).toBe(false);
  });

  it("counts sites, not URLs, and none that are the supplier, us, or anyone's content", () => {
    expect(
      independentHosts([
        "https://www.illy.com/a",
        "https://shop.illy.com/b",
        "https://kafezona.com./c",
        "https://web.archive.org/web/2026/https://kafezona.com/x",
        "https://web.archive.org/web/2026/https://example.org/x",
        "https://buy-a-coffee.com/d",
        "https://a.blogspot.com/e",
        "https://b.blogspot.com/f",
        "https://www.coffee.co.uk/g",
        "not a url",
      ]),
    ).toEqual(["illy.com", "coffee.co.uk"]);
    expect(siteOf("www.shop.example.de.")).toBe("example.de");
  });
});

describe("source check", () => {
  const page = (body: string, status = 200) => new Response(body, { status });

  it("needs two sites that open and print the figure", async () => {
    const pages: Record<string, () => Response> = {
      "https://www.illy.com/tin-20": () => page("<p>Illy decaf <b>20</b> pods</p>"),
      "https://shop.example.de/illy-20": () => page("<script>var x=7</script><p>20 Kapseln</p>"),
    };
    const check = createSourceCheck(async (url) => pages[url]?.() ?? page("", 404));
    expect(await check(HIGH_PACK)).toBeNull();
  });

  it("holds back when a page is missing or says something else", async () => {
    const check = createSourceCheck(async (url) =>
      url.includes("illy.com") ? page("<p>20 capsules</p>") : page("<p>200 Kapseln</p>"),
    );
    expect(await check(HIGH_PACK)).toMatch(/1 от цитираните сайтове/);
    const failing = createSourceCheck(async () => {
      throw new Error("blocked");
    });
    expect(await failing(HIGH_PACK)).toMatch(/0 от цитираните сайтове/);
  });

  it("reads a whole number, not part of another", () => {
    expect(printsNumber("20 pods", 20)).toBe(true);
    expect(printsNumber("x20 капсули", 20)).toBe(true);
    expect(printsNumber("200 pods", 20)).toBe(false);
    expect(printsNumber("1.20 €", 20)).toBe(false);
    expect(printsNumber("20,5 g", 20)).toBe(false);
  });
});

describe("reviewBatch", () => {
  const tinCandidate = candidate({
    id: "tin",
    slug: "illy-tin",
    name: "Дозети Illy Decaffeinato 18бр.",
    weightValue: "100.0000",
    weightUnit: "pc",
    sourceData: { packSizeConflict: { inName: "18 бр.", inPackField: "100 бр." } },
  });
  const tinItem = workItem({
    id: "tin",
    slug: "illy-tin",
    pack: { label: "100 бр.", inName: "18 бр.", inPackField: "100 бр.", mayState: true },
    task: { writeCopy: true, research: true, researchReasons: ["conflict"] },
  });
  const context = (overrides: Partial<ReviewContext> = {}): ReviewContext => ({
    candidates: new Map([[tinCandidate.id, tinCandidate]]),
    summaries: new Map(),
    bodies: new Map(),
    model: "claude-opus-5-5",
    now: new Date("2026-10-19T12:00:00Z"),
    checkSources: pass,
    ...overrides,
  });
  const twentyPods = withBody("В кутията има 20 бр. дози.");

  it("applies a confident correction and lets the copy state the corrected size", async () => {
    const review = await reviewBatch(
      [tinItem],
      { products: [{ id: "tin", copy: twentyPods, research: HIGH_CORRECTION }] },
      context(),
    );
    const decision = review.decisions[0];
    expect(decision?.research.status).toBe("recorded");
    if (decision?.research.status !== "recorded") return;
    expect(decision.research.pack).toEqual({
      value: "20",
      unit: "pc",
      servings: "20",
      servingsEstimated: false,
    });
    expect(decision.research.record).toMatchObject({
      version: 2,
      applied: true,
      heldBack: null,
      before: { value: "100.0000", unit: "pc" },
      basis: researchBasis(tinCandidate),
    });
    expect(decision.copy.status).toBe("accepted");
  });

  it("holds back a correction whose pages do not confirm it", async () => {
    const review = await reviewBatch(
      [tinItem],
      { products: [{ id: "tin", copy: GOOD_COPY, research: HIGH_CORRECTION }] },
      context({ checkSources: async () => "0 от цитираните сайтове се отвориха" }),
    );
    expect(review.decisions[0]?.research).toMatchObject({
      status: "recorded",
      pack: null,
      record: { applied: false, heldBack: "0 от цитираните сайтове се отвориха" },
    });
  });

  it("holds back a weak correction, and then the copy may state no size", async () => {
    const review = await reviewBatch(
      [tinItem],
      {
        products: [{ id: "tin", copy: twentyPods, research: withPack({ confidence: "medium" }) }],
      },
      context(),
    );
    expect(review.decisions[0]?.research).toMatchObject({
      status: "recorded",
      pack: null,
      record: { applied: false, heldBack: "увереността е средна" },
    });
    expect(review.decisions[0]?.copy).toMatchObject({
      status: "rejected",
      problems: ["посочва размер на опаковката, докато размерът е спорен"],
    });
  });

  it("corrects a stored size the model calls confirmed against the name (the live case)", async () => {
    // Stored 100 from the pack field; the name and three shops say 16.
    const borbone = withPack({ value: 16 }, { verdict: "confirmed" });
    const review = await reviewBatch(
      [tinItem],
      { products: [{ id: "tin", copy: GOOD_COPY, research: borbone }] },
      context(),
    );
    expect(review.decisions[0]?.research).toMatchObject({
      status: "recorded",
      pack: { value: "16", unit: "pc" },
      record: { verdict: "confirmed", applied: true, heldBack: null },
    });
  });

  it("changes nothing when the size found is the stored one", async () => {
    const review = await reviewBatch(
      [tinItem],
      { products: [{ id: "tin", copy: GOOD_COPY, research: withPack({ value: 100 }) }] },
      context(),
    );
    expect(review.decisions[0]?.research).toMatchObject({
      status: "recorded",
      pack: null,
      record: { applied: false, heldBack: null },
    });
  });

  it("costs only the product whose answer is malformed, and notes stray ids", async () => {
    const other = candidate({ id: "other" });
    const items = [tinItem, workItem({ id: "other" })];
    const review = await reviewBatch(
      items,
      {
        products: [
          { id: "tin", copy: GOOD_COPY },
          { id: "other", copy: GOOD_COPY, research: null },
          { id: "someone-else", copy: GOOD_COPY, research: null },
        ],
      },
      context({
        candidates: new Map([
          [tinCandidate.id, tinCandidate],
          [other.id, other],
        ]),
      }),
    );
    expect(review.decisions[0]?.copy.status).toBe("rejected");
    expect(review.decisions[0]?.research.status).toBe("missing");
    expect(review.decisions[1]?.copy.status).toBe("accepted");
    expect(review.strayIds).toEqual(["someone-else"]);

    const unreadable = await reviewBatch([tinItem], { nothing: true }, context());
    expect(unreadable.decisions[0]?.copy.status).toBe("rejected");
  });

  it("does not accept the same summary for two products in one batch", async () => {
    const first = candidate({ id: "first" });
    const second = candidate({ id: "second" });
    const items = [workItem({ id: "first" }), workItem({ id: "second" })];
    const review = await reviewBatch(
      items,
      {
        products: [
          { id: "first", copy: GOOD_COPY, research: null },
          { id: "second", copy: GOOD_COPY, research: null },
        ],
      },
      context({
        candidates: new Map([
          [first.id, first],
          [second.id, second],
        ]),
      }),
    );
    expect(review.decisions.map((d) => d.copy.status)).toEqual(["accepted", "rejected"]);
  });
});

/* --- Plumbing ------------------------------------------------------------------- */

describe("plumbing", () => {
  it("escapes copy into paragraphs", () => {
    expect(paragraphsToHtml(["A & B", "<b>"])).toBe("<p>A &amp; B</p>\n<p>&lt;b&gt;</p>");
  });

  it("keeps a brand's products in one batch, and few researched ones to a prompt", () => {
    const items = ["a", "b", "a", "c", "b"].map((brand, index) =>
      workItem({ id: String(index), brand }),
    );
    expect(toBatches(items, 2).map((batch) => batch.map((item) => item.brand))).toEqual([
      ["a", "a"],
      ["b", "b"],
      ["c"],
    ]);
    const researched = Array.from({ length: 6 }, (_, index) =>
      workItem({
        id: `r${index}`,
        task: { writeCopy: true, research: true, researchReasons: ["x"] },
      }),
    );
    const sizes = toBatches([...researched, ...items], 10).map((batch) => batch.length);
    expect(sizes).toEqual([MAX_RESEARCH_PER_BATCH, 2, 5]);
  });

  it("scrubs credentials from text bound for a public log", () => {
    expect(scrubForLog("token sk-ant-oat01-abcDEF_123 and postgres://u:p@host/db done")).toBe(
      "token [redacted] and [redacted] done",
    );
  });
});
