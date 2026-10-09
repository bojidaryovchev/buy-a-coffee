# KafeZona catalog platform

A second outlet for another shop's catalogue. The public site
`https://www.kafezona.com/` (the source) sells coffee; this repository keeps a
copy of its catalogue continuously synchronised into our own database and sells
the same products, at the same prices, from an independently branded storefront
— Buy a Coffee, `apps/web`. There is no cart and no online payment: a customer
leaves a phone number and the shop calls back, which is how the source takes
orders too.

The storefront reads **only** our own PostgreSQL database and our own mirrored
images. It never contacts the source during a customer request.

```
source site  ──▶  catalog sync  ──▶  PostgreSQL + image store  ──▶  storefront  ──▶  customer
                  (GitHub Actions,
                   every six hours)
```

## Contents

- [What this does](#what-this-does)
- [The storefront](#the-storefront)
- [The admin panel](#the-admin-panel)
- [Architecture](#architecture)
- [Local setup](#local-setup)
- [Commands](#commands)
- [Environment variables](#environment-variables)
- [How synchronisation works](#how-synchronisation-works)
- [Safety: why the catalog cannot be wiped](#safety-why-the-catalog-cannot-be-wiped)
- [Reference artifacts](#reference-artifacts-the-handoff-contract)
- [Testing](#testing)
- [Adapting parsers when the source changes](#adapting-parsers-when-the-source-changes)
- [Deployment](#deployment)
- [Legal and operational boundaries](#legal-and-operational-boundaries)
- [Documentation](#documentation)

## What this does

**Catalog synchronisation** keeps our PostgreSQL catalog current: it detects
new, changed, renamed and vanished products, follows renamed brands and
categories, mirrors product images into our own object storage, reads a few
product pages per run for the facts only they state, records an append-only
audit trail, and refuses to apply a diff that looks like a source failure
rather than a real catalog change.

**Discovery** walks the entire public surface of the source and produces a
deterministic, machine-readable description of it: pages, page types, route
patterns, the link graph, catalog entities, filters, forms and observed
features. Output lands in [`reference/latest/`](reference/latest), which is what
the storefront's parity check and the offline test catalog are built from.

## The storefront

The customer-facing shop lives in [`apps/web`](apps/web) and is documented in
[`docs/architecture.md`](docs/architecture.md). Its written standard is
[`PRODUCT.md`](PRODUCT.md) (who it is for and how it speaks) and
[`DESIGN.md`](DESIGN.md) (tokens and components, written to be implemented
literally).

It is organised by what the customer owns — a brewing system — rather than by
product type: listings filter by system and sort by price per cup, every product
page states which machines it fits, and a recommendation wizard asks which
machine is on the counter before anything else.

**Every page is under a locale prefix.** The shop is at `/bg/…`, with
Bulgarian transliterated slugs: `/bg/kafe-kapsuli`, `/bg/marki/lavazza`,
`/bg/za-kafemashina/krups`, `/bg/blog`. Categories and products share the first
level, `/bg/<slug>`. An English locale (`/en/…`) is built and switched off by
one flag, `LOCALE_READY` in `apps/web/src/i18n/config.ts`. The bare `/` answers
307 to a locale, and every URL the shop served before locales
(`/products/<slug>`, `/categories/<slug>`, `/wizard`, …) answers 308 to its
replacement. No link in the code is written as a path: every one is built by
`href()` and its helpers in `apps/web/src/lib/routes.ts`, from the slug tables
in `apps/web/src/i18n/slugs/`, and a test fails on a bare one. The route table
is in [`docs/architecture.md`](docs/architecture.md#routes).

**Product names and addresses are the shop's own.** The source's name for a
product is stored and shown only to the owner. What a customer reads is
computed from the record by `productName()` in `packages/shared` — brand and
line, then format and quantity, "Lavazza Super Crema — кафе на зърна, 1 кг" —
and the product's slug is derived from the same name:
`lavazza-super-crema-kafe-na-zarna-1-kg`. A slug a product used to have keeps
answering 308.

Besides the categories the source keeps, four **landing listings** are rules
over the catalog: Lavazza's capsules, Lavazza's beans, decaf, and the cheapest
per cup in each system. Each exists only while it lists something.

**Product descriptions are ours, or they are a generated sentence; they are
never the source's.** The sync records what the source publishes and the
storefront never selects it. Copy is written in
[`apps/web/content/product-copy.ts`](apps/web/content/product-copy.ts), keyed by
our own frozen product slug, and published into override columns by
`pnpm copy:apply`. A product nobody has written for yet shows one factual
sentence composed from its own data (`lib/catalog/fallback-copy.ts`) and no long
description. Both shops sell the same catalogue, so shared product text would be
duplicate content across two domains — and it would land in the meta description
and the Product JSON-LD as well as on the page.

`pnpm check:originality` fails when the source's name or domain reaches the
storefront, when copy we wrote tracks the source's text, or when two of our own
texts repeat each other. A product with no copy of its own is not a failure: it
is counted, and `pnpm copy:todo` lists them.

Functional parity with the source is tracked in
[`docs/reference-coverage.md`](docs/reference-coverage.md), which is generated,
not hand-maintained: `pnpm reference:coverage` fails when the crawler observes a
capability the storefront does not implement and nobody has recorded why.

## The admin panel

`/admin` reads what the storefront collects and answers it: order enquiries,
contact messages, newsletter subscribers, an `info@` mailbox that receives mail
through a Resend webhook and replies **as the shop**, and a sync page
(`/admin/sinhron`) that says whether the catalog is current and, if not, why.

One password (`ADMIN_PASSWORD`), a separate session secret
(`ADMIN_SESSION_SECRET`) and a signed cookie. **Unset, the panel is disabled
rather than defaulted.** On a deployment it also stays disabled while the
password is shorter than 12 characters or the session secret is missing or
equal to the password; the disabled screen names the reason, never a value.
Sign-in is attempt-limited through the database and refuses when it cannot
count. See [`docs/architecture.md`](docs/architecture.md#the-admin-panel).

## Architecture

```
apps/
  scraper/            CLI, Lambda handler, command implementations
  web/                Next.js storefront and the admin panel at /admin
packages/
  shared/             URL canonicalisation, exact decimals, money, weights,
                      servings per pack, the pack-size rule, product names
                      and slugs, hashing, structured logging (no I/O, no
                      dependencies)
  db/                 Drizzle schema, migrations, database client
  scraper-core/       fetcher, parsers, catalog discovery, diff engine, move
                      detection, circuit breaker, enrichment, image mirror,
                      storage drivers, artifact export
.github/workflows/    ci.yml (every push and pull request), sync.yml (the
                      scheduled catalog sync)
infra/terraform/      The AWS alternative to the scheduled workflow
fixtures/kafezona/    Sanitised real pages used by parser tests
reference/latest/     Generated description of the source site
docs/                 See below
```

Layering is strict and one-directional: `shared` knows nothing about the
source, `scraper-core` knows nothing about the CLI or the scheduler, and the
diff engine, move detection, taxonomy matching and circuit breaker are pure
functions with no database or network access at all — which is what makes the
dangerous logic exhaustively testable. There is one deliberate exception to
"packages do not import the app": `packages/shared/src/storefront-data.ts`
reads three plain-data tables from `apps/web` (brand names, product-name
overrides, the slug tables), so the sync allocates product slugs against the
storefront's own list of taken addresses and not a copy of it.

### Key design decisions

A handful worth knowing before reading any code. The full set, with reasons, is
in [`docs/decisions.md`](docs/decisions.md); the evidence is in
[`docs/source-recon.md`](docs/source-recon.md).

**Product identity is path + pack size — not the URL, and not the product
code.** `/borbone-crema-classica/` once served two genuinely different products,
0.500 kg and 1 kg, so keying on URL would have dropped one on every sync. Pack
size is normalised (`1 кг.` and `1000 г` both become `1000g`). The product code
the source now prints is not unique — two pairs of different products share one
— so it is a move-detection signal, never an identity.

**A renamed URL is a move, not a removal and a creation.** In October the source
renamed almost every product URL. Matched on identity alone, every product
looked deleted and a twin looked new. Move detection pairs the two halves and
re-points the existing row, keeping its slug, its copy, its price override and
its photographs.

**Not-found detection works both ways.** The source used to answer unknown
routes with HTTP 200 and the home-page shell, and now answers with a real 404.
At startup the fetcher probes one impossible path: a probe that comes back as a
page is hashed and every later page with that hash is treated as not-found; a
probe that comes back as an error means status codes can be trusted.

**Content hashes ignore volatile markup.** Cloudflare re-keys its email
obfuscation on every response. Without stripping those tokens before hashing,
every page would look changed on every crawl.

**Price extraction is strict.** On a product page the price sits next to the
pack size: `<span>1 кг.</span><span>€30.00</span>`. A "contains a currency
symbol" test matches the _parent_, yielding `"1 кг. €30.00"`, which a money
parser reads as **€1.00**. Only elements whose entire text is a price qualify.

**Money never touches floating point.** Prices are parsed into exact decimals
backed by `BigInt` and stored as `numeric(12,2)`.

**Two independent catalog sources.** The primary source is the site's own
`window.FILTER_INIT` blob on `/search/`; the fallback is the server-rendered
`.product-item` cards on category pages. If the blob disappears, sync keeps
working from HTML _and_ parser confidence drops, which the circuit breaker and
the sync-health alarm both notice.

## Local setup

Requires Node.js 22+, pnpm 10+, and Docker.

```bash
pnpm install
docker compose up -d                 # PostgreSQL 17 on localhost:5433
cp .env.example .env                 # the sync job's settings
cp apps/web/.env.example apps/web/.env.local
set -a && . ./.env && set +a         # scripts do not load .env files themselves
pnpm db:migrate
```

Then fill the catalog one of two ways:

```bash
pnpm seed:reference                  # offline: the committed snapshot, no crawl
# or
pnpm sync:catalog                    # a real sync from the source
```

`seed:reference` loads `reference/latest/` into the database with our copy and a
generated image per product, applies the pack-size rule, moves every product to
the shop's own slug with the code `catalog:reslug` uses, and plants four former
slugs (`apps/web/scripts/reference-former-slugs.ts`) for the redirect tests. It refuses any database that is not on this machine
or that already holds another source's catalog, so use an empty database for
it. A real sync (any run that writes) refuses to start until `CRAWL_USER_AGENT`
in `.env` names a contact the source's operator can reach; `--dry-run` works with
the placeholder.

```bash
pnpm dev                             # http://localhost:3000, which redirects to /bg
```

`next dev` reads `apps/web/.env.local` on its own; the scripts and the CLI read
only the process environment. No cloud account is needed for local development:
the default storage driver writes mirrored images to `.storage/` on disk, and
the storefront serves them through a development-only `/media` route.

## Commands

From the repository root:

| Command                         | What it does                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                      | Run the storefront locally (`next dev`, port 3000)                                                                  |
| `pnpm build`                    | Production build of the storefront                                                                                  |
| `pnpm typecheck`                | Strict TypeScript across every package                                                                              |
| `pnpm lint` / `pnpm lint:fix`   | ESLint                                                                                                              |
| `pnpm format` / `format:check`  | Prettier, write or check                                                                                            |
| `pnpm test`                     | Unit tests only, with no database configured                                                                        |
| `pnpm test:integration`         | Every `*.integration.test.ts` and `*.db.test.ts`; needs PostgreSQL                                                  |
| `pnpm test:all`                 | All four Vitest projects                                                                                            |
| `pnpm test:watch`               | Vitest in watch mode                                                                                                |
| `pnpm test:e2e`                 | Playwright, desktop and mobile, against a production build (run `pnpm build` first; see [Testing](#testing))        |
| `pnpm db:migrate`               | Apply the database migrations (`packages/db/migrations/`); safe to run repeatedly                                   |
| `pnpm db:generate`              | Generate a migration from schema changes                                                                            |
| `pnpm db:studio`                | Drizzle Studio                                                                                                      |
| `pnpm sync:catalog`             | Synchronise the catalog into PostgreSQL                                                                             |
| `pnpm crawl:discovery`          | Full public-surface crawl, then export `reference/latest/`                                                          |
| `pnpm reference:export`         | Re-crawl the source and rewrite `reference/latest/` (contacts the source; a writing run)                            |
| `pnpm catalog:verify`           | Assert the catalog invariants against the database; exit 2 on a violation (`--json` for the report)                 |
| `pnpm catalog:link`             | `<our-slug> <new-source-key>`: re-point a product the sync could not pair (plan only; `--apply`, `--absorb-twin`)   |
| `pnpm catalog:enrich`           | Read the product page of every active product without a code (plan only; `--apply`, `--limit <n>`)                  |
| `pnpm images:gc`                | Report unreferenced mirrored images (`--apply` to delete)                                                           |
| `pnpm images:push`              | Copy every referenced image between stores: `--from <driver> --to <driver>` (plan only; `--apply`)                  |
| `pnpm images:verify`            | Check every referenced image is in the configured store (`--http` also fetches each public URL)                     |
| `pnpm seed:reference`           | Load the committed snapshot into an empty local database                                                            |
| `pnpm seed:dev`                 | Add six invented products under a `seed-dev` source key                                                             |
| `pnpm copy:apply`               | Publish `content/product-copy.ts` into the override columns (`--dry-run` to preview)                                |
| `pnpm copy:todo`                | List the products that still publish the generated sentence                                                         |
| `pnpm check:originality`        | No source branding or source copy in the storefront                                                                 |
| `pnpm check:launch`             | Fails while a draft marker would render or a commercial term is unset or unconfirmed                                |
| `pnpm reference:coverage`       | Fails if the storefront misses an observed capability or `docs/reference-coverage.md` is stale                      |
| `pnpm reference:coverage:write` | Regenerate `docs/reference-coverage.md`                                                                             |
| `pnpm measure:budgets`          | Measure mobile LCP and CLS against the budgets in `DESIGN.md`, on a production build already running (`--base-url`) |
| `pnpm env:check`                | Report the storefront's environment against the manifest, and what each absence costs                               |
| `pnpm env:example`              | Regenerate `apps/web/.env.example` from the manifest                                                                |
| `pnpm env:push`                 | Apply the manifest to Vercel (plan only; `--apply`, `--offline`, `--prune`)                                         |

Only through a package filter:

| Command                                         | What it does                                                                                    |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `pnpm --filter @catalog/web start`              | Serve a production build                                                                        |
| `pnpm --filter @catalog/web test:e2e:ui`        | Playwright's UI mode                                                                            |
| `pnpm --filter @catalog/web catalog:reslug`     | Plan moving stored products to the shop's own slugs (`--tsv <file>`, `--apply`); idempotent     |
| `pnpm --filter @catalog/web catalog:pack-size`  | Plan applying the pack-size rule to stored rows, without contacting the source (`--apply`)      |
| `pnpm --filter @catalog/web mail:prune-foreign` | Plan the removal of mailbox threads never addressed to this shop (`--export <file>`, `--apply`) |
| `pnpm --filter @catalog/web brand:assets`       | Regenerate the favicon, touch and share icons from `public/logo.png`                            |
| `pnpm --filter @catalog/scraper cli status`     | Print catalog counts                                                                            |
| `pnpm --filter @catalog/scraper cli help`       | Every CLI command and option                                                                    |
| `pnpm --filter @catalog/scraper build:lambda`   | Bundle the Lambda for `infra/terraform`                                                         |

CLI flags go after the command, e.g. `pnpm sync:catalog --dry-run`:

```
--base-url <url>        Override the source base URL
--concurrency <n>       Concurrent requests
--verbose               Debug-level logging
--dry-run               sync: compute and report the diff without mutating products
                        discovery: crawl without writing to the database
--no-images             sync: skip image mirroring
--product-limit <n>     sync: only process the first N products
--max-pages <n>         discovery: cap on pages crawled
--max-depth <n>         discovery: cap on link depth
--output <dir>          discovery: artifact output directory
--skip-export           discovery: crawl without writing artifacts
```

Exit codes: `0` success, `1` usage or configuration error, `2` completed but
untrusted (circuit breaker open, partial crawl, or an invariant violated for
`catalog:verify`), `3` failure. `2` is distinct so a scheduler can alert
differently on "we are misconfigured" versus "the source misbehaved".

In Git Bash, prefix `catalog:link` with `MSYS_NO_PATHCONV=1`, or the leading `/`
of the source key is rewritten into a Windows path.

`catalog:reslug` needs migration `0007_product_previous_slugs`. It appends each
old slug to `products.previous_slugs`, so the old URL answers 308 from then on,
and it is followed by `pnpm copy:apply`, because the written copy is keyed by
slug. A slug is otherwise frozen: read the plan before applying.
`catalog:pack-size` is optional on a synced catalog, whose next ordinary run
corrects the rows itself; run it only once the sync job is on the code that
applies the rule, or an older sync rewrites the columns from the pack field.

## Environment variables

Two manifests, one per runtime, and the docs do not repeat them:

- **The storefront**: [`apps/web/env.schema.mjs`](apps/web/env.schema.mjs) is the
  one manifest behind `env:check`, `env:push` and the generated
  [`apps/web/.env.example`](apps/web/.env.example). Each variable says whether it
  is a secret, where it is required and what its absence costs.
- **The sync job**: [`.env.example`](.env.example) at the root, validated at start
  by `loadConfig` in
  [`packages/scraper-core/src/config.ts`](packages/scraper-core/src/config.ts),
  which holds every tunable with its default and the request budget it implies.

The database is addressed purely through `DATABASE_URL`, so any standard
PostgreSQL works — local Docker, Neon, RDS, or anything else.

Mail and the panel are optional and degrade rather than break:
`RESEND_API_KEY` + `MAIL_TO` turn notifications from a log line into an email,
`RESEND_WEBHOOK_SECRET` enables the inbound mailbox, `ADMIN_PASSWORD` +
`ADMIN_SESSION_SECRET` enable `/admin`, and `CRON_SECRET` makes the two daily
cron routes exist (without it they answer 404). Sending and receiving also need
SPF, DKIM and an MX record on the shop's domain, which are DNS settings this
repository cannot check.

The environment tooling refuses an `.env` that declares a key twice, and
`env:push` refuses to deploy a `DATABASE_URL`, `NEXT_PUBLIC_SITE_URL` or
`NEXT_PUBLIC_IMAGE_BASE_URL` whose host is localhost, a loopback address or a
bare hostname.

## How synchronisation works

```
1. discover  read the source; touch nothing of ours
2. diff      compute intent, including moves; still touch nothing
3. judge     let the circuit breaker veto destructive intent
4. apply     write, with removals already stripped if vetoed
5. enrich    read a few product pages and store what only they state
```

Nothing destructive can happen before step 3 has run, and step 5 runs after the
outcome is settled and cannot change it. The implementation is
[`packages/scraper-core/src/catalog/sync.ts`](packages/scraper-core/src/catalog/sync.ts);
the CLI and the Lambda call the same function.

Change detection uses a **semantic hash** over business-relevant fields only —
name, prices, currency, availability, brand, sorted categories, normalised
description, attributes and the image URL set. Timestamps, generated ids and
meaningless ordering are excluded, so an unchanged product hashes identically
forever and a repeat sync performs no writes.

```
new source key, no vanished twin         -> CREATE
new source key paired with a vanished one -> MOVE    (row re-pointed in place)
same key, same semantic hash             -> UNCHANGED  (last_seen_at still moves)
same key, different semantic hash        -> UPDATE + append to sync_changes
previously active key now absent         -> increment consecutive_missing_count
missing or removed key listed again      -> RESTORE
```

**Move detection** ([`catalog/moves.ts`](packages/scraper-core/src/catalog/moves.ts))
pairs a vanished product with a new one in passes, strongest evidence first:
the same product code; then brand + normalised name + pack size; then name +
pack size with the brand differing or absent, accepted only when an independent
signal (the path stem) agrees. Two different product codes veto a pairing. Ties
are broken by path stem, price, image set and description, and a signal counts
only when each side is the other's single best. Nothing is paired by
elimination. What cannot be paired safely is reported in the run (and in
`sync_runs.metadata.unresolvedMoves`) as an unresolved move (`tie`, `conflicting_evidence`, `uncorroborated`) and left
alone: a missed pair costs a visible duplicate that `catalog:link` repairs; a
wrong pair would silently attach one product's copy and history to another. A
move updates the existing row by id, appends the old key to
`previous_source_keys`, and writes a `moved` change. The circuit breaker counts
disappearances after pairing, so a mass rename is not judged a mass removal.

The catalog listing carries no product code, so before the diff the sync reads
the pages of would-be-created products to find theirs — only when some vanished
row holds a code, and not at all when more than `SYNC_ENRICH_LOOKUP_MAX`
(default 10) products are unmatched.

**Brands and categories** ([`catalog/taxonomy.ts`](packages/scraper-core/src/catalog/taxonomy.ts))
match on the source's stable numeric id first and its slug second. A rename
updates the row in place and keeps our slug. One absent from a trusted run (the
breaker closed, the structured source) becomes `missing` and is hidden — never
`removed`, with no threshold — and returns to `active` when listed again.

**Enrichment** ([`catalog/enrich.ts`](packages/scraper-core/src/catalog/enrich.ts))
reads product pages for the products this run created, moved, updated or
restored, then for products never read, and stores the product code, the
labelled characteristics and the stated arabica share, origin and roast. Every
read goes through the same fetcher as the listing. One budget covers the
lookup and enrichment together, `SYNC_ENRICH_MAX_PER_RUN` (default 20), and
five failures in a row stop reads for the run. A failed page is recorded in
`scrape_errors`, counted on the run (`enriched_count`, `enrich_failed_count`)
and tried again after 24 hours; it never fails the sync or trips the breaker. On
a run the breaker refused, nothing is read: the changed products are marked due
for a trusted run. `pnpm catalog:enrich --apply` is the one-time backfill.

**Column ownership.** Two writers touch a product row and own disjoint columns:
the listing upsert owns what `productColumns()` in `sync.ts` writes; enrichment
owns `ENRICHMENT_COLUMNS` in `repository.ts` (`sku`, `arabica_percent`,
`origin`, `roast`, `characteristics`, `enriched_at`, `enrich_attempted_at`). A
move writes neither the slug, nor our copy, nor what enrichment stored. So a
sync after enrichment is still a no-op.

The sync also stores `servings` and `servings_estimated` (cups per pack) from
`packServings()` in `@catalog/shared`, the same function the storefront
displays with, so listings can sort by price per cup in SQL.

**Pack size.** The source states a pack size in the product's name and again
in a pack field, and the two can disagree. `decidePackSize()` in
`@catalog/shared` settles it during normalisation: the pack field stands unless
the name states another size, and then the name's does. The decided size is
what is stored, hashed and divided into servings; identity is still built from
the pack field as the source typed it. The source's own field and any conflict
are kept in `source_data`, and the admin's sync page lists the conflicts.

**Names and slugs.** The sync stores the source's name untouched and, beside
it, `search_name`: the shop's own heading for the product, for search. A
product seen for the first time is given its storefront slug from
`productName()` (`<brand>-<line>-<format>-<qty>`), refused any address already
taken by a product, a former product slug, a category or a route, and
disambiguated by a suffix derived from its source key, never by a counter. A
slug is allocated once and the sync never changes it.

**Request budget.** Every sync makes 3 page requests (robots.txt, the not-found
probe, `/search/`), plus one per product page read: a day with five new
products is 8, and no sync can exceed 3 + `SYNC_ENRICH_MAX_PER_RUN` = 23. The
backfill is one page per active product without a code plus two. Images are
counted separately. The full account is in the comment above the politeness
settings in `config.ts`.

## Safety: why the catalog cannot be wiped

A product is never removed because of one bad request.

**Missing-count threshold.** Absence increments a counter. Only
`SYNC_MISSING_THRESHOLD` (default 3) consecutive _successful_ syncs with the
product absent promote it to `removed`. Reappearing resets the counter to zero
immediately.

**Circuit breaker.** Before any absence is applied, the run is judged against
the last healthy baseline. It refuses the destructive part of the diff when:

- more than 20% of active products would disappear at once (after move pairing),
- discovery returned less than 75% of the baseline count,
- discovery returned fewer than 10 products while some would disappear,
- a catalog entry page failed to load, or no catalog source answered,
- parser confidence fell below 0.6 while some products would disappear,
- discovery returned nothing at all.

When it opens, creations, moves and updates still apply — those are additive
and safe — but nothing is marked missing or removed, no brand or category is
hidden, no product page is read, the run is recorded as `partial` with its
reasons, and the CLI exits 2.

**Baselines are only recorded from trusted runs**, so a string of bad runs
cannot slowly ratchet the bar down until mass removal starts to look normal.

**Afterwards, check rather than trust.** `pnpm catalog:verify` reads the
database and asserts what must hold after any sync: no product listed twice,
every moved row kept its slug and copy, no listed price at or below zero, every
listed product has an image, no two active brands or categories share a source
id, and no renamed brand or category has been emptied by a twin.

## Reference artifacts (the handoff contract)

Every successful discovery run writes `reference/latest/`:

| File                  | Contents                                                                      |
| --------------------- | ----------------------------------------------------------------------------- |
| `manifest.json`       | Source host, timestamp, git commit, crawler version, counts, SHA-256 per file |
| `report.md`           | Human-readable summary of the observed site                                   |
| `pages.json`          | Every page reached, with type, confidence and evidence                        |
| `site-map.json`       | Link graph: nodes and edges                                                   |
| `route-patterns.json` | Observed URL patterns per page type                                           |
| `page-types.json`     | Page-type counts and URLs                                                     |
| `products.json`       | Normalised catalog snapshot                                                   |
| `categories.json`     | Category taxonomy with parents                                                |
| `brands.json`         | Brands with product counts                                                    |
| `filters.json`        | Filters, their URL parameters and values                                      |
| `forms.json`          | Public forms (never submitted)                                                |
| `features.json`       | Observed storefront capabilities with evidence URLs                           |
| `relationships.json`  | Entity relationships and data-quality counts                                  |
| `errors.json`         | Failures, soft-404s, stale sitemap entries                                    |

Output is deterministic: object keys are sorted recursively and every list has
an explicit sort, so a diff between two exports shows real changes to the
source rather than key reordering.

Three things read the artifacts: `reference:coverage` (parity),
`check:originality` and `copy:todo` (the source's text, to compare our copy
against), and `seed:reference` (the offline catalog for tests and CI).

`products.json` records each product as it stood when the snapshot was
exported, so its slugs and pack sizes may predate the shop's own slugs and the
pack-size rule. `seed:reference` applies both, with the production code, so a
seeded catalog matches a synced one whatever the snapshot's age.

## Testing

```bash
pnpm test                 # unit; no database, nothing skipped for want of one
pnpm test:integration     # needs PostgreSQL
pnpm test:e2e             # needs a production build and a seeded database
pnpm typecheck
pnpm lint
```

"Unit" and "integration" are defined once, by file name, in
[`vitest.shared.ts`](vitest.shared.ts), and the root `vitest.config.ts` builds
four projects from it (`unit`, `integration`, `web-unit`, `web-integration`):

- **Unit tests** are everything not named as an integration test. They run with
  `DATABASE_URL` and `TEST_DATABASE_URL` blanked, so a test that needs a database
  shows up as skipped rather than quietly reading whatever `.env.local` points
  at. They cover URL canonicalisation, exact decimals, money and weight parsing,
  semantic hashing, product identity, the diff engine, move detection, the
  circuit breaker, robots.txt, the storefront's components and pure logic, the
  `DESIGN.md` contrast table against the tokens (`test/contrast.test.ts`), and
  the parsers against sanitised real pages in
  [`fixtures/kafezona/`](fixtures/kafezona), so they never depend on the live
  site.
- **Integration tests** are `*.integration.test.ts`, which build their own
  private database on the server (`TEST_DATABASE_URL`, named after
  `TEST_DATABASE_NAME`, so several checkouts can share one server), and
  `*.db.test.ts`, which read the catalog in `DATABASE_URL` — seed it with
  `pnpm seed:reference` first. A `*.db.test.ts` file only reads: that database
  is the development catalog, and a test that has to write belongs in the
  other group, with a private database. Only the network is faked; the diff engine,
  repository, circuit breaker, enrichment and image mirror run their production
  code paths. With no database reachable they skip, under a banner that says so;
  with `CI` set, an unreachable database fails the run instead.
- **End-to-end tests** (`apps/web/e2e/`) run Playwright, desktop Chrome and a
  Pixel 7, against `next start` on port 8765 over a real production build. They
  open with a canary that the server under test is this app, assert at the
  browser level that nothing is loaded from the source, and drive the wizard with
  JavaScript disabled. The URLs they visit are written out literally in
  `e2e/support/paths.ts`, not computed by the code under test, so a slug change
  fails there until the list is updated in the same commit.

To run the browser suite locally, the way CI does:

```bash
set -a && . ./.env && set +a         # DATABASE_URL, for the build and the server
pnpm db:migrate && pnpm seed:reference
pnpm build
pnpm --filter @catalog/web exec playwright install chromium   # once
pnpm test:e2e                        # or: pnpm --filter @catalog/web test:e2e e2e/names.spec.ts
```

The suite is written against the `seed:reference` catalog and a production
build made against it; `next dev` and the six `seed:dev` products will not pass
it. Playwright starts the server itself and refuses to reuse one already
listening. `E2E_PORT` moves it off 8765, `E2E_BASE_URL` points the suite at a server that is already
running instead, and `CI=true` adds two retries and limits it to two workers.
CI builds with `NEXT_PUBLIC_SITE_URL=http://127.0.0.1:8765`, so the absolute
URLs in the pages point at the server under test.

**CI** ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs on every
pull request and on pushes to `main` and `completion`. The `verify` job runs
typecheck, lint, format check and unit tests, then migrates and seeds a
PostgreSQL service with `seed:reference` and runs the integration tests,
`check:originality`, `reference:coverage` and a production build. The `e2e` job
builds against the same seed and runs the whole Playwright suite, desktop and
mobile, with nothing excluded.

## Adapting parsers when the source changes

1. Rebuild the fixtures from the live site:
   `node scripts/build-fixtures.mjs` (`--raw-dir` keeps the responses,
   `--offline` rebuilds from them).
2. Run the parser tests. The failures name exactly what changed.
3. Fix the parser, not the test, unless the test encoded a wrong expectation.
4. Confirm with a dry run before writing anything:
   `pnpm sync:catalog --dry-run`.

Fetching, parsing, normalisation, validation, diffing and persistence are
separate layers, so the source can change its HTML without forcing changes to
the database or reconciliation logic. When the source renames URLs, read the dry
run's unresolved moves before the real run, and pair what the sync could not
with `catalog:link`.

## Deployment

**The storefront** is a Vercel project with `apps/web` as its root directory.
Functions run in Frankfurt (`fra1`, set in `apps/web/vercel.json`), next to the
database. The same file schedules two daily crons, both guarded by
`CRON_SECRET`: `/api/cron/sync-health`, which emails once per condition per day
when the sync is late, failed, untrusted or degraded, and `/api/cron/retention`,
which deletes what the privacy policy says is no longer kept. Product images
are served from a Vercel Blob store (created at launch, Phase H2), and
`NEXT_PUBLIC_IMAGE_BASE_URL` must equal the sync's `STORAGE_PUBLIC_BASE_URL`.

**The sync** runs as a scheduled GitHub Actions workflow,
[`.github/workflows/sync.yml`](.github/workflows/sync.yml): every six hours
(`17 */6 * * *`) and on manual dispatch, where `dry_run` defaults to true and
`product_limit` is optional. One run at a time, and a running one is never
cancelled. It needs the secrets `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN` and
the variables `STORAGE_DRIVER`, `STORAGE_PUBLIC_BASE_URL` and
`CRAWL_USER_AGENT`, and fails fast naming whichever is missing. Exit codes 1, 2
and 3 fail as separately named steps, so a notification says "untrusted" or
"crashed" rather than just "failed". **Its logs are public**, because the
repository is: never add a step that prints the environment or a secret.
GitHub disables scheduled workflows after 60 days without repository activity,
which this workflow cannot report — that is why the alarm lives in the
storefront.

**The order matters at launch:** migrations before the code, and the admin
password and session secret before the code. The runbook is Phase H of
[`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md#phase-h--hook-up-and-launch);
[`docs/launch.md`](docs/launch.md) summarises it and says what to watch for
afterwards.

[`infra/terraform/`](infra/terraform/README.md) provisions the same sync as an
AWS Lambda on EventBridge Scheduler, with S3 and CloudWatch alarms. It has never
been applied, and is kept as the documented alternative until the workflow has
run for 30 days.

## Legal and operational boundaries

- Only public pages available to an ordinary unauthenticated visitor are read.
- `robots.txt` is honoured, including `Crawl-delay`.
- Request rates are conservative and configurable; concurrency, minimum
  spacing, timeouts, retry backoff with jitter, response-size limits and the
  per-run product-page budget are all bounded.
- Every request names the crawler in its user agent, and a run that writes
  refuses to start while that user agent carries a placeholder contact.
- **No form is ever submitted.** The source's quick-order and newsletter flows
  create real orders and subscriptions for the source business. Discovery
  inspects their structure and client code and stops there.
- The source's third-party CMS tenant key, though public in its markup, is
  deliberately **not** copied into this repository, and is redacted from
  fixtures.
- No authentication, CAPTCHA, paywall or bot protection is bypassed.
- Scraped HTML is treated as untrusted input: bodies are size-bounded, the
  structured catalog blob is parsed without `eval`, image types are verified by
  magic bytes rather than trusting `content-type`, and description HTML is
  sanitised before any rendering.
- Source attribution is retained internally; the source's branding, logo, CSS,
  source code and product prose are not reproduced.

## Documentation

| Document                                                 | Contents                                                                                                               |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [PRODUCT.md](PRODUCT.md)                                 | Who the storefront is for, what it promises, and the voice it speaks in                                                |
| [DESIGN.md](DESIGN.md)                                   | The design standard: tokens, components, states and phone behaviour, written to be implemented literally               |
| [docs/architecture.md](docs/architecture.md)             | How the storefront is built, as built                                                                                  |
| [docs/decisions.md](docs/decisions.md)                   | Every decision that governs this repo, with its reason — crawler, storefront, infrastructure, and the legal boundaries |
| [docs/source-recon.md](docs/source-recon.md)             | What the source site actually does, and the evidence                                                                   |
| [docs/reference-coverage.md](docs/reference-coverage.md) | Generated. Functional parity against the crawler's artifacts — do not edit by hand                                     |
| [docs/launch.md](docs/launch.md)                         | The launch order, its traps, and what to watch in the first weeks                                                      |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)         | The plan the current work follows, with the launch runbook (Phase H)                                                   |
| [infra/terraform/README.md](infra/terraform/README.md)   | The AWS alternative to the scheduled sync: deployment, alarms and failure recovery                                     |
