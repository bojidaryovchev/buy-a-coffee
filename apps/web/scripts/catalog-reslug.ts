#!/usr/bin/env tsx
/**
 * Move every product to the shop's own slug.
 *
 * A product's slug used to be the supplier's name, transliterated:
 * `kapsuli-dg-rema-caffe-cookies-16-br`. It is now built from the shop's own
 * name for the product, brand first: `rema-caffe-cookies-kapsuli-dolce-gusto-16-br`
 * (`productName` in `@catalog/shared`). The sync gives new products that slug
 * from the start. Products stored before the change are moved by this script,
 * once.
 *
 *   pnpm --filter @catalog/web catalog:reslug                 plan only
 *   pnpm --filter @catalog/web catalog:reslug --tsv f.tsv     plan, and write old → new to f.tsv
 *   pnpm --filter @catalog/web catalog:reslug --apply         move (one transaction)
 *
 * Plan mode prints old → new for every product that would move and writes
 * nothing. `--apply` writes each new slug and appends the old one to
 * `previous_slugs`, so the old URL answers 308 to the new one from then on.
 *
 * Deterministic and safe to run twice. The plan is a function of the products
 * themselves — never of the order they were stored in — so production ends at
 * the same slugs as any other database holding the same catalog; and a second
 * run finds nothing to move. `content/product-copy.ts` is keyed by these slugs,
 * so run `copy:apply` afterwards.
 *
 * A slug is otherwise frozen. Do not run this casually on a catalog that has
 * already been moved: it changes nothing unless a name override was added or
 * two products have come to share a name, and in either case the plan is the
 * thing to read first.
 *
 * Scripts do not load `.env` files: export DATABASE_URL first. Needs migration
 * `0007_product_previous_slugs`.
 */
import { writeFileSync } from "node:fs";
import { createDatabase } from "@catalog/db";
import { applyReslug, planReslug } from "./catalog-reslug-lib.ts";

interface Args {
  apply: boolean;
  tsvFile: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, tsvFile: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply") args.apply = true;
    // pnpm forwards a bare `--` on some versions; it means nothing here.
    else if (arg === "--") continue;
    else if (arg === "--tsv") {
      const file = argv[++i];
      if (!file || file.startsWith("--")) throw new Error("--tsv needs a file path");
      args.tsvFile = file;
    } else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { db, close } = createDatabase({ max: 1 });

  try {
    const plan = await planReslug(db);
    console.log(`products: ${plan.rows.length}`);
    console.log(`to move:  ${plan.moves.length}`);
    for (const move of plan.moves) console.log(`  ${move.from}  ->  ${move.to}`);

    if (args.tsvFile) {
      const lines = plan.moves.map((move) => [move.from, move.to, move.name].join("\t"));
      writeFileSync(args.tsvFile, ["old_slug\tnew_slug\tsource_name", ...lines, ""].join("\n"));
      console.log(`wrote ${plan.moves.length} rows to ${args.tsvFile}`);
    }

    if (plan.moves.length === 0) {
      console.log("every product is already at its planned slug; nothing to do.");
      return;
    }
    if (!args.apply) {
      console.log("plan only; nothing written. Re-run with --apply to move them.");
      return;
    }

    const moved = await applyReslug(db, plan);
    console.log(`moved ${moved} products; each old slug now redirects to the new one.`);
    console.log("next: pnpm --filter @catalog/web copy:apply");
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
