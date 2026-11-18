import { spawn } from "node:child_process";
import { COPY_OUTPUT_JSON_SCHEMA } from "./contract.ts";

/**
 * One batch through Claude Code, headless.
 *
 * WHY THE CLI AND NOT THE API SDK. This runs on the owner's Claude
 * subscription: `claude setup-token` issues a long-lived token that headless
 * `claude -p` accepts as `CLAUDE_CODE_OAUTH_TOKEN` (documented for CI; the
 * Agent SDK is not documented for subscription sign-in). The same command also
 * runs on an `ANTHROPIC_API_KEY`, which takes precedence when both are set, so
 * switching to API billing is an environment change, not a code change.
 *
 * WHAT THE MODEL CAN REACH. The product text it reads comes from a third-party
 * shop and the pages it fetches are anyone's, so the session is built as if
 * the model might be talked into misbehaving:
 *
 *  - It runs in an empty temporary directory holding only the skill and the
 *    batch file (`run.ts`), so there is nothing of ours to read where it is
 *    allowed to read. Reads elsewhere need a permission nobody grants:
 *    `--permission-mode dontAsk` with `--permission-prompts none` refuses
 *    anything not pre-approved.
 *  - Its environment is an allow-list (`childEnvironment`): no database URL,
 *    no storage token - only what the CLI needs to start and sign in.
 *  - `--tools` gives it Read, WebSearch and WebFetch: no shell, no writes.
 *    `--strict-mcp-config` keeps out any MCP servers the machine has.
 *  - It only *returns* text. This process validates and audits that text and
 *    is the one that writes to the database.
 *
 * `--json-schema` makes the CLI enforce the output shape; the validated object
 * comes back as `structured_output`.
 */

export interface ClaudeRunOptions {
  /** The executable: `claude` on CI, an absolute path to `claude.exe` on Windows. */
  readonly bin: string;
  /** The session's working directory: the batch's temporary workspace. */
  readonly cwd: string;
  readonly model: string;
  readonly maxTurns: number;
  readonly timeoutMs: number;
  /** The child's whole environment; see `childEnvironment`. */
  readonly env: NodeJS.ProcessEnv;
}

export interface ClaudeRunResult {
  readonly output: unknown;
  readonly costUsd: number | null;
  readonly turns: number | null;
  readonly durationMs: number;
}

/**
 * Why a run failed, which decides whose fault it is.
 *
 * `setup` (Claude Code cannot start, sign in or use the account: a login that
 * expired or was revoked, an organization or account that turned it off, no
 * credit, a version or model the service no longer takes) and `service` (a
 * usage or spend limit, rate limiting, an overloaded or failing service, the
 * network) say nothing about the products in the batch: the run stops, and
 * the products are not charged an attempt - otherwise an expired token would
 * quietly give up on the whole catalogue three batches at a time. `batch`
 * (out of turns, too slow) is this batch's own doing, and counts against it.
 * `unknown` (nothing says whose fault it is) counts against the batch too, so
 * one bad batch cannot hold up the queue. Either way, a second failed batch in
 * a row stops the run and is not charged (`run.ts`): what fails batch after
 * batch is not about their products.
 */
export type ClaudeFailure = "setup" | "service" | "batch" | "unknown";

export class ClaudeRunError extends Error {
  constructor(
    message: string,
    readonly detail: string,
    readonly failure: ClaudeFailure = "unknown",
  ) {
    super(message);
    this.name = "ClaudeRunError";
  }
}

/*
 * Matched against what the CLI itself prints - its own messages and the
 * "API Error: <status>" lines it reports - not against any number anywhere in
 * the text: a 403 from a web page the model fetched is not ours.
 *
 * The messages are those of https://code.claude.com/docs/en/errors, checked
 * against Claude Code 2.1.302. One missing here used to cost every product in
 * every batch an attempt: from 2026-11-17 "Your organization has disabled
 * Claude subscription access for Claude Code" gave up on 20 products that way.
 * What a new wording slips past these, `classifyEnvelope` and the stop after
 * two failed batches in `run.ts` are there to catch.
 */
