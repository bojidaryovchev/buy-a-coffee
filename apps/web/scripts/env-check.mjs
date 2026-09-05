#!/usr/bin/env node
/**
 * Environment report.
 *
 * Answers one question: what will this deployment actually do with the
 * configuration it has?
 *
 * Separate from `readiness.mjs` on purpose - that one asks what content is
 * still fake, this one asks what the environment is missing or has wrong. Both
 * exist because the failure they catch has the same shape: something that looks
 * fine and is not.
 *
 * The inventory, the per-variable rules and the cross-field rules all come from
 * env.schema.mjs, so this cannot drift from `.env.example` or from what
 * `env:push` deploys. It used to carry its own copy of the list, which is
 * exactly how the drift it now catches got in.
 *
 *   npm run env:check              report
 *   npm run env:check -- --strict  exit 1 on any error
 */

import { crossChecks, vars } from "../env.schema.mjs";
import {
  assertManifestValid,
  colours,
  createReport,
  displayValue,
  envValue,
  isRequired,
  isSet,
  loadEnvFiles,
  printReport,
  resolve,
} from "./env-lib.mjs";

const { RED, BOLD, OFF } = colours;

loadEnvFiles();

const STRICT = process.argv.includes("--strict");

try {
  assertManifestValid(vars);
} catch (error) {
  console.error(`\n${RED}${BOLD}Manifest problem.${OFF}\n${error.message}\n`);
  process.exit(1);
}

const hostEnv = envValue("VERCEL_ENV");
const onServerless = isSet("VERCEL");
/* "Production-ish": a deployment whose mistakes reach the public. Off a
   platform that announces itself, we cannot tell, so we do not guess. */
const isProductionish = hostEnv === "production";

const report = createReport();

/* -- per-variable -------------------------------------------------------- */

for (const spec of vars) {
  if (spec.kind === "system") continue;

  const { value, source } = resolve(spec, "local");

  if (value === undefined) {
    if (isRequired(spec, { isProductionish })) {
      report.error(`${spec.name} is not set`, spec.missing?.message ?? spec.summary);
    } else if (spec.missing) {
      /* Some absences are graver on a host with no disk, and say something
         different there. The manifest supplies both variants; this file only
         picks between them, so it never has to know which variable is which. */
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

  const verdict = spec.validate?.(value);
  if (verdict) {
    report.add(verdict.level, `${spec.name}: ${verdict.message}`, undefined);
    if (verdict.level === "error") continue;
  }

  report.ok(spec.name, displayValue(spec, value, source));
}

/* -- cross-field --------------------------------------------------------- */

const context = {
  has: (name) =>
    resolve(vars.find((v) => v.name === name) ?? { name, kind: "config" }, "local").value !==
    undefined,
  value: (name) =>
    resolve(vars.find((v) => v.name === name) ?? { name, kind: "config" }, "local").value,
  hostEnv,
  onServerless,
  isProductionish,
};

for (const check of crossChecks) {
  const result = check(context);
  if (result) report.add(result.level, result.title, result.message);
}

/* -- report -------------------------------------------------------------- */

printReport(report, {
  heading: "Environment",
  context: hostEnv ? `VERCEL_ENV=${hostEnv}` : "local",
});

if (STRICT && report.counts.errors) {
  console.error(
    `${RED}${BOLD}Stopped.${OFF} Fix the errors above, or run without --strict for a report.\n`,
  );
  process.exit(1);
}
