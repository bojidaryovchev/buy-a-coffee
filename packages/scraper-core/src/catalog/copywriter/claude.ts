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
 * `setup` (the CLI could not start, is not signed in, or the account cannot
 * be billed) and `service` (the subscription's usage limit, rate limiting, an
 * overloaded or failing service, the network) say nothing about the products
 * in the batch: the run stops, and the products are not charged an attempt -
 * otherwise an expired token would quietly give up on the whole catalogue
 * three batches at a time. `batch` (out of turns, no usable answer, too slow)
 * is about this batch, and counts against it.
 */
export type ClaudeFailure = "setup" | "service" | "batch";

export class ClaudeRunError extends Error {
  constructor(
    message: string,
    readonly detail: string,
    readonly failure: ClaudeFailure = "batch",
  ) {
    super(message);
    this.name = "ClaudeRunError";
  }
}

/*
 * Matched against what the CLI itself prints - its own messages and the
 * "API Error: <status>" lines it reports - not against any number anywhere in
 * the text: a 403 from a web page the model fetched is not ours.
 */
const SETUP_TROUBLE = [
  /not logged in/i,
  /please run \/login/i,
  /invalid api key/i,
  /oauth token (?:has )?expired/i,
  /authentication_error/i,
  /API Error: 40[13]\b/,
  /credit balance is too low/i,
];
const SERVICE_TROUBLE = [
  /usage limit/i,
  /hit your limit/i,
  /rate[_ ]limit/i,
  /too many requests/i,
  /overloaded/i,
  /API Error: (?:429|5\d\d)\b/,
  /connection error/i,
  /\b(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN)\b/,
  /fetch failed/i,
];

/** Classify a failure from what the CLI said. */
export function classifyFailure(text: string): ClaudeFailure {
  if (SERVICE_TROUBLE.some((pattern) => pattern.test(text))) return "service";
  if (SETUP_TROUBLE.some((pattern) => pattern.test(text))) return "setup";
  return "batch";
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

export function childEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const passed: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) {
    // Windows spells some of these in mixed case ("Path", "SystemRoot").
    if (value !== undefined && value !== "" && PASSED_THROUGH.has(name.toUpperCase())) {
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
    const said = String(envelope.result ?? "").slice(0, 2000);
    throw new ClaudeRunError(
      `Claude run did not succeed (${String(envelope.subtype ?? "error")})`,
      said,
      // Out of turns is this batch's doing, whatever the last message said.
      envelope.subtype === "error_max_turns" ? "batch" : classifyFailure(said),
    );
  }
  if (envelope.structured_output === undefined || envelope.structured_output === null) {
    throw new ClaudeRunError(
      "Claude returned no structured output",
      String(envelope.result ?? "").slice(0, 2000),
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
            ),
          );
          return;
        }
        if (code !== 0 && !stdout.trim()) {
          const said = stderr.slice(-2000);
          reject(
            new ClaudeRunError(`Claude exited with code ${code}`, said, classifyFailure(said)),
          );
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
