/**
 * Shared machinery for the three env commands.
 *
 * Value resolution, the report formatter, and a small Vercel REST client. Kept
 * in one file because it is small and the alternative - a lib directory with
 * four modules - would be more structure than this deserves.
 */

import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

/* -------------------------------------------------------------------------- */
/* Environment loading                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Keys that appear more than once in one env file, with the line of each.
 *
 * Node's own loader (and Next's) lets the LAST occurrence win without a word.
 * That is how a developer's file once declared DATABASE_URL twice - a remote
 * one, then a localhost one - and the localhost one is what `env:push` would
 * have sent to production. A repeated key is never intentional, so it is an
 * error rather than a precedence rule to remember.
 *
 * Only line numbers are reported. A value is never read back out, because the
 * values in these files are credentials.
 */
export function findDuplicateKeys(text) {
  const firstSeen = new Map();
  const duplicates = [];
  let openQuote = null;

  text.split(/\r?\n/).forEach((line, index) => {
    const lineNo = index + 1;

    /* Inside a multi-line quoted value: its lines are data, not declarations. */
    if (openQuote) {
      if (line.includes(openQuote)) openQuote = null;
      return;
    }

    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=(.*)$/.exec(line);
    if (!match) return;
    const [, key, rest] = match;

    const value = rest.trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'" || quote === "`") && !value.slice(1).includes(quote)) {
      openQuote = quote;
    }

    if (firstSeen.has(key)) duplicates.push({ key, firstLine: firstSeen.get(key), line: lineNo });
    else firstSeen.set(key, lineNo);
  });

  return duplicates;
}

/** A problem in an env file itself, as opposed to in what it configures. */
export class EnvFileError extends Error {
  constructor(message) {
    super(message);
    this.name = "EnvFileError";
  }
}

/**
 * Parse one env file's text, refusing duplicate keys. Separate from the file
 * system so it can be tested with a string.
 */
export function parseEnvText(text, file) {
  const duplicates = findDuplicateKeys(text);
  if (duplicates.length) {
    throw new EnvFileError(
      duplicates
        .map(
          (d) =>
            `${file}: ${d.key} is declared twice (line ${d.firstLine} and line ${d.line}).\n` +
            "    Which one wins depends on the tool reading it, so none of them is trusted.\n" +
            "    Keep one, and comment out the other.",
        )
        .join("\n  "),
    );
  }
  return parseEnv(text);
}

/**
 * Load the env files the way Next does at runtime, which a plain Node script
 * does not do for itself: `.env.local` first, then `.env` filling the gaps.
 * Anything already in the real environment beats both, which is what makes
 * `VERCEL_ENV=production node scripts/env-check.mjs` work.
 *
 * Throws `EnvFileError` when a file declares the same key twice.
 */
