# Deployment

Terraform provisions the AWS runtime around the scraper. It never performs a
crawl itself.

## What it creates

| Resource | Purpose |
| --- | --- |
| Lambda function | Runs the recurring catalog sync (and, on demand, discovery) |
| IAM roles + policies | Least-privilege access for the Lambda and the Scheduler |
| S3 bucket | Mirrored product images, crawl artifacts, diagnostic snapshots |
| EventBridge Scheduler | Recurring sync (default: every 6 hours) and a weekly discovery schedule (disabled) |
| SQS queue | Dead letter queue for undeliverable schedule invocations |
| CloudWatch log group | Structured JSON logs with configurable retention |
| CloudWatch alarms | Seven alarms, see below |
| SNS topic | Alarm fan-out, optionally to an email address |
| Secrets Manager secret | Holds `DATABASE_URL`; created empty unless you supply your own |

## Secrets

The database connection string is **never** committed and never placed in a
Lambda environment variable — those are readable by anyone with console access
to the function. Instead:

1. Terraform creates (or you supply) a Secrets Manager secret.
2. Its ARN is passed to the Lambda as `DATABASE_URL_SECRET_ARN`.
3. The handler resolves the secret at cold start and caches it for the life of
   the container.

Locally, `DATABASE_URL` is read straight from the environment and no AWS call
is made at all.

## Deploy

```bash
# 1. Build the Lambda bundle (writes infra/terraform/build/scraper-lambda.zip)
pnpm --filter @catalog/scraper build:lambda

# 2. Configure
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
$EDITOR terraform.tfvars

# 3. Review and apply
terraform init
terraform fmt -check -recursive
terraform validate
terraform plan
terraform apply
```

Then complete the checklist Terraform prints as the `post_apply_checklist`
output:

```bash
# Put the real connection string in the secret
aws secretsmanager put-secret-value \
  --secret-id "$(terraform output -raw database_url_secret_arn)" \
  --secret-string 'postgres://user:password@host:5432/db?sslmode=require'

# Apply migrations from somewhere that can reach the database
DATABASE_URL='postgres://...' pnpm db:migrate

# Trigger one dry run and read the result
aws lambda invoke \
  --function-name "$(terraform output -raw lambda_function_name)" \
  --payload '{"job":"sync","dryRun":true}' \
  --cli-binary-format raw-in-base64-out \
  out.json && cat out.json
```

## Why a single Lambda

The measured full sync of the ~110-product catalog takes about **7 seconds**
including image mirroring, and about **1 second** when nothing has changed.
That fits one invocation with two orders of magnitude of headroom, so there is
no SQS fan-out and no Step Functions state machine here — they would add
failure modes to a job that does not need them.

If the source ever grows enough to threaten the timeout, the evidence will
appear in the `DurationMs` metric. Introduce the smallest justified fan-out at
that point, not before.

`reserved_concurrent_executions = 1` keeps two syncs from overlapping: they
would race on the same rows and double the load on the source for no benefit.

## Alarms

All alarms publish to the SNS topic. Set `alarm_email` to receive them (you
must confirm the subscription by email).

| Alarm | Fires when |
| --- | --- |
| `lambda-errors` | The function raised an unhandled error |
| `lambda-throttles` | The function was throttled |
| `circuit-breaker-open` | Mass-removal protection refused a diff |
| `parser-confidence-low` | Parser confidence dropped — the source's HTML likely changed |
| `no-successful-sync` | No successful sync within `no_successful_sync_hours` |
| `image-failures` | Image mirroring failed repeatedly |
| `scheduler-dlq-not-empty` | The Scheduler could not invoke the function |

`no-successful-sync` treats missing data as breaching. That is deliberate: a
job that silently stops running produces no metrics at all, and it is the
failure mode most likely to go unnoticed.

## Metrics

Metrics are emitted as CloudWatch Embedded Metric Format log lines, so there is
no `PutMetricData` call, no extra latency, and no IAM permission needed for
metrics. Namespace: `CoffeeCatalogSync`, dimensioned by `SourceSite` and
`Job`.

## Failure recovery

**The circuit breaker opened.** The catalog was preserved and nothing was
removed. Read `circuit_breaker_reason` on the `sync_runs` row, then check
whether the source actually changed:

```sql
select started_at, status, discovered_count, circuit_breaker_reason, parser_confidence
from sync_runs order by started_at desc limit 5;
```

If the source genuinely shrank, raise `SYNC_BREAKER_MAX_DISAPPEARED_RATIO` for
one run, or let the missing counters climb naturally over the next few syncs.

**Parsers broke after a source redesign.** `catalog_source` on `sync_runs`
tells you which parser produced the catalog. A switch from `filter_init` to
`listing_html` means the structured blob disappeared. Rebuild the fixtures
(`node scripts/build-fixtures.mjs`), run the parser tests to see exactly what
changed, and adapt the parser.

**A bad deploy wrote wrong data.** `sync_changes` is append-only and holds the
before/after of every mutation, so any change can be reconstructed:

```sql
select created_at, change_type, source_key, changed_fields, before, after
from sync_changes order by created_at desc limit 50;
```

## Teardown

The assets bucket has versioning enabled, so `terraform destroy` will refuse
until it is emptied:

```bash
aws s3 rm "s3://$(terraform output -raw assets_bucket)" --recursive
terraform destroy
```
