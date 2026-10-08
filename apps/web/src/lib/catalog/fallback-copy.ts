import { BREWING_SYSTEMS, type BrewMethod, type BrewingSystem } from "../recommend/systems";
import { parseIntensity } from "./attributes";

/**
 * The sentence a product publishes until someone writes its copy.
 *
 * The sync adds products continuously and copy is written by hand, so there
 * is always a gap between a product arriving and its entry appearing in
 * `content/product-copy.ts`. What fills that gap used to be the source's own
 * description, which is the one thing this shop must not publish: the same
 * paragraph on two domains, in the three fields a search engine compares.
 *
 * So the gap is filled from the other direction. Nothing here reads the
 * source's prose — it is not even passed in. The sentence is composed from
 * normalised facts we hold as data: the brand, the brewing system the product
 * is filed under, the pack size, the declared intensity, and the decaf and
 * flavoured flags. It is deliberately plain. A generated sentence that tried
 * to sound written would have to invent the adjectives, and an invented fact
 * about a coffee is worse than a dull one.
 *
 * Two rules shape every branch below:
 *
 *  - **Absent means unsaid.** A missing attribute removes its clause; it never
 *    produces a default. `decaf: "no"` is likewise left unsaid rather than
 *    turned into a claim about caffeine nobody asked us to make.
 *  - **Deterministic.** Same facts, same sentence, on every render — no
 *    variation, no randomness. The lead paragraph, the meta description and
 *    the JSON-LD are computed separately and have to agree.
 *
 * Pure, with no I/O and no `server-only` import, so the scripts and the tests
 * can call exactly what the storefront calls.
 */

/** Everything the sentence may be built from. All of it is optional. */
export interface FallbackCopyFacts {
  /** Brand as displayed. Whitespace is tidied; the spelling is not altered. */
  readonly brandName?: string | null;
  /**
   * Keys of the categories the product is filed under. Storefront slugs,
   * source keys, or both mixed — a brewing system is bound to either (see
   * `lib/recommend/systems.ts`), so both are accepted here.
   */
  readonly categoryKeys?: readonly string[] | null;
  /** Normalised pack size: `products.weight_value`, in `packUnit`. */
  readonly packValue?: string | number | null;
  /** `"g"`, `"ml"` or `"pc"` — `products.weight_unit`. */
  readonly packUnit?: string | null;
  /** The normalised attribute bag: `intensity`, `strength`, `decaf`, `aromas`. */
  readonly attributes?: Readonly<Record<string, string>> | null;
}

/**
 * The brewing system a product belongs to, from its categories.
 *
 * Returns a system only when the categories name exactly one. A product filed
 * under two systems is real data we cannot summarise in one noun, so it falls
 * back to the format they share, and to nothing when they do not share one.
 */
export function resolveProductFormat(categoryKeys: readonly string[] | null | undefined): {
  readonly system: BrewingSystem | null;
  readonly method: BrewMethod | null;
} {
  const keys = new Set((categoryKeys ?? []).map((key) => key.trim().toLowerCase()));
  const matched = BREWING_SYSTEMS.filter(
    (system) =>
      system.categorySlugs.some((slug) => keys.has(slug)) ||
      system.categorySourceKeys.some((key) => keys.has(key)),
  );

  const [first] = matched;
  if (!first) return { system: null, method: null };
  if (matched.length === 1) return { system: first, method: first.method };

  const sameMethod = matched.every((system) => system.method === first.method);
  return { system: null, method: sameMethod ? first.method : null };
}

type Agreement = "neuter" | "plural" | "masculine";

/** „Ароматизиран“ has to agree with whatever noun the sentence opens on. */
const FLAVOURED: Record<Agreement, string> = {
  neuter: "ароматизирано",
  plural: "ароматизирани",
  masculine: "ароматизиран",
};

/**
 * Used only when a numeric reading is absent. The same three words the
 * strength facet uses, as adjectives of „интензивност“.
 */
const STRENGTH_PHRASES: Record<string, string> = {
  weak: "със слаба интензивност",
  medium: "със средна интензивност",
  strong: "със силна интензивност",
};

function lowerFirst(text: string): string {
  return text.charAt(0).toLocaleLowerCase("bg") + text.slice(1);
}

function upperFirst(text: string): string {
  return text.charAt(0).toLocaleUpperCase("bg") + text.slice(1);
}

function tidy(text: string | null | undefined): string | null {
  const collapsed = text?.replace(/\s+/gu, " ").trim();
  return collapsed ? collapsed : null;
}

/** Bulgarian writes a decimal comma: „1,5 кг“. At most three decimals. */
function formatQuantity(value: number): string {
  return String(Math.round(value * 1000) / 1000).replace(".", ",");
}

