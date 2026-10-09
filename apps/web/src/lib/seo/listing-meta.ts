import type { Metadata } from "next";
import { brandFactsFor } from "../../../content/brand-facts";
import { categoryCopyFor } from "../../../content/category-copy";
import { fill } from "@/i18n/fill";
import { cupRangePhrase, type CupRange } from "@/lib/catalog/cup-range";
import type { BrewMethod, BrewingSystem } from "@/lib/recommend/systems";
import { fullTitle } from "./title";

/**
 * Titles, headings and meta descriptions of the listing, brand and index
 * pages.
 *
 * The wording follows the market study (`docs/seo.md` §12): the title leads
 * with the words people type, in both alphabets where both are typed, and ends
 * with the shop's name. Which page may carry which term is §1 of the same
 * study, and `test/keyword-map.test.ts` holds every title and heading built
 * here against it.
 *
 * Pure: a page reads the catalog and hands the facts in, so every wording can
 * be tested without a database. Nothing here types a figure. A pack size, a
 * list of systems and a price per cup all arrive as arguments, computed from
 * the catalog when the page is rendered.
 */

/* --- The shared parts ---------------------------------------------------- */

/**
 * A full `<title>`: the page's own words, then the shop's name.
 *
 * Absolute, and ending exactly as the layout's template ends every other
 * page's title: both are `fullTitle` in `lib/seo/title.ts`, which is the one
 * place the separator is decided.
 */
export function pageTitle(text: string): NonNullable<Metadata["title"]> {
  return { absolute: fullTitle(text) };
}

export { fullTitle };

/**
 * How ordering works, in the one sentence a search snippet has room for.
 * There is no cart: the customer leaves a number and a person calls back
 * (`PRODUCT.md`, "Operating context").
 */
export const CALLBACK_SENTENCE = "Оставяте телефон и ви се обаждаме, за да потвърдим.";

/**
 * A meta description: what the page lists, what a cup of it costs, and how to
 * order. The range is left out, not replaced, when the catalog cannot support
 * one — an empty listing, or products with no recorded pack size.
 */
export function metaDescription(lead: string, cupRange: CupRange | null): string {
  const range = cupRangePhrase(cupRange);
  return `${range ? `${lead} — ${range}` : lead}. ${CALLBACK_SENTENCE}`;
}

