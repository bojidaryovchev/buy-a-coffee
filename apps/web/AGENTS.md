<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Pages, links and names in this app

Read `docs/architecture.md`, "Routes", before adding a page or a link. The
short version:

- **Every shop page is under `src/app/(site)/[lang]/`.** Folder names are the
  canonical Bulgarian segments. There is no `app/layout.tsx`; the `[lang]`
  layout is the shop's root layout. A page reads its locale with `localeFrom`
  or `shippingLocale` from `src/i18n/params.ts`.
- **Never write a path as a string.** Build every link, canonical, breadcrumb
  and JSON-LD URL with `href(locale, routes.x)`, `categoryHref`, `productHref`,
  `brandHref` or `targetHref` from `src/lib/routes.ts`. `test/bare-paths.test.ts`
  fails on a bare one. The admin panel and the API carry no locale and are the
  exception.
- **A new static page** needs its segment in `ROUTE_SEGMENTS`
  (`src/i18n/slugs/types.ts`), its spelling in both slug tables
  (`src/i18n/slugs/bg.ts`, `en.ts`), an entry in `routes`, and its folder. That
  also reserves the slug, so no product or category can take it. Declare
  `alternates` with `pageAlternates` or `localeAlternates`
  (`src/lib/seo/alternates.ts`), canonical and `hreflang` together, and its
  share tags with `shareMetadata` (`src/lib/seo/share.ts`) from the same path.
  Never write `openGraph:` or `twitter:` by hand; `test/share.test.ts` fails on
  it. A new page type also goes in the `pages` list of "the head of every
  page" in `e2e/i18n.spec.ts`.
- **Middleware is `src/proxy.ts`**, exporting `proxy`. It decides the 404 for
  catalog slugs; a page that can name something the catalog may not hold
  belongs in `catalogLookup` and `src/lib/catalog/slug-exists.ts`, or sets
  `dynamicParams = false`.
- **Titles** end through `fullTitle` (`src/lib/seo/title.ts`): set a plain
  `title` and let the layout's template finish it, or use `pageTitle` from
  `src/lib/seo/listing-meta.ts`. Do not type a separator.
- **Frame strings** (header, footer, drawer, 404) go in both dictionaries,
  `src/i18n/dictionaries/bg.ts` and `en.ts`. Page copy is Bulgarian in place.
- **A product's name** is whatever the query layer hands you (`name`, `title`,
  `detail`), computed by `productName()` in `@catalog/shared`. Never render
  `products.name`: that is the source's wording and is for the admin only.
- **No figure in copy.** A count, a price or a price per cup is computed from
  the catalog at render time and passed in.
