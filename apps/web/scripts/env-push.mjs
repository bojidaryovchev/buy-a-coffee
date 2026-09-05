#!/usr/bin/env node
/**
 * Apply env.schema.mjs to Vercel.
 *
 *   npm run env:push            plan only - shows what would change, writes nothing
 *   npm run env:push -- --offline  what WOULD be sent, without contacting Vercel
 *   npm run env:push -- --apply actually write
 *   npm run env:push -- --apply --create   also create the project if absent
 *   npm run env:push -- --prune            report variables on Vercel that the
 *                                          manifest does not declare
 *
 * Plan-by-default is deliberate. This writes credentials to a live third-party
 * account, and the cost of a surprise there is higher than the cost of typing a
 * flag. Nothing here deletes anything: `--prune` reports extras and tells you
 * how to remove them by hand, because a script that silently drops a variable
 * somebody added in the dashboard is a script that loses production config.
 *
 * Where values come from:
 *   config vars  the manifest only, unless the variable sets `fromEnv: true`.
 *                Your .env holds DEVELOPMENT values, and a silent fallback
 *                would push localhost into production canonicals.
 *   secret vars  your .env, always - the manifest may not hold one.
 *
 * Requires VERCEL_TOKEN (https://vercel.com/account/tokens), and VERCEL_TEAM_ID
 * if the project sits under a team. Put them in .env.local, which is gitignored.
 */

import { project, vars } from "../env.schema.mjs";
import {
  assertManifestValid,
  clampComment,
  colours,
  createVercelClient,
  isSet,
  loadEnvFiles,
  resolve,
  VercelError,
} from "./env-lib.mjs";

const { RED, YELLOW, GREEN, CYAN, DIM, BOLD, OFF } = colours;

loadEnvFiles();

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const CREATE = argv.includes("--create");
const PRUNE = argv.includes("--prune");
const OFFLINE = argv.includes("--offline");

/* The guard that lets this manifest live in a public repository. Checked before
   anything else, and before any network call. */
try {
  assertManifestValid(vars);
} catch (error) {
  console.error(`\n${RED}${BOLD}Refusing to run.${OFF}\n${error.message}\n`);
  process.exit(1);
}

/* -- 1. Work out the desired state --------------------------------------- */

/** Only these two kinds are deployed. `system` is the platform's; `local` is yours. */
const deployable = vars.filter((v) => v.kind === "config" || v.kind === "secret");

const desired = [];
const skipped = [];

for (const spec of deployable) {
  if (!spec.targets?.length) {
    skipped.push({ spec, why: "declared with no Vercel targets" });
    continue;
  }
  const { value, source } = resolve(spec);
  if (value === undefined) {
    /* Say which of the two reasons it is. "No value anywhere" and "there is a
       value but it is a development one this tool refuses to deploy" are very
       different messages, and the second is the one worth explaining. */
    const hasLocal = isSet(spec.name);
    skipped.push({
      spec,
      why:
        hasLocal && spec.kind === "config" && !spec.fromEnv
          ? "manifest has no value - your .env does, but a config var is not deployed from .env " +
            "(it holds development values). Put it in the manifest, or set `fromEnv: true` if the " +
            "local value genuinely is the production one."
          : "no value in the manifest or your .env",
    });
    continue;
  }
  desired.push({
    spec,
    source,
    entry: {
      key: spec.name,
      value,
      /* `plain` is readable in the dashboard, which is right for values that
         already ship to every browser. `encrypted` is Vercel's own default for
         anything typed into the secret field. */
      type: spec.kind === "secret" ? "encrypted" : "plain",
      target: spec.targets,
      /* The dashboard stops being an undocumented list of names. */
      comment: clampComment(spec.summary),
    },
  });
}

const label = (source) => (source === "manifest" ? `${DIM}manifest${OFF}` : `${CYAN}.env${OFF}`);
const mask = (spec, value) =>
  spec.kind === "secret"
    ? `${DIM}(${value.length} chars, hidden)${OFF}`
    : value.length > 60
      ? `${value.slice(0, 57)}...`
      : value;

/* -- 2. Offline plan ------------------------------------------------------- */

