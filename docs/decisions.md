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
JavaScript or markup is reproduced. What is reproduced is _capability_, and the
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
`description_html_override`. The source value stays where the sync put it and
ours sits beside it. Writing the rewrite _into_ the source columns was the
obvious alternative and it does not survive — `upsertProduct` overwrites them on
every `pnpm sync:catalog`, so the copy would quietly revert on the next run.

This was first built the same way as the retail-price layer, with the storefront
reading `coalesce(override, source)`. That was wrong, and it is no longer what
the code does: see "Override or generated" under [Product copy](#product-copy).

Keeping both values also makes the check possible rather than merely claimed.
`pnpm check:originality` compares what we publish against what the crawler
observed and fails when too much of the source's phrasing survives or when two
of our own products share one summary — the same duplication pointed inward. It
reads the reference artifacts, not the database, so it runs in CI where there is
no catalog.

**Scope stops at the observed behaviour.** There is no cart, no checkout and no
payment, because the source storefront has none: ordering there is a phone
number and a callback. Building a checkout would be inventing a requirement the
reference artifacts do not support.

## Crawling

**Not-found detection is mandatory, and it works both ways.** Until October
2026 the source answered unknown routes with **HTTP 200 and the home-page
shell**, and its `sitemap.xml` listed 111 `/products/<slug>/` URLs that no longer
existed; a crawler that trusted status codes would have ingested 111 phantom
products. It now answers with a real 404. Both behaviours stay supported,
because the source has shown both: at startup the fetcher probes one impossible
path, and a probe that comes back as a page is hashed and every later non-root
page carrying that hash is treated as not-found, while a probe that comes back
as an error means status codes are trusted for the rest of the run.

**The sitemap is a hint, never truth.** Every candidate URL is verified. Real
product pages live at the root — `/<slug>/` — not under the `/products/` prefix
the sitemap advertised until October 2026, and the sitemap still lists one dead
URL (`/marki/`).

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
collapsed an accidental duplicate in the August catalog, taking 111 raw records
to 110 products. (Since the October rename no URL serves two products, and the
rule is unchanged: it costs nothing and the source has done it before.)

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
test matches the _parent_, yielding `"1 кг. €30.00"`, which a money parser reads
as **€1.00**. Only elements whose entire text is a price qualify.

**Money never touches floating point.** Prices are parsed into exact decimals
backed by `BigInt` and stored as `numeric(12,2)`. They arrive in the storefront
as decimal strings and stay strings until the final `Intl.NumberFormat` call;
comparisons use integer minor units, because comparing decimal strings makes
`"9.00" > "10.00"` true and advertises a saving that does not exist.

**Nullable where the source is genuinely missing data.** Two products have no
price and one has no pack size — observed, not hypothetical — so price is
nullable and "Price on request" is a real render path, never `0.00`.

**Where the source states two pack sizes, the name's is the product's.** The
source types a pack size twice: at the end of the product's name and in a pack
field of its own. For one tin of pods the two disagree, 18 in the name and 100
in the field, and the price is the price of 18; dividing it by 100 printed a
price per cup about a sixth of the true one, on the figure this shop exists to
get right. The name is what the source's own customers read and order by, so it
is the one of the two that has been checked. The rule is one function
(`decidePackSize` in `@catalog/shared`) applied in the sync's normalisation, so
the stored size, the servings and every price per cup follow from one decision
and no reader had to change. Rejected: correcting it at display time, which
leaves the sort column and the card able to disagree; and a list of known
conflicts in a test, which cannot stop the next one arriving with a sync. A
conflict is therefore data on the product, written on every run, cleared when
the source corrects itself, and listed for the owner on the sync page.

Three edges of that rule are deliberate. Identity still comes from the pack
field as the source typed it: a key has to recognise the source's record, not
be right about coffee, and re-keying on a correction would move the product for
nothing. An empty pack field takes the name's size and raises no conflict,
because nothing was contradicted. And a multipack name ("2 x 250 г") is read as
stating no size, so the pack field stands: multiplying it out would raise
conflicts on a guess.

## Safety

**A product is never removed because of one bad request.** Absence increments a
counter; only three consecutive _successful_ syncs with the product absent
promote it to `removed`, and reappearing resets the counter immediately.

**The circuit breaker judges before anything destructive is applied.** The run
order is: discover → diff → judge → apply → enrich, and the last step cannot
change the outcome of the others. It refuses the destructive half of a
diff when more than 20% of active products would disappear at once, when
discovery returned less than 75% of the baseline, when a catalog entry page
failed, when parser confidence collapsed, or when discovery returned nothing.

When it opens, **creations, moves and updates still apply** — those are
additive and safe — but nothing is marked missing or removed, no brand or
category is hidden, no product page is read, the run is recorded as `partial`
with its reasons, and the CLI exits 2, which the scheduled workflow and the
storefront's sync-health alarm both report.

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
кофеин" the other way round. When this was built (the August catalog), one
system held a single product and it happened to be decaffeinated, so this is not
hypothetical.

**Three suggestions, each with its reasons.** One answer reads as a guess and
gives the visitor nothing to judge. The reason phrases are generated from the
criteria that actually contributed to the score, so a card cannot claim a match
the ranking did not make. A recommendation that cannot explain itself is a
filter wearing a costume.

**Questions are asked with concrete anchors, never abstract scales.** "Strong"
means high caffeine to one person and bitter to another. Each taste option is
described by a situation instead, which is what makes answers comparable
between visitors.

**Below five compatible products the questions are skipped.** When this was built, three of
the systems held three products each; A Modo Mio still holds three. Asking four questions to narrow three
items wastes the visitor's time and reads as a form for its own sake.

**Price is scored relative to the compatible pool, and there is no "premium"
option.** Beans run about EUR 0.09-0.16 a cup and capsules EUR 0.25-0.54, so a
fixed budget threshold would empty one system while telling capsule buyers
nothing. And with no ratings and no cupping scores there is no basis for
claiming a dearer coffee is a better one; the honest third choice is "price is
not the point".

**Price per cup is computed, shown, and derived from one function.** Pack price
reverses the true ordering — 100 capsules at EUR 33.25 undercuts 16 at EUR 5.60
per cup. Servings come from the piece count where there is one and from weight
at `GRAMS_PER_SERVING` otherwise; anything derived from weight is marked
estimated and displayed as an approximation, because how much coffee a shot uses
is a property of the machine, not the bag. The constant and
`packServings()` live in `@catalog/shared`, and the sync stores that function's
answer in `products.servings`, so a listing sorted by price per cup in SQL, the
wizard's ranking and the figure on the product page cannot contradict each
other.

**Answers live in the URL and the step is derived from them.** Same reasoning as
the catalog filters: shareable, bookmarkable, back-button-safe, and working with
JavaScript off. Deriving the step rather than storing a cursor means an edited
link can never land on a step that contradicts its own answers.

**Scoring is a pure function with no database, clock or randomness.** The same
reasoning as the diff engine and the circuit breaker: the logic that decides
something consequential is the logic that must be exhaustively testable, and
"why did it suggest that?" has to be answerable.

**A system binds to its categories by slug _and_ source key.** The slug is
derived from the category's Bulgarian name and would change if the source
renamed it; the source key would not. A system that resolves to nothing is not
offered at all, so an upstream rename degrades to one fewer option rather than
to an empty result.

**The machine pages are indexed; the answered wizard is not.** "Which capsules
fit a Krups Piccolo" is a question people type, and it is answered from our own
stable data. Every answered permutation of the wizard is the same page with
different state, which is the filtered-listing problem again.

## Infrastructure

The sync now runs as a scheduled GitHub Actions workflow (see [The scheduled
sync](#the-scheduled-sync) below). The decisions in this section are those of
`infra/terraform`, the documented alternative, and still hold for it.

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

## Following the source through renames

**Identity stays path + pack size, even now that a product code exists.** In
October 2026 the source began printing a code on every product page
(`Код: 00072`). It is not unique: two pairs of different products share one
today (two Rema Dolce Gusto capsules, and two different Lollo bean blends),
so keying on it would merge each pair into one row. And every row already had a
path-shaped key; switching to `sku:<code>` as each page happened to be read
would re-key the catalog a second time, piecemeal. So the code is stored on the
row and used as evidence, never as identity — `resolveProductIdentity` does not
accept one (`sku?: never`), so passing it is a compile error.

**A rename is a move, detected rather than guessed.** The same month the source
renamed almost every product URL, typically by adding a pack-size suffix. Only
21 of 110 rows still matched on identity, so the next sync would have created
about 166 products, left the old ones to go missing, and lost their slugs, copy,
price overrides and photographs with them. Move detection (`catalog/moves.ts`)
pairs a vanished product with a new one in passes: equal product code; then
brand + name + pack size; then name + pack size with the brand differing,
accepted only when the path stem agrees. Two different codes veto a pairing.

The rules lean one way because the two errors are not equal. A missed pair is a
duplicate a person can see and repair with `catalog:link`. A wrong pair silently
attaches one product's copy, slug and order history to another, and nobody is
told. So a pair is made only when it is the single reading the evidence allows:
a tie-breaking signal counts only when each side is the other's single best, two
signals that disagree pair nobody, and nothing is paired by elimination. The
rest is reported as unresolved and left alone. Rehearsed on a copy of the
production catalog, the real rename paired 86, created 79 and left 2 — products
whose name changed as well — for `catalog:link`; none was duplicated and none
lost, and a second sync changed nothing.

**The breaker counts disappearances after pairing.** Before pairing, a mass
rename is indistinguishable from a mass removal. Counted afterwards, a renamed
product is a move, and the breaker judges only what really vanished.

**Brands and categories match by the source's numeric id.** The source renames
their slugs too (`kapsuli` became `kafe-kapsuli`, `biancafe` became
`biancaffe`), and matched on slug each rename would insert a second row and
abandon the first with its indexed storefront slug. Unlike products, they carry
a stable id in the catalog blob, so the match is id first, slug second, with no
fingerprinting. One absent from a trusted run is hidden as `missing` and never
`removed`: hiding is the whole effect, the row and its slug are kept, and the
next listing that includes it brings it back.

**The two writers of a product row own disjoint columns.** The listing upsert
owns what the listing says; enrichment owns what only the product page says —
`sku`, `arabica_percent`, `origin`, `roast`, `characteristics` and the two
enrichment timestamps. Neither can undo the other, and a sync after enrichment
is a no-op. `characteristics` is a column of its own rather than more keys in
`attributes` because `attributes` is rewritten from the listing on every run and
feeds the semantic hash: facts stored there would be erased each run, or would
make every product look changed.

**Stated facts are stored only when stated unambiguously.** An arabica share is
kept when the page gives one clear figure; a hedged figure, a range or two
contradicting statements are null, and "100% робуста" is null rather than 0.
Robusta is never derived by subtraction. A null means "not stated", and the
wizard treats it as neutral.

**Enrichment is budgeted and cannot fail a sync.** Product pages are one request
each, so they are read sparingly: what this run changed, then what was never
read, up to 20 a run, through the same polite fetcher. A failure is recorded,
counted and retried after a day; five in a row stop reads for the run. It runs
after the outcome is settled and never on a run the breaker refused, because a
source serving something structurally wrong is not one to ask for more.

## Product copy

**Copy is keyed by our slug, not the source's key.** `copy:apply` used to match
entries on `source_key`. The rename changed every key, which would have orphaned
every entry at once. The slug is ours, allocated once and frozen, and a move
keeps it. (The one deliberate exception is `catalog:reslug`, after which
`copy:apply` is run again; see [Addresses and names](#addresses-and-names).)

**Override or generated, never the source.** The storefront first read
`coalesce(override, source)`, the shape of the price layer. A price may fall
back to the source's price, because a price is a fact; a description must not
fall back to the source's description, because that is the source's prose — and
every product the sync created shipped it until somebody wrote an entry. Now a
product without our copy shows one factual sentence composed from its own data
(`lib/catalog/fallback-copy.ts`) and no long description. The source's text is
still indexed for search, which decides what matches and renders nothing.

**Missing copy is a count, not a failure.** The sync adds products on the
source's schedule, not ours. If `check:originality` failed on a product without
copy, every new product would break the build until someone wrote for it, and
the pressure would be to write quickly rather than well. The generated sentence
is ours and is held to the same standard by its own test
(`test/fallback-copy.test.ts`), so a missing entry is unfinished, not wrong: the
check reports the count and `copy:todo` lists the products.

## Addresses and names

The measurements behind these are in [seo.md](seo.md); its last section lists
what was built from it.

**Every locale is prefixed, Bulgarian included, and English is built but
switched off.** A bare default beside prefixed siblings leaves `/kafe-kapsuli`
ambiguous between a page and a redirect to one, and search engines settle an
ambiguity by guessing. Prefixing from the start also means a second language
can be added without moving a URL. English is not shipped because its content
does not exist: a locale switched on before its copy publishes Bulgarian pages
under English addresses, which teaches a crawler they are duplicates. So the
gate is data (`LOCALE_READY`), and a locale that is off serves nothing and
appears in no `hreflang`, sitemap or switcher.

**The bare `/` is negotiated by `Accept-Language` alone.** A 307, because the
answer is per visitor. No cookie, because the Cookies page promises the shop
sets none and that promise is worth more than remembering a language. Nothing
geographic, because EU rules on geo-blocking forbid routing a visitor by where
they are, and because a crawler arriving from another country would be bounced
off the Bulgarian pages, which are the whole shop. For the same reasons nobody
is ever moved off the locale already in their URL.

**Every URL the shop used to serve answers 308.** The unprefixed English routes
were live and may be indexed, bookmarked or printed in a mail. Each goes to its
replacement in one hop, query string kept. They are not disallowed in
`robots.txt`: a crawler has to fetch a redirect to learn where it leads.

**The proxy decides a catalog 404, not the page.** In Next.js 16 a page-level
`notFound()` returns a 404 status over a document that is empty until
JavaScript runs. The only 404 rendered on the server is the global one, and
only routing can reach it, so the proxy asks the catalog whether a slug exists
before the route tree sees it. The cost is a cached list of slugs and one more
thing that must agree with the pages; it is bounded (five minutes, a reload on
a miss at most every 15 seconds) and it fails open, because a wrong 404 from a
failed lookup is worse than a blank one. Rejected: leaving it to `notFound()`,
which fails the "works without JavaScript" rule on exactly the pages a dead
link lands on.

**No route-level loading state.** There is no `loading.tsx` and no Suspense
boundary above a page, and none is to be added. Either lets Next send the shell
before the page has decided what it is, and after that a page cannot answer
with a status: the 308 for a product's previous slug, a brand's stored slug or
a category's stored slug, and the 404 for what does not exist, would each
become a 200 that JavaScript corrects. That is the defect the proxy's
existence check removes, arriving by another door. The pages are cached and
render whole, so a skeleton would cover very little waiting; the standard used
to ask for one per fetching segment and no longer does. Boundaries below the
page are fine, and the search field has one, whose fallback is a working form.

**The 404 is always Bulgarian.** It is one page for every URL and is not told
which was asked for; an honest fixed language beats a guessed one. This has to
be revisited when a second locale ships.

**A product's name on the storefront is the shop's own; the source's name is
for the owner.** The source's names are its shorthand ("DG", "Дозети"), which
nobody searches for, and printing them made every product page a reworded copy
of the source's. The name is rebuilt from data the catalog already holds —
brand, line, format from the category, pack size — by one pure function shared
by the sync and the storefront, because the sync derives a URL from the name
and a URL is frozen the moment it is published. The source's name is kept
untouched for the owner's side, who orders by it, and search matches both.
Rejected: a hand-written name per product, which the sync would outrun.

**A product slug is a function of the product, never of arrival order.** A
counter suffix makes the slug depend on which of two products was stored first,
and the shop has two databases that were filled in different orders and must
publish the same URLs, with the written copy keyed by them. So when products
share a base, every one of them takes a discriminator derived from its own
source key and nobody keeps the bare base. The sync applies the same rule to a
newcomer and never moves a product already stored; closing that gap is
`catalog:reslug`, which a person runs after reading its plan.

**Every address a product has had keeps redirecting, and is never reused.** The
products moved once, from the source's wording to the shop's, and the old
addresses are the ones search engines hold. They are stored on the row rather
than in a redirect table so they travel with the product and stay reserved.

**A brand is published at the slug it writes itself with.** The stored slug is
derived from the source's label and frozen (`lollocafe`); the brand calls
itself Lollo Caffè. Only the brands that differ are curated, the stored slug
answers 308, and everything internal keeps keying a brand by the stored slug
so no filter, logo or query had to change. Display names follow the brand's
own spelling where it was checked against its site and packs; Rema Caffè is
the one compromise, written as two words with a grave accent although the
brand's mark sets it as one word, because that is how Italian writes "caffè"
and how the product copy already wrote it.

**One doorway from a package into the app.** The sync allocates product URLs,
so it must know which first-level addresses the storefront has taken, and the
sync cannot depend on the web app. `packages/shared/src/storefront-data.ts`
imports the storefront's plain-data tables directly. Rejected: a second copy of
each table inside a package held equal by a test, which is wrong on the day
someone adds a route and has not yet run the test, and on that day the sync
could hand a product the URL of a page.

**A landing listing is a rule over the catalog, and exists only while it lists
something.** The four pages are not categories the source keeps, so each is a
pure selection in code. One answer (`LandingAvailability`) drives the page's
404, the sitemap, `llms.txt`, the footer and every cross-link, because a link
to a page that says "nothing here" is worse than no link, and five separate
checks would drift.

**"Cheapest" means the head of the per-cup sort, among what can be ordered.**
Three per system: enough to compare, few enough to be a shortlist. A sold-out
pack is left out, because calling something the cheapest way to drink coffee
when it cannot be ordered is a claim about nothing. Ties are broken as the
listing's own sort breaks them, so the page can never show an order the
listing contradicts.

**Decaf is what the record's flag says, never what the name says.** A name that
contains "Decaf" proves nothing, and a product without the word may still be
flagged. The flag selects more products than a count by name does; the page
lists what the data says, and the "Без кофеин" filter on every listing applies
the same test.

**The journal is called „Блог“ to customers.** „Дневник“ reads in Bulgaria as a
school register or a newspaper, and searches for it are for those. The code
keeps the word "journal"; only the label and the address changed.

**One title format, and the shop's name is printed "Buy a Coffee".** A bar
before the name, decided in one function, because the titles themselves use a
dash and a second one would read as a third clause. The name is written as
three words everywhere a customer or a search result shows it, as
`siteConfig.name` has it, not hyphenated as the study's examples were.

**One page owns each search term, and a test holds it.** Three consequences
that are easy to undo by accident:

- The Caffitaly listing's title does not say that its capsules fit Tchibo
  Cafissimo, although the study's own example does. That term belongs to the
  Tchibo machine page, and two titles carrying it would compete. The listing's
  description and introduction say it and link there.
- The brands index, not a journal article, owns „италиански марки кафе“. The
  study left the choice open and asked for one, not both; the index already
  lists the brands, so it says which are Italian, from recorded evidence.
- The Lavazza brand page does not repeat, in its row of system chips, a shelf
  its block of related pages already links: one destination, one link in a
  page's header.

**The promotions page answers 200 with nothing reduced, and is `noindex`
then.** A 404 would break every link to it the day the last reduction ends. It
leaves the sitemap, `llms.txt` and the navigation while it is empty and
returns by itself.

**A machine page links to the system's shelf, not to an answered wizard.**
Answered wizard states are disallowed in `robots.txt`, and a crawlable link to
a disallowed URL is wasted. The shelf is also where a visitor who now knows
their system wants to be.

## Design

The standard is [DESIGN.md](../DESIGN.md); these are the decisions in it that
are easiest to undo by accident.

**Gold, from the shop's own mark, is the single accent.** One gold control per
viewport, for the most important action, and never gold text on paper, where it
measures 2.85:1. An accent used twice is no longer an accent.

**Clay means a price went down, and nothing else.** Not a caution, not a brand
flourish, not a hover. A colour that means "reduced" only works if it never
means anything else; cautions have their own amber `caution` token.

**Each brewing system has a colour, and it never appears without the system's
name.** Customers shop by machine, so the system is the first thing a card says,
and colour makes it quick to scan. But colour alone excludes anyone who cannot
tell the hues apart, so a swatch, border or legend alone is never enough. The
colour is applied with `data-system`, because a class assembled from a runtime
id is a class Tailwind never generates.

**Intensity is shown on its own scale.** The source states it out of 5, 9, 10,
12 or 13 depending on the brand. Rescaling to one range would claim a precision
nobody has; showing the bare numeral would let a customer read "8" on two cards
as equally strong. So it is always "8 от 12", with the scale drawn.

**Packshots sit on pure white.** The photographs have white grounds; any tinted
well draws a rectangle around each one.

**A brand's logo appears only where the brand is the subject, and never marks
a system.** A logo is the brand's trademark, shown to identify the genuine
product: on the brand's page, the brands index, its own products. It is the
brand's own file, checked against the packs, with the provenance recorded, and
never recoloured; a logo published only in white sits on a dark tile. A system
is named in text by the system badge even where the system's owner is a brand
on sale, because a logo beside somebody else's compatible capsule would read
as an endorsement. Four brands have no usable logo and show their name.

**`@theme static`.** Tailwind normally emits only the theme variables some
utility uses. The system colours are reached only through `var()` from the
`[data-system]` rules, so without `static` they would not exist at runtime. The
token names are an interface: values change, names do not, and
`test/contrast.test.ts` measures the `DESIGN.md` contrast table against the
values.

**The announcement bar cannot be dismissed.** It carries the phone number and
the hours of a shop that takes orders by phone, a close button would move the
page under the reader, and remembering the choice needs state. It is absent
rather than empty when no free-delivery threshold is configured.

## Operations

<a id="the-scheduled-sync"></a>

**The scheduled sync is a GitHub Actions workflow, and its alarm lives in the
storefront.** The workflow needs no cloud account beyond the ones the project
already has, and its runs, logs and failures sit beside the code. Its weakness
is that GitHub disables a scheduled workflow after 60 days without repository
activity, silently, and a workflow cannot report its own absence; the production
catalog once went two months without a sync because the only thing watching it
was the thing that had stopped. So the watcher is the storefront's daily
`/api/cron/sync-health`, which compares the last successful sync with the clock
and keeps working when the workflow does not. `infra/terraform` stays as the
documented alternative until the workflow has run for 30 days, then goes.

**Images live in Vercel Blob.** Same platform as the storefront, one token, and
no second cloud account to provision and pay for. Object names equal the
content-addressed keys the sync already used, so a re-push is safe and a key
resolves the same on any store. The S3 driver and its Terraform remain.

**The rate limiter fails open for the public, closed for the panel.** Counters
live in PostgreSQL because on serverless an in-memory counter is one counter per
warm instance; a database was chosen over a Redis because it is already there.
When that table cannot be reached, a quick order, a contact message, a
subscription or a suggestion still goes through, on a per-process fallback:
losing a customer's order to the limiter's own outage would do more damage than
the abuse it exists to stop. Admin sign-in refuses instead, because there the
limiter is the security control — if it cannot count, it cannot bound guessing.
The global sign-in ceiling has an accepted cost: someone hammering the form from
many addresses keeps the operator out for as long as they keep it up.

**The CSP is static, and reports before it enforces.** A nonce-based policy
would make every page dynamically rendered, and this storefront's pages are
prerendered and revalidated on a timer; trading that for a stricter
`script-src` would make every product view a function invocation and a query.
The static policy allows inline scripts, for the framework's streamed payload,
and pins every source. It ships as `Content-Security-Policy-Report-Only` until
it has been watched on production.

**Retention reads the privacy policy as a ceiling.** The policy promises a
maximum, so the code deletes only what is certainly in scope and counts the
rest for a person to decide. Deleting an order's record cannot be undone;
keeping an unresolved enquiry a few weeks longer while someone is asked to
resolve it can be. So a fulfilled enquiry is never selected, an undecided one is
only counted, an open mail thread is never touched, and a contact message closed
before its closing date was recorded is measured from its creation — earlier
than its closing, so it can only go a little before its due date, never after.

**The deployed admin panel refuses a weak configuration rather than accepting
it.** On a deployment the panel is disabled unless the password has at least 12
characters and a separate session secret is set. A cookie signed with the
password itself is an offline oracle for guessing it, and the password could not
be rotated without signing everybody out. A panel that silently accepted that
would be the default nobody revisits.

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
