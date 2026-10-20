"use client";

import { useEffect, useId, useRef, useState } from "react";
import { INPUT_CLASS } from "@/components/forms/field-styles";
import type { PickerProduct } from "@/lib/newsletter/picker";
import { MAX_BLOCK_PRODUCTS } from "@/lib/newsletter/tokens";

/**
 * The composer's "Продукти": find products by name, brand or address, choose
 * up to six, and put them in the letter — as a new block, as more of a block
 * already there ("+ Добави", which says how many it still takes and leaves
 * out what it already has), or as one `[[продукти: …]]` line in the
 * Markdown text.
 *
 * The search is `/api/admin/newsletter/products`, which checks the session
 * like the panel's other routes, asked a moment after typing stops. A route
 * and not a server action: actions run one at a time per page, and a slow
 * search must not hold up "Запази". A newer term aborts the request for an
 * older one, and closing the picker aborts whatever is out. What the picker
 * shows of a product —
 * photo, name, price — is the storefront's card, so what the owner chooses
 * is what the letter will show. The line itself holds only the addresses:
 * the letter reads the name and the price when it is drawn.
 */

const BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-sm border border-line-strong bg-paper-raised px-3 py-1.5 text-sm font-medium whitespace-nowrap text-ink-900 transition-colors hover:bg-paper-sunken disabled:cursor-not-allowed disabled:text-ink-500";
const BUTTON_PRIMARY =
  "inline-flex min-h-11 items-center justify-center rounded-sm bg-pine-900 px-4 py-2 text-sm font-semibold whitespace-nowrap text-paper transition-colors hover:bg-pine-700 disabled:cursor-not-allowed disabled:bg-paper-sunken disabled:text-ink-500";

const MIN_TERM = 2;

/** "Lavazza Crema e Aroma, Кафе на зърна, 1 кг": a product told apart from its other packs. */
const describe = (product: PickerProduct) =>
  product.detail ? `${product.title}, ${product.detail}` : product.title;

function Thumb({ src }: { src: string | null }) {
  return src ? (
    <img
      src={src}
      alt=""
      width={48}
      height={48}
      className="size-12 shrink-0 rounded-sm border border-line bg-paper-raised object-contain"
    />
  ) : (
    <span className="size-12 shrink-0 rounded-sm border border-line bg-paper-sunken" />
  );
}

function Price({ product }: { product: PickerProduct }) {
  if (!product.price) return <span className="text-ink-500">Цена при запитване</span>;
  return (
    <span className="tabular-nums">
      <span className={product.oldPrice ? "font-semibold text-clay-600" : "font-semibold"}>
        {product.price}
      </span>
      {product.oldPrice && (
        <span className="ml-1.5 text-ink-500 line-through">{product.oldPrice}</span>
      )}
    </span>
  );
}

