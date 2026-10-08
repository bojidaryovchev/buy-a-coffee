/**
 * A count with its noun: "1 продукт", "187 продукта", "20 марки".
 *
 * Bulgarian uses the singular after one and, for masculine nouns, the count
 * form ("продукта") after every other numeral — so two forms are enough.
 */
export function countPhrase(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
