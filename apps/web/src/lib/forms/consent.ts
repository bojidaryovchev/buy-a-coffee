/**
 * How a newsletter subscriber came to be on the list.
 *
 * `newsletter_subscribers.consent_source` has to answer "how did they agree?"
 * for every row, so it only ever holds one of these codes (or, for rows from
 * before this list existed, the page name the footer form used to write). The
 * code is stored, the label is for people reading the admin panel.
 *
 * Plain data, no database and no `server-only`: the admin form (a client
 * component) draws its options from here and the server action validates
 * against the very same list, so the two cannot drift.
 */

/** Ticked by the customer, on a form they filled in themselves. */
export const FORM_CONSENT_SOURCES = {
  footer: "Формата в долната част на сайта",
  quick_order_form: "Отметка във формата за бърза поръчка",
  contact_form: "Отметка във формата за контакт",
} as const;

/**
 * Told to the operator, who writes it down. An enquiry on its own is NOT one of
 * these: asking about a coffee is not agreeing to marketing, so the operator
 * has to say which actual agreement they are recording.
 */
export const OPERATOR_CONSENT_BASES = {
  "operator:phone": "Съгласи се по телефона",
  "operator:email": "Поиска го по имейл",
  "operator:in_person": "Съгласи се лично",
} as const;

export type FormConsentSource = keyof typeof FORM_CONSENT_SOURCES;
export type OperatorConsentBasis = keyof typeof OPERATOR_CONSENT_BASES;

export const OPERATOR_CONSENT_BASIS_CODES = Object.keys(
  OPERATOR_CONSENT_BASES,
) as readonly OperatorConsentBasis[];

export function isOperatorConsentBasis(value: unknown): value is OperatorConsentBasis {
  return typeof value === "string" && Object.hasOwn(OPERATOR_CONSENT_BASES, value);
}

/** A stored code in words. An unknown or missing one is shown as what it is. */
export function consentSourceLabel(source: string | null | undefined): string {
  if (!source) return "Не е записан";
  if (Object.hasOwn(FORM_CONSENT_SOURCES, source)) {
    return FORM_CONSENT_SOURCES[source as FormConsentSource];
  }
  if (Object.hasOwn(OPERATOR_CONSENT_BASES, source)) {
    return `Записано от оператор: ${OPERATOR_CONSENT_BASES[source as OperatorConsentBasis].toLowerCase()}`;
  }
  // Rows written before the list existed carry the bare page name ("footer"
  // is covered above; anything else came from a form we no longer have).
  return `Друг източник (${source})`;
}
