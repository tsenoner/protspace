/**
 * Counts as people read them (design decision 15): digits grouped ("1,234") and nouns that follow
 * the plural rules ("1 protein", "2 proteins"). en-US, as the rest of the interface. Each formatter
 * is built once: building an Intl object costs far more than using one, and the legend formats a
 * count per row on every render.
 */
const NUMBER_FORMAT = new Intl.NumberFormat('en-US');
const PLURAL_RULES = new Intl.PluralRules('en-US');

/** The count with its thousands grouped: 1234 → "1,234". */
export function formatCount(n: number): string {
  return NUMBER_FORMAT.format(n);
}

/** The grouped count and the noun that agrees with it: (1, 'protein', 'proteins') → "1 protein". */
export function countNoun(n: number, one: string, other: string): string {
  return `${formatCount(n)} ${PLURAL_RULES.select(n) === 'one' ? one : other}`;
}
