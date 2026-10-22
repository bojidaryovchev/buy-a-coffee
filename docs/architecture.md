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

| Route (`/bg`, [`/en`])                                                 | Purpose                                                                                                                                                                                                |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/`                                                                    | 307 to a locale by `Accept-Language` alone (`Vary: Accept-Language`, no cookie). With English off, always `/bg`                                                                                        |
| `/bg` [`/en`]                                                          | Home. Every section is data-driven and disappears when there is nothing behind it                                                                                                                      |
| `/bg/kategorii` [`categories`]                                         | Category index with live counts                                                                                                                                                                        |
| `/bg/<category>`                                                       | Category listing at its landing slug (`kafe-kapsuli`, `nespresso-kapsuli`, …). Parents include their children's products                                                                               |
| `/bg/<product>`                                                        | Product detail at the shop's own slug: gallery, facts table, compatibility, the order panel (`#order`), related products. A slug the product used to have answers 308                                  |
| `/bg/marki` [`brands`], `/<brand>`                                     | Brand index (brands with no stock are listed but not linked) and brand listing, at the slug the brand is published at                                                                                  |
| `/bg/promotsii` [`offers`]                                             | Products with a genuine reduction. Answers 200 but is `noindex`, and out of the sitemap, while nothing is reduced                                                                                      |
| `/bg/lavazza-kapsuli`, `/bg/kafe-na-zarna-lavazza`                     | Landing listings: Lavazza's capsules by system, and Lavazza's beans [`lavazza-capsules`, `lavazza-coffee-beans`]                                                                                       |
| `/bg/bezkofeinovo-kafe`, `/bg/nay-evtino-na-chasha`                    | Landing listings: decaf by system, and the cheapest per cup in each system [`decaf-coffee`, `cheapest-per-cup`]                                                                                        |
| `/bg/tarsene` [`search`]                                               | Server-side search over PostgreSQL                                                                                                                                                                     |
| `/bg/kafe-za-vending-mashini` [`vending-coffee`]                       | The vending section: prose of ours around what the source files under its vending category (instant coffee since 16 October 2026, headed for what it is) and the blends named Vending; an enquiry form |
| `/bg/konsumativi` [`consumables`]                                      | The consumables section. `noindex` and out of the sitemap while it lists no products                                                                                                                   |
| `/bg/dostavka-i-plashtane` [`delivery-and-payment`]                    | Delivery, payment and returns, from the same sentence builders as the terms                                                                                                                            |
| `/bg/izbor-na-kafe` [`which-coffee`]                                   | Recommendation wizard. One question per URL, step derived from the answers                                                                                                                             |
| `/bg/izbor-na-kafe/rezultat` [`…/result`]                              | The recommendation, with the reasons behind each pick                                                                                                                                                  |
| `/bg/za-kafemashina` [`by-machine`], `/<brand>`                        | Machine brands and how to recognise each capsule system (with drawings); every model of one brand, grouped by system                                                                                   |
| `/bg/blog` [`journal`], `/<slug>`                                      | The journal, called „Блог“ on the page: articles as typed content in `apps/web/content/journal/`                                                                                                       |
| `/bg/kontakti` [`contact`]                                             | Contact details and message form                                                                                                                                                                       |
| `/bg/byuletin/otpisvane` [`newsletter/unsubscribe`]                    | Tokenised unsubscribe. GET confirms, POST unsubscribes                                                                                                                                                 |
| `/bg/poveritelnost`, `/bg/obshti-usloviya`, `/bg/biskvitki`            | Legal documents written for this business [`privacy`, `terms`, `cookies`]                                                                                                                              |
| `/products/…`, `/categories/…`, `/brands/…`, `/wizard/…`, `/search`, … | The pre-locale URLs. None is served; each answers 308 to its `/bg` equivalent, query string kept                                                                                                       |
| `/sitemap.xml`, `/robots.txt`                                          | Generated from the live catalog; one entry per page per shipping locale, each with its `hreflang` set                                                                                                  |
| `/llms.txt`                                                            | A plain-language map of the shop, generated from the catalog; closed whenever `robots.txt` is                                                                                                          |
| `/opengraph-image`, `/manifest.webmanifest`                            | The default share card and the web app manifest                                                                                                                                                        |
| `/media/[...key]`                                                      | Development-only local image serving; refuses everything once an image host is configured                                                                                                              |
| `/admin`                                                               | Panel index: what is waiting                                                                                                                                                                           |
| `/admin/vhod`                                                          | Password sign-in. Outside the panel group, which would otherwise redirect it                                                                                                                           |
| `/admin/zayavki`, `/[id]`                                              | Order enquiries. Phone number on the list, because dialling it is the next move                                                                                                                        |
| `/admin/sabshteniya`, `/[id]`                                          | Contact-form messages                                                                                                                                                                                  |
| `/admin/poshta`, `/[id]`                                               | The `info@` mailbox: inbound threads, answered as the shop                                                                                                                                             |
| `/admin/poshta/fail/[messageId]/[index]`                               | An attachment, streamed through the session                                                                                                                                                            |
| `/admin/byuletin`, `/[id]`                                             | The newsletter: subscribers and their consent records, the letters, and the composer (templates, blocks, preview, test copy, send, resume, stop)                                                       |
| `/admin/promotsii`, `/nova`, `/[id]`                                   | The shop's own promotions: the list, the editor with its live preview, stop, copy, delete before the start                                                                                             |
| `/admin/sinhron`                                                       | Is the catalog current, and if not, why                                                                                                                                                                |
| `/api/inbound`                                                         | Resend `email.received` webhook                                                                                                                                                                        |
| `/api/search/suggest`                                                  | The typeahead                                                                                                                                                                                          |
| `/api/cron/sync-health`                                                | Daily sync alarm (Vercel cron)                                                                                                                                                                         |
| `/api/cron/retention`                                                  | Daily retention deletion (Vercel cron)                                                                                                                                                                 |
| `/api/cron/promotions`                                                 | Hourly promotions refresh and shop revalidation (Vercel cron)                                                                                                                                          |
| `/api/cron/newsletter`                                                 | Daily: the monthly draft in the first week, and resuming a stalled send (Vercel cron)                                                                                                                  |
| `/api/admin/newsletter/*`, `/api/admin/promotions/*`                   | The two editors' previews, product searches and the newsletter's uploads, behind the panel session                                                                                                     |

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
   English is off — is rewritten to the 404 (`NOT_FOUND` in `proxy.ts`).

