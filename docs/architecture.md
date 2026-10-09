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

Every shop page is under a locale prefix, Bulgarian included: `/bg/…` ships,
`/en/…` is built and switched off. The table shows the Bulgarian URL and, in
brackets, the English one it becomes when `LOCALE_READY.en` is flipped.

| Route (`/bg`, [`/en`])                                                 | Purpose                                                                                                                                                               |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                                                    | 307 to a locale by `Accept-Language` alone (`Vary: Accept-Language`, no cookie). With English off, always `/bg`                                                       |
| `/bg` [`/en`]                                                          | Home. Every section is data-driven and disappears when there is nothing behind it                                                                                     |
| `/bg/kategorii` [`categories`]                                         | Category index with live counts                                                                                                                                       |
| `/bg/<category>`                                                       | Category listing at its landing slug (`kafe-kapsuli`, `nespresso-kapsuli`, …). Parents include their children's products                                              |
| `/bg/<product>`                                                        | Product detail at the shop's own slug: gallery, facts table, compatibility, the order panel (`#order`), related products. A slug the product used to have answers 308 |
| `/bg/marki` [`brands`], `/<brand>`                                     | Brand index (brands with no stock are listed but not linked) and brand listing, at the slug the brand is published at                                                 |
| `/bg/promotsii` [`offers`]                                             | Products with a genuine reduction. Answers 200 but is `noindex`, and out of the sitemap, while nothing is reduced                                                     |
| `/bg/lavazza-kapsuli`, `/bg/kafe-na-zarna-lavazza`                     | Landing listings: Lavazza's capsules by system, and Lavazza's beans [`lavazza-capsules`, `lavazza-coffee-beans`]                                                      |
| `/bg/bezkofeinovo-kafe`, `/bg/nay-evtino-na-chasha`                    | Landing listings: decaf by system, and the cheapest per cup in each system [`decaf-coffee`, `cheapest-per-cup`]                                                       |
| `/bg/tarsene` [`search`]                                               | Server-side search over PostgreSQL                                                                                                                                    |
| `/bg/kafe-za-vending-mashini` [`vending-coffee`]                       | The vending section: prose of ours around whatever the catalog files under it; an enquiry form                                                                        |
| `/bg/konsumativi` [`consumables`]                                      | The consumables section. `noindex` and out of the sitemap while it lists no products                                                                                  |
| `/bg/dostavka-i-plashtane` [`delivery-and-payment`]                    | Delivery, payment and returns, from the same sentence builders as the terms                                                                                           |
| `/bg/izbor-na-kafe` [`which-coffee`]                                   | Recommendation wizard. One question per URL, step derived from the answers                                                                                            |
| `/bg/izbor-na-kafe/rezultat` [`…/result`]                              | The recommendation, with the reasons behind each pick                                                                                                                 |
| `/bg/za-kafemashina` [`by-machine`], `/<brand>`                        | Machine brands and how to recognise each capsule system (with drawings); every model of one brand, grouped by system                                                  |
| `/bg/blog` [`journal`], `/<slug>`                                      | The journal, called „Блог“ on the page: articles as typed content in `apps/web/content/journal/`                                                                      |
| `/bg/kontakti` [`contact`]                                             | Contact details and message form                                                                                                                                      |
| `/bg/byuletin/otpisvane` [`newsletter/unsubscribe`]                    | Tokenised unsubscribe. GET confirms, POST unsubscribes                                                                                                                |
| `/bg/poveritelnost`, `/bg/obshti-usloviya`, `/bg/biskvitki`            | Legal documents written for this business [`privacy`, `terms`, `cookies`]                                                                                             |
| `/products/…`, `/categories/…`, `/brands/…`, `/wizard/…`, `/search`, … | The pre-locale URLs. None is served; each answers 308 to its `/bg` equivalent, query string kept                                                                      |
| `/sitemap.xml`, `/robots.txt`                                          | Generated from the live catalog; one entry per page per shipping locale, each with its `hreflang` set                                                                 |
| `/llms.txt`                                                            | A plain-language map of the shop, generated from the catalog; closed whenever `robots.txt` is                                                                         |
| `/opengraph-image`, `/manifest.webmanifest`                            | The default share card and the web app manifest                                                                                                                       |
| `/media/[...key]`                                                      | Development-only local image serving; refuses everything once an image host is configured                                                                             |
| `/admin`                                                               | Panel index: what is waiting                                                                                                                                          |
| `/admin/vhod`                                                          | Password sign-in. Outside the panel group, which would otherwise redirect it                                                                                          |
| `/admin/zayavki`, `/[id]`                                              | Order enquiries. Phone number on the list, because dialling it is the next move                                                                                       |
| `/admin/sabshteniya`, `/[id]`                                          | Contact-form messages                                                                                                                                                 |
| `/admin/poshta`, `/[id]`                                               | The `info@` mailbox: inbound threads, answered as the shop                                                                                                            |
| `/admin/poshta/fail/[messageId]/[index]`                               | An attachment, streamed through the session                                                                                                                           |
| `/admin/byuletin`                                                      | Newsletter subscribers and their consent records. A list and an unsubscribe, and deliberately not a sender                                                            |
| `/admin/sinhron`                                                       | Is the catalog current, and if not, why                                                                                                                               |
| `/api/inbound`                                                         | Resend `email.received` webhook                                                                                                                                       |
| `/api/search/suggest`                                                  | The typeahead                                                                                                                                                         |
| `/api/cron/sync-health`                                                | Daily sync alarm (Vercel cron)                                                                                                                                        |
| `/api/cron/retention`                                                  | Daily retention deletion (Vercel cron)                                                                                                                                |

