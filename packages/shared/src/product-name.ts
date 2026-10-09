import { brandDisplayNames, productNameOverrides } from "./storefront-data.ts";
import { normalizeLabel, slugify } from "./text.ts";
import { type PackSizeConflict, TRAILING_QUANTITY, decidePackSize } from "./pack-size.ts";

/**
 * A product's name, as this shop writes it.
 *
 * The catalog stores each product under the supplier's own name: "Капсули DG
 * Rema Caffè Cookies 16 бр.", "Дозети Lollo caffe Oro 150бр.". Those words are
 * the supplier's shorthand, not what anyone types into a search box ("DG" is
 * never searched; "кафе дози" is searched twelve times as often as "дозети"),
 * and printing them verbatim makes every page here a copy of a page there.
 *
 * So the name is taken apart and put back together from what the catalog
 * already knows as data:
 *
 *   - **brand**: how the brand spells itself (`content/brand-names.ts`);
 *   - **line**: what is left of the supplier's name once the format words, the
 *     system token, the brand and the pack size are taken out: "Cookies",
 *     "Oro", "Crema e Aroma";
 *   - **format**: the phrase people search for the product's kind, chosen by
 *     the category the product is filed under, never by its name;
 *   - **quantity**: the pack size, as `decidePackSize` (`pack-size.ts`)
 *     decides it: the pack field's, unless the name states another, and then
 *     the name's. The sync stores a size decided by the same function, so a
 *     stored product never arrives here in conflict; a record that has not
 *     been through the sync is settled here, by the same rule.
 *
 * The supplier's name is still stored untouched (`products.name`). It is what
 * the owner orders by, so the admin pages and the order mail keep it, and
 * search matches it as well as ours.
 *
 * **One function for the storefront and the sync.** The storefront shows the
 * name; the sync derives a new product's URL from it (`product-slug.ts`). Two
 * implementations would drift, and a URL is frozen the moment it is published.
 *
 * Pure and deterministic: the same record gives the same name on every call,
 * in every process.
 */

export interface ProductNameInput {
  /** The supplier's name for the product, exactly as stored. */
  readonly sourceName: string;
  /** The product's source key, and the keys it answered to before a move. */
  readonly sourceKey?: string | null;
  readonly previousSourceKeys?: readonly string[] | null;
  /** The brand as the catalog holds it, or null when the product has none. */
  readonly brand?: {
    readonly sourceKey?: string | null;
    readonly name?: string | null;
  } | null;
  /** Source keys of the categories the product is filed under. */
  readonly categoryKeys?: readonly string[] | null;
  /** The parsed pack size: `products.weight_value` in `packUnit`. */
  readonly packValue?: string | number | null;
  /** `"g"`, `"ml"` or `"pc"`. */
  readonly packUnit?: string | null;
}

export type ProductFormatId =
  | "beans"
  | "ese"
  | "dolce-gusto"
  | "nespresso"
  | "lavazza-blue"
  | "a-modo-mio"
  | "caffitaly"
  | "capsules";

export interface ProductFormat {
  readonly id: ProductFormatId;
  /** "Капсули за Dolce Gusto", or "Капсули Lavazza Blue" for the owner's own. */
  readonly label: string;
  /** What the format's listing is called, whoever made the product. */
  readonly listingLabel: string;
  /** The format's part of a product slug: `kapsuli-dolce-gusto`. */
  readonly slug: string;
}

export interface ProductQuantity {
  /** "1 кг", "250 г", "16 бр.". */
  readonly label: string;
  /** `1-kg`, `250-g`, `16-br`. */
  readonly slug: string;
}

