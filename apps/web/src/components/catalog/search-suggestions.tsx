import { BrandLogo, legibleBrandLogo } from "@/components/catalog/brand-logo";
import { ImagePlaceholder } from "@/components/catalog/image-placeholder";
import { ProductImage } from "@/components/catalog/product-image";
import type { SearchCopy } from "@/components/catalog/search-field-fallback";
import { SystemBadge } from "@/components/catalog/system-badge";
import type { Locale } from "@/i18n/config";
import { fill, plural } from "@/i18n/fill";
import type { SearchSuggestions } from "@/lib/catalog/types";
import { brandHref, categoryHref, href, productHref, routes } from "@/lib/routes";

/**
 * The search field's typeahead: what it asks the server, and the dropdown it
 * draws from the answer.
 *
 * Only ever reached through the `import()` in `search-field.tsx`, after the
 * page has loaded or the moment the visitor reaches for the field. The field
 * itself — the form, its state, the keys — is drawn by the server and works
 * without any of this; the logos, the photographs and the badges a dropdown
 * row needs are the bulk of the search's code, and no page needs them to
 * paint.
 *
 * The suggestions come from `/api/search/suggest`, which matches with the same
 * predicate as the results page. A dropdown that offers something the results
 * page cannot then find would be worse than no dropdown at all.
 *
 * Requests are debounced and de-duplicated through a small session cache,
 * because backspacing through a word should not re-ask the database questions
 * it has already answered.
 */

/** Long enough that a fast typist does not fire a request per character. */
const DEBOUNCE_MS = 180;
/** Bounded so a long session cannot grow the cache without limit. */
const CACHE_LIMIT = 40;

/*
 * Suggestions already fetched this visit, keyed by term, for every field on
 * the page: the header's and the search page's ask the same questions.
 */
const cache = new Map<string, SearchSuggestions>();

/**
 * Ask for the suggestions for `term` after the debounce, and hand them to
 * `onResult`; at once when they are already known. Returns the cancel, which
 * also aborts a request in flight: without it, a slow response for "la" could
 * land after a fast one for "lavazza" and replace it with stale rows.
 */
