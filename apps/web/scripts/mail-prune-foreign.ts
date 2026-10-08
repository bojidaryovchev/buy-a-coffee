#!/usr/bin/env tsx
/**
 * Remove mailbox threads that were never addressed to this shop.
 *
 * The mail provider's account holds several domains and its webhook used to
 * fire for mail to any of them, so the mailbox collected other domains'
 * correspondence. The handler now ignores such mail (`lib/mail/inbound.ts`);
 * this clears what was stored before that.
 *
 *   pnpm --filter @catalog/web mail:prune-foreign                  plan only
 *   pnpm --filter @catalog/web mail:prune-foreign --export f.json  plan, and write the rows to f.json
 *   pnpm --filter @catalog/web mail:prune-foreign --apply          delete (one transaction)
 *
 * Plan mode prints counts and, per thread, only its id, date and the recipient
 * DOMAIN. Never an address, subject or body: logs and terminals are no place
 * for correspondence. `--export` is the one way the content leaves the
 * database, and it goes to a file you name, mode 0600.
 *
 * A thread is "foreign" when none of its messages was addressed to the shop's
 * mail domain AND the shop never wrote in it. The second condition protects
 * conversations the shop started from the panel: those messages are addressed
 * to the customer, and would otherwise look foreign.
 *
 * Caveat: only the `to` header is stored, not cc/bcc/envelope. A message that
 * reached the shop as a Bcc looks foreign here. Read the plan before applying.
 *
 * Scripts do not load `.env` files: export DATABASE_URL (and MAIL_FROM, if the
 * shop does not send from the default address) first.
 */
import { writeFileSync } from "node:fs";
import { inArray } from "drizzle-orm";
import { createDatabase } from "@catalog/db";
import { mailMessages, mailThreads } from "@catalog/db/schema";
import { siteConfig } from "../src/config/site.ts";
import { domainOf, extractAddresses, isAddressedToDomain } from "../src/lib/mail/recipients.ts";

/** Same derivation as `lib/mail/identity.ts`, which is `server-only` and so
 *  cannot be imported here. */
function shopMailDomain(): string {
  const from = process.env.MAIL_FROM || siteConfig.contact.email;
  const address = (from.match(/<([^>]+)>/)?.[1] ?? from).trim();
  return domainOf(address);
}

interface Args {
  apply: boolean;
  exportFile: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, exportFile: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--export") {
      const file = argv[++i];
      if (!file || file.startsWith("--")) throw new Error("--export needs a file path");
      args.exportFile = file;
    } else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const domain = shopMailDomain();
  const { db, close } = createDatabase({ max: 1 });

  try {
    const [threads, messages] = await Promise.all([
      db.select().from(mailThreads),
      db.select().from(mailMessages),
    ]);

    const byThread = new Map<string, (typeof messages)[number][]>();
    for (const m of messages) {
      const list = byThread.get(m.threadId) ?? [];
      list.push(m);
      byThread.set(m.threadId, list);
    }

    const foreign = threads.filter((thread) => {
      const own = byThread.get(thread.id) ?? [];
      const wroteIn = own.some((m) => m.direction === "out");
      const toShop = own.some((m) => isAddressedToDomain([[m.toAddresses]], domain));
      return !wroteIn && !toShop;
    });

    console.log(`shop mail domain: ${domain}`);
    console.log(`threads: ${threads.length}, messages: ${messages.length}`);
    console.log(`foreign threads: ${foreign.length} of ${threads.length}`);

    for (const thread of foreign.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
      const domains = new Set<string>();
      for (const m of byThread.get(thread.id) ?? []) {
        for (const item of m.toAddresses.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)) {
          for (const a of extractAddresses(item)) domains.add(domainOf(a));
        }
      }
      const shown = domains.size > 0 ? [...domains].sort().join(" ") : "(none)";
      console.log(`  ${thread.id}  ${thread.createdAt.toISOString().slice(0, 10)}  ${shown}`);
    }

    if (foreign.length === 0) return;

    const ids = foreign.map((t) => t.id);

    if (args.exportFile) {
      const rows = {
        exportedAt: new Date().toISOString(),
        domain,
        threads: foreign,
        messages: ids.flatMap((id) => byThread.get(id) ?? []),
      };
      writeFileSync(args.exportFile, JSON.stringify(rows, null, 2), { mode: 0o600 });
      console.log(
        `exported ${rows.threads.length} threads, ${rows.messages.length} messages to file`,
      );
    }

    if (!args.apply) {
      console.log("plan only; nothing deleted. Re-run with --apply to delete.");
      return;
    }

    /* Messages first, explicitly, though the foreign key cascades: the order is
       then true whatever the constraint is changed to later. */
    await db.transaction(async (tx) => {
      const gone = await tx
        .delete(mailMessages)
        .where(inArray(mailMessages.threadId, ids))
        .returning({ id: mailMessages.id });
      const threadsGone = await tx
        .delete(mailThreads)
        .where(inArray(mailThreads.id, ids))
        .returning({ id: mailThreads.id });
      console.log(`deleted ${gone.length} messages, ${threadsGone.length} threads`);
    });
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