export function loadEnvFiles() {
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    const parsed = parseEnvText(readFileSync(file, "utf8"), file);
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

/** For the command-line entry points: print an env-file problem and stop. */
export function loadEnvFilesOrExit() {
  try {
    loadEnvFiles();
  } catch (error) {
    if (!(error instanceof EnvFileError)) throw error;
    console.error(`\n${RED}${BOLD}Refusing to run.${OFF}\n  ${error.message}\n`);
    process.exit(1);
  }
}

export const isSet = (name) => {
  const value = process.env[name];
  return typeof value === "string" && value.trim() !== "";
};

export const envValue = (name) => (process.env[name] ?? "").trim();

/**
 * Where a variable's value comes from, and what it is.
 *
 * Precedence depends on what you are asking, and getting this backwards makes
 * one of the two commands lie:
 *
 *   "deploy"  the manifest wins. It is the source of truth for what Vercel
 *             gets, and a local .env must not quietly change a deployment.
 *   "local"   .env wins, because that is what actually runs on your machine.
 *             This is Next's own precedence, and it is what makes a local
 *             override an override rather than a no-op. The manifest value is
 *             still shown when .env is silent, since it is what production
 *             will have.
 *
 * A `secret` may never carry a manifest value - `assertManifestHoldsNoSecrets`
 * enforces that - so secrets always resolve from the environment either way.
 */
export function resolve(spec, mode = "deploy") {
  const fromManifest =
    spec.kind === "config" && spec.value !== undefined
      ? { value: spec.value, source: "manifest" }
      : null;
  const fromEnv = isSet(spec.name) ? { value: envValue(spec.name), source: "env" } : null;

  if (mode === "local") {
    /* Your machine: .env is what actually runs, and the manifest value is the
       documented default behind it. */
    return fromEnv ?? fromManifest ?? { value: undefined, source: "missing" };
  }

  /* Deploying. A `config` variable takes its value from the manifest and
     nowhere else, unless it explicitly opts in with `fromEnv: true`.

     This is not fussiness. Your local .env holds DEVELOPMENT values - the
     buy-a-coffee storefront has NEXT_PUBLIC_SITE_URL=http://localhost:3000 in
     it - and a silent fallback would push localhost into production canonicals
     and the sitemap. Secrets are exempt because they cannot live in the
     manifest at all; `fromEnv` is for the handful of public values, like a
     referrer-restricted Maps key, where the local value genuinely is the
     production one. */
  if (fromManifest) return fromManifest;
  if (spec.kind === "secret" || spec.fromEnv)
    return fromEnv ?? { value: undefined, source: "missing" };
  return { value: undefined, source: "missing" };
}

/**
 * Display form for a resolved value.
 *
 * Secrets are confirmed, never echoed. Config values are shown because seeing
 * them is the point - but truncated, because an API key pasted whole into a
 * terminal tends to end up in a screenshot or a bug report. Being public by
 * design is not a reason to hand it around.
 */
export function displayValue(spec, value, source) {
  if (spec.kind === "secret") return `set${source === "manifest" ? " (manifest)" : ""}`;
  const shown = value.length > 24 ? `${value.slice(0, 21)}...` : value;
  return `${shown}${source === "manifest" ? "  [manifest]" : ""}`;
}

const KINDS = new Set(["config", "secret", "system", "local"]);
const TARGETS = new Set(["production", "preview", "development"]);

/**
 * Every invariant the manifest has to hold, checked by all three commands
 * rather than by a test.
 *
 * A test would run when someone remembers to run it. These run whenever the
 * manifest is used at all, which is the property that matters for the first
 * rule: a secret that slipped into a committed file should fail loudly on the
 * next command anyone types, not wait to be noticed at deploy time.
 */
export function assertManifestValid(vars, retired = []) {
  const problems = [];

  const leaked = vars.filter((v) => v.kind === "secret" && v.value !== undefined);
  if (leaked.length) {
    problems.push(
      `Committed value for ${leaked.map((v) => v.name).join(", ")}, declared kind "secret".\n` +
        "    Secrets come from .env, never from the manifest - it is committed, and these\n" +
        '    repositories are public. Remove the value, or change the kind to "config" if\n' +
        "    it is genuinely not a secret.",
    );
  }

  const seen = new Set();
  for (const spec of vars) {
    if (!spec.name) problems.push("A variable has no name.");
    if (seen.has(spec.name)) problems.push(`${spec.name} is declared twice.`);
    seen.add(spec.name);

    if (!KINDS.has(spec.kind))
      problems.push(
        `${spec.name}: unknown kind "${spec.kind}". Expected one of ${[...KINDS].join(", ")}.`,
      );

    for (const target of spec.targets ?? []) {
      if (!TARGETS.has(target))
        problems.push(
          `${spec.name}: unknown target "${target}". Expected one of ${[...TARGETS].join(", ")}.`,
        );
    }

    if ((spec.kind === "system" || spec.kind === "local") && spec.targets?.length)
      problems.push(
        `${spec.name}: kind "${spec.kind}" is never deployed, so targets are meaningless.`,
      );

    /* Vercel rejects a comment over 500 characters and fails the whole batch
       with it. Caught here rather than as an API error halfway through a push. */
    if (spec.summary && spec.summary.length > 500)
      problems.push(
        `${spec.name}: summary is ${spec.summary.length} chars; Vercel caps comments at 500.`,
      );
  }

  for (const r of retired) {
    if (seen.has(r.name)) problems.push(`${r.name} is both declared and listed as retired.`);
    if (!r.why) problems.push(`${r.name}: a retired variable needs a reason.`);
  }

  if (problems.length) {
    throw new Error(`env.schema.mjs is invalid:\n  ${problems.join("\n  ")}`);
  }
}

/** Whether a variable is required in the environment being reported on. */
export function isRequired(spec, { isProductionish }) {
  if (spec.required === "always") return true;
  if (spec.required === "production") return isProductionish;
  return false;
}

/* -------------------------------------------------------------------------- */
/* Never deploy a laptop                                                      */
/* -------------------------------------------------------------------------- */

/** Variables whose value is a place, and so can be a place only your machine has. */
export const PLACE_VARIABLES = [
  "DATABASE_URL",
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_IMAGE_BASE_URL",
];

/**
 * Why a URL's host could not work from anywhere but the machine that wrote it,
 * or null when it looks like a real remote host.
 *
 * Loopback names and addresses, and a bare hostname with no dot (`db`,
 * `postgres`): those resolve through a local hosts file or a container
 * network, never on a hosting platform. Unparseable values return null; that is
 * the variable's own `validate`'s job to report, not this guard's.
 */
export function localOnlyHostReason(value) {
  let host;
  try {
    host = new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
  host = host.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return `host "${host}" is this machine`;
  if (host === "::1" || host === "0.0.0.0" || /^127\./.test(host))
    return `host "${host}" is this machine`;
  if (!host.includes(".") && !host.includes(":"))
    return `host "${host}" is a bare hostname with no dot, which only resolves on a local network`;
  return null;
}

/**
 * Entries about to be sent to a deployed target whose value points at the
 * sender's own machine.
 *
 * This exists because a local .env can hold DATABASE_URL twice, or a stale
 * localhost, and `env:push --apply` would carry it to production. It runs on
 * the desired set, before any network call and in `--offline` too, so the
 * mistake is visible even when nothing could have been sent.
 *
 * The result names the variable, the targets and the reason - never the value,
 * which for DATABASE_URL carries a password.
 */
export function findLocalOnlyValues(desired) {
  const problems = [];
  for (const { spec, entry } of desired) {
    if (!PLACE_VARIABLES.includes(spec.name) || !entry.target?.length) continue;
    const reason = localOnlyHostReason(entry.value);
    if (reason) problems.push({ name: spec.name, targets: entry.target, reason });
  }
  return problems;
}

/** The text a developer sees for those problems. */
export function describeLocalOnlyValues(problems) {
  return (
    problems
      .map(
        (p) =>
          `${p.name} would be sent to ${p.targets.join(", ")}, but its ${p.reason}.\n` +
          "    A deployed site cannot reach that. The value is not shown here: it may hold a credential.",
      )
      .join("\n  ") + "\n  Fix the value in your .env (or the manifest), then run this again."
  );
}

/**
 * Split variables found on the platform but not in the manifest into the ones
 * known to be retired - safe to remove - and the ones nobody has accounted for.
 */
export function classifyExtras(existing, declaredNames, retired = []) {
  const reasons = new Map(retired.map((r) => [r.name, r.why]));
  const extras = existing.filter((e) => !declaredNames.has(e.key));
  return {
    retired: extras
      .filter((e) => reasons.has(e.key))
      .map((e) => ({ ...e, why: reasons.get(e.key) })),
    unknown: extras.filter((e) => !reasons.has(e.key)),
  };
}

/**
 * Evaluate every manifest variable against the current environment into a
 * report. This is the body of `env:check`, kept here so a test calls exactly
 * what the command calls.
 */
export function evaluateVars(vars, { isProductionish, onServerless, report = createReport() }) {
  for (const spec of vars) {
    if (spec.kind === "system") continue;

    const { value, source } = resolve(spec, "local");

    if (value === undefined) {
      if (isRequired(spec, { isProductionish })) {
        report.error(`${spec.name} is not set`, spec.missing?.message ?? spec.summary);
      } else if (spec.missing) {
        /* Some absences are graver on a host with no disk, and say something
           different there. The manifest supplies both variants; this only picks
           between them, so it never has to know which variable is which. */
        const local = !onServerless;
        const level =
          local && spec.missing.levelWhenLocal ? spec.missing.levelWhenLocal : spec.missing.level;
        const message =
          local && spec.missing.messageWhenLocal
            ? spec.missing.messageWhenLocal
            : spec.missing.message;
        report.add(level, `${spec.name} is not set`, message);
      }
      continue;
    }

    const verdict = spec.validate?.(value, { isProductionish });
    if (verdict) {
      report.add(verdict.level, `${spec.name}: ${verdict.message}`, undefined);
      if (verdict.level === "error") continue;
    }

    report.ok(spec.name, displayValue(spec, value, source));
  }
  return report;
}

/* -------------------------------------------------------------------------- */
/* Report formatting                                                          */
/* -------------------------------------------------------------------------- */

const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const OFF = "\x1b[0m";

export const colours = { RED, YELLOW, GREEN, CYAN, DIM, BOLD, OFF };

export function createReport() {
  const items = { error: [], warning: [], note: [], ok: [] };
  const add = (level, title, message) => {
    if (!items[level]) throw new Error(`Unknown report level: ${level}`);
    items[level].push({ title, message });
  };
  return {
    error: (t, m) => add("error", t, m),
    warning: (t, m) => add("warning", t, m),
    note: (t, m) => add("note", t, m),
    ok: (t, m) => add("ok", t, m),
    add,
    items,
    get counts() {
      return {
        errors: items.error.length,
        warnings: items.warning.length,
        notes: items.note.length,
      };
    },
  };
}

export function printReport(report, { heading, context }) {
  const block = (title, colour, list) => {
    if (!list.length) return;
    console.log(`${BOLD}${colour}${title}${OFF}`);
    for (const { title: t, message } of list) {
      console.log(`  ${BOLD}${t}${OFF}`);
      if (message) console.log(`    ${DIM}${message}${OFF}`);
    }
    console.log("");
  };

  console.log(`\n${BOLD}${heading}${OFF}  ${DIM}${context}${OFF}\n`);

  block("Errors", RED, report.items.error);
  block("Warnings", YELLOW, report.items.warning);
  block("Notes", DIM, report.items.note);

  if (report.items.ok.length) {
    console.log(`${BOLD}${GREEN}Configured${OFF}`);
    for (const { title, message } of report.items.ok) {
      console.log(`  ${title}${message ? `  ${DIM}${message}${OFF}` : ""}`);
    }
    console.log("");
  }

  const { errors, warnings, notes } = report.counts;
  console.log(`${errors} errors, ${warnings} warnings, ${notes} notes.\n`);
}

/* -------------------------------------------------------------------------- */
/* Vercel REST client                                                         */
/* -------------------------------------------------------------------------- */

const API = "https://api.vercel.com";

/**
 * Endpoint versions differ per resource and are not interchangeable - the
 * project lookup is v9, project creation v11, environment variables v10. They
 * are pinned here rather than guessed at the call site.
 */
const ROUTES = {
  findProject: (name) => `/v9/projects/${encodeURIComponent(name)}`,
  createProject: () => `/v11/projects`,
  listEnv: (name) => `/v10/projects/${encodeURIComponent(name)}/env`,
  upsertEnv: (name) => `/v10/projects/${encodeURIComponent(name)}/env`,
};

export class VercelError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = "VercelError";
    this.status = status;
    this.body = body;
  }
}

