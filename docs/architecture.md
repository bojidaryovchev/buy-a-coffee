# Architecture

How the storefront is built, as built. The crawler and sync side is described
in the [README](../README.md); the decisions behind both are in
[decisions.md](decisions.md).

The customer-facing shop reads the synchronised catalog and our own mirrored
images, and it never contacts the source site during a customer request.

## Source of truth

```
source site  ──▶  catalog sync  ──▶  PostgreSQL + object storage  ──▶  storefront
                  (background)                                        (this app)
```

Two artifacts define what this app must do:

- [`reference/latest/`](../reference/latest) — the crawler's observations:
  page types, route patterns, filters, forms, features and the catalog itself.
- The database schema in [`packages/db`](../packages/db) — the shape of the data.

`pnpm reference:coverage` checks the app against the first of those and writes
[`docs/reference-coverage.md`](./reference-coverage.md). It fails when the
crawler has observed something the storefront does not implement and nobody has
written down why.

## Local setup

```bash
pnpm install
docker compose up -d
pnpm db:migrate
pnpm sync:catalog          # populate the catalog from the source
cp apps/web/.env.example apps/web/.env.local
pnpm dev                   # http://localhost:3100
```

With no network access, `pnpm --filter @catalog/web seed:dev` writes a small,
deterministic catalog instead. It is additive and namespaced under a `seed-dev`
source key, so it never disturbs synchronised data.

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Home. Every module is catalog-driven; empty sections are omitted rather than rendered blank |
| `/categories` | Category index with live counts |
| `/categories/[slug]` | Category listing. Parent categories include their children's products |
| `/brands` | Brand index. Brands with no stock are listed but not linked |
| `/brands/[slug]` | Brand listing |
| `/products/[slug]` | Product detail, gallery, quick order, related products |
| `/promotions` | Products with a genuine reduction |
| `/search` | Server-side search over PostgreSQL |
| `/contact` | Contact details and message form |
| `/journal` | Blog capability; no articles yet |
| `/privacy`, `/terms`, `/cookies` | Legal documents written for this business |
| `/sitemap.xml`, `/robots.txt` | Generated from the live catalog |
| `/media/[...key]` | Development-only local image serving; disabled in production |

## Catalog queries

All reads live in [`src/lib/catalog/queries.ts`](../apps/web/src/lib/catalog/queries.ts).

Rules that hold throughout:

- Only `status = 'active'` products are listed. `missing` products are hidden
  while the sync is unsure about them, and `removed` products are gone.
- The displayed price is `retail_price_override ?? current_price`.
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
application code. That is faster anyway, and it cannot silently mis-resolve.

## Pricing

Source prices are owned by the sync and never edited by the storefront. A
`retail_price_override` column sits alongside them:

- `null` (the default) means "track the source price".
- A value pins the retail price without touching the source value, so a markup
  rule can still be derived from the original later.

Money is exact from end to end. Prices arrive from PostgreSQL as decimal
strings and stay strings until the final `Intl.NumberFormat` call. Comparisons
use integer minor units — comparing decimal strings would make `"9.00" > "10.00"`
true and advertise a saving that does not exist.

Products with no price render "Price on request", never `0.00`.

## Filters, sorting and pagination

Filter state lives entirely in the URL (`brand`, `strength`, `decaf`, `aromas`,
`category`, `sort`, `page`), using the same parameter names the reference site
uses. Every control is an ordinary link, so filtering works without JavaScript,
each view is shareable and bookmarkable, and the back button behaves.

The reference site filters by hiding DOM nodes in the browser and ships the
whole catalog to every visitor. Ours queries the database. Sorting and
pagination are additions the reference does not have.

Filtered, sorted and paginated permutations are `noindex`, and the canonical
tag always points at the clean first page.

## Product availability and removal

The sync owns reconciliation; the storefront just respects it.

| State | Behaviour |
| --- | --- |
| `active`, in stock | Listed, orderable |
| `active`, out of stock | Listed with an out-of-stock badge, order button disabled |
| `missing` | Hidden from listings. The sync is unsure, so we do not advertise it |
| `removed` | Hidden from listings. The URL still resolves to a page explaining that the product is gone, with a route back into the catalog |

A removed product returns a real page rather than a 404 because its URL may
already be indexed or bookmarked, and a dead end helps nobody. That page is
`noindex`, so it stops attracting new search traffic.

## Search

PostgreSQL, using two complementary strategies:

- a generated `tsvector` over name, SKU, pack size and description, with the
  `simple` configuration — the catalog is Bulgarian and PostgreSQL ships no
  Bulgarian stemmer, so a language-specific configuration would quietly do
  nothing useful;
