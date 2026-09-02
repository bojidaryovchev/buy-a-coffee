#!/usr/bin/env node
/**
 * Environment report for the STOREFRONT.
 *
 * Answers one question: what will this deployment actually do with the
 * configuration it has?
 *
 * The catalog sync job is configured separately and validates itself - see
 * `loadConfig` in packages/scraper-core/src/config.ts, which parses the whole
 * environment through a zod schema and fails with a readable message. Nothing
 * equivalent existed on this side, where the two settings that matter most both
 * degrade silently: an unset image base URL serves images off a disk that does
 * not exist in production, and an unset rate-limit salt keeps working with a
 * public default.
 *
 *   node scripts/env-check.mjs            report
 *   node scripts/env-check.mjs --strict   exit 1 on any error
 */

import { existsSync } from "node:fs";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const STRICT = process.argv.includes("--strict");

const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const OFF = "\x1b[0m";

const set = (name) => {
  const value = process.env[name];
  return typeof value === "string" && value.trim() !== "";
};
const val = (name) => (process.env[name] ?? "").trim();

const errors = [];
const warnings = [];
const notes = [];
const ok = [];

const error = (title, detail) => errors.push({ title, detail });
const warn = (title, detail) => warnings.push({ title, detail });
const note = (title, detail) => notes.push({ title, detail });
const good = (title, detail) => ok.push({ title, detail });

const hostEnv = val("VERCEL_ENV");
const onVercel = set("VERCEL");
/* Whether this deployment is one search engines may index. Mirrors robots.ts
   exactly, including the precedence, so the report cannot disagree with the
   file it is reporting on. */
const isProduction = hostEnv
  ? hostEnv === "production"
  : val("NEXT_PUBLIC_ENVIRONMENT") === "production" ||
    (process.env.NODE_ENV === "production" &&
      process.env.NEXT_PUBLIC_ENVIRONMENT === undefined);

/* -- Database ------------------------------------------------------------- */

if (!set("DATABASE_URL")) {
  error(
    "DATABASE_URL is not set",
    "The storefront reads its whole catalog from this. Nothing renders without it.",
  );
} else if (!/^postgres(ql)?:\/\//i.test(val("DATABASE_URL"))) {
  error("DATABASE_URL does not look like a PostgreSQL URL", "Expected it to start with postgres:// or postgresql://.");
} else {
  good("DATABASE_URL", "set");
}

if (set("DATABASE_POOL_MAX")) {
  const max = Number.parseInt(val("DATABASE_POOL_MAX"), 10);
  if (!Number.isFinite(max) || max < 1) {
    error("DATABASE_POOL_MAX is not a positive integer", `Got "${val("DATABASE_POOL_MAX")}".`);
  } else if (onVercel && max > 5) {
    warn(
      `DATABASE_POOL_MAX is ${max} on a serverless host`,
      "Every concurrent function instance is its own process with its own pool, so this is the per-instance figure. Use a pooled endpoint, or a small number here.",
    );
  } else {
    good("DATABASE_POOL_MAX", String(max));
  }
} else {
  note(
    "DATABASE_POOL_MAX is not set",
    onVercel
      ? "Defaults to 2 on Vercel, because each instance holds its own pool."
      : "Defaults to 10, which suits one long-running process.",
  );
}

/* -- Site ----------------------------------------------------------------- */

if (!set("NEXT_PUBLIC_SITE_URL")) {
  error(
    "NEXT_PUBLIC_SITE_URL is not set",
    "Canonical tags, Open Graph, the sitemap and the structured data all derive from it. It falls back to http://localhost:3000, which is wrong everywhere except a laptop.",
  );
} else if (!/^https?:\/\//.test(val("NEXT_PUBLIC_SITE_URL"))) {
  error("NEXT_PUBLIC_SITE_URL has no scheme", `Got "${val("NEXT_PUBLIC_SITE_URL")}".`);
} else if (isProduction && /localhost|127\.0\.0\.1/.test(val("NEXT_PUBLIC_SITE_URL"))) {
  error("NEXT_PUBLIC_SITE_URL points at localhost on an indexable deployment", val("NEXT_PUBLIC_SITE_URL"));
} else {
  good("NEXT_PUBLIC_SITE_URL", val("NEXT_PUBLIC_SITE_URL"));
}

/* -- Images --------------------------------------------------------------- */