The admin panel, the API, `/media`, Next's internals, the share card and every
file with an extension are excluded twice: by the matcher, and by `isUntouched`
in the same file.

**The 404 is rendered on the server, and the proxy decides it.** In Next.js 16
a page that calls `notFound()` answers with the right status and an empty
`<html id="__next_error__">` that JavaScript fills in; with scripts off the
page is blank. The one 404 Next renders as finished HTML is the global one,
drawn by `src/app/global-not-found.tsx` (enabled by
`experimental.globalNotFound` in `next.config.ts`) for a URL no route matches,
and only routing can send a request there. So for the URLs whose existence
only the database knows, the proxy asks first: `catalogLookup` names the slug,
`slugExists` in `lib/catalog/slug-exists.ts` answers, and a slug that names
nothing is rewritten to `NOT_FOUND`, a path no route matches.

**Not to Next's `/_not-found` route**, which it used to be. `next start`
answers that route with 404; Vercel serves it as the prerendered page it is,
with 200, so every dead link on production was a soft 404 — `noindex`, but a
200 — while `/bg/a/b/c`, which matches nothing, was a real 404 all along.
`test/proxy.test.ts` checks `NOT_FOUND` against every route under `src/app`.
The 404 carries one robots tag, the `noindex` Next writes into every
not-found render; the route's own address, `/_not-found`, is answered with
`X-Robots-Tag: noindex` (`next.config.ts`). Three kinds are checked:

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
announcement bar, header, `<main>`, newsletter band, footer — is `SiteFrame` in
`components/layout/site-frame.tsx`, drawn by the `[lang]` layout and by the
global 404, so a dead link still has the menu, the search and the phone number.
The band and the footer sit together under `<main>` in one wrapper
(`data-frame-foot`) that owns the space above them, so no page sets its own
bottom margin. The layout renders beside the page and cannot be told by it
what to draw, so a page switches the band off with a marker,
`<NewsletterBandOff />` (`components/layout/newsletter-band.tsx`: the
unsubscribe page, the contact page, the two business sections, the 404), and
a page that ends on a full-bleed band of its own (the home page's Vending
Zone) carries `data-ends-on-band`, which closes that space; both are read by
`:has()` rules in `globals.css`, on the server's own HTML, with no script.
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

| Part       | Where it comes from                                                                                                                                                   | Example                                        |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `brand`    | how the brand spells itself (`apps/web/content/brand-names.ts`)                                                                                                       | Rema Caffè                                     |
| `line`     | what is left of the source's name once the format words, the system token, the brand and the pack size are taken out                                                  | Cookies                                        |
| `format`   | the category the product is filed under, not its name — except instant coffee, which its name says (below); "за" a system for a capsule somebody else makes to fit it | Капсули за Dolce Gusto                         |
| `quantity` | the pack size as `decidePackSize` decides it (below)                                                                                                                  | 16 бр.                                         |
| `title`    | brand and line: a card's name and the product page's `h1`                                                                                                             | Rema Caffè Cookies                             |
| `detail`   | format and quantity: the line under the `h1`                                                                                                                          | Капсули за Dolce Gusto, 16 бр.                 |
| `full`     | the whole name in one line, for a `<title>`, an `alt`, structured data                                                                                                | title — detail                                 |
| `slugBase` | `<brand>-<line>-<format>-<qty>`, before uniqueness is settled                                                                                                         | `rema-caffe-cookies-kapsuli-dolce-gusto-16-br` |

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