const SETUP_TROUBLE = [
  // Signed out, or a login that no longer works.
  /not logged in/i,
  /please run \/login/i,
  /sign in again/i,
  /session has expired/i,
  /invalid api key/i,
  /oauth token (?:has )?expired/i,
  /oauth token (?:has been )?revoked/i,
  /failed to authenticate/i,
  /authentication_error/i,
  /API Error: 40[13]\b/,
  // How a crash (`errors`) records the status of the request that failed.
  /\bapi_error_status=40[13]\b/,
  // The account or its organization turned Claude Code off, or holds it back.
  /organization has disabled/i,
  /disabled organization|organization has been disabled/i,
  /account is on hold/i,
  /does not have access to claude/i,
  /organization's (?:settings|policy)|managed settings/i,
  /can't start/i,
  // Billing.
  /credit balance (?:is )?too low/i,
  /usage credits required/i,
  // A version, or a model, the service no longer takes.
  /needs? an update/i,
  /is required to continue/i,
  /older than the minimum version/i,
  /or (?:newer|later) is required/i,
];
const SERVICE_TROUBLE = [
  // Usage, spend and rate limits.
  /usage limit/i,
  /hit your [^.\n]{0,40}?(?:limit|budget)/i,
  /spend limit/i,
  /exceeds your group's budget/i,
  /rate[_ ]limit/i,
  /too many requests/i,
  /temporarily limiting requests/i,
  /request rejected \(429\)/i,
  // A busy or failing service.
  /overloaded/i,
  /experiencing high load/i,
  /API Error: (?:429|5\d\d)\b/,
  /\bapi_error_status=(?:429|5\d\d)\b/,
  /no response from API/i,
  /request timed out/i,
  /stream idle timeout/i,
  /mid-response|mid-stream|before a response was produced/i,
  /response stopped arriving|never arrived|stream was malformed/i,
  /content block (?:not found|already closed)|stream event unreadable/i,
  /empty or malformed response|ended before any complete data/i,
  // The network.
  /connection error/i,
  /unable to connect to (?:the )?(?:API|Anthropic)/i,
  /connection (?:refused|dropped|closed)|can't reach the API server|no internet route/i,
  /connection to the API was lost/i,
  /couldn't connect through your proxy|proxy refused the connection/i,
  /socket is closed/i,
  /SSL certificate|unable to get local issuer certificate/i,
  /\b(?:ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|ENETDOWN|EPIPE|ERR_SOCKET_CLOSED|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT|ConnectionRefused|ConnectionClosed)\b/,
  /fetch failed/i,
];

/** Classify a failure from what the CLI said. */
export function classifyFailure(text: string): ClaudeFailure {
  if (SERVICE_TROUBLE.some((pattern) => pattern.test(text))) return "service";
  if (SETUP_TROUBLE.some((pattern) => pattern.test(text))) return "setup";
  return "unknown";
}

/**
 * Classify a run the CLI reported as failed: by its message first, then by
 * what the envelope records, which does not depend on the CLI's wording.
 *
 *  - `api_error_status` is the HTTP status of our own request to the model,
 *    never of a page the model fetched: 401 or 403 is the credential or the
 *    account, 429 or 5xx the service.
 *  - A refused model request is reported as `subtype: "success"` with
 *    `is_error`. With a `total_cost_usd` of 0 the model never answered, so it
 *    had not read the batch - the skill is given only the batch file's name
 *    and has to Read it - and nothing in the batch can have caused it.
 *    Subscription runs report a cost too ($0.10 for one product on
 *    2026-11-09). Not so a crash: the crash handler's `error_during_execution`
 *    reports a cost of 0 however far the run got.
 */