if (!set("NEXT_PUBLIC_IMAGE_BASE_URL")) {
  (onVercel ? error : note)(
    "NEXT_PUBLIC_IMAGE_BASE_URL is not set",
    onVercel
      ? "Images are served from STORAGE_LOCAL_DIR on local disk, which does not exist on this host. Every product image will 404. Set it to the CDN base URL."
      : "Images are served from STORAGE_LOCAL_DIR through the app's own /media route. Correct for development.",
  );
} else {
  try {
    const parsed = new URL(val("NEXT_PUBLIC_IMAGE_BASE_URL"));
    good("NEXT_PUBLIC_IMAGE_BASE_URL", parsed.origin);
    note(
      "Image host is fixed at build time",
      `next.config.ts derives images.remotePatterns from this value, so changing it needs a redeploy rather than a dashboard save. Currently allowing: ${parsed.hostname}`,
    );
  } catch {
    error("NEXT_PUBLIC_IMAGE_BASE_URL is not a valid URL", `Got "${val("NEXT_PUBLIC_IMAGE_BASE_URL")}". next.config.ts silently allows NO remote images when it cannot parse this.`);
  }
}

if (onVercel && set("STORAGE_LOCAL_DIR")) {
  note("STORAGE_LOCAL_DIR is set on a serverless host", "It is only read when NEXT_PUBLIC_IMAGE_BASE_URL is empty, so it is harmless here - but it is development configuration and does not belong in this dashboard.");
}

/* -- Rate limiting -------------------------------------------------------- */

if (!set("RATE_LIMIT_SALT")) {
  (isProduction ? error : note)(
    "RATE_LIMIT_SALT is not set",
    "Rate limiting keeps working with a public default, which is the problem: the IP fingerprint becomes identical and predictable across every deployment of this code. Nothing breaks, so nothing tells you.",
  );
} else if (val("RATE_LIMIT_SALT").length < 16) {
  warn("RATE_LIMIT_SALT is short", `${val("RATE_LIMIT_SALT").length} characters. Use something like \`openssl rand -hex 32\`.`);
} else {
  good("RATE_LIMIT_SALT", "set");
}

/* -- robots.txt ----------------------------------------------------------- */

if (hostEnv) {
  good(
    "Environment signal",
    `VERCEL_ENV=${hostEnv}, so robots.txt ${isProduction ? "allows crawling" : "disallows everything"}. NEXT_PUBLIC_ENVIRONMENT is ignored here and should be left unset.`,
  );
  if (set("NEXT_PUBLIC_ENVIRONMENT")) {
    warn(
      "NEXT_PUBLIC_ENVIRONMENT is set on Vercel",
      "VERCEL_ENV takes precedence, so this does nothing. It is worth removing: it reads as if it were in control.",
    );
  }
} else if (!set("NEXT_PUBLIC_ENVIRONMENT")) {
  note(
    "NEXT_PUBLIC_ENVIRONMENT is not set and there is no VERCEL_ENV",
    `robots.txt falls back to NODE_ENV, so this deployment ${isProduction ? "allows crawling" : "disallows everything"}.`,
  );
} else if (!isProduction) {
  warn(
    `NEXT_PUBLIC_ENVIRONMENT is "${val("NEXT_PUBLIC_ENVIRONMENT")}", not "production"`,
    "The comparison is exact, and anything else makes robots.txt disallow the entire site. If this is the live deployment, that is a total deindex.",
  );
} else {
  good("NEXT_PUBLIC_ENVIRONMENT", "production - robots.txt allows crawling");
}

/* -- Report --------------------------------------------------------------- */

const block = (title, colour, items) => {
  if (!items.length) return;
  console.log(`${BOLD}${colour}${title}${OFF}`);
  for (const { title: t, detail } of items) {
    console.log(`  ${BOLD}${t}${OFF}`);
    if (detail) console.log(`    ${DIM}${detail}${OFF}`);
  }
  console.log("");
};

console.log(`\n${BOLD}Storefront environment${OFF}  ${DIM}${hostEnv ? `VERCEL_ENV=${hostEnv}` : "local"}${OFF}\n`);

block("Errors", RED, errors);
block("Warnings", YELLOW, warnings);
block("Notes", DIM, notes);

if (ok.length) {
  console.log(`${BOLD}${GREEN}Configured${OFF}`);
  for (const { title, detail } of ok) {
    console.log(`  ${title}${detail ? `  ${DIM}${detail}${OFF}` : ""}`);
  }
  console.log("");
}

console.log(`${errors.length} errors, ${warnings.length} warnings, ${notes.length} notes.\n`);

if (STRICT && errors.length) {
  console.error(`${RED}${BOLD}Stopped.${OFF} Fix the errors above, or run without --strict for a report.\n`);
  process.exit(1);
}
