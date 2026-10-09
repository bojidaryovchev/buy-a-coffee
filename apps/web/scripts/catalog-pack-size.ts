#!/usr/bin/env tsx
/**
 * Apply the pack-size rule to products already stored.
 *
 * A product's pack size is decided in one place (`decidePackSize` in
 * `@catalog/shared`): the supplier's pack field, unless the product's name
 * states another size, and then the name's. The sync applies it to every
 * product it reads, so a synced catalog corrects itself on its next ordinary
 * run. This script applies the same rule to the rows as they stand, from what
 * they already hold, without contacting the source: for a local copy that will
 * never be synced, or for a catalog that should not wait for its next run.
 *
 *   pnpm --filter @catalog/web catalog:pack-size            plan only
 *   pnpm --filter @catalog/web catalog:pack-size --apply    write (one transaction)
 *
 * Plan mode prints, for each product whose stored pack size is not the one the
 * rule decides, the size, the servings and the price per cup before and
 * after, and writes nothing. `--apply` writes the pack columns
 * (`weight`, `weight_value`, `weight_unit`, `servings`, `servings_estimated`)
 * and records the supplier's pack field and both sizes in `source_data`, which
 * is where the admin's sync page reads conflicts from.
 *
 * Deterministic and safe to run twice: the plan is a function of each row's
 * name and of the supplier's pack field, which is kept verbatim, so a second
 * run finds nothing to change. Running it before or after a sync makes no
 * difference to where the catalog ends up; see `applyPackSizes` for the one
 * audit record the next sync then writes.
 *
 * Scripts do not load `.env` files: export DATABASE_URL first.
 */
import { createDatabase } from "@catalog/db";
import { type PackColumns, applyPackSizes, planPackSizes } from "./catalog-pack-size-lib.ts";

function parseArgs(argv: string[]): { apply: boolean } {
  const args = { apply: false };
  for (const arg of argv) {
    if (arg === "--apply") args.apply = true;
    // pnpm forwards a bare `--` on some versions; it means nothing here.
    else if (arg === "--") continue;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

const size = (columns: PackColumns): string =>
  columns.weight ?? (columns.weightCanonical ? columns.weightCanonical : "(none)");

const number = (value: string | null): string =>
  value === null ? "(none)" : value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { db, close } = createDatabase({ max: 1 });

  try {
    const plan = await planPackSizes(db);
    console.log(`products:   ${plan.products}`);
    console.log(`to correct: ${plan.changes.length}`);
    for (const change of plan.changes) {
      console.log(`  ${change.name}  (${change.sourceKey})`);
      console.log(`    pack field at the source: ${change.packField ?? "(none)"}`);
      console.log(`    pack size:      ${size(change.stored)}  ->  ${size(change.planned)}`);
      console.log(
        `    servings:       ${number(change.stored.servings)}  ->  ${number(change.planned.servings)}`,
      );
      console.log(
        `    price per cup:  ${change.pricePerCup.stored ?? "(none)"}  ->  ${change.pricePerCup.planned ?? "(none)"}  (pack price ${change.price ?? "none"})`,
      );
    }

    console.log(`name and pack field disagree at the source: ${plan.conflicts.length}`);
    for (const { name, sourceKey, conflict } of plan.conflicts) {
      console.log(
        `  ${name}  (${sourceKey}): name says ${conflict.inName}, pack field says ${conflict.inPackField}`,
      );
    }

    if (plan.changes.length === 0) {
      console.log("every product already has the pack size the rule decides; nothing to do.");
      return;
    }
    if (!args.apply) {
      console.log("plan only; nothing written. Re-run with --apply to correct them.");
      return;
    }

    const corrected = await applyPackSizes(db, plan);
    console.log(`corrected ${corrected} products.`);
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
