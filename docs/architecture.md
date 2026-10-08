# Architecture

How the storefront is built, as built. The crawler and sync side is described
in the [README](../README.md#how-synchronisation-works); the decisions behind
both are in [decisions.md](decisions.md); the visual standard is
[DESIGN.md](../DESIGN.md) and the voice is [PRODUCT.md](../PRODUCT.md).

The customer-facing shop reads the synchronised catalog and our own mirrored
images, and it never contacts the source site during a customer request.

## Source of truth

```
source site  ──▶  catalog sync  ──▶  PostgreSQL + object storage  ──▶  storefront
                  (scheduled workflow)                                 (this app)
```

Two artifacts define what this app must do:

- [`reference/latest/`](../reference/latest) — the crawler's observations:
  page types, route patterns, filters, forms, features and the catalog itself.
- The database schema in [`packages/db`](../packages/db) — the shape of the data.

`pnpm reference:coverage` checks the app against the first of those and fails
when the crawler has observed something the storefront does not implement and
nobody has written down why, or when
[`docs/reference-coverage.md`](./reference-coverage.md) is stale
(`pnpm reference:coverage:write` regenerates it).

## Local setup

See the [README](../README.md#local-setup). In short: `docker compose up -d`,
`pnpm db:migrate`, then `pnpm seed:reference` (the committed snapshot, offline)
or `pnpm sync:catalog` (the live source), then `pnpm dev` on
`http://localhost:3000`. `next dev` reads `apps/web/.env.local`; copy it from
`apps/web/.env.example`. Nothing in that file is required for local
development.

`pnpm seed:dev` writes six invented products under a `seed-dev` source key
instead, for work that needs no real catalog.

## Routes

| Route                                       | Purpose                                                                                                                      |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `/`                                         | Home. Every section is data-driven and disappears when there is nothing behind it                                            |
| `/categories`                               | Category index with live counts                                                                                              |
| `/categories/[slug]`                        | Category listing. Parent categories include their children's products. A business section's category answers 308 to its page |
| `/brands`                                   | Brand index. Brands with no stock are listed but not linked                                                                  |
| `/brands/[slug]`                            | Brand listing, with a summary of formats and systems computed from the catalog                                               |
| `/products/[slug]`                          | Product detail: gallery, facts table, compatibility, the order panel (`#order`), related products                            |
| `/promotions`                               | Products with a genuine reduction                                                                                            |
| `/search`                                   | Server-side search over PostgreSQL                                                                                           |
| `/vending`, `/consumables`                  | The two business sections. Prose of ours around whatever the catalog files under them; an enquiry form                       |
| `/delivery`                                 | Delivery, payment and returns, from the same sentence builders as the terms                                                  |
| `/wizard`                                   | Recommendation wizard. One question per URL, step derived from the answers                                                   |
| `/wizard/result`                            | The recommendation, with the reasons behind each pick                                                                        |
| `/wizard/machines`                          | Machine brands, and how to recognise each capsule system (with drawings)                                                     |
| `/wizard/machines/[brand]`                  | Every model of one brand, grouped by the system it takes                                                                     |
| `/journal`, `/journal/[slug]`               | The journal: four articles as typed content in `apps/web/content/journal/`                                                   |
| `/contact`                                  | Contact details and message form                                                                                             |
| `/newsletter/unsubscribe`                   | Tokenised unsubscribe. GET confirms, POST unsubscribes                                                                       |
| `/privacy`, `/terms`, `/cookies`            | Legal documents written for this business                                                                                    |
| `/sitemap.xml`, `/robots.txt`               | Generated from the live catalog                                                                                              |
| `/llms.txt`                                 | A plain-language map of the shop, generated from the catalog; closed whenever `robots.txt` is                                |
| `/opengraph-image`, `/manifest.webmanifest` | The default share card and the web app manifest                                                                              |
| `/media/[...key]`                           | Development-only local image serving; refuses everything once an image host is configured                                    |
| `/admin`                                    | Panel index: what is waiting                                                                                                 |
| `/admin/vhod`                               | Password sign-in. Outside the panel group, which would otherwise redirect it                                                 |
| `/admin/zayavki`, `/[id]`                   | Order enquiries. Phone number on the list, because dialling it is the next move                                              |
| `/admin/sabshteniya`, `/[id]`               | Contact-form messages                                                                                                        |
| `/admin/poshta`, `/[id]`                    | The `info@` mailbox: inbound threads, answered as the shop                                                                   |
| `/admin/poshta/fail/[messageId]/[index]`    | An attachment, streamed through the session                                                                                  |
| `/admin/byuletin`                           | Newsletter subscribers and their consent records. A list and an unsubscribe, and deliberately not a sender                   |
| `/admin/sinhron`                            | Is the catalog current, and if not, why                                                                                      |
| `/api/inbound`                              | Resend `email.received` webhook                                                                                              |
| `/api/search/suggest`                       | The typeahead                                                                                                                |
| `/api/cron/sync-health`                     | Daily sync alarm (Vercel cron)                                                                                               |
| `/api/cron/retention`                       | Daily retention deletion (Vercel cron)                                                                                       |

**Two route groups, no URL change.** `src/app/(site)/` holds the shop and
`src/app/(admin)/` the panel; a group name in parentheses is not part of any
path. The split exists so the admin does not inherit the storefront layout — the
shop layout reads the category tree on every render to build the navigation, and
its `robots` metadata declares the page indexable. `app/layout.tsx` above both is
deliberately almost empty: `<html>`, `<body>`, the fonts, the stylesheet and the
measurement scripts.

**Navigation is built once per render**, by `buildNavigation()` in
`components/layout/navigation.ts`, from the category tree the layout already
loads. The rail, the drawer and the footer draw the same structure, organised
by brewing system (from `BREWING_SYSTEMS`), then "Намери по машина", then the
business sections. A category whose key is a business section is never listed
as a category. "Промоции" is linked only while a reduction exists.

## Catalog queries

All catalog reads live in
[`src/lib/catalog/queries.ts`](../apps/web/src/lib/catalog/queries.ts); the home
page's and the journal's own reads sit beside it in `home-queries.ts` and
`journal-queries.ts`.

Rules that hold throughout:

- Only `status = 'active'` products are listed. `missing` products are hidden
  while the sync is unsure about them, and `removed` products are gone.
- The displayed price is `retail_price_override ?? current_price`.
- The displayed description is **our override, or a sentence generated from our
  own data — never the source's text.** `description_text` and
  `description_html` are not selected anywhere in the file. When the override is
  null, `publishedSummary` in
  [`lib/catalog/fallback-copy.ts`](../apps/web/src/lib/catalog/fallback-copy.ts)
  composes one factual sentence from the product's brand, format, pack and
  attributes, and there is no long description at all. Every reader — product
  page, metadata, JSON-LD, cards, the wizard — goes through `toCard` or
  `getProductBySlug`, so this is a single decision.
- The one place the source's text is still read is the generated
  `search_vector` column, which indexes `coalesce(override, source)`. That
  decides which products _match_ a query; nothing from it is rendered.
- Price per cup is sorted in SQL: the retail price over the `servings` column the
  sync stores, both `numeric`, so the division is exact. No price or no known
  pack size sorts last.
- Everything is parameterised through Drizzle.
- Listings load products, images and facets in a bounded number of round trips.
  There is no per-product query anywhere.

### One trap worth knowing about

Drizzle table-qualifies column references in a `WHERE` clause but **not** inside
a subquery in the select list. A correlated subquery written as
`where pc.category_id = ${categories.id}` renders as a bare `"id"`, which
PostgreSQL then resolves against the subquery's own table. The query runs, no
error is raised, and every count comes back zero.

Counts are therefore computed with separate grouped queries and merged in
application code, and where an outer reference inside a subquery is unavoidable
it is written as bare SQL with a comment saying why.

## Pricing

Source prices are owned by the sync and never edited by the storefront. A
`retail_price_override` column sits alongside them:

- `null` (the default) means "track the source price" — the same price the
  source charges.
- A value pins the retail price without touching the source value, so a markup
  rule can still be derived from the original later.

Money is exact from end to end. Prices arrive from PostgreSQL as decimal
strings and stay strings until the final `Intl.NumberFormat` call. Comparisons
use integer minor units — comparing decimal strings would make `"9.00" > "10.00"`
true and advertise a saving that does not exist.

Products with no price render "Цена при запитване", never `0,00 €`.

**Price per cup** is shown on every card and product page. Servings come from
the piece count where there is one, and from weight at `GRAMS_PER_SERVING`
otherwise, in [`@catalog/shared/serving`](../packages/shared/src/serving.ts);
anything derived from weight is marked estimated and shown as an approximation.
The sync stores the same function's answer in `products.servings` for sorting,
so the order of a listing and the figure on a card cannot disagree.

## Filters, sorting and pagination

Filter state lives entirely in the URL, parsed and validated by
[`lib/catalog/filters.ts`](../apps/web/src/lib/catalog/filters.ts):

| Parameter  | Values                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| `system`   | Brewing system ids from `BREWING_SYSTEMS`, comma-separated. Ours; the source has no notion of a system        |
| `brand`    | Brand slugs, comma-separated                                                                                  |
| `strength` | The intensity band: `weak`, `medium`, `strong`. Never the raw numeral, which the source states on five scales |
| `decaf`    | `yes` or `no`                                                                                                 |
| `aromas`   | `yes` or `no`                                                                                                 |
| `category` | Category slugs, comma-separated                                                                               |
| `sort`     | `relevance`, `price-per-cup`, `price-asc`, `price-desc`, `newest`, `name-asc`, `name-desc`                    |
| `page`     | 1–500, 24 per page                                                                                            |

`brand`, `strength`, `decaf` and `aromas` keep the names and multi-value
semantics the source uses. A malformed parameter degrades to its default rather
than producing an error page. Every sort ends on `products.id`, so two products
with the same price and name cannot swap between requests and appear on two
pages or none.

Facets are counted against the scope (category, brand or promotions) and the
search term but not against the selected filters, so a visitor can always reach
the other options. They use the same search predicate as the results, brand-name
match included; the system counts use the very predicate the `system` filter
applies, so a count is by construction the number of results that filter
returns.

Every control is an ordinary link, so filtering works without JavaScript, each
view is shareable and bookmarkable, and the back button behaves. Selected
filters are repeated as chips with a remove link each. On a phone the filters
sit in a `<details>` disclosure. Filtered, sorted and paginated permutations are
`noindex`, and the canonical tag always points at the clean first page.

## Product availability and removal

The sync owns reconciliation; the storefront just respects it.

| State                  | Behaviour                                                                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `active`, in stock     | Listed, orderable                                                                                                                                  |
| `active`, out of stock | Listed with an availability badge. The card links to the page instead of offering quick order; the page shows the phone number instead of the form |
| `missing`              | Hidden from listings. The sync is unsure, so we do not advertise it                                                                                |
| `removed`              | Hidden from listings. The URL still resolves to a page explaining that the product is gone, with a route back into the catalog                     |

A removed product returns a real page rather than a 404 because its URL may
already be indexed or bookmarked, and a dead end helps nobody. That page is
`noindex`, so it stops attracting new search traffic.

## The product page

Facts first, then the order. The facts table
([`components/catalog/facts-table.tsx`](../apps/web/src/components/catalog/facts-table.tsx))
lists system, intensity on its own scale, composition, origin, roast, caffeine,
flavouring, pack, price per cup, price per kilogram or litre, the product code
and the category — each row only when the data holds it. Composition, origin,
roast and the code come from the sync's enrichment step and are null for a
product whose page has not been read or did not state them.

A capsule or pod product names the machines it fits: the system's own
recognition sentence and up to 12 models (`COMPATIBLE_MACHINE_LIMIT`) from the
hand-written machine database, each linking to its maker's page in the machine
finder. Related products are restricted to the same brewing system: "same
brand" once put a Dolce Gusto capsule under a Nespresso one.

## Search

Product names mix both alphabets in one string — "Капсули Nespresso Rema Caffè
Cookies" — and nobody switches keyboard layout mid-search. So every comparison
folds both the catalog and the query into one canonical form first, using the
`catalog_translit()` SQL function: `rema` finds „Рема", `рема` finds „Rema".

Latin is the canonical form because transliteration only runs one way without
ambiguity — `щ` is always `sht`, but `sht` could be `щ` or `шт` — and because
Latin text folds to itself, so one folded column serves both scripts. The
function is a character-for-character copy of `transliterate()` in
`@catalog/shared`, which is what keeps a product's slug and its search entry
describing the same word; `packages/shared/test/text.test.ts` pins the mapping.

Before folding, the term is expanded by
[`lib/catalog/search-synonyms.ts`](../apps/web/src/lib/catalog/search-synonyms.ts):
a hand-maintained list of how Bulgarians spell brand and system names, each
mapped to the form the catalog writes („лаваца" → `lavazza`, "Dolce Gusto" →
`DG`). Expansion only adds alternatives — the typed term is always one of them —
and every alternative goes through the same comparisons. „или" is deliberately
not an Illy synonym: it is also the word "or", and would turn "кафе или чай" into
an Illy search.

Over that folded text, three complementary strategies:

- a generated `tsvector` over name, product code, pack size and description,
  with the `simple` configuration — the catalog is Bulgarian and PostgreSQL ships
  no Bulgarian stemmer, so a language-specific configuration would quietly do
  nothing useful;
- substring matching for partial words ("lavaz", „капсул"), which full text
  cannot do;
- word similarity (`%>`) for misspellings, which neither of the others can do.
  Not plain `similarity()`: that scores the term against the _whole_ name, so
  "lavaza" against „Кафе на зърна Lavazza Crema E Aroma 1кг." lands at 0.15,
  below any threshold that also rejects nonsense. `%>` scores against the best
  matching run of words instead, putting that typo at 0.71 while "zzzzqqqq"
  stays at 0.14.

A match on the brand name counts too, so searching a brand finds its whole
range and not only the products that repeat the brand in their own name. All of
it is indexed. Queries are length-bounded (80 characters) and parameterised, and
`%` and `_` are escaped before they reach a `LIKE` pattern.

The predicate is defined once, in
[`lib/catalog/search.ts`](../apps/web/src/lib/catalog/search.ts), and shared by
the results page, the facet counts and the typeahead — so the dropdown can never
suggest a product the results page then fails to find.

### Typeahead

`/api/search/suggest` is the one place the storefront serves catalog JSON. It
returns products with their images, prices and system badges, matching brands
and categories, and the total, so the dropdown can offer "виж всички N
резултата".

It exists because a debounced keystroke handler cannot call a server action
without queueing behind the router. It is rate limited (60 a minute per client)
and its term is bounded; it exposes nothing that is not already on the results
page.

The field itself is still a real `GET` form and still works with no JavaScript
at all — the dropdown is layered on top, never in the way. Requests are
debounced, cancelled when the term moves on, and cached per session so
backspacing through a word asks the database nothing new. (Cancelled requests
make Next log `The destination stream closed early`; that is the abort working,
not a fault.)

Known limitation: folding handles transliteration, not phonetic spelling, and the
synonym list closes that gap for every brand and system the catalog carries. A
spelling that is not in the list is still not found. The list should grow from
what visitors actually type.

## Quick order

There is no cart and no checkout, because the source has neither. Ordering is
a phone number and a callback.

**Where the form lives.** Every product page has one order panel, `#order`,
holding the form and the delivery and payment terms it is ordered on; on a phone
the terms come first, so they are read before the number is typed. A product
card's "Бърза поръчка" is a link to `/products/<slug>#order`. With JavaScript, a
plain click instead opens the same form in a native `<dialog>`
([`components/catalog/quick-order-dialog.tsx`](../apps/web/src/components/catalog/quick-order-dialog.tsx)),
fetched the first time any card's control is used and mounted for one product
at a time, so a listing of 24 cards ships 24 small links and no copy of the form.
`showModal()` gives the inert background, Escape and the top layer for free, and
focus returns to the card's link on close.

**The server side** ([`lib/forms/actions.ts`](../apps/web/src/lib/forms/actions.ts)):
rate limit → validate (including a honeypot) → persist → notify. The record is
safe in the database before any notification is attempted, so a misconfigured
email provider can never lose an order. Submissions are idempotent within a
five-minute window, keyed on the phone number and product, so a double-clicked
button cannot create two orders.

**The confirmation says when to expect the call.** It is built on the server at
the moment of submission from `siteConfig.commerce.openingHours`, read as wall
time in Europe/Sofia
([`lib/forms/callback-window.ts`](../apps/web/src/lib/forms/callback-window.ts)):
a day — "днес", "утре", "в понеделник" — plus "в работно време", with the hours
printed beside it. It never names an hour for the call, because the shop has
committed to when it is open, not to when it will ring back. The honeypot branch
returns the same text, so a bot sees what a person sees.

**Consent.** The quick-order and contact forms carry an unticked newsletter
checkbox. Ticking it records the subscription with its consent source
([`lib/forms/consent.ts`](../apps/web/src/lib/forms/consent.ts)); leaving it
unticked records nothing.

Notifications go through
[`src/lib/notifications.ts`](../apps/web/src/lib/notifications.ts). The provider
is chosen by configuration: with `RESEND_API_KEY` and `MAIL_TO` both set the
notification is emailed, otherwise a redacted line goes to the log. The record is
stored either way. `setNotificationSink` remains, as an override for tests.

**The notification carries a link, not the customer.** Subject, one-line summary
and a URL into the panel — never the phone number or the email. Those stay in
the record behind the panel password.

## Commercial terms

Delivery fee, free-delivery threshold, delivery time, couriers, payment methods,
return window, who pays return shipping and opening hours are configuration,
`siteConfig.commerce` in `src/config/site.ts`, not copy. The sentences built from
them live once, in
[`components/commerce/terms.ts`](../apps/web/src/components/commerce/terms.ts),
and feed the announcement bar, the order panel, `/delivery`, the delivery,
payment and withdrawal sections of the terms, and `/llms.txt`. **An unset term
is omitted everywhere, never invented.** `commerce.confirmedByOwner` stays false
until the business has confirmed the values; until then the shipping and return
policies are left out of the Product JSON-LD, and `pnpm check:launch` fails on
it, on every unset required term, and on every draft marker (`ЗА ПРЕГЛЕД`) that
would render on a legal page.

The announcement bar exists to carry the free-delivery promise. With no
threshold configured it is absent, and the header shows the phone number
instead. It cannot be dismissed: it carries the phone and the hours, and a close
button would move the page.

## The admin panel

Everything the forms collect was write-only until this existed: rows went into
Postgres and nothing in the application could read them back.

`/admin` is one password (`ADMIN_PASSWORD`) and an HMAC-signed session cookie
that lasts 12 hours, signed with `ADMIN_SESSION_SECRET` — one shop, one
operator, no users table. **With no password set the panel is disabled rather
than defaulted**, because a shipped default is worse than no panel on a screen
that reads every customer's phone number and can send mail over the shop's DKIM
signature. Every server action re-checks the session: the layout's redirect is a
rendering decision, and an action id in a client bundle can be POSTed to
directly.

**The production gate** ([`lib/auth.ts`](../apps/web/src/lib/auth.ts)). On a
deployment — `VERCEL_ENV` is `production` or `preview`, or, off Vercel,
`NEXT_PUBLIC_ENVIRONMENT` is `production` — the panel also stays disabled unless
the password is at least 12 characters and `ADMIN_SESSION_SECRET` is set and
different from it. The disabled screen names which of those is wrong, never a
value.

**Sign-in limits** ([`lib/sign-in-guard.ts`](../apps/web/src/lib/sign-in-guard.ts)),
all counted in the shared rate-limit table so they hold across serverless
instances:

- at most 5 attempts a minute per client, counted before the password is read;
- from the fourth wrong password, a lock that doubles from 30 seconds up to
  15 minutes, during which nothing from that client is evaluated;
- a global ceiling of 20 password evaluations per 15 minutes across all clients.

A refused attempt is refused before the password is compared, so a correct
password during a lockout waits it out and the answer cannot be used to test a
guess. Every store error refuses. The cost, accepted on purpose: someone
hammering the form from many addresses can keep the operator out while they keep
it up.

**The sync page** (`/admin/sinhron`) asks the same pure question as the daily
alarm (`evaluateSyncHealth` in `lib/sync-health.ts`), so the email and the screen
cannot disagree about whether something is wrong. It lists recent runs; the
selected run travels in `?run=`, so the page works without JavaScript.

**The newsletter.** `/admin/byuletin` lists subscribers with how and when each
agreed, and unsubscribes by stamping a date rather than deleting the row, so the
consent record survives. An enquiry is not consent to marketing, so adding the
sender of an enquiry or message to the list requires the operator to say how
the person agreed (by phone, by email, in person); that answer is stored as the
consent source and a missing one is refused. An address that unsubscribed is not
put back from the panel. Unsubscribing from a mail link goes through
`/newsletter/unsubscribe?token=…`: a GET only shows what would happen, because
mail scanners open every link; the button is a POST. The page sends a
`same-origin` referrer policy so the token is not handed to anything off the
site — not `no-referrer`, which makes the browser send `Origin: null` and Next.js
refuse the server action. There is still no sender, deliberately.

## The mailbox

`/api/inbound` receives Resend's `email.received` webhook, verifies the svix
signature over the **raw** request body, and then does two things in a fixed
order. It **records** the message — so the conversation can be answered from the
panel and leave as the shop's own address — and then **forwards** a copy to
`MAIL_TO`, because a panel nobody has open notifies nobody.

Recording first is the whole design. A forward that fails costs a notification;
a record that never happens costs the conversation. Only a failed record is
answered with a 500, which is what makes Resend retry.

**Only this shop's mail is recorded.** The mail account holds several domains
and fires the webhook for all of them. Before recording, the handler checks the
event's `to`, `cc`, `bcc` and `received_for` against the shop's mail domain
(derived from `MAIL_FROM`, in `lib/mail/identity.ts`), and answers a 200 without
recording anything addressed elsewhere; mail from our own domain is not recorded
either. The address parsing is in
[`lib/mail/recipients.ts`](../apps/web/src/lib/mail/recipients.ts), with no
imports, so it is tested with plain strings. `pnpm --filter @catalog/web
mail:prune-foreign` clears threads stored before the filter existed: plan only
by default, `--export <file>` writes the rows to a file you name, `--apply`
deletes in one transaction. Only the `to` header was ever stored, so a message
that reached the shop as a Bcc looks foreign; read the plan before applying.

Threading is by `References`/`In-Reply-To` first, then by correspondent plus
normalised subject. The string half lives in
[`lib/mail/threading.ts`](../apps/web/src/lib/mail/threading.ts) with no imports,
so it can be tested without a database.

Answering an order enquiry or a contact message opens an ordinary mailbox thread
keyed on a reproducible subject — `Вашата заявка A1B2C3D4` — which is how the
customer's reply finds its way back to the same conversation. There is no column
linking a record to a thread, and deliberately so: the subject is the join, and
it survives a round trip through any mail client. The recipient is read off the
stored row, never off the form.

Attachment bytes stay in Resend. `/admin/poshta/fail/[messageId]/[index]` asks
for a fresh signed URL per click and streams it through the session, so no
bearer URL is ever put in the page.

**Retention** ([`lib/retention.ts`](../apps/web/src/lib/retention.ts), run daily
by `/api/cron/retention`) deletes what the privacy policy says is no longer
kept, and reads that policy conservatively: a row is deleted only when it is
certain to be in scope. Order enquiries marked cancelled or spam go 12 months
after `created_at`; a fulfilled one is never selected, and an undecided one
(`new`, `contacted`) is only counted, because it may still be an order. Contact
messages go 12 months after `closed_at`, or `created_at` for those closed before
the column existed. Mailbox threads marked `done` go 12 months after their last
message, with their messages; an open thread is never selected.

## The recommendation wizard

Four questions, then three suggestions with the reasons behind each. The
decisions behind it are in [decisions.md](decisions.md#the-recommendation-wizard);
this is how it is put together.

```
answers in the URL ──▶ hard rules (compatibility, requirements) ──▶ soft scores ──▶ 3 picks + reasons
                              │                                                          │
                        machine database                                  price per cup, pack fit,
                       (our own, checked in)                              strength, intensity,
                                                                          stated composition and roast
```

| Module                                                                                             | Responsibility                                                       |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| [`lib/recommend/systems.ts`](../apps/web/src/lib/recommend/systems.ts)                             | The brewing systems, and the ones we deliberately do not stock       |
| [`content/machines.ts`](../apps/web/src/content/machines.ts)                                       | Machine brand → model → system. Editorial data, written by hand      |
| [`lib/recommend/answers.ts`](../apps/web/src/lib/recommend/answers.ts)                             | The questions, URL parsing and serialisation, and the step machine   |
| [`lib/recommend/score.ts`](../apps/web/src/lib/recommend/score.ts)                                 | Ranking. Pure: no database, no clock, no randomness                  |
| [`lib/recommend/facts.ts`](../apps/web/src/lib/recommend/facts.ts)                                 | Stated arabica share and roast as soft evidence for the taste answer |
| [`lib/recommend/summary.ts`](../apps/web/src/lib/recommend/summary.ts)                             | The answer chips, and what clearing an answer implies                |
| [`@catalog/shared/serving`](../packages/shared/src/serving.ts)                                     | Servings per pack and price per serving, in exact decimals           |
| [`components/wizard/capsule-diagrams.tsx`](../apps/web/src/components/wizard/capsule-diagrams.tsx) | The "recognise your capsule" drawings                                |

Two queries serve the whole flow, both in `queries.ts` with everything else:
`getSystemAvailability()` counts products per system in one round trip — it is
what hides an empty system and what triggers the short-circuit — and
`listRecommendationCandidates()` loads a system's whole compatible set, since
the scorer ranks products against each other and scores price against the
pool's own range.

**Stated facts are soft, signed evidence.** Where the product page states an
arabica share or a roast, `facts.ts` scores it around a neutral midpoint: a
supporting fact adds, a contradicting fact subtracts, and an absent fact
contributes exactly 0, so a product the source did not describe is never marked
down for it. Only the "mild" taste reads the arabica share; "mild" and "intense"
read the roast; origin is never scored. The weights are small enough that both
facts together cannot outweigh one step of the strength answer the visitor was
actually asked.

**The capsule drawings** are our own schematic line drawings — a side profile,
and a top view where the outline separates two systems — on one shared scale,
so relative size is information. A dimension is printed only where the
repository already states it; the other proportions are approximate, and no
logo or marking is drawn.

### What it will not do

- **It will not recommend something that does not fit.** Compatibility is a
  filter, never a weight.
- **It will not return an empty page.** Constraints are relaxed one at a time,
  least meaningful first.
- **It will not relax one quietly.** The page states it and the card carries the
  specific warning.
- **It will not need JavaScript.** Every control is a link; an end-to-end test
  drives the flow with scripting disabled.

## Images

Product images are mirrored by the sync into our own object storage, under
content-addressed keys, and the database stores the **key**, not an absolute URL.
[`lib/catalog/images.ts`](../apps/web/src/lib/catalog/images.ts) resolves a key
against `NEXT_PUBLIC_IMAGE_BASE_URL`, which must equal the sync's
`STORAGE_PUBLIC_BASE_URL`; the same value builds `images.remotePatterns` and the
CSP, so it is read at build time and a change needs a redeploy.

- With an image host configured, keys resolve to it, and any stored absolute URL
  on another host — the source's above all — is rejected.
- With none, development serves keys through `/media/[...key]` from the local
  storage directory. A deployed host (Vercel sets `VERCEL`) has no such disk, so
  there it shows the placeholder instead of a URL that would 404.
- Every product photo is drawn by
  [`ProductImage`](../apps/web/src/components/catalog/product-image.tsx), which
  swaps to the placeholder if the file fails to load — before hydration too — so
  the browser's broken-image icon never appears. Placeholders are never offered
  as a product's image in JSON-LD or Open Graph.

The sync has three storage drivers (`packages/scraper-core/src/storage/driver.ts`):
`local`, `s3` and `vercel-blob`, the one production uses. Moving between stores
is `pnpm images:push --from <driver> --to <driver>` (plan, then `--apply`),
checked by `pnpm images:verify --http`.

## Crons and region

`apps/web/vercel.json` pins functions to `fra1`, next to the database in
`eu-central-1`, and schedules two daily crons. Both answer 404 unless the request
carries `Authorization: Bearer <CRON_SECRET>` — no secret configured means the
route does not exist ([`lib/cron-auth.ts`](../apps/web/src/lib/cron-auth.ts)).

- **`/api/cron/sync-health`** (07:15 UTC). The sync runs outside the storefront,
  and once stopped for two months without anyone noticing, because the only
  thing watching it was the thing that had stopped. This route judges the
  `sync_runs` rows: no success within two six-hour intervals plus two hours of
  slack, the latest run failed or partial, the breaker open, the HTML fallback
  carrying the catalog, parser confidence below 0.9, image failures. Each
  condition alerts at most once per UTC day, through `notify()` with kind
  `sync_alert`, claimed in `sync_alerts`. Runs written by `catalog:link` are
  bookkeeping, not syncs, and are ignored.
- **`/api/cron/retention`** (03:40 UTC). See [the mailbox](#the-mailbox). The
  response carries counts and nothing else.

## Rate limiting

[`lib/rate-limit.ts`](../apps/web/src/lib/rate-limit.ts) is a fixed-window
counter over a pluggable store. With a database configured the store is
PostgreSQL (`rate_limit_buckets`, one atomic upsert per hit, with bounded
cleanup of expired rows), because a counter held in memory on serverless is one
counter per warm instance. Without one — unit tests, a checkout with no database
— it is in memory.

| Limiter       | Limit            | When the store fails |
| ------------- | ---------------- | -------------------- |
| Quick order   | 5 per 10 minutes | open                 |
| Contact       | 3 per 30 minutes | open                 |
| Newsletter    | 3 per hour       | open                 |
| Suggestions   | 60 per minute    | open                 |
| Admin sign-in | see above        | **closed**           |

Keys are a salted hash of the client fingerprint (`RATE_LIMIT_SALT`); the raw IP
address is never stored or logged. Until the table exists — that is, until the
migrations have run — the forms fall back to the per-process counter and admin
sign-in is refused.

## Security

- Description HTML is sanitised through a narrow allow-list (`sanitize-html`, in
  `lib/sanitize.ts`) before it is rendered. Today only our own override reaches
  the page, and it is still treated as untrusted.
- Image URLs are validated against our configured host. The source domain is
  rejected outright and the placeholder is shown instead — silently hotlinking
  would be worse than showing nothing.
- Public writes go through Server Actions, which are origin-checked, and are
  rate limited per hashed client fingerprint.
- The development-only `/media` route rejects path traversal and refuses to
  serve at all when an image host is configured.
- The admin panel is password-gated, `noindex` at the layout level and
  disallowed in `robots.txt`. Every admin server action re-checks the session
  independently of the layout.
- Mail bodies in the panel are rendered as **text, never as the sender's HTML**:
  sanitising means betting on the sanitiser, flattening means never rendering a
  stranger's markup at all, and in a support thread the markup only ever adds a
  signature image.
- Security headers are set in `next.config.ts`, including a
  **Content-Security-Policy-Report-Only**. The policy is static, not nonce-based:
  a nonce must change per response, which would make every page dynamically
  rendered, and these pages are prerendered and revalidated. What the static
  policy costs is `'unsafe-inline'` in `script-src`, for the App Router's inline
  payload; what it does is pin every source — scripts, styles, fonts, frames,
  form targets and connections to this origin, images to this origin and the
  configured image host, `frame-ancestors 'none'`. It reports rather than
  enforces until it has been watched on production.

## Analytics

Vercel Web Analytics and Speed Insights, mounted once in the root layout by
[`components/measurement.tsx`](../apps/web/src/components/measurement.tsx).
Both are cookieless and served from this origin. Nothing under `/admin` is
measured, enforced twice: the scripts are not rendered on an admin path, and
`beforeSend` drops any event whose URL is in the panel, for client-side
navigation into it. Custom events go through
[`lib/analytics.ts`](../apps/web/src/lib/analytics.ts) and carry no personal
data; a search query that looks like a phone number, an email address or a link
is withheld.

## SEO

- Per-page metadata, canonical URLs and Open Graph via the Next.js metadata API.
  A product shares its own photograph when it has one and the generated card
  when it does not.
- `Organization`, `WebSite`, `Product` (with `sku` once enrichment has read the
  code), `BreadcrumbList`, `ItemList` and `Article` JSON-LD. Shipping and return
  policies appear on the offer only once the owner has confirmed the terms. The
  company's legal identity is omitted until it is filled in, rather than
  published as an invented identifier. No `aggregateRating` or reviews: the shop
  has none, and inventing them would be both a policy violation and a lie.
- `SearchAction` is declared only because the search route genuinely exists.
- The sitemap is generated from the live catalog, so it can never advertise a
  product we no longer sell; it includes the business sections, `/delivery`, the
  journal and the machine pages.
- `robots.txt` disallows search, the API, `/media`, `/admin`, filtered and sorted
  permutations and answered wizard states, and disallows everything on
  non-production deployments. `/llms.txt` follows the same gate.
- The machine compatibility pages _are_ indexed and sitemapped. "Which capsules
  fit a Krups Piccolo" is a real query, answered from our own stable data rather
  than from the catalog.

## Accessibility

Targets WCAG 2.2 AA, verified rather than asserted. The Playwright suite checks
one `h1` per page, no heading-level skips, semantic landmarks, a skip link as the
first focusable element, labelled form controls, a focus-trapped mobile drawer
that returns focus on close, and alt text on every image;
`test/contrast.test.ts` checks the contrast table in `DESIGN.md` against the
tokens in `globals.css`. Live regions announce form results,
`prefers-reduced-motion` is respected globally, and nothing is conveyed by colour
alone: a system's colour always sits beside its name.

The honeypot field is hidden off-screen with `tabindex="-1"` inside an
`aria-hidden` wrapper, so it is invisible to people and to assistive technology.

## Testing

```bash
pnpm --filter @catalog/web test              # web-unit: no database
pnpm --filter @catalog/web test:integration  # web-integration: needs PostgreSQL
pnpm --filter @catalog/web test:e2e          # Playwright, desktop and mobile
pnpm reference:coverage                      # functional parity with the crawler
pnpm check:originality                       # no source branding or copy
pnpm check:launch                            # nothing undecided would render
```

Storefront unit tests live in `apps/web/test/`; components are rendered with
`createElement` and `renderToStaticMarkup`, with no JSX runtime import needed.
`*.integration.test.ts` files each get a private migrated database
(`test/helpers/test-db.ts`); `*.db.test.ts` files read the catalog in
`DATABASE_URL` and are written against the `seed:reference` snapshot. See the
[README](../README.md#testing) for how the groups are defined.

The end-to-end suite runs against a real production build (`next start` on port
8765, never reusing a server already there) and the real database, and opens
with a canary that asserts the server under test is actually this app. An
earlier run silently reused an unrelated application listening on the chosen
port, and generic assertions passed against it. The config gives the server it
starts throwaway admin credentials, so the admin-gate spec does not depend on
the machine's `.env.local`.

## Deployment

A Vercel project rooted at `apps/web`; nothing in the code is coupled to Vercel
beyond the system variables it reads (`VERCEL`, `VERCEL_ENV`) and the two
platform analytics packages.

```bash
pnpm --filter @catalog/web build
pnpm --filter @catalog/web start
```

What production needs is declared in
[`apps/web/env.schema.mjs`](../apps/web/env.schema.mjs) and checked by
`pnpm env:check`; `pnpm env:push` applies it. Brand, contact, legal, commercial
and feature values are constants in `src/config/site.ts`, not environment
variables.

`robots.txt` blocks every crawler unless the deployment is production. On a host
that announces its own environment — Vercel sets `VERCEL_ENV` — that is decided
automatically and previews are blocked with nothing to configure. Elsewhere, set
`NEXT_PUBLIC_ENVIRONMENT=production`; any other value keeps the site out of
search results.

## Catalog freshness

Catalog pages revalidate every 5 minutes (search every minute, the journal and
the sitemap every hour), so a background sync becomes visible without a
redeploy. No customer request ever waits on the sync.

## Changing the branding

Brand values are compiled into the bundle, and the prerender cache can serve a
stale page after a brand change — a rename once updated `/brands` while `/` kept
the old name. **Delete `.next` and rebuild** after changing any brand value, and
check the built HTML rather than trusting a running server.

1. Edit `src/config/site.ts`. Every brand, contact, legal and commercial value
   is a plain constant there; none of them is an environment variable.
2. Colours, type, spacing and radii are the tokens in `src/app/globals.css`.
   Their names are an interface the components use; change values, not names,
   and keep `DESIGN.md`'s contrast table true (`test/contrast.test.ts` checks it).
3. Replace `public/logo.png` and run
   `pnpm --filter @catalog/web brand:assets` to regenerate the icons;
   `components/layout/wordmark.tsx` draws the header mark.
4. Fill in the legal constants. Until they are set, the footer says plainly that
   company details are not configured and the structured data omits them
   entirely rather than publishing invented identifiers.
5. Have a lawyer review `src/content/legal.ts`. Paragraphs beginning with
   `ЗА ПРЕГЛЕД` render as visible callouts until they are completed, and
   `pnpm check:launch` fails while any would render.
