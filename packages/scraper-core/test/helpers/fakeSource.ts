/**
 * A synthetic stand-in for the reference site.
 *
 * Integration tests exercise the real `Fetcher`, `discoverCatalog` and
 * `runCatalogSync` code paths — only the network is replaced. That keeps the
 * tests honest (they run the production code) while making them hermetic and
 * free of any load on the real source.
 *
 * The fake reproduces the source's two defining quirks:
 *   - unknown routes answer HTTP 200 with the home-page shell (soft 404),
 *   - the catalog is published as a `window.FILTER_INIT` blob on `/search/`.
 */

export interface FakeProduct {
  readonly h1: string;
  readonly url: string;
  readonly price?: string;
  readonly old_price?: string;
  readonly availability?: string;
  readonly weight?: string;
  readonly intensity?: string;
  readonly brewStrength?: string;
  readonly decaf?: string;
  readonly aromas?: string;
  readonly brandSlug?: string;
  readonly categorySlug?: string;
  readonly imageUrl?: string;
  readonly description?: string;
}

export interface FakeSiteOptions {
  readonly products: readonly FakeProduct[];
  readonly brands?: ReadonlyArray<{ id: string; h1: string; slug: string; count: number }>;
  readonly categories?: ReadonlyArray<{ id: string; h1: string; slug: string; count: number; children?: unknown[] }>;
  /** Force `/search/` to fail, so the HTML fallback path is exercised. */
  readonly searchStatus?: number;
  /** Serve a listing page with cards for the HTML fallback. */
  readonly listingProducts?: readonly FakeProduct[];
  /** Fail every request to these paths. */
  readonly failingPaths?: readonly string[];
}

const SHELL = `<!doctype html><html lang="bg"><head><title>Fake Shop — home</title></head><body><header>chrome</header><p>home shell</p></body></html>`;

const IMAGE_BYTES = Buffer.from([
  // Smallest valid PNG.
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

function completeProduct(product: FakeProduct): Required<FakeProduct> {
  return {
    h1: product.h1,
    url: product.url,
    price: product.price ?? "€10.00",
    old_price: product.old_price ?? "",
    availability: product.availability ?? "in_stock",
    weight: product.weight ?? "1 кг.",
    intensity: product.intensity ?? "8 от 10",
    brewStrength: product.brewStrength ?? "strong",
    decaf: product.decaf ?? "no",
    aromas: product.aromas ?? "no",
    brandSlug: product.brandSlug ?? "testbrand",
    categorySlug: product.categorySlug ?? "testcategory",
    imageUrl: product.imageUrl ?? `/img/product-img-${hashOf(product.url)}.jpg-800w.jpg`,
    description: product.description ?? "A fine synthetic blend.",
  };
}

function hashOf(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) % 100000;
  return hash;
}

function buildSearchPage(options: FakeSiteOptions): string {
  const brands =
    options.brands ??
    [{ id: "1", h1: "Test Brand", slug: "testbrand", count: options.products.length }];
  const categories =
    options.categories ??
    [{ id: "10", h1: "Test Category", slug: "testcategory", count: options.products.length, children: [] }];

  return `<!doctype html><html><head><title>Search</title></head><body>
<script>
window.FILTER_INIT = {
  brands:     ${JSON.stringify(brands)},
  categories: ${JSON.stringify(categories)},
  products:   ${JSON.stringify(options.products.map(completeProduct))}
};
</script>
</body></html>`;
}

function buildListingPage(products: readonly FakeProduct[]): string {
  const cards = products
    .map((raw) => {
      const p = completeProduct(raw);
      return `<div class="product-item" data-brand="${p.brandSlug}" data-strength="${p.brewStrength}" data-decaf="${p.decaf}" data-aromas="${p.aromas}">
  <div onclick="window.location='${p.url}'">
    <img src="${p.imageUrl}" alt="${p.h1}">
    <p>${p.h1}</p>
    <p>${p.description}</p>
    <p>${p.price}</p>
    <a href="${p.url}">Order</a>
  </div>
</div>`;
    })
    .join("\n");

  return `<!doctype html><html><head><title>Listing</title></head><body>
<h1>Listing</h1>
${cards}
<script>
function pushFiltersToURL() {
  var params = new URLSearchParams(window.location.search);
  if (_activeBrands.length) params.set('brand', _activeBrands.join(',')); else params.delete('brand');
  if (_activeStrengths.length) params.set('strength', _activeStrengths.join(',')); else params.delete('strength');
  if (_activeDecaf) params.set('decaf', _activeDecaf); else params.delete('decaf');
  if (_activeAromas) params.set('aromas', _activeAromas); else params.delete('aromas');
}
</script>
</body></html>`;
}

/** Build a `fetch` implementation that serves the fake site. */
export function createFakeFetch(options: FakeSiteOptions): {
  fetchImpl: typeof fetch;
  requests: string[];
} {
  const requests: string[] = [];
  const failing = new Set(options.failingPaths ?? []);

  const fetchImpl = (async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(typeof input === "object" && "url" in input ? input.url : input));
    const pathname = decodeURIComponent(url.pathname);
    requests.push(pathname);

    if (failing.has(pathname)) {
      return new Response("upstream error", { status: 503 });
    }

    if (pathname === "/robots.txt") {
      return new Response("User-agent: *\nAllow: /\n", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }

    if (pathname.startsWith("/img/")) {
      return new Response(IMAGE_BYTES, {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }

    if (pathname === "/search/") {
      if (options.searchStatus && options.searchStatus !== 200) {
        return new Response("nope", { status: options.searchStatus });
      }
      return new Response(buildSearchPage(options), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (options.listingProducts && LISTING_PATHS.has(pathname)) {
      return new Response(buildListingPage(options.listingProducts), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    // Everything else — including unknown routes — answers with the shell,
    // exactly as the real source does.
    return new Response(SHELL, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }) as unknown as typeof fetch;

  return { fetchImpl, requests };
}

const LISTING_PATHS = new Set([
  "/kafe-na-zyrna/",
  "/kapsuli/",
  "/kafe-dozi/",
  "/raztvorimo kafe/",
  "/vending-zona/",
]);

/** A small, stable catalog used as the baseline in most tests. */
export function baseCatalog(): FakeProduct[] {
  return Array.from({ length: 12 }, (_, index) => ({
    h1: `Coffee number ${index + 1} 1кг.`,
    url: `/coffee-${index + 1}/`,
    price: `€${(10 + index).toFixed(2)}`,
    weight: "1 кг.",
    brandSlug: index % 2 === 0 ? "testbrand" : "otherbrand",
    categorySlug: "testcategory",
  }));
}