export interface ProductName {
  /** The brand as it spells itself, or null for a product with no brand. */
  readonly brand: string | null;
  /** The line as the brand writes it. Empty when the name holds nothing else. */
  readonly line: string;
  readonly format: ProductFormat | null;
  readonly quantity: ProductQuantity | null;
  /**
   * Set when the supplier's name states one pack size and the pack size
   * passed in is another: both, as the shop would write them. `quantity` is
   * then the name's. Null for every product whose two sizes agree, for one
   * that states only one of them, and for every stored product, whose pack
   * size the sync has already settled.
   */
  readonly packConflict: PackSizeConflict | null;
  /** The heading: "Lavazza Super Crema". */
  readonly title: string;
  /** The line under the heading: "Кафе на зърна, 1 кг". Null when neither part is known. */
  readonly detail: string | null;
  /**
   * The whole name in one line, for a page title, an `alt`, structured data:
   * "Lavazza Super Crema — кафе на зърна, 1 кг".
   */
  readonly full: string;
  /** `<brand>-<line>-<format>-<qty>`, before uniqueness is settled. */
  readonly slugBase: string;
}

/* --- Formats ------------------------------------------------------------ */

interface FormatRule {
  readonly id: ProductFormatId;
  /** Source keys of the categories that hold this format, old keys included. */
  readonly categoryKeys: readonly string[];
  /** For a product some other maker produces to fit the system. */
  readonly label: string;
  /**
   * For a product made by the system's owner. Lavazza's own Blue capsule is
   * not "for" Lavazza Blue, it is one; and a third party's capsule is never
   * presented as the owner's (`PRODUCT.md`). Which of the two a product is
   * comes from its brand, by source key.
   */
  readonly ownLabel?: string;
  readonly ownerBrandKeys?: readonly string[];
  readonly listingLabel: string;
  readonly slug: string;
  /**
   * How the supplier abbreviates the system at the front of a name ("DG",
   * "Blue"). Removed from the line only for a product filed under this format,
   * so a bean called "Blue Mountain" keeps its name.
   */
  readonly nameTokens: readonly string[];
  readonly capsule: boolean;
}

/**
 * The phrases are the searched ones (docs/seo.md §6.2, §12): „кафе дози“ over
 * „дозети“, „Dolce Gusto“ over „DG“. Slugs carry the same words transliterated.
 * `kafe-dozi` has no `ese` in it because nobody types it in the address bar and
 * the listing is already `/bg/kafe-dozi`.
 */
const FORMAT_RULES: readonly FormatRule[] = [
  {
    id: "beans",
    categoryKeys: ["kafe-na-zyrna", "kafe-na-zarna"],
    label: "Кафе на зърна",
    listingLabel: "Кафе на зърна",
    slug: "kafe-na-zarna",
    nameTokens: [],
    capsule: false,
  },
  {
    id: "ese",
    categoryKeys: ["kafe-dozi"],
    label: "Кафе дози ESE",
    listingLabel: "Кафе дози ESE",
    slug: "kafe-dozi",
    nameTokens: ["ese", "e.s.e."],
    capsule: false,
  },
  {
    id: "dolce-gusto",
    categoryKeys: ["dolce-gusto"],
    label: "Капсули за Dolce Gusto",
    ownLabel: "Капсули Dolce Gusto",
    ownerBrandKeys: ["dolce-gusto", "nescafe-dolce-gusto", "nescafe"],
    listingLabel: "Капсули за Dolce Gusto",
    slug: "kapsuli-dolce-gusto",
    nameTokens: ["dolce gusto", "dg"],
    capsule: true,
  },
  {
    id: "nespresso",
    categoryKeys: ["nespresso"],
    label: "Капсули за Nespresso",
    ownLabel: "Капсули Nespresso",
    ownerBrandKeys: ["nespresso"],
    listingLabel: "Капсули за Nespresso",
    slug: "kapsuli-nespresso",
    nameTokens: ["nespresso"],
    capsule: true,
  },
  {
    id: "lavazza-blue",
    categoryKeys: ["lavazza-blue"],
    label: "Капсули за Lavazza Blue",
    ownLabel: "Капсули Lavazza Blue",
    ownerBrandKeys: ["lavazza"],
    listingLabel: "Капсули за Lavazza Blue",
    slug: "kapsuli-lavazza-blue",
    nameTokens: ["lavazza blue", "blue"],
    capsule: true,
  },
  {
    id: "a-modo-mio",
    categoryKeys: ["a-modo-mio"],
    label: "Капсули за Lavazza A Modo Mio",
    ownLabel: "Капсули Lavazza A Modo Mio",
    ownerBrandKeys: ["lavazza"],
    listingLabel: "Капсули за Lavazza A Modo Mio",
    slug: "kapsuli-a-modo-mio",
    nameTokens: ["lavazza a modo mio", "a modo mio"],
    capsule: true,
  },
  {
    id: "caffitaly",
    categoryKeys: ["caffitaly"],
    label: "Капсули за Caffitaly",
    ownLabel: "Капсули Caffitaly",
    ownerBrandKeys: ["caffitaly"],
    listingLabel: "Капсули Caffitaly",
    slug: "kapsuli-caffitaly",
    nameTokens: ["caffitaly"],
    capsule: true,
  },
];