export function classifyEnvelope(envelope: Record<string, unknown>, said: string): ClaudeFailure {
  // Out of turns is this batch's doing, whatever the last message said.
  if (envelope.subtype === "error_max_turns") return "batch";
  const fromText = classifyFailure(said);
  if (fromText !== "unknown") return fromText;
  const status = typeof envelope.api_error_status === "number" ? envelope.api_error_status : null;
  if (status === 401 || status === 403) return "setup";
  if (status === 429 || (status !== null && status >= 500)) return "service";
  if (envelope.subtype === "success" && envelope.total_cost_usd === 0) return "setup";
  return "unknown";
}

/**
 * What a failed envelope says: `said`, to classify it by, and `detail`, for
 * the log. A refused request says it in `result`. A crash says it in
 * `errors`: the crash's own message, every error the CLI logged during the
 * session (with stack traces), and a `[session_crash]` line with the status
 * of the request that failed (2.1.302). Only that line and the crash's own
 * message are about the crash - the rest could tip it either way - so only
 * they are classified, the line first, where the message and a cut keep it.
 */
function failureText(envelope: Record<string, unknown>): { said: string; detail: string } {
  const result =
    typeof envelope.result === "string" && envelope.result.trim() ? [envelope.result] : [];
  const errors = Array.isArray(envelope.errors)
    ? envelope.errors.filter(
        (error): error is string => typeof error === "string" && !!error.trim(),
      )
    : [];
  if (envelope.subtype !== "error_during_execution") {
    const said = [...result, ...errors].join("\n");
    return { said, detail: said };
  }
  const crash = errors.find((error) => error.startsWith("[session_crash]"));
  const own = errors.find((error) => !error.startsWith("[session_crash]"));
  const said = [crash, own, ...result].filter((line) => line !== undefined).join("\n");
  const rest = errors.filter((error) => error !== crash && error !== own);
  return { said, detail: [said, ...rest].join("\n") };
}

/**
 * A CLI that exited with an error and printed nothing on stdout - it refused
 * to start, or died - said why on stderr, if anywhere. Its first line goes
 * into the message, so the run's summary shows the CLI's own words.
 */
export function exitFailure(code: number | null, stderr: string): ClaudeRunError {
  const first = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  const said = stderr.slice(-2000);
  return new ClaudeRunError(
    `Claude exited with code ${code}${first ? `: ${first.slice(0, 200)}` : ""}`,
    said,
    classifyFailure(said),
  );
}

/**
 * What the CLI needs from the environment, and nothing else: where it lives
 * and keeps its sign-in, temp space, locale, proxies, and the credential it
 * runs on. Everything this process holds besides - the database URL above
 * all - stays out of the model's reach.
 */
const PASSED_THROUGH = new Set([
  "PATH",
  "PATHEXT",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "HOMEDRIVE",
  "HOMEPATH",
  "SYSTEMROOT",
  "SYSTEMDRIVE",
  "WINDIR",
  "COMSPEC",
  "TEMP",
  "TMP",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "TZ",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "NODE_EXTRA_CA_CERTS",
  "CLAUDE_CONFIG_DIR",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
]);

/**
 * Credentials never contain whitespace, but a token pasted out of a terminal
 * often does: `claude setup-token` prints one long line that the terminal
 * wraps, and copying it picks up the line breaks - which the API then refuses
 * as "Invalid bearer token".
 */
const CREDENTIALS = new Set(["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"]);

export function childEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const passed: NodeJS.ProcessEnv = {};
  for (const [name, raw] of Object.entries(env)) {
    const key = name.toUpperCase();
    const value = raw !== undefined && CREDENTIALS.has(key) ? raw.replace(/\s+/g, "") : raw;
    // Windows spells some of these in mixed case ("Path", "SystemRoot").
    if (value !== undefined && value !== "" && PASSED_THROUGH.has(key)) {
      passed[name] = value;
    }
  }
  return passed;
}