/**
 * What would be sent, without a token and without a network call.
 *
 * Useful for reviewing a manifest change on its own terms, and the only way to
 * see anything at all before you have credentials. It is also the quickest way
 * to confirm the property this tool most needs to hold: that no development
 * value from your .env is on its way to production.
 */
if (OFFLINE) {
  console.log(
    `\n${BOLD}Would send to ${project.vercelName}${OFF} ${DIM}(offline - nothing contacted)${OFF}\n`,
  );
  for (const { spec, entry, source } of desired) {
    console.log(
      `  ${BOLD}${spec.name}${OFF} ${DIM}[${entry.target.join(", ")}] ${entry.type}${OFF} ${label(source)}\n` +
        `    ${mask(spec, entry.value)}`,
    );
  }
  if (skipped.length) {
    console.log(`\n${BOLD}${DIM}Not sent${OFF}`);
    for (const { spec, why } of skipped) console.log(`  ${spec.name}  ${DIM}${why}${OFF}`);
  }
  console.log(`\n${desired.length} would be sent, ${skipped.length} skipped.\n`);
  process.exit(0);
}

/* -- 3. Talk to Vercel ----------------------------------------------------- */

let client;
try {
  client = createVercelClient({
    token: process.env.VERCEL_TOKEN,
    teamId: process.env.VERCEL_TEAM_ID,
  });
} catch (error) {
  console.error(`\n${RED}${BOLD}${error.message}${OFF}\n`);
  console.error(
    `  ${DIM}To review the plan without a token: npm run env:push -- --offline${OFF}\n`,
  );
  process.exit(1);
}

