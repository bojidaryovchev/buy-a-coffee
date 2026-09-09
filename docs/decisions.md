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

**Product copy is written, not synchronised.** For a while "original copy"
described the pages around the catalog but not the catalog itself: the sync
wrote the source's product descriptions straight into `description_text`, and
the storefront rendered them. That is the one duplication that actually costs
something. Both shops sell the same products, so identical descriptions put the
same paragraphs on two domains, and `description_text` feeds the visible copy,
the `<meta name="description">` and the Product JSON-LD at once — the three
fields a search engine compares. Neither site gains; the one judged to be the
copy loses.

So product copy now lives in [`apps/web/content/product-copy.ts`](../apps/web/content/product-copy.ts)
and is published into two override columns, `description_text_override` and
`description_html_override`. The shape is deliberately the same as the
retail-price layer: the source value stays where the sync put it, ours sits
beside it, and the storefront reads `coalesce(override, source)`. Writing the
rewrite *into* the source columns was the obvious alternative and it does not
survive — `upsertProduct` overwrites them on every `pnpm sync:catalog`, so the
copy would quietly revert on the next run.

Keeping both values also makes the check possible rather than merely claimed.
`pnpm check:originality` compares what we publish against what the crawler
observed and fails when too much of the source's phrasing survives, when a
product has no copy of its own, or when two of our own products share one
summary — the same duplication pointed inward. It reads the reference
artifacts, not the database, so it runs in CI where there is no catalog.

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

**Search folds both scripts into one canonical form before comparing.** Product
names mix Cyrillic and Latin in a single string and visitors type whichever is
under their fingers, so matching the two against each other pairwise does not
scale. Both the catalog and the query pass through `catalog_translit()` first,
and Latin is the canonical form for two reasons: transliteration only runs one
way without ambiguity (`щ` is always `sht`; `sht` could be `щ` or `шт`), and
Latin text folds to itself, so one folded column covers both alphabets instead
of two.

**Search uses three complementary strategies over that folded text.** A
generated `tsvector` with the `simple` configuration — the catalog is Bulgarian
and PostgreSQL ships no Bulgarian stemmer, so a language-specific configuration
would quietly do nothing useful — plus substring matching for partial words,
plus word similarity (`%>`) for misspellings. Word similarity rather than plain
`similarity()`, which scores a short term against the whole product name and so
cannot separate a typo from nonsense.

**The search predicate is defined once and shared.** The results page, the facet
counts and the typeahead all match with the same expression. A dropdown that
offers a product the results page then cannot find is worse than no dropdown.

**The typeahead is an upgrade to the form, not a replacement for it.** The field
stays a real `GET` form that works before hydration and without JavaScript; the
dropdown is layered on top. It was previously argued that a type-ahead was a
poor trade because ours queries a database rather than filtering an embedded
copy of the catalog in the browser. Debouncing, per-session caching and a
bounded, rate-limited endpoint make that trade a good one — and the images and
prices in the dropdown are worth more than the request they cost.

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

## The recommendation wizard

**Compatibility is the product, not taste.** Five mutually incompatible capsule
systems are stocked, and customers know their machine rather than their system —
"a Krups thing", not "Dolce Gusto". Closing that gap is the reason the wizard
exists; every other question is a refinement. So compatibility is asked first,
answered from our own machine database, and is the one thing the scorer will
never trade away.

**The machine database is ours, written by hand.** Nothing about compatibility
is scraped or inferred. A compatibility claim is a promise to a customer, so it
needs an owner who can be asked why — and a model is listed only when we know
which capsule it takes. Machines we cannot supply are listed too, pointing at an
explanation: someone with a Vertuo deserves a straight "nothing here fits it"
rather than a wizard that quietly runs out of answers.

**Hard rules exclude; soft scores rank.** There are only three hard rules —
compatibility, an explicit requirement, and decaf, which is excluded unless it
was asked for. Everything else is a weighted score that can never empty the
page. A preference nothing in the catalog satisfies costs the visitor a better
match, never a dead end.

**Nothing is relaxed in silence.** When a constraint cannot be met the page says
so in plain words and the card carries the specific warning — "съдържа кофеин"
on a caffeinated coffee shown to someone who asked for decaf, and equally "без
кофеин" the other way round. One system in this catalog holds a single product
and it happens to be decaffeinated, so this is not hypothetical.

**Three suggestions, each with its reasons.** One answer reads as a guess and
gives the visitor nothing to judge. The reason phrases are generated from the
criteria that actually contributed to the score, so a card cannot claim a match
the ranking did not make. A recommendation that cannot explain itself is a
filter wearing a costume.

**Questions are asked with concrete anchors, never abstract scales.** "Strong"
means high caffeine to one person and bitter to another. Each taste option is
described by a situation instead, which is what makes answers comparable
between visitors.

**Below five compatible products the questions are skipped.** Three of the
systems here hold three products each. Asking four questions to narrow three
items wastes the visitor's time and reads as a form for its own sake.

**Price is scored relative to the compatible pool, and there is no "premium"
option.** Beans run about EUR 0.09-0.16 a cup and capsules EUR 0.25-0.54, so a
fixed budget threshold would empty one system while telling capsule buyers
nothing. And with no ratings and no cupping scores there is no basis for
claiming a dearer coffee is a better one; the honest third choice is "price is
not the point".

**Price per cup is computed, shown, and derived from one constant.** Pack price
reverses the true ordering — 100 capsules at EUR 33.25 undercuts 16 at EUR 5.60
per cup. Servings come from the piece count where there is one and from weight
at `GRAMS_PER_SERVING` otherwise; anything derived from weight is marked
estimated and displayed as an approximation, because how much coffee a shot uses
is a property of the machine, not the bag. The constant lives in
`@catalog/shared` so the wizard cannot rank by a number the product page
contradicts.

**Answers live in the URL and the step is derived from them.** Same reasoning as
the catalog filters: shareable, bookmarkable, back-button-safe, and working with
JavaScript off. Deriving the step rather than storing a cursor means an edited
link can never land on a step that contradicts its own answers.

**Scoring is a pure function with no database, clock or randomness.** The same
reasoning as the diff engine and the circuit breaker: the logic that decides
something consequential is the logic that must be exhaustively testable, and
"why did it suggest that?" has to be answerable.

**A system binds to its categories by slug *and* source key.** The slug is
derived from the category's Bulgarian name and would change if the source
renamed it; the source key would not. A system that resolves to nothing is not
offered at all, so an upstream rename degrades to one fewer option rather than
to an empty result.

**The machine pages are indexed; the answered wizard is not.** "Which capsules
fit a Krups Piccolo" is a question people type, and it is answered from our own
stable data. Every answered permutation of the wizard is the same page with
different state, which is the filtered-listing problem again.

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
