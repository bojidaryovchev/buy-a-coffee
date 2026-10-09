/**
 * Fill `{name}` placeholders in a dictionary string.
 *
 * So that a sentence stays one string per language. Concatenating fragments
 * around a value fixes the word order of whichever language was written first
 * — "Капсули {system}" is "{system} capsules" in English.
 *
 * Deliberately tiny, as buy-a-vend's is: no plural rules, no number formatting
 * (callers format with `Intl`). An unmatched placeholder is left in place
 * rather than blanked — a visible `{count}` is a bug report; a gap is a typo
 * nobody files.
 */
export function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : whole,
  );
}

/** One or many, the only distinction Bulgarian and English both make for these. */
export function plural(
  forms: { readonly one: string; readonly many: string },
  count: number,
): string {
  return count === 1 ? forms.one : forms.many;
}