export function NewsletterProductPicker({
  onInsert,
  onClose,
  max = MAX_BLOCK_PRODUCTS,
  exclude = [],
  insertLabel = (count) => (count > 1 ? `Вмъкни ${count} продукта` : "Вмъкни в текста"),
}: {
  /** The chosen products, in the order chosen; the block is written from their slugs. */
  onInsert: (products: PickerProduct[]) => void;
  onClose: () => void;
  /** How many more the block takes. */
  max?: number;
  /** Slugs the block already shows, which are not offered again. */
  exclude?: readonly string[];
  insertLabel?: (count: number) => string;
}) {
  const id = useId();
  const [term, setTerm] = useState("");
  const [answer, setAnswer] = useState<{
    term: string;
    products: PickerProduct[];
    error: string | null;
  }>({ term: "", products: [], error: null });
  const [selected, setSelected] = useState<PickerProduct[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => searchRef.current?.focus(), []);

  const query = term.trim();
  useEffect(() => {
    if (query.length < MIN_TERM) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      let next: { products: PickerProduct[]; error: string | null };
      try {
        const response = await fetch(
          `/api/admin/newsletter/products?q=${encodeURIComponent(query)}`,
          { signal: controller.signal, headers: { accept: "application/json" } },
        );
        const result = (await response.json()) as { products?: PickerProduct[]; error?: string };
        next = {
          products: result.products ?? [],
          error: response.ok ? null : (result.error ?? "Търсенето не успя. Опитайте отново."),
        };
      } catch {
        // Aborted for a newer term, or the picker closed: nothing to show.
        if (controller.signal.aborted) return;
        next = { products: [], error: "Търсенето не успя. Опитайте отново." };
      }
      if (!controller.signal.aborted) setAnswer({ term: query, ...next });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const searching = query.length >= MIN_TERM && answer.term !== query;
  const results = (query.length >= MIN_TERM && answer.term === query ? answer.products : []).filter(
    (product) => !exclude.includes(product.slug),
  );
  const full = selected.length >= max;
  const isSelected = (slug: string) => selected.some((product) => product.slug === slug);
  const toggle = (product: PickerProduct) =>
    setSelected((list) =>
      list.some((item) => item.slug === product.slug)
        ? list.filter((item) => item.slug !== product.slug)
        : list.length >= max
          ? list
          : [...list, product],
    );

  const status =
    query.length < MIN_TERM
      ? "Напишете поне две букви от името, марката или адреса на продукта."
      : searching
        ? "Търси се…"
        : answer.error
          ? answer.error
          : results.length === 0
            ? "Няма продаван продукт с такова име."
            : `${results.length === 1 ? "1 продукт" : `${results.length} продукта`}.`;

  return (
    <div
      role="group"
      aria-labelledby={`${id}-title`}
      className="mt-3 rounded-md border border-line-strong bg-paper-raised p-4"
    >
      <h3 id={`${id}-title`} className="text-sm font-semibold text-ink-900">
        Продукти в писмото
      </h3>
      <p className="mt-0.5 text-xs text-ink-500">
        {max < MAX_BLOCK_PRODUCTS ? `Още до ${max}` : `До ${MAX_BLOCK_PRODUCTS}`}, в реда, в който
        ги изберете. Името, цената и снимката се взимат от магазина, когато писмото се изпраща.
      </p>

      <label htmlFor={`${id}-search`} className="mt-3 block text-sm font-medium text-ink-900">
        Търсене
      </label>
      <input
        ref={searchRef}
        id={`${id}-search`}
        type="search"
        value={term}
        onChange={(event) => setTerm(event.currentTarget.value)}
        onKeyDown={(event) => {
          // Enter here must not submit the newsletter form.
          if (event.key === "Enter") event.preventDefault();
          if (event.key === "Escape") onClose();
        }}
        placeholder="Име, марка или адрес, напр. Lavazza"
        autoComplete="off"
        aria-describedby={`${id}-status`}
        className={`mt-1 ${INPUT_CLASS}`}
      />
      <p id={`${id}-status`} role="status" className="mt-1 text-xs text-ink-500">
        {status}
      </p>

      {results.length > 0 && (
        <ul className="mt-2 flex max-h-80 flex-col divide-y divide-line overflow-y-auto rounded-sm border border-line">
          {results.map((product) => {
            const chosen = isSelected(product.slug);
            return (
              <li key={product.slug} className="flex items-center gap-3 px-3 py-2">
                <Thumb src={product.image} />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium break-words text-ink-900">{product.title}</p>
                  <p className="text-xs text-ink-500">
                    {[product.detail, product.soldOut ? "Изчерпан" : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <p className="text-sm">
                    <Price product={product} />
                  </p>
                </div>
                {/* One name whatever its state, which `aria-pressed` says; the
                    pack is in it because two packs can share a title. */}
                <button
                  type="button"
                  aria-pressed={chosen}
                  aria-label={`Избери: ${describe(product)}`}
                  disabled={!chosen && full}
                  onClick={() => toggle(product)}
                  className={`${BUTTON} aria-pressed:border-pine-700 aria-pressed:bg-pine-100`}
                >
                  {chosen ? "Избран" : "Избери"}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selected.length > 0 && (
        <div className="mt-3">
          <p className="text-sm font-medium text-ink-900">
            Избрани: {selected.length} от {max}
          </p>
          <ol className="mt-1 flex flex-col gap-1 text-sm">
            {selected.map((product, index) => (
              <li key={product.slug} className="flex items-center gap-2">
                <span className="w-5 text-right text-ink-500 tabular-nums">{index + 1}.</span>
                <span className="min-w-0 flex-1 break-words text-ink-900">
                  {product.title}
                  {product.detail && <span className="text-ink-500"> · {product.detail}</span>}
                </span>
                <button
                  type="button"
                  aria-label={`Махни: ${describe(product)}`}
                  onClick={() => toggle(product)}
                  className="min-h-9 px-2 text-sm text-pine-700 underline underline-offset-2"
                >
                  Махни
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={selected.length === 0}
          onClick={() => onInsert(selected)}
          className={BUTTON_PRIMARY}
        >
          {insertLabel(selected.length)}
        </button>
        <button type="button" onClick={onClose} className={BUTTON}>
          Отказ
        </button>
      </div>
    </div>
  );
}