/** A capsule filed only under the parent category, or under two systems at once. */
const CAPSULES: FormatRule = {
  id: "capsules",
  categoryKeys: ["kafe-kapsuli", "kapsuli"],
  label: "Кафе капсули",
  listingLabel: "Кафе капсули",
  slug: "kafe-kapsuli",
  nameTokens: [],
  capsule: true,
};

/**
 * Reduce a name, a key or a token to letters and digits, without accents.
 *
 * The same brand arrives as "REMA CAFFE", "rema-caffe", "Rema Caffè" and
 * "Rema Caffe", and "Lollo caffe" in a product's name is the brand whose key
 * is `lollocafe` and whose own spelling is "Lollo Caffè". They differ only in
 * case, separators and accents, so they are compared without any of them.
 */
function fold(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function ruleFor(categoryKeys: readonly string[] | null | undefined): FormatRule | null {
  const keys = new Set((categoryKeys ?? []).map((key) => key.trim().toLowerCase()));
  const matched = FORMAT_RULES.filter((rule) => rule.categoryKeys.some((key) => keys.has(key)));
  const [first] = matched;
  if (first && matched.length === 1) return first;
  // Two systems at once is real data nobody can name in one phrase; the
  // format they share is the most that can be said.
  if (first) return matched.every((rule) => rule.capsule) ? CAPSULES : null;
  return CAPSULES.categoryKeys.some((key) => keys.has(key)) ? CAPSULES : null;
}

/* --- Brand -------------------------------------------------------------- */

const DISPLAY_NAMES = new Map(
  Object.entries(brandDisplayNames).map(([key, name]) => [fold(key), name]),
);

/** Every spelling of every known brand, longest first, for a product with no brand row. */
const KNOWN_BRAND_SPELLINGS: ReadonlyArray<readonly [string, string]> = [
  ...new Map(
    Object.entries(brandDisplayNames).flatMap(([key, name]) => [
      [fold(key), name] as const,
      [fold(name), name] as const,
    ]),
  ),
].sort((a, b) => b[0].length - a[0].length);

function tidy(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * The name for a brand with no entry in `brand-names.ts`.
 *
 * A name typed in one case throughout ("NEW BRAND") carries no information in
 * its casing, so it is title-cased; one in mixed case ("FoodNess") is kept as
 * typed, because someone chose those capitals.
 */
export function fallbackBrandName(sourceName: string): string {
  const name = tidy(sourceName);
  const singleCase = name === name.toUpperCase() || name === name.toLowerCase();
  if (!singleCase) return name;
  return name.replace(/[\p{L}\p{N}]+/gu, capitalise);
}

/**
 * How a brand is written on the storefront: by source key first, the identity
 * the sync holds stable; then by the name itself; then a tidy title-case.
 * Never throws and never returns the raw value.
 */
export function brandDisplayName(brand: {
  readonly name: string;
  readonly sourceKey?: string | null;
}): string {
  const byKey = brand.sourceKey ? DISPLAY_NAMES.get(fold(brand.sourceKey)) : undefined;
  return byKey ?? DISPLAY_NAMES.get(fold(brand.name)) ?? fallbackBrandName(brand.name);
}

/* --- Line --------------------------------------------------------------- */

/** What the supplier opens a name with to say what kind of thing it is. */
const FORMAT_WORDS = /^(?:кафе\s+на\s+зърна|кафе\s+капсули|кафе\s+дози|капсули|дозети|дози)\s+/iu;

const CYRILLIC = /\p{Script=Cyrillic}/u;

/** Italian connectives the supplier capitalises and the brands do not. */
const CONNECTIVES: ReadonlySet<string> = new Set(["e", "ed", "di", "da", "del", "della", "al"]);

/** Drop `phrase` from the front of `tokens` when they spell it; else null. */
function withoutLeading(tokens: readonly string[], phrase: string): string[] | null {
  const target = fold(phrase);
  if (!target) return null;
  let spelled = "";
  for (let count = 1; count <= tokens.length; count += 1) {
    spelled += fold(tokens[count - 1] ?? "");
    if (spelled === target) return tokens.slice(count);
    if (!target.startsWith(spelled)) return null;
  }
  return null;
}

function withoutLeadingAny(tokens: readonly string[], phrases: readonly string[]): string[] | null {
  for (const phrase of phrases) {
    const rest = withoutLeading(tokens, phrase);
    if (rest) return rest;
  }
  return null;
}

/**
 * The line, and the brand when the catalog does not link one.
 *
 * In order: the format words and the pack size come off the ends; the system
 * token comes off the front, but only the one belonging to the product's own
 * format; then the brand, in any of its spellings. A word in Cyrillic left in
 * a Latin name is the supplier glossing it ("Caramel карамел") and is
 * dropped. What remains is the line.
 *
 * A brand that is not at the front of what remains is left where it is, and
 * the line then opens with whatever the supplier put there: "Adore Espresso
 * Bar" is a range Bianchi sells under another name, and the page says
 * "Bianchi Adore Espresso Bar".
 */
function parseLine(
  sourceName: string,
  rule: FormatRule | null,
  brand: ProductNameInput["brand"],
): { readonly line: string; readonly inferredBrand: string | null } {
  let text = normalizeLabel(sourceName);
  while (FORMAT_WORDS.test(text)) text = text.replace(FORMAT_WORDS, "");
  text = text.replace(TRAILING_QUANTITY, "");

  let tokens = text.split(" ").filter(Boolean);
  if (rule) tokens = withoutLeadingAny(tokens, rule.nameTokens) ?? tokens;

  let inferredBrand: string | null = null;
  if (brand?.name || brand?.sourceKey) {
    const spellings = [
      brandDisplayName({ name: brand.name ?? "", sourceKey: brand.sourceKey ?? null }),
      brand.name ?? "",
      brand.sourceKey ?? "",
    ].filter(Boolean);
    tokens = withoutLeadingAny(tokens, spellings) ?? tokens;
  } else {
    // No brand row: the supplier forgot to link one. If the name opens with a
    // brand this shop already knows, that is the brand.
    for (const [spelling, name] of KNOWN_BRAND_SPELLINGS) {
      const rest = withoutLeading(tokens, spelling);
      if (rest) {
        tokens = rest;
        inferredBrand = name;
        break;
      }
    }
  }

  // A system token the supplier put after the brand ("Bianchi DG Forte").
  if (rule) tokens = withoutLeadingAny(tokens, rule.nameTokens) ?? tokens;

  const latin = tokens.filter((token) => !CYRILLIC.test(token));
  // An all-Cyrillic line is the line; only a gloss inside a Latin one goes.
  const kept = latin.length > 0 ? latin : tokens;
  const line = kept
    .map((token, index) =>
      index > 0 && index < kept.length - 1 && CONNECTIVES.has(token.toLowerCase())
        ? token.toLowerCase()
        : token,
    )
    .join(" ");
  return { line, inferredBrand };
}

/* --- The name ----------------------------------------------------------- */

function lowerFirst(text: string): string {
  return text.charAt(0).toLocaleLowerCase("bg") + text.slice(1);
}

function overrideFor(input: ProductNameInput) {
  for (const key of [input.sourceKey, ...(input.previousSourceKeys ?? [])]) {
    if (key && Object.hasOwn(productNameOverrides, key)) return productNameOverrides[key];
  }
  return undefined;
}

/** The longest brand-and-line part of a slug; the format and the size always fit after it. */
const SLUG_HEAD_MAX = 72;

export function productName(input: ProductNameInput): ProductName {
  const override = overrideFor(input);
  const rule = ruleFor(input.categoryKeys);
  const parsed = parseLine(input.sourceName, rule, input.brand ?? null);

  const hasBrand = Boolean(input.brand?.name || input.brand?.sourceKey);
  const brand = hasBrand
    ? brandDisplayName({
        name: input.brand?.name ?? input.brand?.sourceKey ?? "",
        sourceKey: input.brand?.sourceKey ?? null,
      })
    : parsed.inferredBrand;
  const line = tidy(override?.line ?? parsed.line);

  const brandKey = fold(input.brand?.sourceKey ?? "");
  const own = Boolean(rule?.ownLabel && brandKey && rule.ownerBrandKeys?.includes(brandKey));
  const format: ProductFormat | null = rule
    ? {
        id: rule.id,
        label: own && rule.ownLabel ? rule.ownLabel : rule.label,
        listingLabel: rule.listingLabel,
        slug: rule.slug,
      }
    : null;

  // The pack size is decided in one place, for the page and the sync alike.
  const pack = decidePackSize(input.sourceName, {
    value: input.packValue,
    unit: input.packUnit,
  });
  const packConflict = pack.conflict;
  const quantityLabel = pack.label;
  const quantity: ProductQuantity | null = quantityLabel
    ? { label: quantityLabel, slug: slugify(quantityLabel) }
    : null;

  // A product with neither a brand nor a line still has to be called
  // something: the supplier's name, tidied, is the honest last resort.
  const title = [brand, line].filter(Boolean).join(" ") || normalizeLabel(input.sourceName);
  const detailParts = [format?.label, quantity?.label].filter(Boolean);
  const detail = detailParts.length > 0 ? detailParts.join(", ") : null;
  const full = format
    ? `${title} — ${[lowerFirst(format.label), quantity?.label].filter(Boolean).join(", ")}`
    : quantity
      ? `${title}, ${quantity.label}`
      : title;

  const head = slugify(title, { maxLength: SLUG_HEAD_MAX });
  const slugBase = [head, format?.slug, quantity?.slug].filter(Boolean).join("-") || "product";

  return { brand, line, format, quantity, packConflict, title, detail, full, slugBase };
}

/**
 * What search matches a product by, beside the supplier's name.
 *
 * The heading as the page prints it — brand and line — and, where either
 * carries an accent, once more without it, because nobody types "Caffè" into
 * a search box and substring matching does not fold accents.
 *
 * Not the format or the system: "капсули за Lavazza Blue" in every compatible
 * capsule's search name would put another maker's capsules first in a search
 * for Lavazza. A system is found through its category and the synonym table,
 * as it always has been. Never displayed.
 */
export function productSearchName(name: ProductName): string {
  const plain = name.title.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  return plain === name.title ? name.title : `${name.title} ${plain}`;
}

/** The format's listing label for a set of category keys, or null. For breadcrumbs. */
export function formatListingLabel(
  categoryKeys: readonly string[] | null | undefined,
): string | null {
  return ruleFor(categoryKeys)?.listingLabel ?? null;
}
