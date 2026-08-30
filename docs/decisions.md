# Decisions

Every one of these exists because of something observed on the live source site.
The evidence is in [source-recon.md](source-recon.md); the crawler's own
observations are in [`reference/latest/`](../reference/latest).

---

## What this system is, and what it is not

**The storefront reads our database and our images, and never contacts the
source during a customer request.** That is the boundary the whole architecture
exists to hold. It is enforced twice rather than trusted: a source scan
(`pnpm check:originality`) fails on source branding or a source-domain image
host reaching the customer-facing app, and the end-to-end suite asserts it at
the browser level.

**This is functional equivalence, not a pixel clone.** Original visual identity,
original layout, original copy, original legal documents. No source logo, CSS,
JavaScript or markup is reproduced. What is reproduced is *capability*, and the
coverage matrix is generated rather than claimed —
[reference-coverage.md](reference-coverage.md) fails CI when the crawler
observes something the storefront does not implement and nobody has written down
why.

**Scope stops at the observed behaviour.** There is no cart, no checkout and no
payment, because the source storefront has none: ordering there is a phone
number and a callback. Building a checkout would be inventing a requirement the
reference artifacts do not support.

## Crawling

**Soft-404 detection is mandatory, not defensive.** The source answers unknown
routes with **HTTP 200 and the home-page shell**, and its own `sitemap.xml`
still lists 111 `/products/<slug>/` URLs that no longer exist. A crawler that
trusted status codes would ingest 111 phantom products. At startup we fetch a
deliberately impossible path, hash the response, and treat any non-root page
carrying that hash as not-found.

**The sitemap is a hint, never truth.** Every candidate URL is verified. Real
product pages live at the root — `/<slug>/` — not under the `/products/` prefix
the sitemap still advertises.

**Page type cannot be derived from the URL.** The URL space is flat: products,
categories and brands all live at `/<slug>/`. Classification uses DOM and
content signals, and records its evidence.

**Two independent catalog sources.** The primary is the site's own
`window.FILTER_INIT` blob on `/search/`; the fallback is the server-rendered
`.product-item` cards on category pages. If the blob disappears, sync keeps
working from HTML **and** parser confidence drops, which the circuit breaker
notices. One source would have been a single point of silent failure.

**HTTP first, no browser.** Plain `GET` returns full server-rendered HTML, so
Playwright is not used for crawling at all. Rates are conservative and bounded:
concurrency, minimum spacing, timeouts, retry backoff with jitter, redirect
limits and response-size caps.

## Identity and data

**Product identity is path + normalised pack size, not URL.**
`/borbone-crema-classica/` serves two genuinely different products — 0.500 kg at
€10.70 and 1 kg at €20.50 — and keying on URL would silently drop one on every
sync. Pack size is normalised (`1 кг.` and `1000 г` both become `1000g`) so a
notation change cannot fork one product into two. The same rule correctly
collapses an accidental duplicate in the source CMS, taking 111 raw records to
110 products.

`imageUrl` is unique across all 111 records and was **rejected** as identity:
re-uploading an image would silently recreate the product.

**Content hashes ignore volatile markup.** Cloudflare re-keys its email
obfuscation on every response. Without stripping those tokens before hashing,
every page would look changed on every crawl and change detection would be
worthless.

**Change detection is a semantic hash** over business-relevant fields only —
name, prices, currency, availability, brand, sorted categories, normalised
description, attributes and the image URL set. Timestamps, generated ids and
meaningless ordering are excluded, so an unchanged product hashes identically
forever and a repeat sync performs no writes.

**Price extraction is strict.** On a product page the price sits beside the pack
size: `<span>1 кг.</span><span>€30.00</span>`. A "contains a currency symbol"
test matches the *parent*, yielding `"1 кг. €30.00"`, which a money parser reads
as **€1.00**. Only elements whose entire text is a price qualify.

**Money never touches floating point.** Prices are parsed into exact decimals
backed by `BigInt` and stored as `numeric(12,2)`. They arrive in the storefront
as decimal strings and stay strings until the final `Intl.NumberFormat` call;
comparisons use integer minor units, because comparing decimal strings makes
`"9.00" > "10.00"` true and advertises a saving that does not exist.

**Nullable where the source is genuinely missing data.** Two products have no
price and one has no pack size — observed, not hypothetical — so price is
nullable and "Price on request" is a real render path, never `0.00`.

## Safety

**A product is never removed because of one bad request.** Absence increments a
counter; only three consecutive *successful* syncs with the product absent
promote it to `removed`, and reappearing resets the counter immediately.

**The circuit breaker judges before anything destructive is applied.** The run
order is: discover → diff → judge → apply. It refuses the destructive half of a
diff when more than 20% of active products would disappear at once, when
discovery returned less than 75% of the baseline, when a catalog entry page
failed, when parser confidence collapsed, or when discovery returned nothing.

