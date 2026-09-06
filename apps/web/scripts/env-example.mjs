#!/usr/bin/env node
/**
 * Regenerate .env.example from env.schema.mjs.
 *
 *   npm run env:example           write the file
 *   npm run env:example -- --check exit 1 if it is out of date (for CI, or a hook)
 *
 * Why this exists: the example file, the readiness check and the deployed
 * configuration were three hand-maintained lists of the same thing, and they
 * had drifted - a documented variable no code read, a port that did not exist,
 * a locale count off by seven. Generating one of them from the manifest turns
 * that class of bug from "fixed" into "not expressible".
 *
 * Do not edit .env.example by hand. Edit the manifest and re-run this.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { vars } from "../env.schema.mjs";
import { assertManifestValid, colours } from "./env-lib.mjs";

const { RED, GREEN, DIM, BOLD, OFF } = colours;

const CHECK = process.argv.includes("--check");
const TARGET = ".env.example";
const WIDTH = 78;

try {
  assertManifestValid(vars);
} catch (error) {
  console.error(`
${RED}${BOLD}Manifest problem.${OFF}
${error.message}
`);
  process.exit(1);
}

const rule = (title) => `# --- ${title} ${"-".repeat(Math.max(0, WIDTH - 7 - title.length))}`;

const wrap = (text, prefix = "# ") => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (line && (prefix + line + " " + word).length > WIDTH) {
      lines.push(prefix + line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(prefix + line);
  return lines;
};

const out = [];

out.push(
  "# GENERATED - edit env.schema.mjs, then run `npm run env:example`.",
  "#",
  "# Copy to .env and fill in. Nothing here is required for local development.",
  "# Values marked [manifest] are committed and deployed from the manifest;",
  "# set them here only to override locally.",
  "",
);

/* Grouped by the manifest's own sections, in first-appearance order, so the
   generated file reads in the same shape a person would have written. */
const sections = [];
for (const spec of vars) {
  const name = spec.section ?? "Other";
  let group = sections.find((s) => s.name === name);
  if (!group) sections.push((group = { name, specs: [] }));
  group.specs.push(spec);
}

for (const { name, specs } of sections) {
  out.push(rule(name));

  for (const spec of specs) {
    if (spec.summary && spec.kind !== "system") out.push(...wrap(spec.summary));

    if (spec.detail?.length) {
      out.push("#");
      for (const line of spec.detail) out.push(line ? `# ${line}` : "#");
    }

    if (spec.kind === "system") {
      out.push(`#   ${spec.name}  (set by the platform)`);
    } else if (spec.kind === "local") {
      out.push(`${spec.name}=${spec.example ?? ""}`);
    } else {
      if (spec.example && spec.value === undefined) out.push(`# e.g. ${spec.example}`);
      out.push(`${spec.name}=${spec.value !== undefined ? `   # [manifest] ${spec.value}` : ""}`);
    }
    out.push("");
  }
}

const rendered = `${out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;

if (CHECK) {
  let current = "";
  try {
    current = readFileSync(TARGET, "utf8");
  } catch {
    /* missing counts as out of date */
  }
  if (current !== rendered) {
    console.error(
      `\n${RED}${BOLD}${TARGET} is out of date.${OFF}\n` +
        `  ${DIM}Run \`npm run env:example\` and commit the result.${OFF}\n`,
    );
    process.exit(1);
  }
  console.log(`${GREEN}${TARGET} is up to date.${OFF}`);
} else {
  writeFileSync(TARGET, rendered, "utf8");
  console.log(
    `${GREEN}${BOLD}Wrote ${TARGET}${OFF} ${DIM}(${rendered.split("\n").length} lines, ${vars.length} variables)${OFF}`,
  );
}
