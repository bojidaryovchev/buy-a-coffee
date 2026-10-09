import {
  computeJournalFigures,
  type JournalCatalogRow,
  type JournalFigures,
} from "@/lib/catalog/journal-figures";

/**
 * A small catalog for the journal tests.
 *
 * Shaped like the real one — beans by weight, capsules and pods by the piece,
 * intensity on several scales, one brand on two of them, a decaf that still
 * declares an intensity, an arabica share on some products and none on others,
 * a roast written two ways — but with invented products, so no assertion here
 * depends on what happens to be on sale.
 */

let sequence = 0;

export function row(overrides: {
  category: string;
  price?: string | null;
  weightValue?: string | null;
  weightUnit?: string | null;
  intensity?: string;
  decaf?: "yes" | "no";
  strength?: string;
  brandName?: string | null;
  name?: string;
  slug?: string;
  currency?: string | null;
  arabicaPercent?: number | null;
  roast?: string | null;
}): JournalCatalogRow {
  sequence += 1;
  return {
    slug: overrides.slug ?? `product-${sequence}`,
    name: overrides.name ?? `Продукт ${sequence}`,
    brandName: overrides.brandName === undefined ? "ALFA" : overrides.brandName,
    price: overrides.price === undefined ? "10.00" : overrides.price,
    currency: overrides.currency === undefined ? "EUR" : overrides.currency,
    weightValue: overrides.weightValue === undefined ? "10.0000" : overrides.weightValue,
    weightUnit: overrides.weightUnit === undefined ? "pc" : overrides.weightUnit,
    arabicaPercent: overrides.arabicaPercent ?? null,
    roast: overrides.roast ?? null,
    attributes: {
      decaf: overrides.decaf ?? "no",
      strength: overrides.strength ?? "medium",
      ...(overrides.intensity ? { intensity: overrides.intensity } : {}),
    },
    categories: [{ slug: overrides.category, sourceKey: overrides.category }],
  };
}

export const FIXTURE_ROWS: readonly JournalCatalogRow[] = [
  // Beans: by weight, so servings are estimated.
  row({
    slug: "beans-kilo",
    name: "Зърна Едно",
    category: "kafe-na-zarna",
    price: "14.00",
    weightValue: "1000.0000",
    weightUnit: "g",
    intensity: "8 от 10",
    brandName: "ALFA",
    strength: "strong",
    arabicaPercent: 100,
    roast: "средно",
  }),
  row({
    slug: "beans-quarter",
    name: "Зърна Две",
    category: "kafe-na-zarna",
    price: "5.00",
    weightValue: "250.0000",
    weightUnit: "g",
    intensity: "8 от 13",
    brandName: "BETA",
    arabicaPercent: 70,
    // As a product page might write it; the level is still "тъмно".
    roast: "Тъмно изпичане",
  }),
  // Nespresso: the hundred-box costs more on the shelf and less in the cup.
  row({
    slug: "nespresso-hundred",
    name: "Капсули Сто",
    category: "nespresso",
    price: "33.25",
    weightValue: "100.0000",
    intensity: "8 от 12",
    brandName: "ALFA",
    arabicaPercent: 100,
  }),
  row({
    slug: "nespresso-ten",
    name: "Капсули Десет",
    category: "nespresso",
    price: "3.90",
    weightValue: "10.0000",
    intensity: "5 от 12",
    brandName: "GAMA",
    strength: "weak",
  }),
  row({
    slug: "dolce-sixteen",
    name: "Капсули Шестнадесет",
    category: "dolce-gusto",
    price: "5.60",
    weightValue: "16.0000",
    intensity: "7 от 10",
    decaf: "yes",
    brandName: "GAMA",
    arabicaPercent: 50,
  }),
  // Pods, with no declared intensity and no stated composition.
  row({
    slug: "pods-box",
    name: "Дози Кутия",
    category: "kafe-dozi",
    price: "27.00",
    weightValue: "150.0000",
    brandName: "BETA",
  }),
  // Not coffee by any system: must be ignored by the price and format figures.
  row({
    slug: "syrup",
    name: "Сироп",
    category: "siropi",
    price: "8.00",
    weightValue: "700.0000",
    weightUnit: "ml",
    brandName: null,
  }),
];

export const FIXTURE_FIGURES: JournalFigures = computeJournalFigures(FIXTURE_ROWS, "EUR");