/**
 * The pack size as a customer would say it: „1 кг“, „500 г“, „16 броя“.
 *
 * Null for anything that is not a positive quantity in a unit we know, which
 * drops the clause — a product with no recorded size says nothing about size.
 */
export function packSizeLabel(
  value: string | number | null | undefined,
  unit: string | null | undefined,
): string | null {
  if (value === null || value === undefined || value === "") return null;
  const quantity = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;

  switch (unit) {
    case "g":
      return quantity >= 1000
        ? `${formatQuantity(quantity / 1000)} кг`
        : `${formatQuantity(quantity)} г`;
    case "ml":
      return quantity >= 1000
        ? `${formatQuantity(quantity / 1000)} л`
        : `${formatQuantity(quantity)} мл`;
    case "pc":
      // Half a capsule is a parsing accident, not a pack size.
      if (!Number.isInteger(quantity)) return null;
      // „броя“ is the count form after a numeral; one of anything is „брой“.
      return quantity === 1 ? "1 брой" : `${quantity} броя`;
    default:
      return null;
  }
}

/**
 * Compose the sentence.
 *
 * The shape is fixed and each clause is optional:
 *
 *   [flavoured] <what it is> [без кофеин] [от <brand>] [за <system>]
 *   [в опаковка от <size>][, с интензивност <n> от <max>].
 *
 * „What it is“ comes from the brewing system, because that is the only
 * statement of kind we hold as data. Without one the product is called
 * „продукт“ and not „кафе“: the catalog also carries matcha and cappuccino
 * capsules, and a new category could hold anything.
 *
 * Returns null only when there is nothing at all to say — no system, no
 * brand, no size, no attribute. Callers render no sentence in that case
 * rather than a noun on its own.
 */
export function composeFallbackCopy(facts: FallbackCopyFacts): string | null {
  const attributes = facts.attributes ?? {};
  const { system, method } = resolveProductFormat(facts.categoryKeys);
  const brand = tidy(facts.brandName);
  const pack = packSizeLabel(facts.packValue, facts.packUnit);
  const intensity = parseIntensity(attributes.intensity);
  const strengthPhrase = STRENGTH_PHRASES[attributes.strength ?? ""] ?? null;
  const decaf = attributes.decaf === "yes";
  const flavoured = attributes.aromas === "yes";

  let noun: string;
  let agreement: Agreement;
  let brandPreposition = "от";
  /** Set for capsules only: the system is what the capsule is *for*. */
  let fits: string | null = null;

  if (method === "capsule") {
    noun = "капсули";
    agreement = "plural";
    fits = system?.name ?? null;
  } else if (system && method === "beans") {
    // The system's own name is the noun: „Кафе на зърна“.
    noun = lowerFirst(system.name);
    agreement = "neuter";
  } else if (system && method === "pod") {
    // Likewise: „Дози ESE“.
    noun = lowerFirst(system.name);
    agreement = "plural";
  } else {
    noun = "продукт";
    agreement = "masculine";
    // „Продукт на Lavazza“ is how it is said; „от“ would read as "made out of".
    brandPreposition = "на";
    if (!brand && !pack && !intensity && !strengthPhrase && !decaf && !flavoured) return null;
  }

  const subject = [flavoured ? FLAVOURED[agreement] : null, noun, decaf ? "без кофеин" : null]
    .filter(Boolean)
    .join(" ");

  const clauses = [
    brand ? `${brandPreposition} ${brand}` : null,
    fits ? `за ${fits}` : null,
    pack ? `в опаковка от ${pack}` : null,
  ].filter(Boolean);

  const intensityPhrase = intensity
    ? `с интензивност ${intensity.value} от ${intensity.max}`
    : strengthPhrase;

  let sentence = [subject, ...clauses].join(" ");
  if (intensityPhrase) {
    // After the pack size a comma is needed, or the intensity reads as a
    // property of the packaging („в опаковка от 1 кг с интензивност…“).
    // After the noun, the brand or the system it attaches where it should.
    sentence += `${pack ? "," : ""} ${intensityPhrase}`;
  }

  return `${upperFirst(sentence)}.`;
}

/**
 * Override-or-generated: the only description the storefront publishes.
 *
 * Every reader of a product's summary goes through this — the lead paragraph,
 * the meta description, the JSON-LD, the card. There is no third arm. The
 * source's own text is not a parameter, so it cannot be reached by accident.
 */
export function publishedSummary(
  override: string | null | undefined,
  facts: FallbackCopyFacts,
): string | null {
  return tidy(override) ? (override as string).trim() : composeFallbackCopy(facts);
}
