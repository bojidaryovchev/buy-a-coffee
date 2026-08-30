# Source site recon — kafezona.com

Recorded during implementation. All observations come from ordinary unauthenticated
HTTP GETs of public pages. No forms were submitted. No controls were bypassed.

## Access

- `robots.txt`: `Allow: /`, single `Disallow: /cdn-cgi/l/email-protection`. Sitemap declared.
- Fronted by Cloudflare. Plain HTTP `GET` returns full server-rendered HTML; **no browser
  automation is required**. Playwright is therefore not used.
- Language: Bulgarian. Currency: **EUR** (`€`).

## Critical behaviour: soft 404s

Unknown routes return **HTTP 200 with the homepage shell**, not 404.

    /this-does-not-exist-xyz/   -> 200, byte-identical homepage shell
    /marki/                     -> 200, homepage shell (stale sitemap entry)
    /products/<slug>/           -> 200, homepage shell (ALL 111 sitemap entries)

A crawler that trusts status codes would ingest 111 phantom "products". Soft-404
detection is mandatory and is implemented as a first-class fetch concern.

## Stale sitemap

`sitemap.xml` lists 148 URLs, of which 111 use a `/products/<slug>/` prefix that no
longer exists. Real product pages live at the **root**: `/<slug>/`. The sitemap is
therefore treated as a hint, never as truth; every candidate is verified.

## URL space

Flat. Products, categories and brands all live at `/<slug>/`, so page type **cannot**
be derived from the URL path. Classification uses DOM/content signals.

Known dirty URLs present in the site's own markup and data:

- `/raztvorimo kafe/` — literal unencoded space in the path
- `/ vergnano/` — leading space (brand slug is literally `" vergnano"`)
- `/brands/` is live; `/marki/` is a soft 404 although the sitemap lists it

## Primary catalog source: `window.FILTER_INIT`

`/search/` embeds the site's own complete structured catalog in an inline script:

    window.FILTER_INIT = {
      brands:     [{ id, h1, slug, count }],
      categories: [{ id, h1, slug, count, children: [...] }],
      products:   [{ h1, url, price, old_price, availability, weight, intensity,
                     brewStrength, decaf, aromas, brandSlug, categorySlug,
                     imageUrl, description }]
    }

Scope check across pages:

| Page             | FILTER_INIT | products |
|------------------|-------------|----------|
| `/search/`       | yes         | 111 (full) |
| brand pages      | yes         | none (scoped categories only) |
| category pages   | no          | — (renders `.product-item` HTML) |
| everything else  | no          | — |

So `/search/` is the single authoritative catalog index. Category listing HTML is an
**independent fallback** source parsed by a separate parser, which keeps sync alive if
the blob disappears and feeds parser-confidence into the circuit breaker.

## Catalog shape (observed)

- **111 product records, 109 distinct URLs**, 15 brands with products, 3 top-level
  categories, 5 capsule subcategories.
- Category counts: `kafe-na-zyrna` 51, `kapsuli` 57 (nespresso 22, dolce-gusto 28,
  a-modo-mio 3, caffitaly 3, lavazza-blue 1), `kafe-dozi` 3.
- `/vending-zona/` and `/raztvorimo kafe/` are real navigation categories with **zero**
  products and are absent from `FILTER_INIT.categories`.
- `/brands/` lists 21 brands; only 15 currently have products.
- `/promo/` renders correctly but currently holds **zero** promotions; every
  `old_price` is empty. The promotion capability exists and must be supported.
- `/blog/` exists and is empty ("Все още няма публикувани статии").

## Identity: URL is NOT unique

`/borbone-crema-classica/` maps to **two genuinely different products**:

    Borbone Crema Classica 0.500кг.  €10.70  image 1221
    Borbone Crema Classica 1кг.      €20.50  image 1204

Only the 0.500кг variant is reachable at that URL; the 1кг variant has no detail page.

`/eurocaf-piacere-oro/` also appears twice — same name, same price, same weight, two
different image IDs and a typo'd description. That is an accidental duplicate in the
source CMS and *should* collapse.

Chosen identity: **canonical URL path + canonical weight**, where weight is normalised
to a unit-bearing token (`1 кг.` -> `1000g`, `10 бр.` -> `10pc`). This splits the
Borbone pair correctly and collapses the Eurocaf pair correctly, yielding 110 products.
`imageUrl` is unique across all 111 but is rejected as identity because re-uploading an
image would silently recreate the product.

## Data-quality hazards (all real, all observed)

- Missing price: `/lavazza-gusto-forte/`, `/rema-caffe-intenso/` have empty `price`
  on both the index and the detail page. Price must be nullable.
- Comma decimal: `/dg-molini-napoli/` is `€4,90` while everything else uses `.`.
- Missing weight: `/rema-caffe-intenso/` has none.
- 13 products carry an empty `brandSlug` despite a matching brand page existing.
- Non-conforming image path: `/lavazza-gran-espresso/` uses `/img/66123-800w.jpg`
  instead of `/img/product-img-<id>...`.
- Detail pages render the **same content twice** (desktop + mobile blocks); parsers
  must de-duplicate rather than double-count.

## Observed public features

- Category navigation with a capsules submenu; brand navigation via `/brands/`.
- Search at `/search/?q=` — client-side over `FILTER_INIT`, debounced 300ms, min 2 chars.
- Filters, URL-encoded, applied client-side over `.product-item` data attributes:
  - `brand` (multi, comma-separated), `strength` (multi: `weak|medium|strong`),
    `decaf` (single: `yes|no`), `aromas` (single: `yes|no`)
  - category pages filter by brand/strength/decaf/aromas; brand pages filter by category
- **No sort control and no pagination anywhere** — every listing renders in full.
- Product detail: breadcrumbs, single image, attribute list (availability, intensity,
  weight), short description, price, quick-order, related products.
- Quick order: phone-only, `POST https://backend.airacms.com/api/intents`
  `{ type: "quick-order", phone, product_name }` with an `X-Tenant-Key` header.
- Newsletter: same endpoint, `{ type: "subscribed", email }`.
- Dismissible sitewide notice banner (localStorage, 7 days).

**Neither form was ever submitted.** The third-party tenant key is deliberately not
copied into this repository. Our storefront implements the same *intent* against our
own endpoint and database.