export function createVercelClient({ token, teamId }) {
  if (!token) {
    throw new VercelError(
      "No Vercel token. Create one at https://vercel.com/account/tokens and provide it as\n" +
        "  VERCEL_TOKEN=... npm run env:push\n" +
        "or put it in .env.local, which is gitignored. Add VERCEL_TEAM_ID too if the\n" +
        "project lives under a team rather than your personal account.",
    );
  }

  const call = async (path, { method = "GET", query = {}, body } = {}) => {
    const url = new URL(API + path);
    if (teamId) url.searchParams.set("teamId", teamId);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    const response = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }

    if (!response.ok) {
      const detail = parsed?.error?.message ?? parsed?.raw ?? response.statusText;
      throw new VercelError(`${method} ${path} failed (${response.status}): ${detail}`, {
        status: response.status,
        body: parsed,
      });
    }
    return parsed;
  };

  return {
    /** The project, or null when it does not exist. */
    async findProject(name) {
      try {
        return await call(ROUTES.findProject(name));
      } catch (error) {
        if (error instanceof VercelError && error.status === 404) return null;
        throw error;
      }
    },

    createProject({ name, framework, gitRepository, rootDirectory }) {
      return call(ROUTES.createProject(), {
        method: "POST",
        body: {
          name,
          framework,
          ...(gitRepository ? { gitRepository } : {}),
          ...(rootDirectory ? { rootDirectory } : {}),
        },
      });
    },

    /**
     * Existing variables, decrypted so a plan can say "unchanged" rather than
     * re-pushing every value on every run.
     *
     * The response shape varies by account: sometimes a bare array, sometimes
     * `{ envs }`. Normalised here so callers see one thing.
     */
    async listEnv(name) {
      const result = await call(ROUTES.listEnv(name), { query: { decrypt: "true" } });
      if (Array.isArray(result)) return result;
      return result.envs ?? [];
    },

    /**
     * One request for the whole set. `upsert=true` makes it idempotent, so
     * there is no separate create-or-update branch to get wrong.
     *
     * Partial failure is possible: the response carries `failed[]` alongside
     * `created`, and a 200 does not mean every variable landed.
     */
    upsertEnv(name, entries) {
      return call(ROUTES.upsertEnv(name), {
        method: "POST",
        query: { upsert: "true" },
        body: entries,
      });
    },
  };
}

/** Vercel caps env var comments at 500 characters. */
export const clampComment = (text) =>
  !text ? undefined : text.length <= 500 ? text : `${text.slice(0, 497)}...`;