The admin panel, the API, `/media`, the share card and every file with an
extension carry no locale and are never touched by the proxy.

**Locales and URLs.** `src/i18n/config.ts` declares the locales and
`LOCALE_READY`, the gate: a locale that is `false` serves nothing, appears in no
`hreflang`, no sitemap and no language switcher. Folder names under
`src/app/(site)/[lang]/` are the canonical (Bulgarian) segments.
`lib/routes.ts` holds the route table (`routes`) and `href(locale, path)`, which
adds the prefix and translates each static segment through that locale's slug
table. A slug table (`src/i18n/slugs/<locale>.ts`, its shape in `types.ts`)
holds three things: every static segment, each category's landing slug by
source key, and the published slug of the brands whose stored slug is not how
the brand writes itself. `categoryHref`, `productHref`, `brandHref` and
`targetHref` build the links that need the catalog's keys; all of them end in
`href`. Every link, canonical, `hreflang`, sitemap entry, breadcrumb and JSON-LD
URL goes through these, and `test/bare-paths.test.ts` reads the source and
fails on a path written as a string.

Adding a locale is its code in `LOCALES`, a slug table, a dictionary
(`src/i18n/dictionaries/`), the error page's strings (`i18n/error-copy.ts`) and
its content; every per-locale map is a `Record<Locale, …>`, so a missing one is
a type error. Then `LOCALE_READY` is flipped. Per-locale product slugs, when
they exist, are wired in `productSlug()` and `storedProductSlug()` in
`lib/routes.ts` and nowhere else.

**The proxy.** `src/proxy.ts` (Next.js 16's name for middleware; it exports
`proxy`) runs before the route tree and does the reverse of `href` on the way
in. In order:

1. A path under a shipping locale is served as asked. A translated segment is
   rewritten to its folder, and a spelling the locale does not publish answers
   308 to the one it does (`resolveLocalisedPath`). Nobody is moved off the
   locale in their URL, by browser language or by location.
2. The bare `/` answers 307 to a locale chosen from `Accept-Language` alone
   (`i18n/negotiate.ts`), with `Vary: Accept-Language`. No cookie is read or
   set, and nothing geographic is consulted.
