# Launch

The runbook is **Phase H of
[IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md#phase-h--hook-up-and-launch)**:
the business's answers, the image store, the databases, the deployment
environment, shipping the code, catching the catalog up, turning on the
schedule, mail, search engines and a production smoke test, in that order, with
a rollback. This page does not repeat it. It keeps the traps in that order that
are easy to get wrong, and what to watch for afterwards.

`pnpm check:launch` lists what the business still has to decide: open
questions in the legal text, commercial terms that are unset, and
`commerce.confirmedByOwner`. It fails until all of them are answered.

---

## Launch-order traps

Both of these fail closed, so getting them wrong locks the operator out rather
than exposing anything — but the shop then has no panel on launch day.

- **The admin password and the session secret before the code.** On a
  deployment the new code disables the panel unless `ADMIN_PASSWORD` has at
  least 12 characters and `ADMIN_SESSION_SECRET` is set and different from it.
  Set both in the deployment environment (`pnpm env:push`, read the plan, then
  `--apply`) before the code that enforces it is deployed. The disabled screen
  names which condition failed.
- **The migrations before the code.** Admin sign-in is attempt-limited through
  the `rate_limit_buckets` table and refuses whenever it cannot count, so until
  `pnpm db:migrate` has run against production, nobody can sign in. The
  migrations are additive, so applying them under the running site is safe.

Two more that cost a day rather than the panel:

- **`NEXT_PUBLIC_IMAGE_BASE_URL` before the build that needs it**, equal to the
  sync's `STORAGE_PUBLIC_BASE_URL`, and the images pushed and verified first
  (`pnpm images:push`, `pnpm images:verify --http`). It is read at build time;
  without it a deployed storefront shows the placeholder for every product.
- **The catch-up sync as a dry run first.** Read its unresolved moves, and link
  what it could not pair with `pnpm catalog:link` before the real run, or each
  one becomes a duplicate. Then `catalog:verify`, `catalog:enrich --apply`,
  `pnpm --filter @catalog/web catalog:reslug` (read the plan, then `--apply`),
  `copy:apply`, and a second sync that must change nothing.
- **`catalog:reslug` before `copy:apply`, and after the migrations.** The
  written copy is keyed by the shop's own product slugs, so `copy:apply` finds
  nothing to attach to until the stored products have been moved to them. The
  move needs migration `0007_product_previous_slugs`, and it leaves every old
  slug answering 308 to the new one.

## Watch for, in the first weeks

The admin page **Синхронизация** (`/admin/sinhron`) shows the recent runs and
whether anything is wrong; the daily sync-health alarm emails the same
conditions to `MAIL_TO`, once per condition per day. Start there.

- **No recent successful sync.** The workflow did not run or did not succeed. A
  scheduled workflow is disabled by GitHub after 60 days without repository
  activity, and it cannot say so itself: re-enable it under the repository's
  Actions tab.
- **The circuit breaker opening.** It means the catalog was preserved and
  nothing was removed. Read the reasons on the run before doing anything: if the
  source genuinely shrank, raise `SYNC_BREAKER_MAX_DISAPPEARED_RATIO` for one run
  or let the missing counters climb naturally. If the source renamed URLs again,
  look for unresolved moves.
- **`catalog_source` switching from `filter_init` to `listing_html`.** The
  source's structured blob has disappeared and the fallback parser is carrying
  the sync. Rebuild the fixtures, run the parser tests to see exactly what
  changed, and fix the parser rather than the test.
- **Parser confidence dropping.** Same signal, earlier.
- **Unresolved moves in a run.** Counted in the workflow's job summary, logged
  as `sync.moves_unresolved`, and stored in the run's `metadata.unresolvedMoves`.
  Each one is a product the source renamed that the sync would not guess at. Pair it with `catalog:link`, then
  `catalog:verify`.
- **A pack-size conflict on the sync page.** The source states one pack size in
  a product's name and another in its pack field. The storefront already shows
  the name's and computes the price per cup from it, so nothing is wrong on the
  site; the mistake is the source's to correct, and the line leaves the page
  when it does.
- **Products accumulating without copy.** They publish the generated sentence,
  which is correct but thin. `pnpm copy:todo` lists them; write entries, then
  `pnpm copy:apply`.
- **Enrichment failures.** Counted on each run and recorded in `scrape_errors`;
  they retry after a day and never fail a sync, but a steady count means product
  pages changed shape.

## Known gaps, deliberate

- **The newsletter collects consent and does not send.** A sender needs
  unsubscribe handling in every message, bounces, suppression and a reputation
  to protect, and a bad one would put the order replies behind the same
  domain reputation.
- **The CSP reports and does not enforce.** Watch its reports on production
  before switching it to enforcing.
- **`infra/terraform` is kept but not applied.** It is the alternative to the
  scheduled workflow, to be deleted once the workflow has run for 30 days.

## After a brand change

Brand values in `src/config/site.ts` are compiled into the bundle and the
prerender cache can serve a stale page, one page showing the new name and
another the old. **Delete `.next` and rebuild**, then check the built HTML
rather than trusting a running server.
