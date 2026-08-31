# Launch

What stands between this repository and a shop that can take a real order. The
software is complete and verified; everything below is configuration, a business
answer, or a legal one.

---

## Blocking

| | Item | Owner |
| --- | --- | --- |
| ⛔ | **The brand.** Name, wordmark and legal identity are placeholders by design — `src/config/site.ts` (plain constants, not environment variables), the token block at the top of `globals.css`, and `components/layout/wordmark.tsx`. Until the legal constants are filled in the footer says plainly that company details are not configured, and the structured data omits them rather than publishing invented identifiers. | business |
| ⛔ | **Legal review.** `src/content/legal.ts` is written for this business rather than copied, and sections marked `REVIEW REQUIRED` render as visible callouts until they are completed. A lawyer has not seen them. | business + lawyer |
| ⛔ | **The commercial relationship with the source.** The brief states there is one. Nothing in this repository records what it is, and `robots.txt` permission is not permission under a site's terms of service. This is the one risk the code cannot mitigate — the originality checks answer *copyright*, not *authorisation*. | business |
| ⛔ | **Production environment.** `DATABASE_URL`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_IMAGE_BASE_URL` and `RATE_LIMIT_SALT` — the whole list is `apps/web/.env.example`, and nothing else belongs in the dashboard. On Vercel `robots.txt` reads `VERCEL_ENV`, so previews are blocked automatically; on any other host set `NEXT_PUBLIC_ENVIRONMENT=production`, because **any other value makes `robots.txt` disallow everything**. | us |
| ⛔ | **A notification provider.** Orders persist without one and are never lost, but nobody is told they arrived. Implement `NotificationSink` and call `setNotificationSink` once at start-up. | us |

## Infrastructure, once

```bash
pnpm --filter @catalog/scraper build:lambda
cd infra/terraform && cp terraform.tfvars.example terraform.tfvars
terraform init && terraform validate && terraform plan && terraform apply
```

Then the checklist Terraform prints as `post_apply_checklist`: put the real
connection string into the Secrets Manager secret, run `db:migrate` from
somewhere that can reach the database, and trigger one dry run —

```bash
aws lambda invoke --function-name "$(terraform output -raw lambda_function_name)" \
  --payload '{"job":"sync","dryRun":true}' --cli-binary-format raw-in-base64-out \
  out.json && cat out.json
```

Set `alarm_email` and confirm the SNS subscription, or the seven alarms fire
into nothing.

## Watch for, in the first weeks

- **The circuit breaker opening.** It means the catalog was preserved and
  nothing was removed. Read `circuit_breaker_reason` on the `sync_runs` row
  before doing anything: if the source genuinely shrank, raise
  `SYNC_BREAKER_MAX_DISAPPEARED_RATIO` for one run or let the missing counters
  climb naturally.
- **`catalog_source` switching from `filter_init` to `listing_html`.** The
  source's structured blob has disappeared and the fallback parser is carrying
  the sync. Rebuild the fixtures, run the parser tests to see exactly what
  changed, and fix the parser rather than the test.
- **Parser confidence dropping.** Same signal, earlier.

## Known gaps, deliberate

- **The blog has no content architecture beyond the route.** The source's blog
  is empty too, so there was nothing to mirror and nothing to design against.
- **The site-notice banner is not implemented.** The source's announces its own
  closure dates — their operational content, not a storefront capability, and
  reproducing it would mean publishing another business's opening hours as our
  own. The mechanism is trivial to add when this shop needs one.
- **Promotions render an empty state.** Every observed product has an empty
  `old_price`, so no promotion is currently active. The capability exists and is
  tested.

## After a brand change

Brand values in `src/config/site.ts` are compiled into the bundle and the
prerender cache can serve a stale page: a rename once updated `/brands` while `/` kept the old name.
**Delete `.next` and rebuild**, then check the built HTML rather than trusting a
running server.