/** "A", "A и B", "A, B и C". */
export function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} и ${items[items.length - 1]}`;
}

/* --- Pages with one fixed wording ---------------------------------------- */

export const HOME_META = {
  title: "Онлайн магазин за кафе: капсули, зърна и дози",
  /** The description's opening; the range and the callback follow. */
  description: "Кафе капсули, кафе на зърна и хартиени дози ESE",
} as const;

export const BRANDS_INDEX_META = {
  /** The breadcrumb and the `h1`: the term the page owns. */
  name: "Марки кафе",
  title: "Марки кафе — италиански и други",
} as const;

export const PROMOTIONS_META = {
  name: "Кафе на промоция",
  title: "Кафе на промоция — намалени капсули, зърна и дози",
  description: "Кафе на промоция: капсули, зърна и дози с намалена цена",
  /** While nothing is reduced there is no range to quote and nothing to list. */
  descriptionWhenEmpty:
    "В момента няма кафе на промоция. Щом намалим цена, продуктът се появява тук.",
} as const;

export const CATEGORIES_INDEX_META = {
  name: "Категории кафе",
  title: "Категории кафе: зърна, капсули по система и дози",
  description: "Целият асортимент по вид: кафе на зърна, капсули по система и дози ESE",
} as const;

/* --- Categories ---------------------------------------------------------- */

interface CategoryNaming {
  readonly slug: string;
  readonly sourceKey?: string | null;
  readonly name: string;
}

export interface CategoryMetaFacts {
  /** `ListingFacts.uniformPieceCount`: set only when every pack is that size. */
  readonly uniformPieceCount?: number | null;
  /** The subcategories that have products, for a parent listing. */
  readonly children?: readonly CategoryNaming[];
}

/**
 * The capsule families on sale under a parent, each once, in the order given:
 * „Nespresso“, „Dolce Gusto“, „Lavazza“, „Caffitaly“. A subcategory nobody has
 * written copy for is named as the catalog names it.
 */
export function capsuleFamilies(children: readonly CategoryNaming[]): readonly string[] {
  return [...new Set(children.map((child) => categoryCopyFor(child)?.family ?? child.name))];
}

function fillCategoryTemplate(
  template: string,
  fallback: string,
  facts: CategoryMetaFacts,
): string {
  if (!template.includes("{systems}")) return template;
  const families = capsuleFamilies(facts.children ?? []);
  // „Кафе капсули за“ with nothing after it is not a sentence.
  return families.length > 0 ? fill(template, { systems: listOf(families) }) : fallback;
}

/** The `h1` of a category's listing. */
export function categoryHeading(category: CategoryNaming): string {
  return categoryCopyFor(category)?.h1 ?? category.name;
}

/** `<title>` of a category's listing, before the shop's name. */
export function categoryTitle(category: CategoryNaming, facts: CategoryMetaFacts = {}): string {
  const copy = categoryCopyFor(category);
  if (!copy) return category.name;
  if (copy.titleWithPack && facts.uniformPieceCount) {
    return fill(copy.titleWithPack, { pack: `${facts.uniformPieceCount} бр.` });
  }
  return fillCategoryTemplate(copy.title, copy.h1, facts);
}

/** The opening of a category's meta description. */
export function categoryDescriptionLead(
  category: CategoryNaming,
  facts: CategoryMetaFacts = {},
): string {
  const copy = categoryCopyFor(category);
  if (!copy) return category.name;
  return fillCategoryTemplate(copy.description, copy.h1, facts);
}

/* --- Brands -------------------------------------------------------------- */

/** How a title names each format: the short word, as people type it after a brand. */
const FORMAT_WORD: Readonly<Record<BrewMethod, string>> = {
  beans: "зърна",
  capsule: "капсули",
  pod: "дози",
};

const FORMAT_ORDER: readonly BrewMethod[] = ["beans", "capsule", "pod"];

interface BrandNaming {
  readonly slug: string;
  readonly name: string;
}

/**
 * The formats a brand is stocked in, as a title lists them.
 *
 * A format that has a page of its own for this brand goes last. „Лаваца
 * капсули“ and „лаваца на зърна“ belong to those two pages (`docs/seo.md` §1),
 * so the brand page must not put either word straight after the name.
 */
export function brandFormatWords(
  brand: BrandNaming,
  systems: readonly Pick<BrewingSystem, "method">[],
): readonly string[] {
  const owned = brandFactsFor(brand).formatPages ?? [];
  const stocked = FORMAT_ORDER.filter((method) =>
    systems.some((system) => system.method === method),
  );
  return [
    ...stocked.filter((method) => !owned.includes(method)),
    ...stocked.filter((method) => owned.includes(method)),
  ].map((method) => FORMAT_WORD[method]);
}

/** „Кафе Bianchi (Бианчи)“: both alphabets where the Cyrillic one is typed. */
function brandLabel(brand: BrandNaming): string {
  const { cyrillic } = brandFactsFor(brand);
  return cyrillic ? `Кафе ${brand.name} (${cyrillic})` : `Кафе ${brand.name}`;
}

/** Added to a brand title only while the whole title stays this short. */
const TITLE_BUDGET = 60;
const PER_CUP_TAIL = " — цена на чаша";

/**
 * `<title>` of a brand page, before the shop's name: „Кафе Bianchi (Бианчи):
 * капсули и дози“. A brand with nothing in stock is named and no more.
 */
export function brandTitle(
  brand: BrandNaming,
  systems: readonly Pick<BrewingSystem, "method">[],
): string {
  const formats = brandFormatWords(brand, systems);
  if (formats.length === 0) return brandLabel(brand);
  const title = `${brandLabel(brand)}: ${listOf(formats)}`;
  // A one-format brand makes a very short title; the per-cup price is what
  // every listing here shows, so it is said where there is room for it.
  return fullTitle(title + PER_CUP_TAIL).length <= TITLE_BUDGET ? title + PER_CUP_TAIL : title;
}

/** The opening of a brand page's meta description. */
export function brandDescriptionLead(
  brand: BrandNaming,
  systems: readonly Pick<BrewingSystem, "method">[],
): string {
  const formats = brandFormatWords(brand, systems);
  return formats.length === 0 ? `Кафе ${brand.name}` : `Кафе ${brand.name}: ${listOf(formats)}`;
}

/**
 * What a brand makes, for its tile on the brand index: „зърна, дози, капсули
 * за Nespresso и Dolce Gusto“. Capsules are named with their systems, because
 * „капсули“ alone does not tell anyone whether they fit.
 */
export function brandMakes(systems: readonly BrewingSystem[]): string | null {
  const parts: string[] = [];
  if (systems.some((system) => system.method === "beans")) parts.push("зърна");
  if (systems.some((system) => system.method === "pod")) parts.push("дози ESE");
  const capsules = systems.filter((system) => system.method === "capsule");
  if (capsules.length > 0) parts.push(`капсули за ${listOf(capsules.map((s) => s.name))}`);
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * The brand index's introduction, from the brands in stock.
 *
 * Two sentences at most. The count is the number of brands handed in. The
 * Italian ones are those `brand-facts.ts` records as Italian with its evidence,
 * and the sentence says „сред тях са“, so a brand whose country nobody has
 * checked is simply not named rather than implied to be something else.
 */
export function brandsIndexIntro(brands: readonly BrandNaming[]): string | null {
  if (brands.length === 0) return null;
  const count = `${brands.length} ${brands.length === 1 ? "марка" : "марки"} кафе`;
  const italian = brands.filter((brand) => brandFactsFor(brand).italian).map((b) => b.name);
  const first =
    italian.length === 0
      ? `В момента предлагаме ${count}.`
      : italian.length === brands.length
        ? `В момента предлагаме ${count}, всички италиански.`
        : `В момента предлагаме ${count}. Сред тях ${
            italian.length === 1 ? "е италианската" : "са италианските"
          } ${listOf(italian)}.`;
  return `${first} Под всяка марка пише какво имаме от нея: зърна, дози или капсули, и за коя система са.`;
}
