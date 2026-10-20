"use client";

import { useEffect, useId, useRef, useState } from "react";
import { INPUT_CLASS } from "@/components/forms/field-styles";
import { buttonClasses } from "@/components/ui/primitives";
import { describeProduct, type PromotionPickerProduct } from "@/lib/promotions/picker";

/**
 * Find products by name, brand or address and add them to a list — the
 * promotion's own products, or the ones it leaves out.
 *
 * Built like the newsletter's picker (`newsletter-product-picker.tsx`): the
 * search is a route (`/api/admin/promotions/products`), asked a moment after
 * typing stops, a newer term aborting the older request; what it shows of a
 * product is the shop's own card. What differs is what a choice does: here
 * each press adds or takes away one product at once, with no limit and
 * nothing to insert, and the list it builds is drawn by the editor.
 */

const MIN_TERM = 2;

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

export function PromotionProductPicker({
  title,
  addLabel,
  chosen,
  onToggle,
  onClose,
}: {
  title: string;
  /** The button's word for adding: "Добави", "Изключи". */
  addLabel: string;
  chosen: ReadonlySet<string>;
  onToggle: (product: PromotionPickerProduct) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [term, setTerm] = useState("");
  const [answer, setAnswer] = useState<{
    term: string;
    products: PromotionPickerProduct[];
    error: string | null;
  }>({ term: "", products: [], error: null });
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => searchRef.current?.focus(), []);

  const query = term.trim();
  useEffect(() => {
    if (query.length < MIN_TERM) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      let next: { products: PromotionPickerProduct[]; error: string | null };
      try {
        const response = await fetch(
          `/api/admin/promotions/products?q=${encodeURIComponent(query)}`,
          { signal: controller.signal, headers: { accept: "application/json" } },
        );
        const result = (await response.json()) as {
          products?: PromotionPickerProduct[];
          error?: string;
        };
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
  const results = query.length >= MIN_TERM && answer.term === query ? answer.products : [];

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
      <h4 id={`${id}-title`} className="text-sm font-semibold text-ink-900">
        {title}
      </h4>

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
          // Enter here must not submit the promotion form.
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
            const isChosen = chosen.has(product.id);
            return (
              <li key={product.id} className="flex items-center gap-3 px-3 py-2">
                <Thumb src={product.image} />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium break-words text-ink-900">{product.title}</p>
                  <p className="text-xs text-ink-500">
                    {[
                      product.detail,
                      product.price ?? "Без цена",
                      product.soldOut ? "Изчерпан" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {/* One name whatever its state, which `aria-pressed` says; the
                    pack is in it because two packs can share a title. */}
                <button
                  type="button"
                  aria-pressed={isChosen}
                  aria-label={`${addLabel}: ${describeProduct(product)}`}
                  onClick={() => onToggle(product)}
                  className={buttonClasses({
                    variant: "secondary",
                    size: "sm",
                    className: "aria-pressed:border-pine-700 aria-pressed:bg-pine-100",
                  })}
                >
                  {isChosen ? "Избран" : addLabel}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4">
        <button
          type="button"
          onClick={onClose}
          className={buttonClasses({ variant: "secondary", size: "sm" })}
        >
          Готово
        </button>
      </div>
    </div>
  );
}