async function main() {
  console.log(
    `\n${BOLD}Vercel environment${OFF}  ${DIM}project ${project.vercelName}${
      process.env.VERCEL_TEAM_ID ? `, team ${process.env.VERCEL_TEAM_ID}` : ", personal account"
    }${OFF}\n`,
  );

  let remote = await client.findProject(project.vercelName);

  if (!remote) {
    if (!CREATE) {
      console.error(
        `${RED}${BOLD}No Vercel project named "${project.vercelName}".${OFF}\n` +
          `  ${DIM}Re-run with --create --apply to create it from the manifest, or create it in\n` +
          `  the dashboard and re-run. If it exists under a team, set VERCEL_TEAM_ID.${OFF}\n`,
      );
      process.exit(1);
    }
    if (!APPLY) {
      console.log(
        `${YELLOW}${BOLD}Would create project "${project.vercelName}"${OFF}\n` +
          `  ${DIM}framework ${project.framework}, repo ${project.gitRepository?.repo ?? "none"}` +
          `${project.rootDirectory ? `, root ${project.rootDirectory}` : ""}${OFF}\n`,
      );
    } else {
      remote = await client.createProject({
        name: project.vercelName,
        framework: project.framework,
        gitRepository: project.gitRepository,
        rootDirectory: project.rootDirectory,
      });
      console.log(`${GREEN}${BOLD}Created project${OFF} ${project.vercelName}\n`);
    }
  }

  /* An unapplied create means there is nothing on the other side to diff
     against, so every variable is new by definition. */
  const existing = remote ? await client.listEnv(project.vercelName) : [];

  const sameTargets = (a = [], b = []) =>
    a.length === b.length && [...a].sort().join() === [...b].sort().join();

  const create = [];
  const update = [];
  const unchanged = [];

  for (const item of desired) {
    const matches = existing.filter((e) => e.key === item.entry.key);
    const exact = matches.find(
      (e) => sameTargets(e.target, item.entry.target) && e.value === item.entry.value,
    );
    if (exact) unchanged.push(item);
    else if (matches.length) update.push({ ...item, matches });
    else create.push(item);
  }

  const declared = new Set(deployable.map((v) => v.name));
  const extra = existing.filter((e) => !declared.has(e.key));

  /* -- 4. Report ---------------------------------------------------------- */

  const section = (title, colour, list, render) => {
    if (!list.length) return;
    console.log(`${BOLD}${colour}${title}${OFF}`);
    for (const item of list) console.log(render(item));
    console.log("");
  };

  section(
    "Create",
    GREEN,
    create,
    ({ spec, entry, source }) =>
      `  ${BOLD}${spec.name}${OFF} ${DIM}[${entry.target.join(", ")}]${OFF} ${label(source)}\n` +
      `    ${mask(spec, entry.value)}`,
  );

  section("Update", YELLOW, update, ({ spec, entry, source, matches }) => {
    const before = matches[0];
    const targetChanged = !sameTargets(before.target, entry.target);
    return (
      `  ${BOLD}${spec.name}${OFF} ${DIM}[${entry.target.join(", ")}]${OFF} ${label(source)}\n` +
      `    ${mask(spec, entry.value)}` +
      (targetChanged
        ? `\n    ${DIM}targets: ${(before.target ?? []).join(", ") || "none"} -> ${entry.target.join(", ")}${OFF}`
        : "")
    );
  });

  if (unchanged.length) {
    console.log(`${BOLD}${GREEN}Unchanged${OFF}`);
    console.log(`  ${DIM}${unchanged.map((u) => u.spec.name).join(", ")}${OFF}\n`);
  }

  if (skipped.length) {
    console.log(`${BOLD}${DIM}Not pushed${OFF}`);
    for (const { spec, why } of skipped) {
      console.log(`  ${spec.name}  ${DIM}${why}${OFF}`);
    }
    console.log("");
  }

  if (extra.length) {
    console.log(`${BOLD}${YELLOW}On Vercel but not in the manifest${OFF}`);
    for (const e of extra) {
      console.log(
        `  ${e.key} ${DIM}[${(Array.isArray(e.target) ? e.target : [e.target]).filter(Boolean).join(", ")}]${OFF}`,
      );
    }
    console.log(
      `  ${DIM}Nothing is deleted by this tool. Either add them to env.schema.mjs or remove\n` +
        `  them in the dashboard - a script that silently drops a variable someone added\n` +
        `  by hand is a script that loses production configuration.${OFF}\n`,
    );
  } else if (PRUNE) {
    console.log(`${DIM}Nothing on Vercel that the manifest does not declare.${OFF}\n`);
  }

  /* -- 5. Apply ----------------------------------------------------------- */

  const writes = [...create, ...update];

  if (!writes.length) {
    console.log(`${GREEN}Nothing to do - Vercel already matches the manifest.${OFF}\n`);
    return;
  }

  if (!APPLY) {
    console.log(
      `${BOLD}Plan only.${OFF} ${create.length} to create, ${update.length} to update.\n` +
        `  ${DIM}Re-run with --apply to write. Nothing has been sent.${OFF}\n`,
    );
    return;
  }

  const result = await client.upsertEnv(
    project.vercelName,
    writes.map((w) => w.entry),
  );

  /* A 200 does not mean every variable landed - the response carries `failed`
     alongside `created`, and ignoring it would report a success that is not. */
  const failed = result?.failed ?? [];
  if (failed.length) {
    console.error(`${RED}${BOLD}${failed.length} failed${OFF}`);
    for (const f of failed) {
      const e = f.error ?? {};
      console.error(
        `  ${e.key ?? e.envVarKey ?? "?"}  ${DIM}${e.message ?? e.code ?? "unknown"}${OFF}`,
      );
    }
    console.error("");
  }

  const applied = writes.length - failed.length;
  console.log(`${GREEN}${BOLD}Applied ${applied} variable${applied === 1 ? "" : "s"}.${OFF}`);
  console.log(
    `  ${DIM}Vercel bakes NEXT_PUBLIC_* values in at build time, so these do not take\n` +
      `  effect until the next deployment. Redeploy to pick them up.${OFF}\n`,
  );

  if (failed.length) process.exit(1);
}

main().catch((error) => {
  if (error instanceof VercelError) {
    console.error(`\n${RED}${BOLD}Vercel API error${OFF}\n  ${error.message}\n`);
    if (error.status === 403) {
      console.error(
        `  ${DIM}A 403 here usually means the token lacks access to this scope, or the\n  project belongs to a team and VERCEL_TEAM_ID is not set.${OFF}\n`,
      );
    }
    process.exit(1);
  }
  throw error;
});