3. A pre-locale URL answers 308 to its Bulgarian equivalent
   (`lib/legacy-routes.ts`, pure, no database). `/journal/<slug>` goes straight
   to the article's current slug, read from the journal's own `previousSlugs`.
   Old category URLs are the one pattern that needs the catalog, so
   `/categories/<slug>` is let through to a route handler,
   `app/categories/[slug]/route.ts`, which redirects in one hop.
4. Anything else — a first segment that is not a shipping locale, `/en` while
   English is off — is rewritten to Next's `/_not-found`.

The admin panel, the API, `/media`, Next's internals, the share card and every
file with an extension are excluded twice: by the matcher, and by `isUntouched`
in the same file.

**The 404 is rendered on the server, and the proxy decides it.** In Next.js 16
a page that calls `notFound()` answers with the right status and an empty
`<html id="__next_error__">` that JavaScript fills in; with scripts off the
page is blank. The one 404 Next renders as finished HTML is the `/_not-found`
route, drawn by `src/app/global-not-found.tsx` (enabled by
`experimental.globalNotFound` in `next.config.ts`), and only routing can send a
request there. So for the URLs whose existence only the database knows, the
proxy asks first: `catalogLookup` names the slug, `slugExists` in
`lib/catalog/slug-exists.ts` answers, and a slug that names nothing is
rewritten to `/_not-found`. Three kinds are checked:

| Kind          | URL                              | Exists when                                                                                                                         |
| ------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `first-level` | `/bg/<slug>`                     | a product has the slug or used to have it, whatever its status; or an active category has it as its stored slug or its landing slug |
| `brand`       | `/bg/marki/<slug>`               | an active brand has it as its stored slug or its published slug                                                                     |
| `landing`     | the four landing listings' paths | the landing's selection is not empty                                                                                                |

The check accepts exactly what the pages accept, redirects included: a previous
product slug and a brand's stored slug must reach their pages to be answered
with a 308 (`lib/catalog/routable-slugs.ts` reads both). The list is every such
slug in the catalog, held in memory for five minutes; a slug that is not in it
reloads the list before it is believed, at most once every 15 seconds. With no
database, or a failed query, the answer is "cannot tell" and the request goes
through to the page, whose own `notFound()` is still there.
`za-kafemashina/[brand]` and `blog/[slug]` need no lookup: both set
`dynamicParams = false`, so an unknown brand or article never matches a route.

For the same reason no route has a `loading.tsx` and no Suspense boundary sits
above a page: a shell streamed before the page has decided what it is turns
its 308 or 404 into a 200 that JavaScript corrects.

The global 404 draws the shop's frame (below) and is always in the default
locale, Bulgarian: it is one page for every URL and is not told which was asked
for. `(site)/[lang]/not-found.tsx` remains for a `notFound()` thrown inside a
page; both draw `components/not-found-body.tsx`.

**The first level is shared.** Categories and products both live at
`/bg/<slug>` (`[lang]/[slug]/page.tsx`), told apart by
`lib/catalog/resolve-slug.ts` in a fixed order: a category at its slug in this
locale; a category at any other slug it has (308 to the published one); a
product by its slug; a product by a slug it used to have (308 to the current
one); otherwise nothing. Categories go first, so a product cannot shadow one.
Static folders win by construction, and no slug may take their names
(`RESERVED_SLUGS`, `test/slug-collisions.db.test.ts`). A category that backs a
business section redirects to the section's page.

**The frame's strings** — header, navigation, drawer, search field, footer,
announcement bar, skip link, 404 — are in `src/i18n/dictionaries/`, typed from
the Bulgarian one so a missing English string is a compile error, and
server-only; a client component is handed the strings it draws as props. The
error page's are in `i18n/error-copy.ts`. Page bodies are Bulgarian in place.