/** Arguments for one batch. Exported so tests can pin them without spawning. */
export function claudeArgs(
  batchFile: string,
  options: Pick<ClaudeRunOptions, "model" | "maxTurns">,
): string[] {
  return [
    "-p",
    `/catalog-copy ${batchFile}`,
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(COPY_OUTPUT_JSON_SCHEMA),
    "--tools",
    "Read,WebSearch,WebFetch",
    // Reading inside the workspace; nothing else is pre-approved.
    "--allowedTools",
    "Read(./**),WebSearch,WebFetch",
    "--permission-mode",
    "dontAsk",
    "--permission-prompts",
    "none",
    "--strict-mcp-config",
    "--max-turns",
    String(options.maxTurns),
    "--model",
    options.model,
  ];
}

/** Read the CLI's `--output-format json` envelope. */
export function parseClaudeEnvelope(stdout: string): {
  output: unknown;
  costUsd: number | null;
  turns: number | null;
} {
  let envelope: Record<string, unknown>;
  try {
    envelope = JSON.parse(stdout.trim()) as Record<string, unknown>;
  } catch {
    const said = stdout.slice(-2000);
    throw new ClaudeRunError("Claude returned no JSON", said, classifyFailure(said));
  }
  if (envelope.is_error === true || (envelope.subtype && envelope.subtype !== "success")) {
    const { said, detail } = failureText(envelope);
    const kind = envelope.subtype && envelope.subtype !== "success" ? ` (${envelope.subtype})` : "";
    throw new ClaudeRunError(
      `Claude run failed${kind}: ${said.split("\n")[0]?.slice(0, 200) || "no message"}`,
      detail.slice(0, 2000),
      classifyEnvelope(envelope, said.slice(0, 2000)),
    );
  }
  if (envelope.structured_output === undefined || envelope.structured_output === null) {
    throw new ClaudeRunError(
      "Claude returned no structured output",
      String(envelope.result ?? "").slice(0, 2000),
      "unknown",
    );
  }
  return {
    output: envelope.structured_output,
    costUsd: typeof envelope.total_cost_usd === "number" ? envelope.total_cost_usd : null,
    turns: typeof envelope.num_turns === "number" ? envelope.num_turns : null,
  };
}

/** Grace between asking a timed-out CLI to stop and killing it. */
const KILL_GRACE_MS = 5000;

/** Run one batch file through the `catalog-copy` skill. */
export function runClaudeBatch(
  batchFile: string,
  options: ClaudeRunOptions,
): Promise<ClaudeRunResult> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(options.bin, claudeArgs(batchFile, options), {
      cwd: options.cwd,
      env: options.env,
      // No shell: the JSON schema is one argument and must reach the CLI intact.
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let killer: ReturnType<typeof setTimeout> | undefined;
    const settle = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killer);
      outcome();
    };

    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      // A CLI that ignores the request is killed, and the batch is settled
      // either way: the next batch must never run beside a hung one.
      killer = setTimeout(() => {
        child.kill("SIGKILL");
        settle(() =>
          reject(
            new ClaudeRunError(
              `Claude run timed out after ${options.timeoutMs} ms and was killed`,
              stderr.slice(-2000),
              "batch",
            ),
          ),
        );
      }, KILL_GRACE_MS);
    }, options.timeoutMs);

    child.on("error", (error) => {
      settle(() =>
        reject(
          new ClaudeRunError(
            `Could not start Claude (${options.bin}): ${error.message}`,
            "",
            "setup",
          ),
        ),
      );
    });
    child.on("close", (code) => {
      settle(() => {
        if (timedOut) {
          reject(
            new ClaudeRunError(
              `Claude run timed out after ${options.timeoutMs} ms`,
              stderr.slice(-2000),
              "batch",
            ),
          );
          return;
        }
        if (code !== 0 && !stdout.trim()) {
          reject(exitFailure(code, stderr));
          return;
        }
        try {
          resolve({ ...parseClaudeEnvelope(stdout), durationMs: Date.now() - started });
        } catch (error) {
          reject(error);
        }
      });
    });
  });
}