- trigram similarity for partial and misspelled input, which is what a search
  box actually receives, and which works identically for Cyrillic and Latin.

Both are indexed. Queries are length-bounded and parameterised.

## Quick order

There is no cart and no checkout, because the reference storefront has neither.
Ordering is a phone number and a callback.

The flow: rate limit → validate (including a honeypot) → persist → notify.
The record is safe in the database before any notification is attempted, so a
misconfigured email provider can never lose an order.

Submissions are idempotent within a five-minute window, keyed on the phone
number and product, so a double-clicked button cannot create two orders.

Notifications go through an abstraction in
[`src/lib/notifications.ts`](../apps/web/src/lib/notifications.ts). With no
provider configured it logs a redacted line; the record is always stored.
To add a real provider, implement `NotificationSink` and call
`setNotificationSink` once at start-up.

## SEO

- Per-page metadata, canonical URLs and Open Graph via the Next.js metadata API.
- `Organization`, `WebSite`, `Product`, `BreadcrumbList` and `ItemList` JSON-LD.
  No `aggregateRating` or reviews: the shop has none, and inventing them would
  be both a policy violation and a lie.
- `SearchAction` is declared only because the search route genuinely exists.
- Sitemap generated from the live catalog, so it can never advertise a product
  we no longer sell.
- `robots.txt` disallows search and filtered permutations, and disallows
  everything on non-production deployments.

## Accessibility

Targets WCAG 2.2 AA basics, verified by the Playwright suite rather than
asserted: one `h1` per page, no heading-level skips, semantic landmarks, a skip
link as the first focusable element, labelled form controls, a focus-trapped
mobile drawer that returns focus on close, alt text on every image, live
regions for form results, and `prefers-reduced-motion` respected globally.

The honeypot field is hidden off-screen with `tabindex="-1"` inside an
`aria-hidden` wrapper, so it is invisible to people and to assistive technology.

## Security

- Product description HTML is sanitised through a narrow allow-list before it
  is rendered. It is third-party input and this is the only place it reaches
  the DOM.
- Image URLs are validated against our configured host. The source domain is
  rejected outright and the placeholder is shown instead — silently hotlinking
  would be worse than showing nothing.
- Public writes go through Server Actions, which are origin-checked, and are
  rate limited per hashed client fingerprint. The raw IP address is never
  stored or logged.
- The development-only `/media` route rejects path traversal and refuses to
  serve at all when a production image host is configured.
- Security headers are set in `next.config.ts`.

## Testing

```bash
pnpm --filter @catalog/web test        # unit
pnpm --filter @catalog/web test:e2e    # Playwright, desktop and mobile
pnpm reference:coverage                # functional parity with the crawler
pnpm check:originality                 # no source branding in the storefront
```

The E2E suite runs against a real production build and the real database, and
opens with a canary that asserts the server under test is actually this app. An
earlier run silently reused an unrelated application listening on the chosen
port, and generic assertions passed against it.

## Deployment

A standard Node.js Next.js deployment; nothing is coupled to a specific host.

```bash
pnpm --filter @catalog/web build
pnpm --filter @catalog/web start
```

Required in production: `DATABASE_URL`, `NEXT_PUBLIC_SITE_URL`,
`NEXT_PUBLIC_IMAGE_BASE_URL`, `RATE_LIMIT_SALT`, and
`NEXT_PUBLIC_ENVIRONMENT=production` (any other value makes `robots.txt`
disallow everything, which is what keeps a staging deployment out of search
results).

## Catalog freshness

Catalog pages revalidate every 5 minutes, so a background sync becomes visible
without a redeploy. No customer request ever waits on the sync.

## Changing the branding

`NEXT_PUBLIC_*` values are inlined at build time, and the prerender cache can
serve a stale page after a brand change — a rename once updated `/brands` while
`/` kept the old name. **Delete `.next` and rebuild** after changing any brand
value, and check the built HTML rather than trusting a running server.

1. Edit `src/config/site.ts` defaults, or set the `NEXT_PUBLIC_*` variables.
2. Edit the token block at the top of `src/app/globals.css` for colour, type,
   spacing and radii.
3. Replace `src/components/layout/wordmark.tsx` if a real logo exists.
4. Fill in the legal variables. Until they are set, the footer says plainly that
   company details are not configured and the structured data omits them
   entirely rather than publishing invented identifiers.
5. Have a lawyer review `src/content/legal.ts`. Sections marked
   `REVIEW REQUIRED` are rendered as visible callouts until they are completed.
