# Source site recon — kafezona.com

Recorded during implementation, and re-recorded on **2026-10-09** after the source
changed shape. All observations come from ordinary unauthenticated HTTP GETs of public
pages. No forms were submitted. No controls were bypassed.

Evidence lives in `fixtures/kafezona/` (built by `scripts/build-fixtures.mjs`, see
[Fixtures](#fixtures)). Where a statement below names a fixture, the fixture is the
proof. Where it says "history", it describes how the source behaved before this date
and can no longer be observed.

## Access

- `robots.txt`: `Allow: /`, single `Disallow: /cdn-cgi/l/email-protection`. Sitemap
  declared. Unchanged.
- Fronted by Cloudflare. Plain HTTP `GET` returns full server-rendered HTML; **no browser
  automation is required**. Playwright is therefore not used.
- Language: Bulgarian. Currency: **EUR** (`€`).

## Not-found behaviour: real 404 now, soft 404 before

Unknown routes now return a **real HTTP 404** with a page of their own
(`fixtures/kafezona/not-found-404.html`: title "Страницата не е намерена — KafeZona",
`<meta name="robots" content="noindex">`, an `<h1>`, links home / search / blog / promo).

    /__definitely-not-a-real-page-fixture/   -> 404, 4373 bytes
    /products/lavazza-super-crema/           -> 404   (old stale-sitemap prefix)
    /marki/                                  -> 404
    /kapsuli/                                -> 404   (renamed, see URL space)
    /amann-cascada/                          -> 404   (renamed, see Identity)

History: until this date unknown routes returned **HTTP 200 with the homepage shell**,
byte-identical to `/`, so a crawler that trusted status codes would have ingested 111
phantom products from the stale sitemap. `fixtures/kafezona/soft-404.html` keeps that
shell (it is the home page by definition; the manifest marks it `derivedFrom`).

Both behaviours stay supported, because the source has now shown both:

- `Fetcher.calibrateSoft404()` probes one impossible path. A probe that comes back as a
  page is the shell and is hash-compared against later responses (soft-404 path). A probe
  that comes back as an error logs `soft404.not_applicable`, learns nothing, is **not
  asked again** in that process, and status codes are trusted: a missing product is then
  an `http_error` with `statusCode: 404`, not a `soft_404`. Pinned in
  `packages/scraper-core/test/fetcher.test.ts`.
- A transient probe failure (timeout, 5xx) is retried on the next call, since it says
  nothing about how the site treats unknown routes.

## Sitemap

`sitemap.xml` lists **228** URLs and is now accurate: every one of the 187 product URLs
in the catalog blob is in it, plus categories, brands, `/promo/`, `/blog/`, the blog
article, `/privacy/`, `/cookie-settings/`, `/vending-zona/`, `/konsumativi/`. There are
**no** `/products/<slug>/` entries any more (111 of them were the stale prefix before).
One entry is dead: `/marki/` still appears and now returns 404; `/brands/` is live but
is not listed. The sitemap remains a hint, never truth: every candidate is verified.

## URL space

Flat. Products, categories and brands all live at `/<slug>/`, so page type **cannot** be
derived from the URL path. Classification uses DOM/content signals.

Changes confirmed on 2026-10-09:

- **Product URLs were renamed**, typically gaining a pack-size suffix:
  `/amann-cascada/` -> `/amann-cascada-500/`, `/lavazza-super-crema/` ->
  `/lavazza-super-crema-1/`, `/dg-molini-napoli/` -> `/dg-molini-napoli-16/`. The old
  URLs return 404. The suffix is **not a unit**: `-500` is 0.500 кг, `-1` is 1 кг, `-10`,
  `-16`, `-100` are piece counts, `-250` is 0.250 кг. Never parse it; read the weight
  from the blob's `weight` field.
- The top-level capsule category was renamed `kapsuli` -> `kafe-kapsuli`.
- `/vending-zona/` and `/konsumativi/` are both real navigation categories.
- Brand slugs no longer carry stray whitespace (`" vergnano"` is now `vergnano`), but
  three brand _display names_ still do (`" VERGNANO"`, `"BORBONE "`, `"BIANCHI "`).
- One product URL still carries a space inside its path: `/caffitaly-espresso-morbido-10 /`
  (kept exactly as the source prints it).

## Primary catalog source: `window.FILTER_INIT`

`/search/` still embeds the site's own complete structured catalog in an inline script,
and it still parses completely:

    window.FILTER_INIT = {
      brands:     [{ id, h1, slug, count }],
      categories: [{ id, h1, slug, count, children: [...] }],
      products:   [{ h1, url, price, old_price, availability, weight, intensity,
                     brewStrength, decaf, aromas, brandSlug, categorySlug,
                     imageUrl, description }]
    }

Scope check across pages (unchanged):

| Page            | FILTER_INIT | products                         |
| --------------- | ----------- | -------------------------------- |
| `/search/`      | yes         | **187** (full)                   |
| brand pages     | yes         | none (scoped categories only)    |
| category pages  | no          | — (renders `.product-item` HTML) |
| everything else | no          | —                                |

So `/search/` is the single authoritative catalog index. Category listing HTML is an
**independent fallback** source parsed by a separate parser, which keeps sync alive if
the blob disappears and feeds parser-confidence into the circuit breaker.

The `search-filter-init.html` fixture is the **whole** page (all 187 records): the diff
tests need every record, so it is no longer trimmed.

## Catalog shape (observed 2026-10-09)

- **187 product records, 187 distinct URLs**, 20 brands with products (24 brands listed on
  `/brands/`; `cafe-moreno`, `garibaldi`, `jacobs`, `nescafe` have none), 3 top-level
  categories, 5 capsule subcategories.
- Category counts: `kafe-na-zyrna` 58, `kafe-kapsuli` 88 (nespresso 36, dolce-gusto 33,
  caffitaly 9, lavazza-blue 7, a-modo-mio 3), `kafe-dozi` 41. They add up to 187.
- `/vending-zona/` and `/konsumativi/` are absent from `FILTER_INIT.categories`.
- History (111 records, 109 distinct URLs, 15 brands, `kapsuli` 57) no longer applies.

## Identity: URL is unique now

History: `/borbone-crema-classica/` mapped to **two** products (0.500 кг and 1 кг) and
`/eurocaf-piacere-oro/` appeared twice as an accidental duplicate. Today no URL serves
two products: Borbone Crema Classica is `/borbone-crema-classica-500/` and
`/borbone-crema-classica-1/`; the Eurocaf pair became `-green-1` and `-orange-1`.

The chosen identity (**canonical URL path + canonical weight**) is unchanged and still
correct, but the rename means every existing `source_key` changed while the products did
not: the diff sees a mass disappearance and a mass creation. Pairing them is B2's job.
`imageUrl` is still rejected as identity because re-uploading an image would silently
recreate the product.

**Product code.** Every product page now prints a code, `Код: 00011` (five digits,
zero-padded, exposed as a string). In all 12 product fixtures it equals `sku` in the
page's `Product` JSON-LD. It is the candidate second identity (B5); uniqueness across
all 187 pages has not been verified, only the 12 sampled.

## Product page structure (observed on 12 pages)

The page is three `<section>`s in `<main>` (it used to be two), each content block
rendered **twice** (desktop + mobile):

1. **Detail**: `<h1>`, an attribute `<ul>` — `Наличност`, `Код`, `Интензивност`, `Тегло`
   in that order — a short description `<p>`, pack-size and price spans, the quick-order
   widget.
2. **Description**: a longer write-up in a `div.kz-md`, ending with an `<h3>`
   "Характеристики" and a labelled list.
3. **Related products**: headed "СВЪРЗАНИ ПРОДУКТИ", cards that are `<a>` elements
   (they used to be click handlers) followed by a "see all" link that is not a card.

The breadcrumb's middle crumb is no longer always the category: it is "Кафе на зърна"
for beans but the sub-brand page (`/caffitaly/`) for capsules. The parser's
`categoryHref` therefore means "the deepest linked crumb", nothing stronger.

**Characteristics.** Labels seen across the 12 pages (count): Състав 12, Вкусов профил 11,
Произход 7, Съвместимост 7, Послевкус 6, Съвместима система 2, Съвместими капсули 1,
Подходящо за 1 (and one typo, "Вкусfl профил"). The markup is hand-written and varies:

- a `<ul>` of `<li><strong>Label:</strong> value</li>` (11 of 12 pages);
- bare `<p>` lines with `<strong>` labels (`/illy-classico-250/`);
- two pairs inside one `<li>`, with a stray `-` between them (`/dg-molini-napoli-16/`);
- `<li><strong>БЕЗ КОФЕИН</strong></li>` flags with no value (`/dg-foodness-marmaid-latte-10/`).

**What the pages state, and how.** `Състав` holds the blend: `100% арабика`,
`70% арабика, 30% робуста`, `80% робуста, 20% арабика` (robusta first), `100% робуста`,
bare `робуста`, bare `арабика и робуста`, and once `около 80% арабика / 20% робуста`
(hedged). The prose repeats or adds to it (`приблизително 50% арабика`, a word typed with
a Latin "a" in `арaбика`, `100 % арабика` with a space). `Произход` is a country list or a
sentence ("отгледано, изпечено и пакетирано в Неапол, Италия"); where it is absent the
prose may say `с произход от Южна Америка и Индия`. There is **no roast label** on any
page; roast appears only in prose (`изпечена средно тъмно`, `Тъмното изпичане`, and the
relative `леко по-светло средно изпичане`). The parser states only what is unambiguous
and leaves the rest null (see `parsers/productFacts.ts`).

Every product page also carries `Product` and `BreadcrumbList` JSON-LD, after a
`WebSite` block that every page has. `Offer.price` matches the page's price in all 12.

## Enrichment: what the product pages added

The catalog blob carries no product code and no characteristics, so the sync
reads product pages for them (`catalog/enrich.ts`), a few per run. The one-time
backfill (`pnpm catalog:enrich --apply`) read all 187 on the rehearsal catalog:

- **A code on every page** (187 of 187). The code is **not unique**: `00162` is
  printed on two different Rema Dolce Gusto capsules (Forte and Intenso), and
  `00405` on two different Lollo beans (Oro 1 кг, Classico 0.500 кг). It is
  therefore stored and used as a move-detection signal, never as identity.
- **Stated facts**, kept only where unambiguous: an arabica share on 76
  products, an origin on 37, a roast on 22. The rest are null, by design.
- No page failed.

## Request budget

What a run asks of the source, in page requests (the full account is the
comment above the politeness settings in `packages/scraper-core/src/config.ts`):

| Run                                 | Requests                                         |
| ----------------------------------- | ------------------------------------------------ |
| Every sync, nothing changed         | 3: `robots.txt`, the not-found probe, `/search/` |
| A sync on a day with 5 new products | 8: the 3, plus 5 product pages                   |
| Any one sync, at most               | 23: the 3, plus `SYNC_ENRICH_MAX_PER_RUN` (20)   |
| The enrichment backfill, once       | 189: `robots.txt`, the probe, 187 product pages  |

Images are fetched separately, with their own spacing, only for images not
already mirrored. Retries on 5xx, 408, 429 and timeouts come on top; a 404 is
not retried, and a product page that failed is offered again after 24 hours, so
a dead URL costs one request a day. Five product pages failing in a row end
product-page reads for that run. Every request carries `CRAWL_USER_AGENT`, and
a run that writes refuses to start while it names a placeholder contact.

## Data-quality hazards

Today (all verified against the 187-record blob):

- Empty `brandSlug`: **1** record (`/tezzoro-espresso-classic-1/`; was 13).
- Non-conforming image path: `/lavazza-gran-espresso-1/` uses `/img/66123-800w.jpg`
  instead of `/img/product-img-<id>...` (still).
- Dirty URL: `/caffitaly-espresso-morbido-10 /` (a space before the trailing slash).
- Detail pages render the **same content twice**; parsers de-duplicate.
- The footer's "Начини на плащане" describes card payment with the bank-transfer wording
  ("Превод по банкова сметка"). Do not repeat that copy anywhere.

No longer true (kept so nobody re-adds a workaround for it): empty `price` (none now),
comma-decimal price `€4,90` (every price is dotted), missing `weight` (none now),
`old_price` (still empty on every record, see Promotions).

The price-null and comma-decimal parser paths are still tested, on the real pages with
the relevant text rewritten, so they stay covered if the source regresses.

## New and changed pages

- **Vending Zone** `/vending-zona/` (`category-empty.html`) and **Consumables**
  `/konsumativi/` (`category-konsumativi.html`): category-style pages with the same filter
  shell (brand, strength, decaf, aromas), "ПРОДУКТИ (0)", "Няма намерени продукти", and a
  paragraph of descriptive copy. Zero products each. They classify as `category` (an empty
  category) from the filter script on the page; **no new page type** was needed.
- **Promotions** `/promo/` (`promo.html`): same shell, "ПРОДУКТИ (0)", "Няма активни
  промоции в момента". Still zero promotions. Classifies as `promotion` by route.
- **Blog** `/blog/` (`blog-index.html`) now lists one article, under "Препоръчано";
  the article is `/blog/kafezona-na-festivala-za-komunikatsiya-i-lichnostno-razvitie/`
  (`blog-article.html`, `Article` JSON-LD, published 2026-09-18). Classifies as
  `blog_index` and `blog_article` by route; the article is the only page under `/blog/<slug>/`.
- **Free-delivery banner**: every page opens with "Безплатна доставка за поръчки над 49€."
  above a quick-order tagline. It is source marketing copy and says nothing about _our_
  delivery terms.
- **Footer**: category links, contact block, social links, "Начини на плащане"
  (cash on delivery, bank transfer, card). Contact details are public business details;
  fixtures replace the plain-text mailbox with a placeholder.
- **JSON-LD** is now present everywhere (`WebSite` on every page, `LocalBusiness` on the
  home page). The classifier used to read only the first block; it now takes the first
  block that names a page type, because the first is always `WebSite`.

## Observed public features

- Category navigation with a capsules submenu; brand navigation via `/brands/`.
- Search at `/search/?q=` — client-side over `FILTER_INIT`, debounced 300ms, min 2 chars.
- Filters, URL-encoded, applied client-side over `.product-item` data attributes:
  - `brand` (multi, comma-separated), `strength` (multi: `weak|medium|strong`),
    `decaf` (single: `yes|no`), `aromas` (single: `yes|no`)
  - category pages filter by brand/strength/decaf/aromas; brand pages filter by category
- **No sort control and no pagination anywhere** — every listing renders in full.
- Product detail: breadcrumbs, single image, attribute list, short description, long
  description with characteristics, price, quick-order, related products.
- Quick order: phone-only, `POST https://backend.airacms.com/api/intents`
  `{ type: "quick-order", phone, product_name }` with an `X-Tenant-Key` header.
- Newsletter: same endpoint, `{ type: "subscribed", email }`.
- Dismissible sitewide notice banner (localStorage; the 7-day expiry was recorded earlier and not re-checked).

**Neither form was ever submitted.** The third-party tenant key is deliberately not
copied into this repository. Our storefront implements the same _intent_ against our
own endpoint and database.

## Fixtures

`node scripts/build-fixtures.mjs` rebuilds `fixtures/kafezona/` from the live site. It is
the only thing in this repository that contacts the source for fixtures, and it:

- reads `robots.txt` first and refuses any page it disallows;
- fetches sequentially, 1.2 s apart, with `CRAWL_USER_AGENT` (the crawler's own);
- aborts without writing if any page returns a status other than the one expected
  (the 404 fixture expects 404), so an error page can never become a fixture;
- redacts the third-party tenant key (and aborts if anything key-shaped survives), turns
  Cloudflare's rotating email tokens into a constant, and replaces plain-text mailboxes;
- `--raw-dir <dir>` keeps the unsanitised responses; `--offline` rebuilds from them for
  free after a change to a transform.

`parsers.test.ts` re-checks every fixture for the tenant key and for plain-text mailboxes.

Fixtures (25 fetched + 1 derived): home, search (full), category `kafe-kapsuli` (trimmed to
6 cards), Vending Zone, Consumables, brand `lavazza` (4 cards), empty brand `jacobs`, brand
index, promotions, blog index, blog article, privacy, the 404 page, and twelve product
pages — one per pattern the product parser handles (renamed URL; 70/30; 100% arabica with
a labelled origin; 100% robusta with a roast phrase; robusta listed first; hedged figure;
characteristics as paragraphs; malformed list; roast in prose; composition without
figures; not coffee; origin absent).

## Politeness record

2026-10-09 re-recon: **49** requests in total, one at a time, at least 1.2 s apart, with the
crawler's user agent, `robots.txt` honoured. No form was submitted.

- 18 while choosing fixtures: `robots.txt`, 16 product pages, and one old product URL
  (`/lavazza-super-crema/`, 404, which confirmed the rename);
- 26 for the fixture build itself: `robots.txt` again plus the 25 pages listed above;
- 5 for the sitemap and old-URL checks: `sitemap.xml`, `/products/lavazza-super-crema/`,
  `/marki/`, `/kapsuli/`, `/amann-cascada/` (all four old URLs returned 404).
