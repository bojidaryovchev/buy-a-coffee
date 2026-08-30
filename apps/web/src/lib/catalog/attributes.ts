/**
 * Bulgarian labels for the normalised product attributes.
 *
 * Attribute keys and their enumerated values are machine tokens written by the
 * sync job (`decaf: "yes"`, `strength: "strong"`). They are never shown raw:
 * the storefront sells only in Bulgaria, so every one of them is translated
 * here before it reaches the DOM.
 *
 * This is the single source of truth, used both by the facet builder in
 * `queries.ts` and by the specification table on the product page. Keeping one
 * copy is what stops the filter saying "Без кофеин" while the product page
 * says "decaf no" for the same field.
 *
 * An unrecognised key or value falls back to the raw token rather than being
 * hidden: a new attribute arriving from the sync should look untranslated and
 * get fixed, not silently vanish from the page.
 */

/** Ordered so the facet list always reads weak → strong. */
export const STRENGTH_ORDER = ["weak", "medium", "strong"] as const;

export const STRENGTH_LABELS: Record<string, string> = {
  weak: "Слабо",
  medium: "Средно",
  strong: "Силно",
};

export const DECAF_LABELS: Record<string, string> = {
  yes: "Без кофеин",
  no: "С кофеин",
};

export const AROMAS_LABELS: Record<string, string> = {
  yes: "Ароматизирано",
  no: "Неароматизирано",
};

/** Row headings for the specification table on a product page. */
const ATTRIBUTE_KEY_LABELS: Record<string, string> = {
  strength: "Интензивност",
  intensity: "Степен на интензивност",
  decaf: "Кофеин",
  aromas: "Ароматизирано",
  weight: "Тегло",
  availability: "Наличност",
};

const ATTRIBUTE_VALUE_LABELS: Record<string, Record<string, string>> = {
  strength: STRENGTH_LABELS,
  decaf: DECAF_LABELS,
  // On a spec row "Ароматизирано: Ароматизирано" reads badly, so the yes/no
  // sense is spelled out instead of reusing the facet label.
  aromas: { yes: "Да", no: "Не" },
};

/** Human heading for an attribute key. Falls back to the key itself. */
export function attributeKeyLabel(key: string): string {
  return ATTRIBUTE_KEY_LABELS[key] ?? key.replace(/[_-]/g, " ");
}

/**
 * Human value for an attribute. Free-text values (such as `intensity`, which
 * arrives as "10 от 12" and is already Bulgarian) pass through untouched.
 */
export function attributeValueLabel(key: string, value: string): string {
  return ATTRIBUTE_VALUE_LABELS[key]?.[value] ?? value;
}