When it opens, **creations and updates still apply** — those are additive and
safe — but nothing is marked missing or removed, the run is recorded as
`partial` with its reason, and an alarm fires.

**Baselines are only recorded from trusted runs**, so a string of bad runs
cannot slowly ratchet the bar down until mass removal starts to look normal.

**Removed products keep their URL.** The storefront serves a real page saying
the product is gone, with a route back into the catalog, rather than 404ing a
link that may already be indexed or bookmarked. That page is `noindex`, so it
stops attracting new traffic.

## Storefront

**Filtering, sorting and search run on the server.** The source filters a
fully-rendered list in the browser and searches an embedded copy of its whole
catalog. Ours query PostgreSQL, so filtered views are server-rendered,
shareable, bookmarkable and crawlable, and the entire catalog is not shipped to
every visitor. Every control is an ordinary link, so filtering works with
JavaScript off.

Filtered, sorted and paginated permutations are `noindex` and the canonical
always points at the clean first page.

**Pagination and sorting are additions, not omissions.** The source has neither
and renders every product at once.

**Search uses two complementary strategies.** A generated `tsvector` with the
`simple` configuration — the catalog is Bulgarian and PostgreSQL ships no
Bulgarian stemmer, so a language-specific configuration would quietly do nothing
useful — plus trigram similarity for partial and misspelled input, which is what
a search box actually receives and which works identically for Cyrillic and
Latin.

**A retail price layer sits alongside the source price.**
`retail_price_override` defaults to null, meaning "track the source price". A
value pins the retail price without touching the source value, so a markup rule
can still be derived from the original later.

**Quick order is a phone number and a callback**, matching the observed
behaviour. Rate limit → validate (including a honeypot) → persist → notify. The
record is safe in the database before any notification is attempted, so a
misconfigured email provider can never lose an order. Submissions are idempotent
within a five-minute window, keyed on phone and product, so a double-clicked
button cannot create two orders.

**No `aggregateRating`, no reviews** in the structured data. The shop has none,
and inventing them would be both a policy violation and a lie. `SearchAction` is
declared only because the search route genuinely exists.

## Infrastructure

**One Lambda, no fan-out.** A full sync of the ~110-product catalog takes about
**7 seconds** including image mirroring, and about **1 second** when nothing has
changed. That fits one invocation with two orders of magnitude of headroom, so
there is no SQS and no Step Functions — they would add failure modes to a job
that does not need them. If the source ever grows enough to threaten the
timeout, the evidence will appear in the `DurationMs` metric; introduce the
smallest justified fan-out at that point and not before.

`reserved_concurrent_executions = 1` keeps two syncs from overlapping: they
would race on the same rows and double the load on the source for no benefit.

**`DATABASE_URL` never sits in a Lambda environment variable**, which anyone
with console access can read. It lives in Secrets Manager and the handler
resolves it at cold start and caches it for the life of the container. Locally
it is read straight from the environment and no AWS call is made at all.

**Metrics are emitted as CloudWatch Embedded Metric Format log lines**, so there
is no `PutMetricData` call, no extra latency and no IAM permission needed for
metrics.

**`no-successful-sync` treats missing data as breaching.** A job that silently
stops running produces no metrics at all, and that is the failure mode most
likely to go unnoticed.

**Images are content-addressed and never hotlinked.** Fetch with bounded
concurrency, verify the type **by magic bytes rather than `content-type`**,
enforce a size cap, hash, deduplicate, store under a deterministic key. Old
objects are not deleted inline; `pnpm images:gc` is a separate, deliberate
command.

## Legal and operational boundaries

- **Public pages only**, available to an ordinary unauthenticated visitor. No
  authentication, CAPTCHA, paywall or bot protection is bypassed.
- **`robots.txt` is honoured**, including `Crawl-delay`. The source's own
  `robots.txt` is `Allow: /` with a single disallow for Cloudflare's email
  protection path.
- **No form is ever submitted.** The source's quick-order and newsletter flows
  create real orders and subscriptions for the source business. Discovery
  inspects their structure and their client code and stops there.
- **The source's third-party CMS tenant key is deliberately not copied** into
  this repository, though it is public in the source's markup, and it is
  redacted from the fixtures.
- **Scraped HTML is untrusted input.** Bodies are size-bounded, the structured
  catalog blob is parsed without `eval`, and stored description HTML is
  sanitised through a narrow allow-list before it ever reaches the DOM.
- **Source attribution is retained internally**; the source's branding, logo,
  CSS and code are not reproduced.

⚠ **One thing is asserted and not evidenced here.** The project brief states
that the business has a legitimate commercial relationship around this catalog.
Nothing in this repository records what that relationship is, and `robots.txt`
permission is not the same as permission under the source's terms of service.
If this is ever questioned, the answer has to come from the business rather than
from the code. See [launch.md](launch.md).
