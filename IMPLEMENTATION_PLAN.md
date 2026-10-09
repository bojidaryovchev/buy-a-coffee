# Implementation plan

What it takes to finish this shop: a storefront that mirrors the source catalog
continuously, at the source's prices, and is good to buy from.

Written 8 October 2026 against commit `db81b64`. Every number here was measured
that day against the live storefront, the production database and the source's
public pages. They drift — re-measure before relying on one.

## Contents

- [How to read this](#how-to-read-this)
- [Definition of done](#definition-of-done)
- [Ground rules](#ground-rules)
- [Progress](#progress)
- [Where it stands](#where-it-stands)
- [Decisions](#decisions)
- [Phase A — Groundwork](#phase-a--groundwork)
- [Phase B — Sync: catch up, then keep up](#phase-b--sync-catch-up-then-keep-up)
- [Phase C — Images](#phase-c--images)
- [Phase D — Trust and operations](#phase-d--trust-and-operations)
- [Phase E — Parity with the source](#phase-e--parity-with-the-source)
- [Phase F — Design](#phase-f--design)
- [Phase G — Search, wizard and SEO](#phase-g--search-wizard-and-seo)
- [Phase H — Hook-up and launch](#phase-h--hook-up-and-launch)
- [Phase I — After launch](#phase-i--after-launch)
- [Phase J — Bulgarian URLs, brand logos and search demand](#phase-j--bulgarian-urls-brand-logos-and-search-demand)
- [Order and dependencies](#order-and-dependencies)
- [Not doing](#not-doing)
- [Appendix: what changed at the source](#appendix-what-changed-at-the-source)

## How to read this

**Phases A–G are code and content.** They are built on a branch against a local
database and need no key, no account and no production write.

**Phase H is hook-up.** Every key, dashboard setting, DNS record and production
write sits there, in one ordered runbook, so it can be done in a single sitting
at the end.

Each task has an id, a size, and a "done when". Sizes are relative:
**S** under half a day, **M** one to two days, **L** three or more.

Tags:

- `early` — no schema change and no key, so it can be merged to `main` ahead of
  everything else if the live site should stop looking broken sooner.
- `owner` — needs an answer or an asset from the business. A default is always
  given so the code is never blocked on it.
- `content` — writing, not programming.

## Definition of done

1. **The catalog matches the source.** Every product the source lists is on the
   storefront within one sync interval, at the same price, exactly once.
2. **The sync runs unattended**, and a failed run, an open circuit breaker or two
   missed intervals emails a person.
3. **Every product has a working photo, a price and copy that is not the
   source's.**
4. **Every capability on the source has an implementation here or a written
   reason**: `pnpm reference:coverage` passes against a fresh crawl.
5. **A customer can learn, before ordering, what delivery costs, how they pay and
   how returns work.** No draft marker appears on any public page.
6. **Orders and messages reach a person**, and the mailbox holds only this shop's
   mail.
7. **CI is green**: `typecheck`, `lint`, `test`, `test:integration`, `test:e2e`,
   `check:originality`, `reference:coverage`, `env:check --strict`.
8. **The docs describe the system as built.**

## Ground rules

1. **Nothing reaches production before Phase H.** `main` deploys to production on
   every push, so all of this lands on a `completion` branch and merges at
   [H5](#phase-h--hook-up-and-launch). The exception is tasks tagged `early`.
2. **Preview deployments share the production database today** — `DATABASE_URL`
   targets both environments. Do not submit a form on a preview until H3 gives
   previews their own database.
3. **Local first.** Docker Postgres on port 5433 and `STORAGE_DRIVER=local`. The
   only network traffic in A–G is the crawler reading the source, at its
   configured politeness.
4. **This repository is public.** No credential, customer detail or account
   identifier goes into a commit — including into this file. Scheduled workflow
   logs are public too.
5. **The codebase's standing rules hold.** The storefront never contacts the
   source during a customer request. Money stays exact. Every control works
   without JavaScript. Customer-facing copy is Bulgarian. Nothing is invented:
   no reviews, no ratings, no facts about a coffee the source did not publish.
6. **The storefront never publishes the source's prose.** Today it can
   ([B7](#phase-b--sync-catch-up-then-keep-up)); after B7 it cannot.
7. **Schema changes are additive Drizzle migrations**, so the migration can be
   applied to production before the code that needs it deploys.
8. **Fix the parser, not the test.** Fixtures are rebuilt from the live source.
9. **Ordering stays a phone number and a callback.** See [Not doing](#not-doing).

## Progress

**9 October 2026.** A first wave of seventeen branches is merged into
`completion` (nothing is on `main`, nothing is pushed). Ticked tasks below are
merged and verified there: `typecheck` and `lint` clean, 605 sync-side and 852
storefront tests passing.

The catch-up sync was rehearsed against a local copy of the production catalog
and the live source: **110 → 187 products, 86 followed to their new URL, 2
linked by hand, 77 created, none duplicated, none lost**; every existing product
kept its slug, its copy and its photo; a second sync was a no-op.

**Second wave, same day.** Nine more branches: the storefront rebuilt to
`DESIGN.md` (navigation, home, product card, listing, product page), product
codes and stated facts read from the source's product pages, newsletter
consent, the wizard using composition and roast, and test infrastructure that
lets the whole browser suite run in CI. 1,769 unit and 293 integration tests
pass; `reference:coverage` passes against a fresh crawl (228 pages, 187
products, 19 of 19 observed capabilities covered); `check:originality` passes
against all 187 of the source's descriptions. The product-code backfill read
187 of 187 pages in 24 seconds with no failure.

Tasks that are built but not ticked, and why:

- **D3** — the code is done; `pnpm check:launch` fails by design until the
  business answers the open questions it lists.
- **E8** — waits on the business for social links.

**Third wave, same night.** A fresh crawl of the source (228 pages, 19 of 19
observed capabilities covered); our own copy for the 77 new products, so all
187 now have it; the documentation rewritten to describe the system as built;
the remaining design work; the browser suite updated for the redesign; and the
performance budgets measured. The six staged migrations are folded into
`0006_completion`, checked against an empty database, a copy in production's
current state and a copy that already had them. The repository is formatted.

**Fourth to sixth waves, 9 October.** [Phase J](#phase-j--bulgarian-urls-brand-logos-and-search-demand):
every storefront URL moved under `/bg/` with Bulgarian slugs chosen from
measured demand, and every old URL answers 308; brand logos; a market study
([docs/seo.md](docs/seo.md)); the shop's own product names and brand-first
addresses; four landing listings and a Tchibo Cafissimo page; titles,
descriptions and internal links from the study; the journal retitled and
grown from four articles to six; a 404 the server renders; one rule for a
pack size the source records wrongly; and pages that share as themselves.
The move of the product addresses was rehearsed on the local catalog with the
steps H6 uses: 187 moved there (production will move 110, because the sync
creates its 77 new products at their final address), copy matched for 187 of
187, and a second run changed nothing.

**Where `completion` stands:** 137 commits ahead of `main`, nothing pushed.
`format:check`, `typecheck` and `lint` are clean; 2,637 unit, 350
integration and 748 browser tests pass (desktop and mobile, `CI=true`, against
a production build seeded exactly as CI seeds it); `check:originality` and
`reference:coverage` pass; `check:launch` fails by design with the business's
eight open questions. Everything left is in Phase H.

Things the first wave found that this plan did not anticipate are marked
**Found** where they apply.

## Where it stands

| Area              | State on 8 October 2026                                                                                                                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Storefront        | Live, deployed from `db81b64`. `typecheck` and `lint` clean, 471 unit tests pass (22 integration tests skipped: no local database). The end-to-end suite was not run.                                          |
| Product photos    | **0 of 110 load in production.** The mirrored files exist only in `.storage/` on a development machine, and production has no image host configured.                                                           |
| Catalog freshness | Last sync **20 August**. No sync has ever run against the production database and nothing schedules one: `infra/terraform` was never applied and there is no CI.                                               |
| Catalog drift     | Source lists **187** products from 20 brands; we list **110** from 15. About 80 are missing, 3 prices differ, 2 of ours no longer exist there.                                                                 |
| Product identity  | The source renamed its product URLs. Only **21 of 110** still match on path + pack size, so the next sync would create about 166 products and remove none — roughly 87 duplicates.                             |
| Source structure  | Unknown routes now return a real 404. The shared-URL collision is gone. New: a Vending Zone page, a Consumables page, one blog article, a free-delivery banner, listed payment methods.                        |
| Delivery, payment | Stated nowhere on the storefront.                                                                                                                                                                              |
| Legal pages       | Terms and Privacy render their draft callouts publicly. Delivery terms, return costs and the Article 57 exceptions are unwritten.                                                                              |
| Mailbox           | The inbound webhook records mail for every domain on the mail account, not only this shop's.                                                                                                                   |
| Analytics         | None. `lib/analytics.ts` has a no-op sink in production and no measurement script is installed.                                                                                                                |
| Operations        | Functions run in `iad1` while the database is in `eu-central-1`. `RATE_LIMIT_SALT` is unset in production. Two variables on the host are read by nothing. No Search Console verification record on the domain. |
| Local environment | `.env` declares `DATABASE_URL` twice and the last one wins, so `pnpm env:push -- --apply` would deploy a localhost database URL.                                                                               |
| Docs              | [docs/launch.md](docs/launch.md) still lists the brand and the notification provider as blocking; both are done. `env.schema.mjs` says there is no production domain.                                          |

What is already right and stays: the wizard and machine pages, price per cup,
cross-alphabet search with typeahead, sorting and pagination, the admin panel,
structured data, the originality and coverage checks, and 110 hand-written
product descriptions.

## Decisions

None of these blocks code. Each has a default the plan assumes.

| #   | Decision                                            | Default                                                                                                                                                                           |
| --- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Where product images live                           | **Vercel Blob.** Same platform as the storefront, one token. Costs a new storage driver (C2). The alternative is S3, whose driver and Terraform already exist.                    |
| Q2  | What runs the sync                                  | **A scheduled GitHub Actions workflow** (B13), with the alarm living in the storefront (B14). The alternative is the Lambda in `infra/terraform`, written and never applied.      |
| Q3  | Delivery fee, free-delivery threshold, timeframes   | Mirror what the source publishes — free above €49 — since the source fulfils the order. Values live in config (D1), not in copy. `owner`                                          |
| Q4  | Payment methods offered                             | Cash on delivery and bank transfer. `owner`                                                                                                                                       |
| Q5  | Who pays return shipping; the Article 57 exclusions | None — this needs a business answer and a lawyer. `owner`                                                                                                                         |
| Q6  | Opening hours                                       | Keep `siteConfig.contact.hours` until told otherwise; the source publishes shorter hours. `owner`                                                                                 |
| Q7  | Vending Zone and Consumables                        | Content pages with an enquiry form now; products appear by themselves once the source lists them (E1).                                                                            |
| Q8  | Brand logos and photography                         | Product packshots carry the imagery. Brand logos are each brand's own file from its own site, checked against the packs (J2). Four brands have none yet; text until then. `owner` |
| Q9  | Who writes copy for new products                    | Written in the same way and under the same rules as the first 110 (B9). The generated fallback (B7) covers the gap.                                                               |
| Q10 | Newsletter                                          | Collect and manage consent only. Sending is out of scope.                                                                                                                         |
| Q11 | Repository visibility                               | Unchanged. Worth a deliberate yes: the repository documents the crawl and is public, and so will be the sync logs.                                                                |
| Q12 | `infra/terraform`                                   | Keep as the documented alternative until the scheduled sync has run for 30 days, then delete.                                                                                     |
| Q13 | "Remove competitor-related texts" (workspace TODO)  | Unclear what it targets. The storefront copy contains no comparison with another shop, and `check:originality` already forbids the source's name there. Needs a pointer.          |

## Phase A — Groundwork

- [x] **A1 · Branch and local data · S**
  - Create `completion`. `docker compose up -d`, `pnpm db:migrate`.
  - Load a **read-only copy of production's catalog tables** into the local
    database: `source_sites`, `brands`, `categories`, `products`,
    `product_categories`, `product_images`, `sync_runs`, `sync_changes`,
    `catalog_baselines`. Leave out `order_inquiries`, `contact_messages`,
    `newsletter_subscribers` and `mail_*` — customer data does not belong in a
    development database.
  - _Done when_ the local storefront shows the same 110 products as production,
    with their slugs and descriptions.
  - _Why_ the identity migration in B3 has to be rehearsed against the real
    rows, not against a fresh sync that would never have the problem.

- [x] **A2 · Continuous integration · M**
  - `.github/workflows/ci.yml` on pull requests and `completion`: install,
    `typecheck`, `lint`, `format:check`, `test`, `test:integration` against a
    Postgres service container, `check:originality`, `reference:coverage`,
    `build`.
  - A second job runs `test:e2e` on desktop and mobile against a database
    filled by `pnpm --filter @catalog/web seed:dev`.
  - _Done when_ a pull request cannot merge red.
  - **Found.** Three checks were already broken on `main`: `format:check`
    fails on 93 files that were never formatted; `test:integration` filters
    for a project no config defines; `reference:coverage` points at page files
    that moved into a route group. And only 112 of 190 end-to-end tests can run
    without the real catalog. All four are being fixed in the second wave.

- [x] **A3 · Environment tooling that cannot deploy a laptop · S · `early`**
  - `apps/web/scripts/env-lib.mjs`: fail when a key appears twice in one file.
  - `apps/web/scripts/env-push.mjs`: refuse to send a `DATABASE_URL` or site URL
    whose host is `localhost` or `127.0.0.1` to any deployed target.
  - `apps/web/env.schema.mjs`: a short admin password is an **error** in
    production, not a warning; `ADMIN_SESSION_SECRET` is required there; add
    `CRON_SECRET` and the image-store token.
  - Clean the local `.env` files down to one `DATABASE_URL` each.
  - _Done when_ `pnpm env:push` on today's `.env` refuses with a clear message.

- [x] **A4 · Make the docs true · S**
  - [docs/launch.md](docs/launch.md) becomes a pointer to Phase H of this file.
  - Correct the port (`3000` in one doc, `3100` in another), the "no production
    domain yet" comment in `env.schema.mjs`, and the status of the brand and
    notification items.
  - _Done when_ no doc describes something that is no longer the case.

## Phase B — Sync: catch up, then keep up

This is the phase the project exists for. B1–B3 are the critical path.

- [x] **B1 · Re-learn the source · M**
  - `node scripts/build-fixtures.mjs`, then run the parser tests. The failures
    name what changed.
  - Add fixtures for the cases that are new: a product at a renamed URL, a real
    404 response, the Vending Zone page, the Consumables page, a blog article.
  - `Fetcher.calibrateSoft404()` already degrades to "not applicable" when the
    probe does not come back as a page — pin that with a test, and keep the
    soft-404 path: the source has behaved both ways.
  - Update [docs/source-recon.md](docs/source-recon.md).
  - _Done when_ parser and fetcher tests pass on fresh fixtures.

- [x] **B2 · Move detection in the diff · L**
  - _Problem._ Identity is source path + pack size
    ([identity.ts](packages/scraper-core/src/catalog/identity.ts)). When the
    source renames a URL the product looks deleted and a twin looks new. The
    circuit breaker then blocks the removals and lets the creations through.
  - _Change._ In [diff.ts](packages/scraper-core/src/catalog/diff.ts), after
    the first pass, pair each would-be-missing product with a would-be-created
    one on a secondary fingerprint: brand key + normalised name + canonical
    pack size. Pair **only one-to-one**; anything ambiguous stays as it is and
    is reported. Emit a new change type, `moved`.
  - _Apply._ In [sync.ts](packages/scraper-core/src/catalog/sync.ts) a move
    updates `source_key`, `source_path`, `source_url` and `source_variant_key`
    on the **existing row**. Its id, slug, description overrides, images and
    order history are untouched. The old key is appended to a new
    `previous_source_keys text[]` column.
  - _Breaker._ `disappearingCount` is computed after pairing, so a rename is
    not mistaken for a mass removal.
  - _Schema._ Add `moved` to `change_type`; add `previous_source_keys`.
  - _Tests._ Unit tests for one-to-one pairing, ambiguity, a rename combined
    with a price change, and the two-pack-sizes-on-one-URL case. A regression
    test built from the August snapshot in `reference/latest/products.json` and
    the fresh fixture.
  - _Done when_ that regression test reports about 87 moved, about 80 created,
    2 missing and **0 duplicates**, and the diff engine is still pure.
  - **Found.** Measured: 22 key matches, **86 moved, 79 created, 2 missing, 0
    duplicates**. Brand + name + pack size alone pairs only 71, because the
    source also filled in a missing brand on 12 products and respelled one
    brand key; a third pass pairs on name + pack size when the path stem
    corroborates it. A tie that no signal breaks is reported, never guessed.
  - **Found.** Brands and categories had the same problem: the capsule parent
    category and one brand were renamed at the source. Both carry a stable
    numeric id there, so they now match on that id first, keep their row and
    their slug, and record the previous key. A brand or category absent from a
    trusted run is hidden (`missing`), never removed.

- [x] **B3 · Rehearse the catch-up locally · S**
  - `pnpm sync:catalog -- --dry-run` against the A1 copy; compare with B2's
    expected numbers. Then run it for real.
  - New command `pnpm catalog:verify` asserting the invariants: no two active
    products share brand + name + pack size; every moved product kept its slug
    and its overrides; every active product has a price or is explicitly
    price-on-request; every active product has an active image row.
  - _Done when_ the local storefront shows about 187 products, no duplicates,
    and `catalog:verify` passes. The same command is reused in H6.

- [x] **B4 · A manual pairing escape hatch · S**
  - `pnpm catalog:link <our-slug> <new-source-key>` for the rename that also
    changed the product's name, which no fingerprint can pair. Two such
    products exist today. It writes the same `moved` change the sync would.
  - _Done when_ a product can be re-linked before its missing counter reaches
    the removal threshold.
  - **Found.** The two products are a pod pack that gained a pack size in its
    name and a bean blend whose name was respelled. Their commands are in H6.

- [x] **B5 · Product code as a second identity · M**
  - The source's product pages now print a product code. Fetch the product page
    for **created, moved and changed** products only, extend
    [productPage.ts](packages/scraper-core/src/parsers/productPage.ts) to read
    it, and store it in `products.sku`.
  - Move detection prefers a matching `sku` over the name fingerprint when both
    sides have one. `source_key` itself does not change strategy — that would
    re-key the whole catalog a second time.
  - One backfill pass reads every product page once, at the configured rate.
  - _Done when_ every active product has a `sku` and a simulated rename with a
    simultaneous name change is still paired.
  - **Found.** The source's product codes are not unique: two pairs of different
    products share a code. The code is therefore a move-detection signal only,
    never the identity, and `catalog:enrich` reports codes held twice.

- [x] **B6 · Structured attributes from the product page · M**
  - The catalog blob carries only a short description (median 122 characters).
    Composition, origin, taste profile and compatible system are a labelled
    list on the product page.
  - Parse that list in the same fetch as B5. Add nullable columns
    `arabica_percent`, `origin`, `roast`; keep the rest in `attributes`. Fill
    from the labelled list first and from an unambiguous phrase in the
    description second. Never guess: absent stays null.
  - _Done when_ the columns are populated wherever the source states the fact,
    with a fixture test per pattern. Consumed by G2, E10 and F5.

- [x] **B7 · Never publish the source's prose · M**
  - _Problem._ [queries.ts](apps/web/src/lib/catalog/queries.ts) reads
    `coalesce(description_text_override, description_text)`. A product synced
    tonight has no override, so the source's paragraph appears on our page, in
    our meta description and in our JSON-LD.
  - _Change._ Descriptions become override-or-generated. A pure function,
    `lib/catalog/fallback-copy.ts`, composes one factual sentence from held
    attributes — brand, system, pack size, intensity, decaf, flavoured. The
    long "За това кафе" section is omitted until real copy exists.
  - `check:originality` keeps failing on duplicated or source-derived copy. A
    product with **no** copy becomes a reported count, not a failure, so a
    growing catalog cannot turn CI red by itself. `pnpm copy:todo` lists them.
  - _Done when_ a product without an override renders no sentence that appears
    in the source's text, asserted by a test over the whole reference snapshot.
  - **Found.** The generated sentence leaves out the product name, so siblings
    with the same brand, size and intensity share one: 110 products yield 91
    distinct sentences. B9 is therefore not optional.
  - **Found.** `copy:apply` skipped a product whose summary was unchanged, so
    body-only edits never reached the database: 31 products are stale. Fixed;
    the next apply (H6) brings production current.

- [x] **B8 · Copy keyed by something we own · M**
  - [product-copy.ts](apps/web/content/product-copy.ts) is keyed by
    `sourceKey`, which B2 has just shown is not stable. Re-key it by storefront
    slug, which is allocated once and frozen.
  - One-off codemod for the 110 entries; update `apply-product-copy.ts` and
    `check-originality.ts`; export `slug` in `reference/latest/products.json`
    so the originality check still runs without a database.
  - _Done when_ `pnpm copy:apply -- --dry-run` reports 110 matched, 0 orphaned.

- [x] **B9 · Write copy for the new products · L · `content`**
  - About 80 products, under the rules at the top of `product-copy.ts`: every
    claim traceable to the source or a held attribute, no reordered source
    sentences, different text for the same coffee in a different pack.
  - In batches by brand, each batch passing `check:originality`.
  - _Done when_ `pnpm copy:todo` is empty.
  - **Found.** The source contradicts itself on a few products — a pod pack
    named 18 but recorded as 100, an intensity out of 9 where its siblings are
    out of 10, a blend described as 100% robusta whose structured data says
    50/50. The copy states only what the structured data supports and leaves
    the rest out; the business may want to tell the source.

- [x] **B10 · Brands and taxonomy · S**
  - The source's brand names carry stray whitespace and inconsistent case. Add
    a display-name map, `content/brand-names.ts`, with a fallback to the
    synced name, so a new brand is never blocked on it.
  - A test that every stocked system in
    [systems.ts](apps/web/src/lib/recommend/systems.ts) resolves to at least
    one category in the reference snapshot.
  - _Done when_ all 20 brands list correctly and the wizard offers every system
    that has products.

- [x] **B11 · Image mirror corrections · S**
  - A skipped image currently overwrites `mime_type` and `byte_size` with null
    in `mirrorProductImages`. Keep the stored values on a skip.
  - Test that an object missing from the configured store is mirrored again —
    that is what makes a change of image host self-healing.
  - _Done when_ no active image row has a null MIME type after a second sync.

- [x] **B12 · Refresh the reference crawl · M**
  - `pnpm crawl:discovery` locally; commit the new `reference/latest/`.
  - Update [features.ts](packages/scraper-core/src/discovery/features.ts): the
    banner is now a delivery promise, so the written reason for omitting
    `site-notice` no longer holds; add detectors for listed payment methods and
    for the two new page types.
  - _Done when_ `pnpm reference:coverage` fails **only** on capabilities Phase E
    is about to add. That failing list is Phase E's checklist.

- [x] **B13 · Schedule it · M**
  - `.github/workflows/sync.yml`: every six hours (the interval the Terraform
    already chose), plus manual dispatch with a `dry_run` input. One run at a
    time. Exit code 2 — completed but untrusted — fails the job distinctly from
    exit code 3.
  - Secrets it will need at H7: the database URL and the image-store token.
  - Two properties of the platform to design around: workflow logs are public
    here, so the sync logs must stay free of anything private (they contain
    catalog data only); and scheduled workflows are switched off after 60 days
    without repository activity, which is exactly what B14 exists to catch.
  - _Done when_ a manual dry run on the branch completes against a throwaway
    database.

- [x] **B14 · The alarm lives outside the thing it watches · M**
  - A cron route in the storefront, `/api/cron/sync-health`, guarded by
    `CRON_SECRET`. It reads the latest `sync_runs` rows and sends one email
    through the existing `notify()` when: two sync intervals have passed with
    no successful run; the latest run failed or was partial; the breaker is
    open; `catalog_source` is not `filter_init`; parser confidence fell; an
    image failed.
  - At most one email per condition per day.
  - _Done when_ each condition, simulated in an integration test, produces
    exactly one notification.

- [x] **B15 · Sync page in the admin panel · M**
  - Read-only `/admin/sinhron`: recent runs with status, counts and breaker
    reason; what each run created, moved and removed; products without their
    own copy; the "what to do when" notes now in `docs/launch.md`.
  - _Done when_ "is the catalog current, and if not why" is answerable without
    a database client.

- [x] **B16 · Crawler identity · S**
  - The default `CRAWL_USER_AGENT` names a placeholder contact. Make the
    contact a required setting for any non-local run; the real address arrives
    in H1.
  - Document the request budget per sync now that B5 adds product-page reads.
  - _Done when_ a scheduled run cannot start with the placeholder.

## Phase C — Images

- [x] **C1 · Never show a broken image · S · `early`**
  - [images.ts](apps/web/src/lib/catalog/images.ts): on a deployed host with no
    image base URL, resolve to the placeholder instead of `/media/…`, which
    cannot exist there.
  - A small client wrapper around `next/image` that swaps to the placeholder on
    a load error, used by the card, the gallery and the typeahead.
  - Replace the placeholder artwork with something that looks intended.
  - _Done when_ no page can render the browser's broken-image icon. Merged to
    `main` early, this makes production look deliberate until H2.
  - **Found.** Images now resolve from the object key against whichever host is
    configured, not from a stored absolute URL, so a later change of image
    store cannot strand a row.

- [x] **C2 · A storage driver for the chosen host · M**
  - Add a third implementation of `StorageDriver` in
    [driver.ts](packages/scraper-core/src/storage/driver.ts) for Q1's choice,
    with deterministic object names so content-addressed keys stay stable.
    Extend the `STORAGE_DRIVER` enum and config validation.
  - One contract test suite run against every driver: local always; remote
    drivers only when their credentials are present.
  - _Done when_ the contract suite passes locally and the driver is selectable
    by configuration alone.

- [x] **C3 · Move and verify images between stores · S**
  - `pnpm images:push --from local --to <driver>` copies every referenced
    object. `pnpm images:verify` checks that each active `product_images` row
    is present in the store and answers 200 at the public base URL.
  - _Done when_ both run against two local directories in a test.

- [x] **C4 · Storefront configuration · S**
  - `NEXT_PUBLIC_IMAGE_BASE_URL` becomes required for production in
    `env.schema.mjs`. `next.config.ts` already derives `remotePatterns` from
    it. `/media` stays development-only.
  - _Done when_ `pnpm env:check --strict` fails a production configuration
    without an image host.

## Phase D — Trust and operations

- [x] **D1 · Commercial terms as configuration · M · `owner`**
  - `siteConfig.commerce`: delivery fee, free-delivery threshold, delivery
    time, payment methods, return window, who pays return shipping. Same
    pattern as `siteConfig.legal`: an unset value is **omitted** from the page,
    never invented.
  - _Done when_ changing the threshold is a one-line commit and every surface
    in D2 and D3 follows.

- [x] **D2 · Say it where people decide · M**
  - An announcement bar; a delivery-and-payment block beside the order form; a
    "Доставка и плащане" page; payment methods in the footer.
  - `shippingDetails` and `hasMerchantReturnPolicy` on the Product JSON-LD once
    D1 is complete.
  - _Done when_ delivery cost and payment method are visible on a product page
    without scrolling past the order form on mobile.

- [ ] **D3 · Finish the legal text · M · `owner`**
  - Generate the delivery and returns sections of
    [legal.ts](apps/web/src/content/legal.ts) from D1. Resolve the three open
    sections with the answers to Q5.
  - New check, `pnpm check:launch`, failing a production build while any
    `ЗА ПРЕГЛЕД` marker remains.
  - _Done when_ `check:launch` passes. The lawyer's read is H1.

- [x] **D4 · Scope the mailbox to this shop · S · `early`**
  - In [inbound.ts](apps/web/src/lib/mail/inbound.ts), ignore an event with no
    recipient at `MAIL_DOMAIN` — before `record()`, so it is neither stored nor
    forwarded. Cover it in `test/mail.test.ts`.
  - `scripts/mail-prune-foreign.ts`, dry-run by default, for the rows already
    stored. Run in H8.
  - _Done when_ a webhook for another domain returns "ignored".

- [x] **D5 · Rate limiting that survives serverless · M**
  - `createRateLimiter` already takes its storage as a parameter. Add a
    Postgres-backed store and use it for the public forms and the suggest
    endpoint. The in-memory store stays for development and tests.
  - _Done when_ the limit holds across two processes in an integration test.

- [x] **D6 · Admin sign-in hardening · M**
  - Attempt limiting on `signIn` through D5's store, per client and global,
    with backoff. Failed attempts are logged without the attempted value.
  - Production refuses to enable the panel with a short password or without a
    separate session secret (A3 makes the tooling say so first).
  - _Done when_ repeated wrong passwords lock out and a correct one afterwards
    still waits out the backoff.
  - **Found — this changes the launch order.** On a deployment the panel now
    stays disabled unless the password is at least 12 characters and a
    separate session secret is set, and sign-in is refused until the rate-limit
    table exists. So the password is rotated and the migration applied
    **before** the code ships (H3, H4), not after.

- [x] **D7 · Measurement · S**
  - Install cookieless page analytics and performance measurement, and wire
    `setAnalyticsSink` so the events `lib/analytics.ts` already defines are
    actually sent. The no-personal-data rule in that file stands.
  - Update the cookies page, which promises to be changed before any
    measurement is switched on.
  - _Done when_ a quick order and a completed wizard appear as events on a
    preview, and the site still sets no cookie for a visitor.

- [x] **D8 · Run next to the database · S · `early`**
  - Pin the storefront's functions to Frankfurt.
  - _Done when_ response headers show the function region as `fra1`.

- [x] **D9 · Keep the privacy policy's promises · M**
  - The policy states that unconverted enquiries and closed contact messages
    are kept for 12 months. Nothing deletes them. Add a daily cron route that
    removes or anonymises rows past retention, and decide and state the same
    for the mailbox.
  - _Done when_ a row dated 13 months ago is gone after one run, in a test.
  - **Found.** Only enquiries marked cancelled or spam are deleted; `new` and
    `contacted` are never touched and are reported as awaiting a decision. The
    policy's promise therefore depends on enquiries being closed in the panel.

- [x] **D10 · Newsletter consent, and marking from the panel · M**
  - An unticked consent checkbox on the quick-order and contact forms, writing
    `newsletter_subscribers` with its `consent_source`.
  - An "add to newsletter" action on an enquiry or message in the admin panel.
    It requires the operator to pick how consent was given, and stores it —
    an enquiry alone is not consent to marketing.
  - A tokenised unsubscribe route, so that any future sending is lawful from
    its first message.
  - _Done when_ every subscriber row can answer "who agreed, when, and how".

- [x] **D11 · After the customer presses the button · S**
  - The success state says what happens next and when, from the opening hours;
    outside them, it says so. Optional confirmation email when the customer
    gave an address.
  - _Done when_ a customer ordering on a Saturday is told to expect the call on
    Monday.

- [x] **D12 · Content-Security-Policy · S**
  - Add a CSP in `next.config.ts`, report-only first, alongside the headers
    already set.
  - _Done when_ the storefront and the admin panel run clean under it.

## Phase E — Parity with the source

B12's failing coverage report is the authoritative list; these are what it will
contain.

- [x] **E1 · Vending Zone and Consumables · M**
  - Two pages with our own copy, linking the vending blends already in the
    catalog, with a business enquiry form that reuses the contact action.
  - Built on the category mechanism, so that when the source starts listing
    products under them, they appear with no further work.
  - In the header, the home page tiles, the sitemap and `llms.txt`.
  - _Done when_ both pages exist and coverage passes for the two page types.

- [x] **E2 · Quick order from the product card · M**
  - A "Бърза поръчка" control on [product-card.tsx](apps/web/src/components/catalog/product-card.tsx)
    opening the existing form in a dialog. Without JavaScript it is a link to
    the order form on the product page.
  - _Done when_ an order can be placed from a listing in two interactions, and
    the no-script end-to-end test still passes.

- [x] **E3 · Intensity on its own scale · S**
  - The source declares intensity on five different scales (out of 5, 9, 10, 12
    and 13). `parseIntensity()` already normalises them. Show the reading as a
    scale with its own maximum — "7 от 10" — on the card and the product page.
  - _Done when_ no two products on different scales look falsely comparable.

- [x] **E4 · System badge and compatibility line · S**
  - Every capsule and pod product names its system on the card. The product
    page links "Става за…" to the matching machine pages.
  - _Done when_ a customer can tell from a listing whether a product fits.

- [x] **E5 · Brand pages · M · `content`**
  - Display names from B10, a short original introduction per brand, an
    optional logo slot (Q8), and a brand row on the home page.
  - _Done when_ all 20 brand pages have an introduction that passes the
    originality check.

- [x] **E6 · Category introductions · S · `content`**
  - Original text per category and subcategory in `content/category-copy.ts`,
    rendered below the listing so products stay first, and covered by
    `check:originality`.
  - _Done when_ all 8 have one.

- [x] **E7 · Journal · M · `content`**
  - Articles as files in the repository, an article route, Article JSON-LD.
  - Three to five launch articles answering questions people actually ask —
    which capsule fits which machine, what a cup really costs by format, how to
    read an intensity number — each linking into the wizard and the catalog.
  - _Done when_ `/journal` is no longer an empty state.

- [ ] **E8 · Social links and contact details · S · `owner`**
  - Render `siteConfig.social` in the footer and as `sameAs` on the
    Organization JSON-LD; both stay absent while it is empty.

- [x] **E9 · Promotions under real conditions · S**
  - The source has no reduced price today, so the page has only ever rendered
    its empty state in production. Add an end-to-end case with a seeded
    reduction, and a home module that appears only when one exists.

- [x] **E10 · Product code on the page · S**
  - Show `sku` on the product page and in the JSON-LD once B5 has filled it.

- [x] **E11 · Coverage green · S**
  - Update the map and the omissions in `apps/web/scripts/reference-coverage.ts`
    and regenerate [docs/reference-coverage.md](docs/reference-coverage.md).
  - _Done when_ `pnpm reference:coverage` passes against B12's crawl.

## Phase F — Design

The current identity — pine green, cream, a serif display face — is coherent
and deliberately unlike the source. It stays. What it lacks is imagery and a
structure that matches how people shop for coffee.

Three layers that have to agree:

- **Navigation: machine first.** People know what machine they own, not which
  capsule system it uses. The wizard is built on that; the catalog is not yet.
- **Visuals: a practical catalog with an espresso-bar warmth.** The packs are
  loud, so the interface stays quiet and lets them carry the colour.
- **Voice: a plain-spoken advisor.** The wizard already sounds like this.

- [x] **F1 · Write it down first · M**
  - `PRODUCT.md` (who buys, what they are trying to do, positioning, scope,
    what may never be claimed) and `DESIGN.md` (colour, type, layout, shape,
    components, do and don't), as the company's other storefronts have.
  - _Done when_ F2–F8 can be reviewed against a written standard.

- [x] **F2 · Tokens · S**
  - Warmer neutrals. One accent taken from the logo's gold, used as a fill
    under dark text. Pine remains the anchor. Clay is reserved for reductions.
  - A colour per brewing system, always paired with its name — never colour
    alone.
  - _Done when_ every pairing passes WCAG AA in the accessibility suite.

- [x] **F3 · The product card · M**
  - Packshot, system badge, brand, name, intensity scale, price, price per cup,
    quick order. Equal heights; two columns on a phone.

- [x] **F4 · Home · M**
  - A hero built from real packshots; the delivery promise; shop-by-system
    tiles; an entry to the wizard; new arrivals; brands; journal; Vending Zone.
    Every module still disappears when it has nothing to show.

- [x] **F5 · Product page · M**
  - Gallery; a facts table (system, intensity, composition, origin, pack,
    price per cup) from B6; delivery and payment; the order form;
    compatibility; related products.
  - **Found.** Related products matched on brand alone, so a Dolce Gusto capsule
    could be suggested under a Nespresso one. They are now restricted to the
    same brewing system.

- [x] **F6 · Listings · M**
  - Filter by system and by intensity band; sort by price per cup; chips for
    active filters; the category introduction; real empty states. New
    parameters join the `noindex` and robots rules.
  - **Found.** Facet counts used a narrower search predicate than the results,
    so searching a brand by name showed results beside zero counts. Facets now
    use the results' predicate.

- [x] **F7 · Navigation · S**
  - Capsules grouped by system, "find by machine" as a first-class entry,
    Vending Zone; the mobile drawer carries the same structure.

- [x] **F8 · States and edges · S**
  - Placeholders, loading, the not-found and error pages, focus styles,
    reduced motion, the share image.
  - **Found.** Text typed into the header search before the page hydrated was
    thrown away when the interactive field replaced the server-rendered one;
    it is handed over now. And the admin login page was prerendered at build
    time, so a build made without a password served the "disabled" notice
    even after one was set; it renders per request now.

- [x] **F9 · Budgets · S**
  - Mobile LCP under 2.5 s and CLS under 0.1 on the home, a listing and a
    product page; the accessibility suite passing on every new component.
  - _Done when_ measured on a preview and recorded in `DESIGN.md`.
  - **Found.** Lab medians are within budget (LCP 1.22 s home, 1.32 s listing,
    1.46 s product; CLS 0). One listing run reached 3.0 s: paint waited on
    long tasks from a page whose image `srcset` lists offered widths up to
    3840 px for ~800 px photos. The widths are trimmed; re-measure on a
    preview with `pnpm measure:budgets` before launch.

## Phase G — Search, wizard and SEO

- [x] **G1 · Phonetic synonyms · S**
  - The documented gap: „Лаваца" folds to `lavatsa` and misses "Lavazza". Add a
    small synonym table for brand and system names as Bulgarians spell them,
    applied to the query before folding, in
    [search.ts](apps/web/src/lib/catalog/search.ts) so the results page, the
    facets and the typeahead keep sharing one predicate.
  - _Done when_ each of the 20 brands is found by its common Cyrillic spelling,
    in `e2e/search.spec.ts`.

- [x] **G2 · Score with real attributes · M**
  - Use B6's composition, origin and roast as soft criteria in
    [score.ts](apps/web/src/lib/recommend/score.ts), with reason phrases, under
    the existing rule that a card may only claim what the ranking used.
  - _Done when_ `test/recommend.test.ts` covers each new criterion.

- [x] **G3 · Recognise your capsule · M**
  - Our own diagrams of the five capsule shapes and the ESE pod on
    `/wizard/machines` — drawn, not manufacturer photography.
  - _Done when_ each system's "how to recognise it" text has a picture.
  - **Found.** Nespresso, Dolce Gusto and the ESE pod are drawn with
    confidence. A Modo Mio, Caffitaly and Lavazza Blue were drawn without a
    reference and must be held against real capsules before launch (H1). The
    recognition text claimed a machine-read barcode on Dolce Gusto capsules;
    nothing supports that, and it is removed.

- [x] **G4 · Structured data, sitemap, llms.txt · S**
  - Article markup for E7; product code and shipping from E10 and D2; new
    routes in the sitemap with `lastModified` from `last_changed_at`; delivery
    terms in `llms.txt`.

- [x] **G5 · Internal links · S**
  - Product → system → machines; category introductions → wizard; journal →
    catalog.

## Phase H — Hook-up and launch

In order. Each step is reversible until the next begins.

**Before starting:** CI green on `completion`; B3 rehearsal passed; `check:launch`
passes.

- [ ] **H1 · From the business** — the answers `pnpm check:launch` lists
      (delivery fee below the threshold; whether exactly €49.00 is free; days to
      dispatch and days in transit; payment methods; return window; who pays
      return shipping; opening hours), then set `commerce.confirmedByOwner`.
      From a lawyer: the Article 57 exclusions, the standard withdrawal form,
      and a read of Terms and Privacy. Social links. Written permission from
      the source's owner for the catalog use, and the contact address for the
      crawler's user agent. Someone holding real A Modo Mio, Caffitaly and
      Lavazza Blue capsules compares them with the drawings on
      `/bg/za-kafemashina`. From Phase J: logo files for 3 Bourbons, Este,
      Eurocaf and Molini, which the source's owner may be able to ask those
      brands for; which of Eurocaf, Molini, Este, 3 Bourbons and Tezzoro are
      Italian; and a word to the source about the illy tin it lists as 100
      pods.
- [ ] **H2 · Image store** — create it; put its token in the local environment
      and in the repository's secrets; `pnpm images:push`; `pnpm images:verify`.
- [ ] **H3 · Databases** — create a database branch for previews and point the
      Preview `DATABASE_URL` at it; take a restore point of production;
      `pnpm db:migrate` on production (additive, so the running site is
      unaffected). **This must precede H5:** until the rate-limit table exists,
      the new code refuses admin sign-in.
- [ ] **H4 · Deployment environment** — first make each local `.env` file
      declare `DATABASE_URL` once; the tooling now refuses a repeated key. Then
      `pnpm env:push` (read the plan, then `--apply`): image base URL,
      `RATE_LIMIT_SALT`, `CRON_SECRET`, a separate session secret, an admin
      passphrase of at least 12 characters, corrected targets. Remove the two
      variables nothing reads. **This must precede H5:** with a short password
      or no separate session secret, the deployed panel disables itself.
- [ ] **H5 · Ship the code** — push `completion` and let CI run on it first
      (the two workflows have never run on GitHub). Then merge into `main`. Check the built
      HTML rather than a warm cache: photos load, no draft marker, function
      region is Frankfurt.
- [ ] **H6 · Catch the catalog up** — `pnpm sync:catalog --dry-run` against
      production; the numbers must match the rehearsal (86 moved, 79 created, 2
      missing, 0 unresolved; 5 brands created, 1 brand and 1 category renamed).
      Link the two renamed-and-retitled products with
      `pnpm catalog:link <slug> <new-key> --apply` (the dry run names both; in
      Git Bash prefix the command with `MSYS_NO_PATHCONV=1`, or the leading `/`
      of the key is rewritten). Then the real run — expect 187 products, 77
      created, 0 missing — followed by `pnpm catalog:verify` and
      `pnpm catalog:enrich --apply`. Then move the old addresses:
      `pnpm --filter @catalog/web catalog:reslug --tsv <file>` and read the
      plan (110 to move: the 77 new products were created at their final
      address), then `--apply`, and once more without it (0 to move). Every
      old address answers 308 from then on. Then `pnpm copy:apply`, which is
      keyed by the new addresses (187 matched, none orphaned; it also writes
      the 31 stale bodies), a second sync that must change nothing, and a
      hand comparison of ten products against the source. Check the admin's
      sync page: it should list one pack-size conflict, the illy tin, shown
      as 18 pods.
- [ ] **H7 · Turn on the schedule** — add the workflow's secrets, run it once
      by hand, enable the schedule, and prove the alarm by letting a preview go
      stale.
- [ ] **H8 · Mail** — `pnpm --filter @catalog/web mail:prune-foreign` (plan-only by default), review, `--export <file>`, then `--apply`.
      Send a real enquiry end to end and answer it from the panel. Confirm SPF
      and DKIM pass; move DMARC off `p=none` once reports are clean.
- [ ] **H9 · Search engines** — verify the domain in Search Console, submit the
      sitemap, request indexing for `/bg`, `/bg/kafe-kapsuli`, `/bg/kafe-na-zarna`,
      `/bg/izbor-na-kafe` and `/bg/za-kafemashina`; check in the URL inspection
      tool that an old English URL answers 308. Bing Webmaster Tools. No Google
      Business Profile: a shop that confirms by phone and ships by courier
      does not qualify ([docs/seo.md](docs/seo.md) §14).
- [ ] **H10 · Smoke test on production** — a product from each system opens
      with photo, price, price per cup and delivery terms; search finds a brand
      in both alphabets; the wizard completes; a quick order arrives by email
      and in the panel; the sync page shows a run from today.

**Rollback:** the previous deployment can be restored instantly; the database
has the H3 restore point; the schedule can be disabled in one click and nothing
else writes to the catalog.

## Phase I — After launch

First weeks, watch for: the breaker opening; `catalog_source` switching to
`listing_html`; parser confidence falling; products accumulating without copy.

Backlog, in rough order of value:

- Advertising research (workspace TODO). Any ad or remarketing tag brings a
  consent banner with it, and the cookies page changes first.
- IndexNow and Bing URL submission after each sync that changed something.
- Whether a product feed for shopping listings is possible at all for a shop
  without online checkout.
- A multi-product enquiry ("order list") — only if calls show customers
  routinely ordering several products at once.
- Sending the newsletter.
- Deleting `infra/terraform` (Q12).

## Phase J — Bulgarian URLs, brand logos and search demand

Added on 9 October 2026, after the first three waves. The storefront's URLs were
English while every customer is Bulgarian; every brand was plain text; and
nobody had measured what Bulgarians search for. Like A–G, this is code and
content only.

- [x] **J1 · Locale-prefixed routing, Bulgarian URLs · L**
  - Every storefront URL under `/bg/`, with transliterated Bulgarian slugs
    chosen from measured demand (`/bg/dolce-gusto-kapsuli`, `/bg/kafe-na-zarna`,
    `/bg/marki/lavazza`, products at the first level). One table of slugs per
    locale; `href()` builds every link; the proxy maps translated segments to
    the route tree. English is built and switched off (`LOCALE_READY`). `/`
    answers by `Accept-Language`, never by location. Every old English URL
    answers 308.
  - _Done when_ no bare path survives (`test/bare-paths.test.ts`), the sitemap
    and `hreflang` list only shipping locales, and the browser suite passes on
    the new URLs.
  - **Found.** Next 16 answers a page's own `notFound()` with a 404 status and
    an empty document that JavaScript fills in, and did so before this work
    too: without scripts a dead product link was a blank page. The proxy now
    asks the catalog first and serves the 404 the server renders. For the same
    reason there is no route-level loading boundary: a shell sent first would
    turn the 308s and 404s these pages answer into 200s.

- [x] **J2 · Brand logos · M**
  - Each brand's own logo where the brand is the subject: the brand index, the
    brand page, the home brand row, the product's brand line, the typeahead,
    and `Brand.logo` in structured data. Files from the brand's own site, never
    recoloured, each checked against the mark on our packshots, with the
    provenance kept in `content/brand-logo-provenance.ts`.
  - **Found.** 16 of 20 brands have a usable file; three (Lollo Caffè, Rema
    Caffè, Vandino) publish only a light logo and sit on a dark tile. None was
    found for 3 Bourbons, Este, Eurocaf or Molini. The source's owner deals
    with these brands and may be able to ask them for files. `owner`. The
    brands' own spellings replace the cautious ones: Lollo Caffè, Biancaffè,
    Rema Caffè.

- [x] **J3 · Market and search research · M**
  - Measured Bulgarian demand for every format, system, brand and question
    this shop could answer, the result pages for the commercial heads, and the
    two shops that matter: [docs/seo.md](docs/seo.md), with the raw data in
    `docs/seo-data/`.
  - **Found.** Capsules carry most of the demand (about 29,000 searches a
    month, against 5,000 for beans); the system comes first in what people
    type; the source ranks for almost nothing, so the risk is looking like a
    copy, not competing with it; English is 2–3 % of demand.

- [x] **J4 · Our own product names and URLs · L**
  - Names as Bulgarians search them („Капсули за Dolce Gusto", „Кафе дози", not
    „DG", „Дозети"); brand-first product URLs; distinct names for the two
    products the source calls by one name; brand URLs spelled as the brand
    spells itself. Old URLs answer 308. The owner keeps seeing the source's
    names, which is what they order by.
  - _Done when_ every product name a customer reads is ours, and a test parses
    all 187 real names.
  - **Found.** The source records one product, an illy tin of 18 pods, with a
    pack size of 100, which made its price per cup 0,09 € instead of 0,51 €
    and put it first on the cheapest-per-cup page. Where the source's name and
    its pack field disagree, the name's size is used now, in the sync, and the
    conflict is listed on the admin's sync page. The source should be told.
    `owner`. The two products the source calls „Lavazza Crema E Aroma 1кг."
    are different bags; one is „Crema e Aroma Expert". Twenty-nine product
    descriptions said „Капсули Dolce Gusto" of third-party capsules; they say
    „за Dolce Gusto" now.

- [x] **J5 · Pages with measured demand · M**
  - Капсули Lavazza, Кафе на зърна Lavazza, Безкофеиново кафе, Най-евтино на
    чаша, and the Tchibo Cafissimo machine page: about 9,000 searches a month
    the shop had no page for. Each disappears when it would be empty.
  - **Found.** The source flags eleven products as caffeine-free. Nine are
    coffee; two are drinks for Dolce Gusto that are not. The page counts
    products without caffeine, not coffees.

- [x] **J6 · Titles, headings and links · M**
  - Every page's title and heading in the words its searchers use, one page per
    query cluster, descriptions that show the price per cup and the callback,
    breadcrumbs by format, and internal links per [docs/seo.md](docs/seo.md)
    §13. The consumables page stays out of the index while it is empty.
  - **Found.** About fifteen kinds of page declared the home page's address,
    title and description for sharing, so a category link pasted into a chat
    was presented as the home page; each page declares its own now. The
    brands page names as Italian only the brands whose own sites say so:
    Rema Caffè's says it is made in Plovdiv, and Eurocaf, Molini, Este, 3
    Bourbons and Tezzoro could not be checked. `owner`. The promotions page
    stays out of the index while nothing is reduced.

- [x] **J7 · Journal · M**
  - The capsule article retitled for „видове капсули за кафе" and moved with a
    308; the formats article retitled; two new articles, choosing beans and
    arabica against robusta, with every catalog figure computed.

**For the runbook.** J4 adds a migration, `0007`, which goes out with H3's,
and the address move, which is written into H6. The pack-size rule needs no
step: the first sync that runs this code corrects the record.

## Order and dependencies

```
A1 ─┬─ B1 ── B2 ── B3 ─┬─ B5 ── B6 ─┬─ G2
    │                  ├─ B8 ── B9  └─ E10, F5
    │                  └─ B12 ── E1…E11
    ├─ B7                (independent of B2; needed before any real sync)
    ├─ C1 … C4           (independent)
    ├─ D1 ── D2, D3
    └─ D5 ── D6
F1 ── F2 ── F3…F9        (F3 and F5 want E3, E4 and B6 done first)
B13, B14, B15            (after B3)
everything ── H
```

Critical path: **A1 → B1 → B2 → B3 → B7 → H6.** That is the shortest route to a
catalog that is correct and stays correct. C1, D4 and D8 are independent and
can ship first.

Where the work is:

| Phase | Tasks | Mostly                          |
| ----- | ----- | ------------------------------- |
| A     | 4     | S                               |
| B     | 16    | 2 L (B2, B9), 9 M, 5 S          |
| C     | 4     | 1 M, 3 S                        |
| D     | 12    | 7 M, 5 S                        |
| E     | 11    | 4 M, 7 S                        |
| F     | 9     | 5 M, 4 S                        |
| G     | 5     | 2 M, 3 S                        |
| H     | 10    | One sitting, plus waiting on H1 |
| J     | 7     | 2 L, 5 M                        |

How the workspace TODO list maps onto this:

| TODO item                                         | Where                            |
| ------------------------------------------------- | -------------------------------- |
| Wizard: photos for the machine finder             | G3                               |
| Wizard: arabica %, roast, origin as real columns  | B6, G2                           |
| Vending zone, consumables                         | E1                               |
| Search in both alphabets, suggestions with photos | Done; G1 closes the phonetic gap |
| Newsletter, and marking from enquiries            | D10                              |
| Google Business Profile                           | H9                               |
| Remove competitor-related texts                   | Q13                              |
| Research for ads                                  | Phase I                          |

## Not doing

- **Cart, checkout, online payment.** The source has none and sells on that
  basis; ordering is a phone number and a callback.
- **Customer accounts, wishlists, loyalty.** Nothing to log in to.
- **Reviews and ratings.** The shop has none, and inventing them is a policy
  violation and a lie.
- **A price different from the source's.** `retail_price_override` stays empty
  by design.
- **Shipping a second language.** The shop sells in Bulgaria. The capability is
  built (J1) and English is switched off: Bulgarian demand is about forty times
  the English, and half a translation would be thin duplicate content
  ([docs/seo.md](docs/seo.md) §11).
- **Sending bulk email.** Consent is collected properly so it can be added
  later without rework.

## Appendix: what changed at the source

Observed 8 October 2026, compared with the crawl of 21 August in
`reference/latest/`.

- **Catalog:** 111 raw records → 187. The structured catalog blob still parses
  completely, with no invalid record.
- **URLs:** product paths renamed, typically gaining a pack-size suffix
  (`/amann-cascada/` → `/amann-cascada-500/`). No path now serves more than one
  product. The old paths return 404.
- **Not-found behaviour:** unknown routes return HTTP 404 instead of 200 with
  the home-page shell.
- **By name,** 108 of our 110 products still exist at the source; by current
  identity, 21 do.
- **Prices:** 3 differ on matched products. No product is without a price any
  more (previously 2), none without a pack size (previously 1).
- **Brands:** 15 → 20. The largest addition is a single brand with 32 products.
- **Categories:** the same 8 in the catalog blob. "Кафе дози" grew from 3
  products to 41.
  The capsule parent category was renamed (key and name), and one brand's key
  was respelled; both kept their numeric id.
- **New pages:** Vending Zone and Consumables (text only, no products yet), one
  blog article, a promotions page with nothing on it.
- **New site-wide statements:** free delivery above €49; cash on delivery, bank
  transfer and card listed as payment methods.
- **Product pages** now print a product code and a labelled list of
  characteristics.
