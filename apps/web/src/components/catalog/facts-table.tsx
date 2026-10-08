import Link from "next/link";
import type { ReactNode } from "react";
import { GRAMS_PER_SERVING } from "@catalog/shared";
import { IntensityScale } from "@/components/catalog/intensity-scale";
import { SystemBadge } from "@/components/catalog/system-badge";
import { STRENGTH_LABELS, attributeValueLabel } from "@/lib/catalog/attributes";
import { compositionLabel, packLabel, systemListingHref } from "@/lib/catalog/product-facts";
import { getBrewingSystem } from "@/lib/recommend/systems";
import type { ProductDetailView } from "@/lib/catalog/types";

/**
 * The facts table on a product page ("Характеристики").
 *
 * Specified in DESIGN.md, "Product page" → "Facts table". Two rules carry it:
 *
 *  - **The order is fixed.** Fit first (system), then how it tastes
 *    (intensity, composition, origin, roast), then what it is (caffeine,
 *    flavouring), then what you get and pay (pack, price per cup, unit price),
 *    then the references (code, category). A customer comparing two tabs finds
 *    the same fact in the same place.
 *  - **A row the record cannot fill is not there.** No dash, no "няма данни",
 *    no zero. Composition, origin and roast are null for every product until
 *    the sync has read them from the product's own page, and stay null where
 *    that page does not state them; the table is correct in both states
 *    because it never knew those rows were expected.
 */

export type FactsTableProduct = Pick<
  ProductDetailView,
  | "systemId"
  | "intensity"
  | "attributes"
  | "arabicaPercent"
  | "origin"
  | "roast"
  | "pack"
  | "weight"
  | "servingPrice"
  | "unitPrice"
  | "sku"
  | "categories"
>;

interface FactRow {
  readonly key: string;
  readonly label: string;
  readonly value: ReactNode;
}

/** Trimmed text, or null for nothing worth a row. */
const text = (value: string | null | undefined): string | null => value?.trim() || null;

/**
 * The rows that have something to say, in the table's order. Exported for the
 * page, which leaves the whole section out when there are none.
 */
export function factRows(product: FactsTableProduct): readonly FactRow[] {
  const rows: Array<FactRow | null> = [];
  const attributes = product.attributes ?? {};

  const system = getBrewingSystem(product.systemId);
  rows.push(
    system
      ? {
          key: "system",
          label: "Система",
          value: (
            <SystemBadge
              systemId={system.id}
              size="md"
              href={systemListingHref(system.id, product.categories) ?? undefined}
            />
          ),
        }
      : null,
  );

  /*
   * The band word is ours (weak / medium / strong, the same on every brand);
   * the numeral is the brand's, on the brand's own scale. Either may be
   * missing. An unknown band token is not printed: unlike a free-text value it
   * means nothing to a customer untranslated.
   */
  const band = STRENGTH_LABELS[attributes.strength ?? ""] ?? null;
  const intensity = text(product.intensity);
  rows.push(
    band || intensity
      ? {
          key: "intensity",
          label: "Интензивност",
          value: (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {band && <span>{band}</span>}
              {/* The track and its numeral stay together; the band may sit above. */}
              {intensity && (
                <span className="whitespace-nowrap">
                  <IntensityScale raw={intensity} size="page" />
                </span>
              )}
            </span>
          ),
        }
      : null,
  );

  const composition = compositionLabel(product.arabicaPercent);
  rows.push(composition ? { key: "composition", label: "Състав", value: composition } : null);

  const origin = text(product.origin);
  rows.push(origin ? { key: "origin", label: "Произход", value: origin } : null);

  // Stored lower-cased by the sync; a table value starts with a capital.
  const roast = text(product.roast);
  rows.push(
    roast
      ? {
          key: "roast",
          label: "Изпичане",
          value: roast.charAt(0).toLocaleUpperCase("bg") + roast.slice(1),
        }
      : null,
  );

  const decaf = text(attributes.decaf);
  rows.push(
    decaf ? { key: "decaf", label: "Кофеин", value: attributeValueLabel("decaf", decaf) } : null,
  );

  const aromas = text(attributes.aromas);
  rows.push(
    aromas
      ? { key: "aromas", label: "Ароматизирано", value: attributeValueLabel("aromas", aromas) }
      : null,
  );

  // The normalised size when there is one, else the size as the record words it.
  const pack = packLabel(product.pack) ?? text(product.weight);
  rows.push(
    pack
      ? { key: "pack", label: "Опаковка", value: <span className="tabular-nums">{pack}</span> }
      : null,
  );

  rows.push(
    product.servingPrice
      ? {
          key: "serving-price",
          label: "Цена на чаша",
          value: (
            <>
              <span className="tabular-nums">{product.servingPrice.formatted}</span>
              {/*
                "≈" alone does not say what was assumed. A bag of beans holds
                as many cups as the dose makes it; the dose we counted with is
                stated, so the figure can be checked.
              */}
              {product.servingPrice.estimated && (
                <span className="mt-0.5 block text-xs font-normal text-ink-500">
                  Изчислено при {GRAMS_PER_SERVING} г кафе на чаша.
                </span>
              )}
            </>
          ),
        }
      : null,
  );

  rows.push(
    product.unitPrice
      ? {
          key: "unit-price",
          // The reference unit is a kilogram for coffee and a litre for a syrup.
          label: /\/\s*л$/u.test(product.unitPrice.formatted)
            ? "Цена за литър"
            : "Цена за килограм",
          value: <span className="tabular-nums">{product.unitPrice.formatted}</span>,
        }
      : null,
  );

  const sku = text(product.sku);
  rows.push(sku ? { key: "sku", label: "Код", value: sku } : null);

  rows.push(
    product.categories.length > 0
      ? {
          key: "categories",
          label: "Категория",
          value: product.categories.map((category, index) => (
            <span key={category.slug}>
              {index > 0 && ", "}
              <Link
                href={`/categories/${category.slug}`}
                className="text-pine-700 underline underline-offset-2 hover:no-underline"
              >
                {category.name}
              </Link>
            </span>
          )),
        }
      : null,
  );

  return rows.filter((row): row is FactRow => row !== null);
}

export function FactsTable({ product }: { product: FactsTableProduct }) {
  const rows = factRows(product);
  if (rows.length === 0) return null;

  return (
    <dl className="rounded-md border border-line bg-paper-raised lg:max-w-2xl">
      {rows.map((row, index) => (
        <div
          key={row.key}
          className={[
            "grid grid-cols-[40%_1fr] gap-4 px-4 py-3 text-sm",
            index > 0 ? "border-t border-line" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <dt className="text-ink-500">{row.label}</dt>
          <dd className="min-w-0 font-medium wrap-break-word text-ink-900">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