**Instant coffee** is a kind of product, not a shelf, and is recognised by the
supplier's own name: `productKind()` in
[`packages/shared/src/product-kind.ts`](../packages/shared/src/product-kind.ts)
reads „разтворимо кафе“ (or „инстантно кафе“) there, never the category, which
is the source's navigation (its vending section holds the tins today and may
hold bean blends tomorrow). Its format is „Разтворимо кафе“ whatever it is
filed under: „Bianchi — разтворимо кафе, 200 г“,
`bianchi-raztvorimo-kafe-200-g`. It has no listing of its own, so
`formatListingLabel` gives none and the breadcrumb names the shelf. The same
pattern string is matched in SQL over `catalog_translit(name)`
(`isInstantCoffee` in `lib/catalog/product-kind-sql.ts`), and
`test/product-kind.db.test.ts` holds the two to the same products.

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
existence check counts it as existing, and no later product is given it.
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
- The displayed price is `retail_price_override ?? current_price`, less a
  running promotion, and every reader selects it from
  [`lib/catalog/price-sql.ts`](../apps/web/src/lib/catalog/price-sql.ts): see
  [Pricing](#pricing). Nothing else spells a price out.
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
- A brewing system's members are the products in its categories that are not
  instant coffee (`brewingSystemsCondition`, `systemCategoryCondition`), and
  `resolveProductFormat` decides the same for a card's badge: instant coffee is
  in no system whatever it is filed under, so it has no badge, counts in no
  system facet, is never a wizard candidate and stands in no landing group.
  Beside an instant coffee, the related products are instant coffee too.
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

**One price layer.** What a product costs is defined once, as SQL, in
[`lib/catalog/price-sql.ts`](../apps/web/src/lib/catalog/price-sql.ts), and
every reader selects it: cards and the product page through `toCard`, the cart
and the order (`listProductsForOrder`, re-priced on the server), sorting and
filtering by price, the price per cup, the promotions listing and its count,
the sitemap, the landings, the journal, the newsletter. So a promotion that
starts is the price everywhere at once, without a write and without a deploy.

- `regularPrice` is `retail_price_override ?? current_price`.
- A **promotion** (`promotions`, `promotion_products`; migration 0013) runs for
  a product while the product is a member and has not left
  (`removed_at` null), the promotion has started, has not ended and was not
  stopped. `now()` is the statement's start, so one query sees one answer. A
  product in two running promotions takes the larger reduction.
- `retailPrice` takes the reduction off the regular price and rounds **down**
  to the cent: 9.95 € at 10% is 8.95 €, so the badge never reads 9%.
- `retailOldPrice`, the struck price, is under a promotion
  `least(reference_price, regular price now)`: the lowest price of the 30 days
  before the reduction began (Directive 98/6/EC, Art. 6a), never above today's
  regular price. Without a promotion it is the source's own struck price.
  `isReduced` (struck price above the price) is what the badge, the promotions
  page and its count mean by "reduced", so a product whose 30-day lowest was
  already lower is sold at the promotion's price with no badge and no claim.
- `ProductCardView.promotion` carries the running promotion's id, customer
  label, percentage, end and regular price; never the owner's own name for it.

The subqueries name the outer product as `"products"."id"` outright: see
[One trap worth knowing about](#one-trap-worth-knowing-about). A select over
`products` alone renders `${products.id}` bare, and inside a subquery that
binds to the subquery's own row.

**New arrivals.** `isNewArrival(since)` in the same file: first seen since
`since`, and created by a sync run that created at most `BULK_IMPORT_SIZE`
(25) products. The first import and any intake of a new part of the source are
not arrivals; on production those are the 110 products of 20 August and the 98
of 18 October 2026. `isRecentArrival` is the last 30 days, the "Ново" badge's
rule and the monthly letter's.

**Price per cup** is shown on every card and product page. Servings come from
the piece count where there is one, and from weight at `GRAMS_PER_SERVING`
otherwise, in [`@catalog/shared/serving`](../packages/shared/src/serving.ts):
7 g a cup for roasted coffee, 2 g for instant, by `productKind()` of the
supplier's name. `packServings()` takes the kind as a required argument, so
every reader — the sync, the cards, the listing facts, the landings, the
journal, the wizard, the pack-size script — states it. Anything derived from
weight is marked estimated and shown as an approximation, and the facts table
states the dose it assumed (`servingAssumption` in `lib/catalog/format.ts`).
The sync stores the same function's answer in `products.servings` for sorting,
so the order of a listing and the figure on a card cannot disagree.

## Promotions

The shop's own reductions, run by the owner from `/admin/promotsii`
([`lib/promotions/`](../apps/web/src/lib/promotions/)). A promotion is a
percentage (1–50; the form asks again above 20, since every reduction comes out
of the owner's margin) off whole brands, whole categories (with every category
below), single products, less exclusions, for whole days in Sofia — at most
60, starting at most a year ahead. `starts_at` is 00:00 Sofia of the first day,
`ends_at` 00:00 Sofia of the day after the last (`lib/promotions/days.ts`, the
one place the shop's days are worked out, DST-safe both ways). How it prices a
product is the [price layer](#pricing); this section is how it is kept.

**Editing rules,** enforced in the actions under `FOR UPDATE`, not only in the
form. Upcoming: everything. Running: name, customer label, the last day (not
before today) and what it covers; the percentage and the first day are locked,
because changing the reduction mid-run would muddle the 30-day history ("за
друга отстъпка спрете тази и започнете нова"). Stopped or ended: read-only.
"Спри сега" sets `stopped_at`. "Изтрий" exists only before the start — a
started promotion is part of the price history and is never deleted.
"Дублирай" opens the editor filled in (`/admin/promotsii/nova?ot=<id>`,
starting tomorrow) and creates nothing until Запази. Saves carry the version
the page was opened with; a stale tab keeps what was typed and is told.

**Membership** (`membership.ts`). The choice is kept as made
(`promotions.targets`) and resolved into `promotion_products` at every
refresh, so a product the sync brings into a promoted brand joins within the
hour. `missing` products stay members (most return on the next sync); only
`removed` ones leave. A product that leaves a started promotion keeps its row
with `removed_at` — it is history — and rejoining clears it and starts a new
stint; before the start a row is simply deleted.

**The 30-day lowest price** (`reference.ts`, pure; `history.ts` reads its
inputs). For each member, at T = the later of the promotion's start and the
product's join, over the 30 Sofia calendar days before T: every regular price
in effect (from the `sync_changes` rows that carry `currentPrice` — a
`catalog:link` move carries none and is passed over — or the override, taken
as constant), and, for every other promotion that priced the product in the
window, the window's lowest regular price less that promotion's percentage.
The minimum is the reference. **No claim without the whole window:** a product
the shop has had for less than 30 days, or that had no price when the window
opened, gets a null reference, and the price layer then strikes nothing. The
module errs low wherever the history is uncertain.

**Refresh** (`refresh.ts`). Every promotion that can still change, under an
advisory lock: membership, then every reference not yet final — provisional
while T is ahead, computed at exactly T and marked final at the first refresh
after it. A final reference never rises; it may fall when a deeper promotion
took the product over since T (`settledReferenceFloor`). Stints overwritten in
a refresh are still counted by every reference computed in it. The panel's
save, stop and delete run the refresh in the same transaction as the write, so
the shop never sees new dates beside old references; if the refresh fails the
write rolls back.

**Revalidation** (`revalidate.ts`). After a write, and when the cron's refresh
reports `shopChanged` (a promotion started or ended, a running one gained or
lost a product, or a reference moved), every page route under the shop's
layout is revalidated as a `"page"` (`SHOP_PAGE_ROUTES`), and `/sitemap.xml`.
**Not the layout:** `revalidatePath("/(site)/[lang]", "layout")` reaches
everything in one call, but a route that prebuilds its whole list
(`dynamicParams = false`: the journal's articles, the machine pages) is then
regenerated as a 404, and the 404 is cached — one saved promotion took every
article and machine page off the site in the e2e suite. Those two follow on
their own clocks (`SELF_TIMED_ROUTES`: 300 seconds and an hour), and
`test/promotion-revalidate.test.ts` holds both lists to the app's folders.
Without revalidation a cached landing page would keep the old price for up to
five minutes (`e2e/promotions.spec.ts` fails exactly there when it is turned
off). Known lag: the search typeahead's CDN cache (`s-maxage=60,
stale-while-revalidate=300`) is not purged and can show the old price for a
few minutes.

**The editor's preview** (`preview.ts`) draws what the shop will show, through
the same rules: the winning promotion's price where two overlap, no struck
price for a null reference, no badge under 1%, `missing` members counted and
labelled.

Not kept: the history of `retail_price_override` (there is no UI that sets
one).

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
sit in a `<details>` disclosure. Filtered and sorted permutations are
`noindex`, and their canonical tag points at the clean first page. Page two
and later of the clean listing are `index, follow` (since 20 October 2026;
`noindex, follow` before), canonical to themselves and titled „— страница 2“:
they are where a crawler finds the products page one has no room for. A page
number past the last is a 404 (`lib/seo/pagination.ts`).

## Product availability and removal

The sync owns reconciliation; the storefront just respects it.

| State                  | Behaviour                                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `active`, in stock     | Listed, orderable                                                                                                                                       |
| `active`, out of stock | Listed with an availability badge. The card links to the page instead of adding to the cart; the page shows the phone number instead of the order panel |
| `missing`              | Hidden from listings. The sync is unsure, so we do not advertise it                                                                                     |
| `removed`              | Hidden from listings. The URL still resolves to a page explaining that the product is gone, with a route back into the catalog                          |

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
brand" once put a Dolce Gusto capsule under a Nespresso one. An instant coffee
has no system: no badge, no "Става за машини" line, no machines, and nothing
in their place; its related products are other instant coffee.

A category that backs a business section is linked as that section's page
(`sectionPathForCategory` in `lib/routes.ts`, followed by `categoryHref`), so
an instant coffee's breadcrumb reads Начало › Кафе за вендинг машини › the
product, and its facts table's category links there in one hop.

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
`DG`), and the other word for instant coffee („инстантно кафе" → „разтворимо
кафе", which every instant coffee's name holds). Expansion only adds alternatives — the typed term is always one of them —
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

## Ordering: the cart and its order form

There is a cart and no payment. Ordering ends in a callback - nothing is paid on
the site - but the request carries everything delivery needs, so the call only
confirms it: first and last name, phone, and a delivery either to an address
(Econt or Speedy, postcode, street) or to an Econt or Speedy office or a BOX NOW
locker, with the courier chosen. Email and a note are optional. Since
19 October 2026 this is the one way to order (the owner's decision), and one
request can carry several products, as on any shop.

**The cart** lives in the browser's `localStorage`
([`lib/cart/`](../apps/web/src/lib/cart/)): product ids and quantities only, no
prices and no personal data. A card's control adds one unit without leaving the
listing; the product page has a quantity stepper. `/bg/kolichka` reads current
prices from the server ([`app/api/cart`](../apps/web/src/app/api/cart/)), shows
anything no longer orderable with the reason, and sends the order through
`submitCartOrder` ([`lib/forms/actions.ts`](../apps/web/src/lib/forms/actions.ts)),
which re-prices every line from the database and stores it in
`order_inquiry_items` - the browser's figures are never trusted.

**Under a promotion.** `/api/cart` carries, per line, the struck price, the
badge figure and the promotion's customer name and last day — only for the
shop's own promotions (the source's own struck prices stay out of the cart and
the customer's mail), and never the promotion's id or the owner's name for it.
The cart strikes reduced lines and adds "Спестявате". Each line posts the unit
price it showed as a hint that is compared, never stored: if any server price
differs — a promotion ended while the cart was open — `submitCartOrder` stores
nothing and answers "Цените се промениха — прегледайте количката и изпратете
отново.", and the cart asks for prices again. It also asks again when the tab
becomes visible, on a page restored from history, and just after the earliest
promotion end among its lines (`priceEndsAt`, never shown; the timer is set
again after every answer). Those asks are quiet: one that fails, or meets a
429, keeps the answer on screen and the form as typed, and retries with
backoff (`requoteRetryDelay`); only the first load, a refusal or the retry
button can show the cart as failed. A stored line
snapshots `regular_unit_price`, `discount_percent`, `promotion_id` and
`promotion_name` (the owner's name, looked up when the order is stored, under
`FOR KEY SHARE` so the promotion cannot be deleted mid-order; migration
`0013`). The owner's mail and the panel show "−10% · <name>, редовна X" and
what the promotions cost; the customer's mail strikes what the page struck,
never the regular price.

**One form.** The product page's order panel, `#order`, has „Добави в
количката“ and „Поръчай“; the second puts the product in the cart unless it is
there and opens `/bg/kolichka`, whose form
([`components/forms/cart-order-form.tsx`](../apps/web/src/components/forms/cart-order-form.tsx))
is the only order form. The delivery is stored in `order_inquiries`
(`first_name` … `delivery_office`, migration `0011`) through
`deliveryColumns` ([`lib/orders/delivery.ts`](../apps/web/src/lib/orders/delivery.ts)),
which drops the fields of the method not chosen; the same module words a
stored delivery as label lines for the panel and the customer's confirmation.
Orders taken before the change have no delivery and are shown as such.
Without JavaScript the cart cannot work, so the product page shows the phone
instead, and a card's control is a link to the product page.

**Validation, in the browser and on the server.** Every form (the order form, contact and its enquiry variants, the newsletter band, unsubscribe, and the
admin's forms) is validated by one zod schema per form
([`lib/forms/schemas.ts`](../apps/web/src/lib/forms/schemas.ts),
[`lib/forms/admin-schemas.ts`](../apps/web/src/lib/forms/admin-schemas.ts)),
used by the server action and, through react-hook-form, by the browser
([`components/forms/use-schema-form.ts`](../apps/web/src/components/forms/use-schema-form.ts)).
The form is `noValidate`, so the browser's own bubbles never show; pressing
the button validates every field, shows our message under each invalid one
and focuses the first. A valid form is sent by hand as its `FormData`. The
`<form action>` stays, so without JavaScript the same POST reaches the same
action, which validates with the same schema and redraws the form with the
same messages and what was typed. The server is the authority either way.

**The newsletter band's check comes late.** The band is on almost every page,
below the fold, so its check is in no page's first scripts: react-hook-form,
the resolver and zod, some 25 KB with brotli, had been on every page, ahead of
its first paint. A page gets the plain form
([`components/forms/newsletter-form.tsx`](../apps/web/src/components/forms/newsletter-form.tsx)),
which imports nothing that brings zod (the answer's shape and lines are in
[`lib/forms/form-state.ts`](../apps/web/src/lib/forms/form-state.ts), with
the email messages the schema uses): a press with the field empty or plainly
not an address is refused there, in the schema's words, and any other is sent
to the action as the browser would post it, the server answering in the same
place. The check
([`newsletter-enhancement.tsx`](../apps/web/src/components/forms/newsletter-enhancement.tsx))
is fetched when the band comes within a screen and a half of the viewport,
watched only once the page has loaded and had an idle moment (DESIGN.md, "The
Quiet Load Rule"), or as soon as the form is touched; it takes the form over
between two things the person does, never while a press is on its way; a
fetch that fails is tried twice more at most, each time only when the field
gets focus. It redraws nothing: both forms draw through one view
([`newsletter-view.tsx`](../apps/web/src/components/forms/newsletter-view.tsx))
rendered in one place, and the check hands it react-hook-form's handlers, so
the field being typed in keeps its text, its focus and its caret, and nothing
moves. The answer state and the analytics event stay with the plain form, so
an answer already on the screen is still the one shown; if the plain form was
pressed and refused, react-hook-form starts as after a press and clears the
refusal when the field is put right. A component in the browser that needs a
constant from a module that builds a schema has the same problem:
`lib/catalog/filter-query.ts` holds what the header's search field and the
listing's toolbar need of `lib/catalog/filters.ts`, without the schema. So
does a link on every page to a page that has a form: the header's cart
([`cart-link.tsx`](../apps/web/src/components/cart/cart-link.tsx)) prefetches
the cart page on intent — a pointer, a finger, focus — instead of on sight,
because that page's order form brings react-hook-form and zod.

**The server side** ([`lib/forms/actions.ts`](../apps/web/src/lib/forms/actions.ts)):
rate limit → validate (including a honeypot) → persist → notify. The record is
safe in the database before any notification is attempted, so a misconfigured
email provider can never lose an order. Submissions are idempotent within a five-minute window, keyed on the phone number, the delivery (method, courier, city, postcode, address, office) and the cart's lines, so a double-clicked button cannot create two orders, while the same cart sent to another place is a new one. A press is matched against the current window's key and the previous one's, under a per-phone advisory lock, because promotions switch at Sofia midnight, which is always a window's edge: a double press across it is still one order, at the first press's price. The repeat is looked up before availability and prices are checked, so it is answered as the stored order even if something sold out or a price moved in between. The delivery is checked as its own object beside the rest of the schema, so an empty form reports every missing field on the first press.

**The confirmation says when to expect the call.** It is built on the server at
the moment of submission from `siteConfig.commerce.openingHours`, read as wall
time in Europe/Sofia
([`lib/forms/callback-window.ts`](../apps/web/src/lib/forms/callback-window.ts)):
a day — "днес", "утре", "в понеделник" — plus "в работно време", with the hours
printed beside it. It never names an hour for the call, because the shop has
committed to when it is open, not to when it will ring back. The honeypot branch
returns the same text, so a bot sees what a person sees.

**Consent.** The order and contact forms carry an unticked newsletter
checkbox. Ticking it records the subscription with its consent source
([`lib/forms/consent.ts`](../apps/web/src/lib/forms/consent.ts)); leaving it
unticked records nothing.

Notifications go through
[`src/lib/notifications.ts`](../apps/web/src/lib/notifications.ts). The provider
is chosen by configuration: with `RESEND_API_KEY` and `MAIL_TO` both set the
notification is emailed, otherwise a redacted line goes to the log. The record is
stored either way. `setNotificationSink` remains, as an override for tests.

**The notification carries a link, not the customer.** Subject, one-line summary and a URL into the panel — never the name, the phone number, the email or the delivery address. Those stay in the record behind the panel password, where the order page sets the delivery out as a courier label.

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
the password is at least 6 characters and `ADMIN_SESSION_SECRET` is set and
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
refuse the server action.

**Sending** ([`lib/newsletter/`](../apps/web/src/lib/newsletter/), since 19
October 2026). The shop's own table decides who is mailed: one Resend account
serves four sites, so a letter goes out through `resend.batch.send` with no
topic, one copy per reader with their own unsubscribe link and the one-click
`List-Unsubscribe` headers, and the account-wide `unsubscribed` flag is never
written (the topic is synced only for Resend's own pages). Starting a send
fixes the recipients and snapshots the products into the campaign
(`newsletter_deliveries`, `attachments`), so a resumed send mails the letter
that was confirmed. Batches carry idempotency keys; a refused batch is split
into single sends; an ambiguous answer is held under the same key; bounces and
complaints are matched by the stored Resend email id only. A run has a 200 s
budget inside the function's 300.

**Composing.** The body is the Markdown subset of `emails/markdown.ts` with
product lines — `[[продукти: адрес, …]]` (picked), `[[нови-продукти]]`,
`[[промоции]]` (resolved at send) and `[[промоции: адрес, …]]` (picked
reductions, each of which must still be reduced at send). The composer
(`components/admin/newsletter-blocks.tsx`) shows that one string as blocks —
text with its formatting buttons, product lists as rows with × and "+ Добави",
move up and down — and back, losslessly (`body-blocks.ts`; fuzzed); a
"Markdown" switch shows the raw text. Saves are versioned (`revision`), so a
stale tab can neither overwrite nor send.

**Starting points** (`templates.ts`, `template-data.ts`, `createNewsletterFromTemplate`).
_Monthly_: what is new — `isNewArrival` since the later of the last sent
monthly letter's cutoff and 30 days ago, so nothing is called new that the
site's "Ново" badge would not call new, and what arrived after a letter was
prepared comes in the next one — and what is reduced now, own promotions
first, up to twelve cards. _Promotion_: one promotion's members whose honest
badge (against the 30-day lowest price) reaches the promotion's percentage, so
"−X%" is true of every product listed; the owner is told how many were left
out and why. A promotion with no such member cannot be announced — the
"Обява за промоция" list counts only honest members and disables it — and
before the promotion starts its letter names no figure and cannot be sent.
_Blank_. The draft keeps its plan (`letter-plan`, in `attachments`): when the
data was read, and for each promotion it names, the days, label and reduction
it was written with, the exact line the template wrote and the reductions it
priced. "Дублирай" does not copy the plan, and only a monthly letter with a
plan moves the new-arrivals window. A picked address that is a product's
former slug resolves to the renamed product.

**Before sending** (`deliverability.ts`, `product-blocks.ts`, `claims.ts`,
`claims-data.ts`). Stops the send: an unreadable line; an address that names
no product; more than twelve products; products that cannot be read; a letter
with neither text nor products; a picked reduction that is no longer reduced;
a promotion the letter still names (its line, or a reduction it priced, is in
the body) that has ended, was stopped or is gone; a named promotion whose days,
label or reduction changed since drafting, while its line is in the body; a
promotion letter with no product its promotion prices, or a product whose
badge is below the promotion's percentage. **The claims are checked at the
start of every run**, a resume included; a failure stops the run with the
cause `claims`, which the daily job never resumes. Only warns: a section left
empty (it vanishes whole, heading and text with it, when all its products come
from the catalog), a picked product sold out or withdrawn since (left out),
and a letter within 30 days of the last one (the band promises no more than
one a month). A test copy goes to any one address (default the owner's), 10 an
hour.

**The monthly draft** (`/api/cron/newsletter`, daily 07:00 UTC; `cron.ts`).
On days 1–7 of a Sofia month, once (`auto_period`, unique), unless a letter
already went out this month or an owner-started monthly draft from this month
is waiting, and
only when something is new or reduced: it prepares the draft and mails the
owner a link (`newsletter_draft` notice). It never sends to subscribers. A
prepared draft the owner deletes is kept as `dismissed`, so the month's claim
stands and the job does not prepare it again. The same job resumes a send
that stopped for a transient reason (its time budget, a rate limit, a network
or 5xx error, a stale heartbeat) within 23 hours of its start — never one that
stopped for the account, the products, the template or repeated identical
refusals, which wait for the owner. "Спри изпращането" ends a stopped send:
waiting copies are skipped, one already handed to Resend is marked failed
("may have arrived").

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
| [`components/wizard/capsule-outlines.ts`](../apps/web/src/components/wizard/capsule-outlines.ts)   | Each capsule's outline in millimetres, with its sources              |
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
so relative size is information. The outlines are data, in millimetres, in
`capsule-outlines.ts`, each figure with its source (a patent, a capsule
maker's dimensioned drawings, retailers' measurements, photographs); a
dimension is printed only where it is established, and no logo or marking is
drawn. The same outlines are the source of the **system icons**
(`components/catalog/system-icons.ts`, `system-icon.tsx`), the small mark
before a system's name across the shop: each capsule's side silhouette (the
ESE pod's view from above) scaled to a 20 × 16 grid, so the icon and the
drawing cannot disagree. Change an outline and both follow.

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

### Cut-outs

Each active photo is also cut out to transparency (Phase K; DESIGN.md,
"Imagery"). `pnpm images:cutout`
([`commands-cutout.ts`](../apps/scraper/src/commands-cutout.ts)) reads the
photos that have no settled cut-out from the store, sends each one's public
address to BRIA RMBG 2.0 on fal
([`cutout-model.ts`](../apps/scraper/src/cutout-model.ts), with `FAL_KEY`),
hands the photos and the model's answers in a temporary directory to
[`tools/cutout/cutout.py`](../tools/cutout/cutout.py) (the ground check and the
shape check), and stores each PNG content-addressed under `cutouts/` with a row
in `image_cutouts`, keyed by the photo's content hash. Only the Node command
holds the key. The Python process is given none of the secrets in its
environment, only what it needs to run; it can still read its parent's, so
splitting the work into steps of their own is what would put them out of its
reach. A run stops asking fal when it refuses the account (no credit, a wrong
key) or answers none of the first four photos: what was answered is still
recorded, the rest wait with no attempt spent, and the run fails with the
reason (`stopped`). `.github/workflows/cutout.yml` runs it after each
scheduled sync on GitHub's standard runner; locally it needs `FAL_KEY` and a
Python with `tools/cutout/requirements.txt` (`--python` or `CUTOUT_PYTHON`).

A row's `status` decides whether the shop shows it: `auto` and `approved` are
live, `pending` waits on `/admin/snimki`, `rejected` keeps the white well for
good, and `failed` is retried up to three times. Every read of a pack image
joins the live cut-out beside the photo (`ProductImageView.cutout`); a surface
uses it by drawing the pack through
[`PackWell`](../apps/web/src/components/catalog/pack-well.tsx), and everything
else keeps the photo. `images:push` and `images:verify` include the cut-outs.

When the tool improves, `pnpm images:cutout --redo <hash,...>` re-cuts the
named photos, settled or not (the tool's `version` is in `made_by`). The new
cut-out waits on `/admin/snimki` whatever the tool says, and the old decision is
cleared; a redo that fails leaves the row as it was.

### Brand logos

A brand's own logo is drawn wherever a brand is named as a brand: the brands
index, the brand page, the home page's brand row, the product page's brand
line, the brand line of every product card and wizard result, and the
typeahead's brand and product rows. The filters name brands in text, like every
other filter group. It
never marks a brewing system, which has our own icon instead (above, "The
capsule drawings"). The standard is `DESIGN.md`, "Brand logo".

- [`content/brand-logos.ts`](../apps/web/content/brand-logos.ts) is what a page
  needs to draw one: file, format, intrinsic size, the ground it was drawn for,
  and a legibility floor where the file needs one. It reaches the browser.
- [`content/brand-logo-provenance.ts`](../apps/web/content/brand-logo-provenance.ts)
  records where each file came from and the check against the packs, and the
  brands for which no usable logo was found, each with its reason. Only tests
  import it.
- The files are in `apps/web/public/brand-logos/`, served from this origin.
- [`components/catalog/brand-logo.tsx`](../apps/web/src/components/catalog/brand-logo.tsx)
  fits a logo into one of six boxes (`LOGO_BOXES`: tile, header, line,
  suggestion, card, chip) by area rather than by height, puts a logo
  published only for dark grounds on an `ink-900` tile, and shows the brand's
  name in text when there is no logo or the box would draw it smaller than it
  can be read — in a 24 px chip that is five stacked lockups, so a chip falls
  back to the name. Two brands have no usable logo (Eurocaf, Molini) and are
  written out everywhere.

All three tables are keyed by the brand's source key, like
`content/brand-names.ts`, which holds how each brand is written on the page.

## Crons and region

`apps/web/vercel.json` pins functions to `fra1`, next to the database in
`eu-central-1`, and schedules four crons (the Pro plan allows an hourly one). Both answer 404 unless the request
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
- **`/api/cron/newsletter`** (07:00 UTC). The monthly draft in the first week
  of a Sofia month, and the resume of a send that stopped for a transient
  reason: see [the newsletter](#the-admin-panel). Answers 500, with the
  counts, when either step failed.
- **`/api/cron/promotions`** (5 past every hour, so 00:05 Sofia whatever the
  season). The [promotions](#promotions) refresh: products the sync brought
  into a promoted brand or category join, references settle once their
  promotion has started, and the shop is revalidated when anything it shows
  may have moved. Counts only.

## Rate limiting

[`lib/rate-limit.ts`](../apps/web/src/lib/rate-limit.ts) is a fixed-window
counter over a pluggable store. With a database configured the store is
PostgreSQL (`rate_limit_buckets`, one atomic upsert per hit, with bounded
cleanup of expired rows), because a counter held in memory on serverless is one
counter per warm instance. Without one — unit tests, a checkout with no database
— it is in memory.

| Limiter       | Limit            | When the store fails |
| ------------- | ---------------- | -------------------- |
| Order         | 5 per 10 minutes | open                 |
| Contact       | 3 per 30 minutes | open                 |
| Newsletter    | 3 per hour       | open                 |
| Test copy     | 10 per hour      | open                 |
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

- Per-page metadata through the Next.js metadata API. Canonical and `hreflang`
  are always declared together, on the page (`lib/seo/alternates.ts`), because
  Next shallow-merges `alternates`.
- **Every page shares as itself.** Next shallow-merges `openGraph` and
  `twitter` too: a page takes the layout's whole object or replaces it whole.
  So both are built in one place,
  [`lib/seo/share.ts`](../apps/web/src/lib/seo/share.ts). `shareDefaults(locale)`
  is what the shop's layout declares: the type, the shop's name, the locale and
  the share card, and never a URL, a title or a description, because those are
  true of one page only. `shareMetadata({ locale, title, description, path })`
  is what a page declares: the same constants restated, plus its own address
  (the path its canonical is built from), its own title without the shop's
  name (`og:site_name` carries the name) and its own description. Every page
  under `(site)/[lang]` that declares a canonical calls it, the shared builders
  `categoryMetadata`, `productMetadata` and `landingMetadata` included. A
  product, a category, a brand, a landing listing and an article each have a
  card of their own, drawn on request by the `opengraph-image.tsx` beside the
  page (`lib/seo/og/`: the pack whole on white beside its name, system, price
  and price per cup; a listing's heading, count and cup range beside three
  packs), and pass `image: "generated"`, which names no image so that Next
  attaches the segment's file with its width, height and `alt`. A card's
  id is a hash of what it shows (`cardId` in `lib/seo/og/data.ts`), so its URL
  changes with a price and a network never keeps showing the old one; an
  article names its card's URL itself, because the same URL is its
  `Article.image` (`lib/seo/og/article-card.ts`). Every other
  page shares the shop's card (`SHARE_CARD` in `lib/seo/share-card.ts`, drawn
  by `app/opengraph-image.tsx`), named with its size and `alt`. The cards
  draw with the site's own Literata and Inter, cut to Latin and Cyrillic, from
  `apps/web/assets/og/` (`lib/seo/og/fonts.ts`); an article passes its dates
  and shares as an `article`. A `noindex` view — a filtered or sorted listing, search, an
  answered wizard state — shares as its canonical. The unsubscribe page has no
  canonical and sends no `og:url`. `test/share.test.ts` reads the source and
  fails on a page that declares alternates without `shareMetadata`, or that
  spells `openGraph:` or `twitter:` by hand; `e2e/i18n.spec.ts` ("the head of
  every page") checks the tags a production build sends, and a new page type
  is added to its `pages` list.
- `app/global-not-found.tsx` sets its own `metadataBase`, because no layout is
  above it. A few `metadataBase` warnings are still printed at build. The likely
  cause, not a proven one, is that `app/opengraph-image.tsx` sits at the root,
  above the segment whose layout sets the base, so Next resolves it once
  without one before the layout's explicit image replaces it. No page sends a
  `localhost` URL; the browser suite asserts that.
- `Organization`, `WebSite`, `Product` (with `sku` once enrichment has read the
  code), `BreadcrumbList`, `ItemList` and `Article` JSON-LD. The organisation
  is one node, `<origin>/#organization`, with its square logo; the offer's
  `seller`, the website's and an article's `publisher` refer to it. A pack's
  weight is a `QuantitativeValue` in grams (never the stored text, never a
  count of capsules), a GTIN is published only when its check digit holds, and
  a product off sale is `OutOfStock` or `Discontinued`, never `InStock`.
  `test/helpers/structured-data.ts` checks every block against schema.org's
  vocabulary and Google's requirements, offline, in the unit and browser
  suites. Shipping and return
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
pnpm check:bundle                            # after a build: no Node crypto polyfill, no eval probe
```

Storefront unit tests live in `apps/web/test/`; components are rendered with
`createElement` and `renderToStaticMarkup`, with no JSX runtime import needed.
`*.integration.test.ts` files each get a private migrated database
(`test/helpers/test-db.ts`); `*.db.test.ts` files read the catalog in
`DATABASE_URL` and are written against the `seed:reference` snapshot. A
`*.db.test.ts` file never writes: that database is somebody's development
catalog. A test that needs to change rows is an integration test and gets a
private database. See the
[README](../README.md#testing) for how the groups are defined.

The end-to-end suite runs against a real production build (`next start` on port
8765, never reusing a server already there) and the real database, and opens
with a canary that asserts the server under test is actually this app. An
earlier run silently reused an unrelated application listening on the chosen
port, and generic assertions passed against it. The config gives the server it
starts throwaway admin credentials, so the admin-gate spec does not depend on
the machine's `.env.local`.

A few specs write to that database to set up what they check — a promotion, a
copied product, a sync run — and clean up after. Every such write goes through
`e2e/support/database.ts`, which refuses before connecting unless the host is
`localhost` or `127.0.0.1` or `CI` is set: a shell left pointing at
production after a migration must make the suite stop, not write.
`e2e/promotion.spec.ts` runs in a desktop-only "after" project once every
other spec has finished, because a running promotion fills the promotions page
that other specs compare against the build-time sitemap; on its own it runs
with `--project after --no-deps`.

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
