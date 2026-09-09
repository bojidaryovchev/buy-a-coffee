# KafeZona catalog platform

A reference crawler and continuous catalog synchronisation system for the
public site `https://www.kafezona.com/`, plus the independently branded
storefront that consumes it.

The storefront reads **only** our own PostgreSQL database and our own mirrored
images. It never contacts the source site during a customer request.

```
kafezona.com  ──▶  discovery crawl + catalog sync  ──▶  PostgreSQL + S3  ──▶  our storefront  ──▶  customer
                        (background, scheduled)
```

## Contents

- [What this does](#what-this-does)
- [The storefront](#the-storefront)
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

**Discovery** walks the entire public surface of the source site and produces a
deterministic, machine-readable description of it: pages, page types, route
patterns, the link graph, catalog entities, filters, forms and observed
features. Output lands in [`reference/latest/`](reference/latest).

**Catalog synchronisation** keeps our PostgreSQL catalog current: it detects
new, changed and vanished products, mirrors product images into our own object
storage, records an append-only audit trail, and refuses to apply a diff that
looks like a source failure rather than a real catalog change.

## The storefront

The customer-facing shop lives in [`apps/web`](apps/web) and is documented in
[`docs/architecture.md`](docs/architecture.md). It reads the synchronised catalog
and our own mirrored images, and never contacts the source site during a
customer request — a rule enforced by both a source scan
(`pnpm check:originality`) and browser-level assertions in the end-to-end suite.

```bash
pnpm dev                  # http://localhost:3100
pnpm build
pnpm reference:coverage   # functional parity against the crawler's artifacts
pnpm check:originality    # no source branding, and no source copy, in the app
pnpm copy:apply           # publish our own product descriptions
```

Product descriptions are ours, not the source's. The sync records what the
source publishes and never shows it: the storefront reads an override column,
written from [`apps/web/content/product-copy.ts`](apps/web/content/product-copy.ts).
Both shops sell the same catalogue, so shared product text would be duplicate
content across two domains — and it lands in the meta description and the
Product JSON-LD as well as on the page. `pnpm check:originality` fails when a
product has no copy of its own or when too much of the source's phrasing
survives a rewrite.

Functional parity with the reference site is tracked in
[`docs/reference-coverage.md`](docs/reference-coverage.md), which is generated,
not hand-maintained: the check fails when the crawler observes a capability the
storefront does not implement and nobody has recorded why.

## The admin panel

`/admin` reads what the storefront collects and answers it.

Order enquiries, contact messages and newsletter signups have been written to
Postgres since the beginning, and until now **nothing in the application could
read them back** — there was no screen, and `notify()` logged a redacted line to
a server console on a serverless host. The panel is the other end of that: the
enquiries, their statuses, and an `info@` mailbox that receives mail through a
Resend webhook and replies **as the shop** rather than from whoever happens to
press Reply in Gmail.

One password (`ADMIN_PASSWORD`) and a signed cookie. **Unset, the panel is
disabled rather than defaulted.** See
[`docs/architecture.md`](docs/architecture.md) for the mailbox design and why
recording precedes forwarding.

## Architecture

```
apps/
  scraper/            CLI, Lambda handler, command implementations
  web/                Next.js storefront: catalog pages, search, quick order,
                      recommendation wizard and machine compatibility;
                      plus the admin panel at /admin
packages/
  shared/             URL canonicalisation, exact decimals, money, weights,
                      hashing, structured logging  (no I/O, no dependencies)
  db/                 Drizzle schema, migrations, database client
  scraper-core/       fetcher, parsers, catalog discovery, diff engine,
                      circuit breaker, image mirror, artifact export
infra/terraform/      AWS runtime: Lambda, Scheduler, S3, alarms
fixtures/kafezona/    Sanitised real pages used by parser tests
reference/latest/     Generated description of the source site
docs/                 See below
```

Layering is strict and one-directional: `shared` knows nothing about the
source, `scraper-core` knows nothing about the CLI or Lambda, and the diff
engine and circuit breaker are pure functions with no database or network
access at all — which is what makes the dangerous logic exhaustively testable.

### Key design decisions

A handful worth knowing before reading any code. Every one exists because of
something observed on the live source site, and the full set — including the
storefront and infrastructure decisions — is in
[`docs/decisions.md`](docs/decisions.md). The evidence is in
[`docs/source-recon.md`](docs/source-recon.md).

**Soft-404 detection is mandatory.** The source answers unknown routes with
HTTP 200 and the home-page shell. Its own `sitemap.xml` still lists 111
`/products/<slug>/` URLs that no longer exist. A crawler that trusted status
codes would ingest 111 phantom products. At startup we fetch a deliberately
impossible path, hash the response, and treat any non-root page with that hash
as not-found.

**Product identity is path + pack size, not URL.** `/borbone-crema-classica/`
serves two genuinely different products — 0.500 kg at €10.70 and 1 kg at
€20.50. Keying on URL would silently drop one on every sync. Pack size is
normalised (`1 кг.` and `1000 г` both become `1000g`) so notation changes
cannot fork one product into two.

**Content hashes ignore volatile markup.** Cloudflare re-keys its email
obfuscation on every response. Without stripping those tokens before hashing,
every page would look changed on every crawl and change detection would be
worthless.

**Price extraction is strict.** On a product page the price sits next to the
pack size: `<span>1 кг.</span><span>€30.00</span>`. A "contains a currency
symbol" test matches the _parent_, yielding `"1 кг. €30.00"`, which a money
parser reads as **€1.00**. Only elements whose entire text is a price qualify.

**Money never touches floating point.** Prices are parsed into exact decimals
backed by `BigInt` and stored as `numeric(12,2)`.

**Two independent catalog sources.** The primary source is the site's own
`window.FILTER_INIT` blob on `/search/`; the fallback is the server-rendered
`.product-item` cards on category pages. If the blob disappears, sync keeps
working from HTML _and_ parser confidence drops, which the circuit breaker
notices.

## Local setup

Requires Node.js 22+, pnpm 10+, and Docker.

```bash
pnpm install
docker compose up -d          # PostgreSQL 17 on localhost:5433
cp .env.example .env
pnpm db:migrate
pnpm sync:catalog             # first real sync
pnpm crawl:discovery          # full crawl + reference artifacts
```

No AWS account is needed for local development: the default storage driver
writes mirrored images to `.storage/` on disk.

## Commands

| Command                   | What it does                                                |
| ------------------------- | ----------------------------------------------------------- |
| `pnpm crawl:discovery`    | Full public-surface crawl, then export `reference/latest/`  |
| `pnpm sync:catalog`       | Synchronise the catalog into PostgreSQL                     |
| `pnpm reference:export`   | Re-export the reference artifacts                           |
| `pnpm images:gc`          | Report unreferenced mirrored images (`--apply` to delete)   |
| `pnpm db:migrate`         | Apply database migrations                                   |
| `pnpm db:generate`        | Generate a migration from schema changes                    |
| `pnpm test`               | Unit, parser-fixture and integration tests                  |
| `pnpm typecheck`          | Strict TypeScript across every package                      |
| `pnpm lint`               | ESLint                                                      |
| `pnpm dev`                | Run the storefront locally                                  |
| `pnpm build`              | Production build of the storefront                          |
| `pnpm test:e2e`           | Playwright, desktop and mobile                              |
| `pnpm reference:coverage` | Verify storefront parity with the reference artifacts       |
| `pnpm check:originality`  | Verify no source branding or source copy reaches the front  |
| `pnpm copy:apply`         | Publish `content/product-copy.ts` into the override columns |

Useful flags (pass after `--`, e.g. `pnpm sync:catalog -- --dry-run`):

```
--base-url <url>        Override the source base URL
--concurrency <n>       Concurrent requests
--dry-run               Compute and report the diff without mutating products
--no-images             Skip image mirroring
--product-limit <n>     Only process the first N products
--max-pages <n>         Cap on pages crawled (discovery)
--max-depth <n>         Cap on link depth (discovery)
--output <dir>          Artifact output directory
--verbose               Debug-level logging
```

Exit codes: `0` success, `1` usage or configuration error, `2` completed but
untrusted (circuit breaker open, partial crawl), `3` failure. `2` is distinct
so a scheduler can alert differently on "we are misconfigured" versus "the
source misbehaved".

## Environment variables

Every variable is documented in [`.env.example`](.env.example), which is
generated from [`apps/web/env.schema.mjs`](apps/web/env.schema.mjs) — the one
manifest behind `env:check`, `env:push` and the example file. The database is
addressed purely through `DATABASE_URL`, so any standard PostgreSQL deployment
works — local Docker, Neon, RDS, or anything else. Nothing is wired to a
specific managed vendor.

Mail and the panel are optional and degrade rather than break:
`RESEND_API_KEY` + `MAIL_TO` turn notifications from a log line into an email,
`RESEND_WEBHOOK_SECRET` enables the inbound mailbox, and `ADMIN_PASSWORD` enables
`/admin`. `pnpm --filter @catalog/web env:check` reports what each absence
actually costs.

⚠ **The domain is not verified in Resend yet.** The address is real —
`info@buy-a-coffee.com` — but sending needs SPF and DKIM on `buy-a-coffee.com`,
and the inbound mailbox additionally needs an MX record. Both are DNS
operations; neither is something this repository can check.

## How synchronisation works

```
1. discover  read the source; touch nothing of ours
2. diff      compute intent; still touch nothing
3. judge     let the circuit breaker veto destructive intent
4. apply     write, with removals already stripped if vetoed
```

Nothing destructive can happen before step 3 has run.

Change detection uses a **semantic hash** over business-relevant fields only —
name, prices, currency, availability, brand, sorted categories, normalised
description, attributes and the image URL set. Timestamps, generated ids and
meaningless ordering are excluded, so an unchanged product hashes identically
forever and a repeat sync performs no writes.

```
new source key                      -> CREATE
same key, same semantic hash        -> UNCHANGED  (last_seen_at still moves)
same key, different semantic hash   -> UPDATE + append to sync_changes
previously active key now absent    -> increment consecutive_missing_count
```

## Safety: why the catalog cannot be wiped

A product is never removed because of one bad request.

**Missing-count threshold.** Absence increments a counter. Only
`SYNC_MISSING_THRESHOLD` (default 3) consecutive _successful_ syncs with the
product absent promote it to `removed`. Reappearing resets the counter to zero
immediately.

**Circuit breaker.** Before any absence is applied, the run is judged against
the last healthy baseline. It refuses the destructive part of the diff when:

- more than 20% of active products would disappear at once,
- discovery returned less than 75% of the baseline count,
- a catalog entry page failed to load,
- parser confidence collapsed,
- discovery returned nothing at all.

When it opens, creations and updates still apply — those are additive and safe
— but nothing is marked missing or removed, the run is recorded as `partial`
with its reason, and an alarm fires.

**Baselines are only recorded from trusted runs**, so a string of bad runs
cannot slowly ratchet the bar down until mass removal starts to look normal.

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

## Testing

```bash
pnpm test          # everything
pnpm typecheck
pnpm lint
```

- **Unit tests** cover URL canonicalisation, tracking-parameter removal, exact
  decimals, money and weight parsing, semantic hashing, product identity, the
  diff engine, the circuit breaker, robots.txt, and image de-duplication keys.
- **Parser fixture tests** run against sanitised copies of real pages in
  [`fixtures/kafezona/`](fixtures/kafezona), so they never depend on the live
  site. Fixtures deliberately include every known edge case: the URL collision,
  the duplicated record, the price-less products, the comma-decimal price, the
  brand slug with a leading space, and the soft-404 shell.
- **Integration tests** run against real PostgreSQL with a synthetic source.
  Only the network is faked; the diff engine, repository, circuit breaker and
  image mirror all run their production code paths. They skip automatically
  with a warning if no database is reachable.

## Adapting parsers when the source changes

1. Rebuild the fixtures from the live site:
   `node scripts/build-fixtures.mjs`
2. Run the parser tests. The failures name exactly what changed.
3. Fix the parser, not the test, unless the test encoded a wrong expectation.
4. Confirm with a dry run before writing anything:
   `pnpm sync:catalog -- --dry-run`

Fetching, parsing, normalisation, validation, diffing and persistence are
separate layers, so the source can change its HTML without forcing changes to
the database or reconciliation logic.

## Deployment

See [`infra/terraform/README.md`](infra/terraform/README.md).

## Legal and operational boundaries

- Only public pages available to an ordinary unauthenticated visitor are read.
- `robots.txt` is honoured, including `Crawl-delay`.
- Request rates are conservative and configurable; concurrency, minimum
  spacing, timeouts, retry backoff with jitter, and response-size limits are
  all bounded.
- **No form is ever submitted.** The source's quick-order and newsletter flows
  create real orders and subscriptions for the source business. Discovery
  inspects their structure and client code and stops there.
- The source's third-party CMS tenant key, though public in its markup, is
  deliberately **not** copied into this repository, and is redacted from
  fixtures.
- No authentication, CAPTCHA, paywall or bot protection is bypassed.
- Scraped HTML is treated as untrusted input: bodies are size-bounded, the
  structured catalog blob is parsed without `eval`, image types are verified by
  magic bytes rather than trusting `content-type`, and stored description HTML
  must be sanitised before any rendering.
- Source attribution is retained internally; the source's branding, logo, CSS
  and source code are not reproduced.

## Documentation

| Document                                                 | Contents                                                                                                               |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [docs/decisions.md](docs/decisions.md)                   | Every decision that governs this repo, with its reason — crawler, storefront, infrastructure, and the legal boundaries |
| [docs/source-recon.md](docs/source-recon.md)             | What the source site actually does, and the evidence                                                                   |
| [docs/architecture.md](docs/architecture.md)             | How the storefront is built, as built                                                                                  |
| [docs/reference-coverage.md](docs/reference-coverage.md) | Generated. Functional parity against the crawler's artifacts — do not edit by hand                                     |
| [docs/launch.md](docs/launch.md)                         | What still stands between this and a shop that can take an order                                                       |
| [infra/terraform/README.md](infra/terraform/README.md)   | Deployment, alarms and failure recovery                                                                                |