**Three root layouts, no `app/layout.tsx`.** `<html lang>` follows the locale,
and a layout cannot read a segment below itself, so the shop's root layout is
`src/app/(site)/[lang]/layout.tsx`; the panel's is `src/app/(admin)/layout.tsx`;
and `src/app/global-not-found.tsx` is a document of its own, because Next
renders it outside every layout. The split also keeps the admin from inheriting
the storefront layout — the shop layout reads the category tree on every render
to build the navigation, and its `robots` metadata declares the page indexable.
The faces are defined once, in `app/fonts.ts`. The shop's frame — skip link,
announcement bar, header, `<main>`, footer — is `SiteFrame` in
`components/layout/site-frame.tsx`, drawn by the `[lang]` layout and by the
global 404, so a dead link still has the menu, the search and the phone number.
If the 404's navigation read fails it falls back to the wordmark and the body's
own links, so a 404 never becomes a 500.

**Navigation is built once per render**, by `buildNavigation()` in
`components/layout/navigation.ts`, from the category tree the layout already
loads. The rail, the drawer and the footer draw the same structure, organised
by brewing system (from `BREWING_SYSTEMS`), then "Намери по машина", then the
business sections. A category whose key is a business section is never listed
as a category. "Промоции" is linked only while a reduction exists. A system's
link carries two names: the short one for the rail, where the group's heading
supplies the noun, and the listing's own name („Капсули за Nespresso“, from
`categoryNameFor` in `content/category-copy.ts`) wherever the link stands
alone. The footer adds one read of its own: which landing listings exist
(`getLandingAvailability`), for its links to the decaf and cheapest-per-cup
pages.

## Product names and slugs

A product has two names. `products.name` is the source's, stored untouched:
"Капсули DG Rema Caffè Cookies 16 бр.". It is what the owner orders by, so the
admin panel, the stored order enquiry and its notification read it, and nobody
else does. Everything a customer reads is computed from the record by
`productName()` in
[`packages/shared/src/product-name.ts`](../packages/shared/src/product-name.ts):

| Part       | Where it comes from                                                                                                  | Example                                        |
| ---------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `brand`    | how the brand spells itself (`apps/web/content/brand-names.ts`)                                                      | Rema Caffè                                     |
| `line`     | what is left of the source's name once the format words, the system token, the brand and the pack size are taken out | Cookies                                        |
| `format`   | the category the product is filed under, never its name; "за" a system for a capsule somebody else makes to fit it   | Капсули за Dolce Gusto                         |
| `quantity` | the pack size as `decidePackSize` decides it (below)                                                                 | 16 бр.                                         |
| `title`    | brand and line: a card's name and the product page's `h1`                                                            | Rema Caffè Cookies                             |
| `detail`   | format and quantity: the line under the `h1`                                                                         | Капсули за Dolce Gusto, 16 бр.                 |
| `full`     | the whole name in one line, for a `<title>`, an `alt`, structured data                                               | title — detail                                 |
| `slugBase` | `<brand>-<line>-<format>-<qty>`, before uniqueness is settled                                                        | `rema-caffe-cookies-kapsuli-dolce-gusto-16-br` |