export function fetchSuggestions(
  term: string,
  onResult: (suggestions: SearchSuggestions) => void,
): () => void {
  const cached = cache.get(term);
  if (cached) {
    onResult(cached);
    return () => undefined;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    void (async () => {
      try {
        const response = await fetch(`/api/search/suggest?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        if (!response.ok) return;
        const data = (await response.json()) as SearchSuggestions;
        // The server echoes the term back; anything else is a stale reply.
        if (data.term !== term) return;

        if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
        cache.set(term, data);
        onResult(data);
      } catch {
        // An aborted or failed lookup leaves the form perfectly usable.
      }
    })();
  }, DEBOUNCE_MS);

  return () => {
    clearTimeout(timer);
    controller.abort();
  };
}

/** Where each kind of row leads, in the locale the field is drawn in. */
export function suggestionLinks(locale: Locale) {
  return {
    product: (slug: string) => productHref(locale, { slug }),
    brand: (brand: SearchSuggestions["brands"][number]) => brandHref(locale, brand),
    category: (category: SearchSuggestions["categories"][number]) => categoryHref(locale, category),
    results: (term: string) => href(locale, `${routes.search}?q=${encodeURIComponent(term)}`),
  };
}

export type SuggestionLinks = ReturnType<typeof suggestionLinks>;

/**
 * The destination of every row the arrow keys can reach, in the order the
 * panel draws them. The panel numbers its rows in the same order, which is
 * what `aria-activedescendant` relies on.
 */
export function suggestionOptions(
  suggestions: SearchSuggestions,
  term: string,
  links: SuggestionLinks,
): string[] {
  // Results for a term the visitor has already typed past are not navigable.
  if (suggestions.term !== term) return [];
  const rows = [
    ...suggestions.products.map((product) => links.product(product.slug)),
    ...suggestions.brands.map((brand) => links.brand(brand)),
    ...suggestions.categories.map((category) => links.category(category)),
  ];
  if (suggestions.total > 0) rows.push(links.results(term));
  return rows;
}

/**
 * The dropdown.
 *
 * `role="option"` is put directly on the anchors rather than on wrapping list
 * items. That trades the link role away in the accessibility tree for two
 * things worth more here: the option's accessible name comes from its own
 * contents, and every row keeps a real `href`, so a product can still be
 * middle-clicked or opened in a new tab. Focus stays on the input throughout;
 * `aria-activedescendant` is what moves.
 *
 * The line a screen reader hears when the list opens is the field's, not
 * this panel's: a live region has to be in the page before what it announces
 * changes, and this panel arrives later than the field.
 */
export function SuggestionPanel({
  id,
  expanded,
  suggestions,
  term,
  activeIndex,
  onHover,
  onSelect,
  links,
  copy,
}: {
  id: string;
  expanded: boolean;
  suggestions: SearchSuggestions;
  term: string;
  activeIndex: number;
  onHover: (index: number) => void;
  onSelect: (href: string) => void;
  links: SuggestionLinks;
  copy: SearchCopy;
}) {
  if (!expanded) return null;

  let index = -1;
  const next = () => (index += 1);

  return (
    <div className="absolute top-full right-0 left-0 z-50 mt-1 max-h-[70vh] overflow-y-auto overscroll-contain rounded-md border border-line bg-paper-raised py-1.5 shadow-float">
      <ul id={id} role="listbox" aria-label={copy.suggestions}>
        {suggestions.products.map((product) => (
          <SuggestionRow
            key={product.slug}
            id={id}
            index={next()}
            activeIndex={activeIndex}
            href={links.product(product.slug)}
            onHover={onHover}
            onSelect={onSelect}
          >
            <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-sm bg-well">
              {product.image ? (
                <ProductImage
                  src={product.image.url}
                  alt=""
                  fill
                  sizes="40px"
                  placeholderLabel={false}
                  className="object-contain"
                />
              ) : (
                <ImagePlaceholder label={false} />
              )}
            </span>

            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-ink-900">{product.title}</span>
              <span className="mt-0.5 flex min-w-0 items-center gap-1.5">
                <SystemBadge systemId={product.systemId} size="sm" />
                <BrandAndWeight product={product} />
              </span>
            </span>

            {product.price && (
              <span className="shrink-0 text-sm font-semibold text-ink-900 tabular-nums">
                {product.price.formatted}
              </span>
            )}
          </SuggestionRow>
        ))}

        {suggestions.brands.length > 0 && <GroupLabel>{copy.brands}</GroupLabel>}
        {suggestions.brands.map((brand) => (
          <SuggestionRow
            key={brand.slug}
            id={id}
            index={next()}
            activeIndex={activeIndex}
            href={links.brand(brand)}
            onHover={onHover}
            onSelect={onSelect}
          >
            {/* Decorative: the name follows in text. A brand with no logo
                keeps the empty box, so the names line up. */}
            <BrandLogo brand={brand} size="suggestion" decorative fallback="blank" />
            <span className="min-w-0 flex-1 truncate text-sm text-ink-900">{brand.name}</span>
            <span className="shrink-0 text-2xs text-ink-300">{brand.productCount}</span>
          </SuggestionRow>
        ))}

        {suggestions.categories.length > 0 && <GroupLabel>{copy.categories}</GroupLabel>}
        {suggestions.categories.map((category) => (
          <SuggestionRow
            key={category.slug}
            id={id}
            index={next()}
            activeIndex={activeIndex}
            href={links.category(category)}
            onHover={onHover}
            onSelect={onSelect}
          >
            <span className="min-w-0 flex-1 truncate text-sm text-ink-900">{category.name}</span>
            <span className="shrink-0 text-2xs text-ink-300">{category.productCount}</span>
          </SuggestionRow>
        ))}

        {suggestions.total > 0 && (
          <SuggestionRow
            id={id}
            index={next()}
            activeIndex={activeIndex}
            href={links.results(term)}
            onHover={onHover}
            onSelect={onSelect}
          >
            <span className="flex-1 text-sm font-medium text-pine-700">
              {fill(plural(copy.seeAll, suggestions.total), { count: suggestions.total })}
            </span>
            <span aria-hidden className="text-pine-700">
              →
            </span>
          </SuggestionRow>
        )}
      </ul>
    </div>
  );
}

/**
 * A product row's brand and pack size: the brand's logo, named by its alt,
 * where it can be read at this size; its name in the line otherwise.
 */
function BrandAndWeight({
  product,
}: {
  product: Pick<SearchSuggestions["products"][number], "brandName" | "brandSlug" | "weight">;
}) {
  const { brandName, brandSlug, weight } = product;
  const logo = brandSlug && brandName && legibleBrandLogo(brandSlug, "chip");
  const text = [logo ? null : brandName, weight].filter(Boolean).join(" · ");
  return (
    <>
      {logo && <BrandLogo brand={{ slug: brandSlug, name: brandName }} size="chip" inline />}
      {logo && weight && (
        <span aria-hidden className="text-2xs text-ink-500">
          ·
        </span>
      )}
      {text && (
        <span className="truncate text-2xs tracking-wide text-ink-500 uppercase">{text}</span>
      )}
    </>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <li
      role="presentation"
      className="mt-1 border-t border-line px-3 pt-2 pb-1 text-2xs tracking-wide text-ink-500 uppercase"
    >
      {children}
    </li>
  );
}

function SuggestionRow({
  id,
  index,
  activeIndex,
  href,
  onHover,
  onSelect,
  children,
}: {
  id: string;
  index: number;
  activeIndex: number;
  href: string;
  onHover: (index: number) => void;
  onSelect: (href: string) => void;
  children: React.ReactNode;
}) {
  const isActive = index === activeIndex;
  return (
    <li role="presentation">
      <a
        id={`${id}-${index}`}
        role="option"
        aria-selected={isActive}
        href={href}
        tabIndex={-1}
        onMouseEnter={() => onHover(index)}
        /*
         * `mousedown` blurs the input before `click` would land, which would
         * close the panel out from under the pointer. Suppressing that keeps
         * the click on the row it was aimed at.
         */
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          // Let the browser handle modified clicks — new tab, new window.
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
          event.preventDefault();
          onSelect(href);
        }}
        className={`flex w-full items-center gap-3 px-3 py-2 text-left ${
          isActive ? "bg-pine-100" : "hover:bg-paper-sunken"
        }`}
      >
        {children}
      </a>
    </li>
  );
}