The function is pure, and the sync and the storefront both call it: the sync to
derive a new product's slug, the storefront to print the name. In the
storefront the one caller is `displayName` in `lib/catalog/queries.ts`, which
`toCard` and `getProductBySlug` go through, so a card, a page, its title, the
typeahead and the JSON-LD cannot name one product two ways. (The home page's
and the journal's own reads call `productName` directly.) A name the parser
cannot get right is corrected in `apps/web/content/product-names.ts`, keyed by
source key because an override has to be findable before a slug exists.
`packages/shared/test/fixtures/product-names.json` holds every real product's
name, and `packages/shared/test/product-name.test.ts` runs the function over
all of them.

**Pack size** is decided once, by `decidePackSize` in
[`packages/shared/src/pack-size.ts`](../packages/shared/src/pack-size.ts): the
source's pack field stands, unless the product's name states another size, and
then the name's does. The sync's normalisation (`normalizeProduct` in
`packages/scraper-core/src/catalog/normalize.ts`) applies it before anything is
stored, so `products.weight`, `weight_value`, `weight_unit` and `servings` hold
the decided size and every price per cup follows from it; `productName` prints
the same decision. Identity does not move: the source key is still built from
the pack field as the source typed it. The source's own field and, when the two
disagree, both sizes are kept in `source_data` (`packField`,
`packSizeConflict`), written on every run and cleared when the source corrects
itself. `/admin/sinhron` lists the conflicts (`listPackSizeConflicts` in
`lib/admin-queries.ts`); nothing is mailed. `pnpm --filter @catalog/web
catalog:pack-size` applies the rule to rows already stored, from what they
hold, without contacting the source (plan by default, `--apply`).

**Slugs are a function of the product, never of arrival order**
([`packages/shared/src/product-slug.ts`](../packages/shared/src/product-slug.ts)).
A product alone on its `slugBase`, whose base is not reserved, has the base.
Otherwise every product sharing the base has `<base>-<discriminator>`, six
characters hashed from its own source key; nobody keeps the bare base for
having been stored first. That is what makes two databases holding the same
catalog publish the same URLs, whichever way they were filled.
`planProductSlugs` states the rule over the whole catalog;
`allocateProductSlug` is what the sync can apply when one product arrives
(`assignProductSlug` in `packages/scraper-core/src/catalog/identity.ts`), and
`packages/scraper-core/test/slugRoutes.test.ts` builds the catalog both ways
and compares the results. A slug is allocated once and then frozen.

What a product slug may not be: any other product's slug, any slug a product
used to have, any category's stored or landing slug, any static route in any
locale, or a locale code.

**Previous slugs.** `products.previous_slugs` (a `text[]` with a GIN index,
migration `0007_product_previous_slugs`) holds every address a product has
had. `resolve-slug.ts` answers one with a 308 to the current slug, the proxy's
existence check counts it as existing, the quick-order action accepts it (a
cached page may still post the old slug), and no later product is given it.
`pnpm --filter @catalog/web catalog:reslug` moves stored products to their
planned slugs: plan by default, `--tsv <file>` to write old → new, `--apply` to
write in one transaction. It is idempotent, and a slug is otherwise never
moved; the plan is the thing to read first. `content/product-copy.ts` is keyed
by slug, so `copy:apply` follows it.

**`products.search_name`** (same migration) stores the shop's heading for a
product — brand and line, and once more without accents — for search only.
Pages never read it. The sync writes it on every run, and `catalog:reslug`
fills it for rows stored earlier.

**Brand slugs.** A brand is stored under a slug derived from the source's
label and published at `brandSlug()` (`lib/routes.ts`): the curated slug in
the slug table's `brands` map where there is one, otherwise the stored slug.
The stored slug of a curated brand answers 308 (`matchBrandSlug`, on the brand
page). Everything else keeps keying a brand by its stored slug: the `brand`
filter, the logo table, the listing query.

**The doorway from a package into the app.**
[`packages/shared/src/storefront-data.ts`](../packages/shared/src/storefront-data.ts)
is the only place a package imports from `apps/web`, and it imports plain
data: the brand names, the product-name overrides and the slug tables. The
sync allocates URLs, so it has to know which first-level addresses are taken,
and reading the storefront's own tables cannot disagree with them the way a
second copy could. It exports `RESERVED_ROUTE_SLUGS`, `CATEGORY_LANDING_SLUGS`
and `RESERVED_PRODUCT_SLUGS`; `apps/web/test/product-identity.test.ts` checks
the first against `RESERVED_SLUGS` in `lib/routes.ts`. Nothing imported there
may need React, Next or a path alias.

## Catalog queries

All catalog reads live in
[`src/lib/catalog/queries.ts`](../apps/web/src/lib/catalog/queries.ts); the home
page's, the journal's, the landing listings' and the listing metadata's own
reads sit beside it in `home-queries.ts`, `journal-queries.ts`,
`landing-queries.ts` and `listing-facts.ts`.

Rules that hold throughout:

- Only `status = 'active'` products are listed. `missing` products are hidden
  while the sync is unsure about them, and `removed` products are gone.
- The displayed price is `retail_price_override ?? current_price`.
- The displayed name is computed, never the stored one: see
  [Product names and slugs](#product-names-and-slugs).
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

## Landing listings

Four pages the search study found demand for and the catalog can fill. None is
a category the source keeps; each is a rule applied to the products on sale.

| Route                       | Lists                                                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `/bg/lavazza-kapsuli`       | Lavazza's capsules, a group per system: the two systems Lavazza makes machines for first, then the ones its capsules only fit    |
| `/bg/kafe-na-zarna-lavazza` | Lavazza's products filed under coffee beans                                                                                      |
| `/bg/bezkofeinovo-kafe`     | every product whose record says decaf (`attributes.decaf = 'yes'`), a group per system. A name is never read                     |
| `/bg/nay-evtino-na-chasha`  | per system, the `CHEAPEST_PER_SYSTEM` products with the lowest price per cup among those that can be ordered and have the figure |

| Module                                                                               | Responsibility                                                                                |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| [`lib/catalog/landings.ts`](../apps/web/src/lib/catalog/landings.ts)                 | The rules. Pure: rows in, a grouped and ordered selection out                                 |
| [`lib/catalog/landing-queries.ts`](../apps/web/src/lib/catalog/landing-queries.ts)   | The read: one pass over the active products, cached per request, and the cards                |
| [`content/landing-copy.ts`](../apps/web/content/landing-copy.ts)                     | The words. It holds no figure; counts, packs and prices arrive as arguments                   |
| `app/(site)/[lang]/_components/landing-page.tsx`                                     | The one page body and its metadata; each route is a few lines naming its landing              |
| [`lib/catalog/related-landings.ts`](../apps/web/src/lib/catalog/related-landings.ts) | Which neighbours a page links to, as data; drawn by `components/catalog/related-landings.tsx` |

Every group is ordered cheapest per cup first, with the same tie-break as the
listings' `sort=price-per-cup` (name, then id), so the cheapest-per-cup page
shows the head of each system's sorted listing; `test/landings.db.test.ts`
holds the two together. "Can be ordered" means not marked out of stock. A page
has no filters and no sort control: it is one selection in one order, and its
URL has no query to canonicalise.

**One switch.** `LandingAvailability` (`landingAvailability()` in
`landings.ts`, read through `getLandingAvailability()`) says which landings
have products, which system groups each has, and how many products each
system holds. Everything that depends on a landing existing reads it: the
page's own 404, the proxy's existence check, the sitemap, `llms.txt`, the
footer's links, the cross-links, and the journal's links to a landing. A page
and every link to it therefore appear and disappear together.

**Cross-links** keep pages that could compete for one search pointing at each
other with one anchor each: the Lavazza brand page, the two Lavazza landings
and the two Lavazza systems; the Caffitaly shelf and the Tchibo machine page;
and from every system's shelf, the decaf and cheapest-per-cup pages, to that
system's group when it has one.

**The Tchibo machine page** is the one machine page that leads with products.
`machineBrandFeatures` in `content/landing-copy.ts` gives it its own title and
`h1` and names the system whose shelf it lists (Caffitaly, through
`getSystemListing`) above the model list. The vending entry in the machine
list is a kind of machine, not a maker, and has wording of its own
(`machineKindCopy`); every other entry uses the generic wording.

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

Product names mix both alphabets in one string — „Rema Caffè Cookies — капсули
за Dolce Gusto“ — and nobody switches keyboard layout mid-search. So every comparison
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

Substring and similarity matching run over two names: the source's, and the
shop's own heading for the product in `products.search_name`, so the words a
customer has just read on a page find the product, and so do the source's. A
match on the brand name counts too, so searching a brand finds its whole
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
card's "Бърза поръчка" is a link to the product page's `#order`
(`productHref(locale, product, "#order")`). With JavaScript, a
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
button cannot create two orders. The product is looked up by the slug the
form posted, then by a slug it used to have, and the order is recorded under
the current one.

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
and feed the announcement bar, the order panel, the delivery page
(`/bg/dostavka-i-plashtane`), the delivery, payment and withdrawal sections of
the terms, and `/llms.txt`. **An unset term
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
selected run travels in `?run=`, so the page works without JavaScript. It also
lists the products the source describes with two different pack sizes, which is
not an alarm condition and is not mailed.

**The newsletter.** `/admin/byuletin` lists subscribers with how and when each
agreed, and unsubscribes by stamping a date rather than deleting the row, so the
consent record survives. An enquiry is not consent to marketing, so adding the
sender of an enquiry or message to the list requires the operator to say how
the person agreed (by phone, by email, in person); that answer is stored as the
consent source and a missing one is refused. An address that unsubscribed is not
put back from the panel. Unsubscribing from a mail link goes through
`/bg/byuletin/otpisvane?token=…`: a GET only shows what would happen, because
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

## The journal

The section is called „Блог“ wherever a customer reads its name (`JOURNAL_NAME`
in `lib/journal.ts`, `nav.journal` in the dictionary) and lives at `/bg/blog`;
the code calls it the journal throughout. Articles are typed content, one file
each under `apps/web/content/journal/articles/`, listed explicitly in
`content/journal/index.ts`. `lib/journal.ts` is the only module the rest of the
application imports: it orders the articles, looks one up, and walks a body.

**An article's body is a function of catalog figures.** Nothing an article
states as a number is typed into prose. `lib/catalog/journal-figures.ts` (pure)
computes `cupCost`, `formats`, `intensity`, `composition`, `beans` and
`landings` from one flat read of the active catalog in
`lib/catalog/journal-queries.ts`, with the same shared helpers the cards use.
Every figure is nullable and an article must read correctly without it; a
failed read is logged and the article renders from `EMPTY_JOURNAL_FIGURES`.
`landings` is the landing listings' availability reduced to a yes or no each,
which is what `landingHref` and `linkWhile` in `content/journal/links.ts` use
to make a phrase a link only while its target exists.

**Links are route keys, not URLs.** An article names a system, a machine brand,
a product or a static route (`content/journal/links.ts`), and `targetHref`
resolves it in the locale being rendered. A link to something the data does not
hold throws at render instead of producing a 404 for a reader.

**A retitled article keeps its old addresses.** An article lists its
`previousSlugs`. `blog/[slug]` prebuilds each beside the articles and answers
it with a 308, and the legacy map sends `/journal/<old slug>` to the current
address in one hop. The route sets `dynamicParams = false`, so any other slug
is the server-rendered 404, and revalidates hourly so quoted figures follow
the catalog.

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

### Brand logos

A brand's own logo is drawn where the brand is the subject: the brands index,
the brand page, the home page's brand row, the product page's brand line and
brand rows in the typeahead. The standard is `DESIGN.md`, "Brand logo".

- [`content/brand-logos.ts`](../apps/web/content/brand-logos.ts) is what a page
  needs to draw one: file, format, intrinsic size, the ground it was drawn for,
  and a legibility floor where the file needs one. It reaches the browser.
- [`content/brand-logo-provenance.ts`](../apps/web/content/brand-logo-provenance.ts)
  records where each file came from and the check against the packs, and the
  brands for which no usable logo was found, each with its reason. Only tests
  import it.
- The files are in `apps/web/public/brand-logos/`, served from this origin.
- [`components/catalog/brand-logo.tsx`](../apps/web/src/components/catalog/brand-logo.tsx)
  fits a logo into one of four boxes (`LOGO_BOXES`) by area rather than by
  height, puts a logo published only for dark grounds on an `ink-900` tile, and
  shows the brand's name in text when there is no logo or the box would draw it
  smaller than it can be read.

All three tables are keyed by the brand's source key, like
`content/brand-names.ts`, which holds how each brand is written on the page.

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

Vercel Web Analytics and Speed Insights, mounted by the shop's root layout and
the global 404 through
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
  product we no longer sell: one entry per page per shipping locale, each with
  the page's `hreflang` set. It lists only what is indexable. Consumables is
  left out while it lists nothing, each landing listing while its selection is
  empty, and promotions while nothing is reduced. `/llms.txt` lists what the
  sitemap lists, on the same switches.
- `robots.txt` disallows search, the API, `/media`, `/admin`, filtered and sorted
  permutations and answered wizard states, with its paths built through `href`
  per shipping locale, and disallows everything on non-production deployments.
  `/llms.txt` follows the same gate. The pre-locale paths are not disallowed: a
  crawler has to be able to fetch a redirect to learn where it leads.
- The machine compatibility pages _are_ indexed and sitemapped. "Which capsules
  fit a Krups Piccolo" is a real query, answered from our own stable data rather
  than from the catalog.

### Titles, headings and descriptions

The wording follows the search study in [seo.md](seo.md); what was built from
it, and where it deviates, is the last section of that file.

- **One title format.** Every storefront `<title>` is the page's own words, a
  bar, the shop's name. `fullTitle` and `TITLE_TEMPLATE` in
  [`lib/seo/title.ts`](../apps/web/src/lib/seo/title.ts) are the one place the
  separator is spelled: a page either sets a plain title and the layout's
  template appends the name, or sets an absolute title through `pageTitle` in
  `lib/seo/listing-meta.ts` (or `productPageTitle`), which calls `fullTitle`.
  `test/title-format.test.ts` reads the source and fails on a separator typed
  into a page.
- **Listings, brands and index pages** take their titles, `h1`s and the opening
  of their meta descriptions from
  [`lib/seo/listing-meta.ts`](../apps/web/src/lib/seo/listing-meta.ts), which is
  pure: the page reads the catalog and hands the facts in.
  `content/category-copy.ts` holds what each category's listing is called — a
  `name` for breadcrumbs, chips and links, an `h1`, a `title` (and a
  `titleWithPack` used only when every pack on the page is one size), the
  capsule `family` a parent's title lists it under, the description's opening,
  the links inside its introduction, and the one journal article it points to.
  `content/brand-facts.ts` holds two facts about a brand the catalog does not:
  the Cyrillic spelling people were measured typing, and whether the brand is
  Italian, with the evidence beside it.
- **A meta description quotes the price per cup range and says how ordering
  works**, in one sentence defined once, `CALLBACK_SENTENCE` in
  `content/order-callback.ts`, shared by listings, landing pages and product
  pages. `lib/catalog/listing-facts.ts` reads price and pack size for the
  unfiltered listing, and `lib/catalog/cup-range.ts` does the arithmetic with
  the helpers a card uses, so a snippet cannot quote a figure the page does not
  show. A range the catalog cannot support is left out, not replaced.
- **One page owns each search term.** `test/keyword-map.ts` is the study's
  keyword map as data, and `test/keyword-map.test.ts` builds every title and
  `h1` the listing, brand, index, landing and machine pages can produce and
  fails when a head term stands in the title or heading of a page that does not
  own it.
- **Breadcrumbs follow the format, not the brand**, with no index step in
  between: Начало › Кафе капсули › Капсули за Dolce Gusto › the product
  (`categoryCrumbs` and `listingBreadcrumbs` in `lib/seo/json-ld.ts`; the
  `BreadcrumbList` is built from the same list).

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

Catalog pages revalidate every 5 minutes (search every minute; journal
articles, the sitemap and `llms.txt` every hour), so a background sync becomes
visible without a redeploy. The proxy's list of existing slugs is held for the
same 5 minutes. No customer request ever waits on the sync.

## Changing the branding

Brand values are compiled into the bundle, and the prerender cache can serve a
stale page after a brand change, with one page showing the new name and
another the old. **Delete `.next` and rebuild** after changing any brand value, and
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
