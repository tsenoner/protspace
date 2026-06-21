import { NA_VALUE } from '@protspace/utils';

/**
 * Filter annotation values, removing N/A entries and empty/whitespace strings.
 * Returns the joined result or null if nothing remains.
 */
export function filterAnnotationValues(values: string[] | undefined): string | null {
  if (!values || values.length === 0) return null;
  const filtered = values
    .filter((value) => value !== NA_VALUE)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (filtered.length === 0) return null;
  return filtered.join(', ');
}

/**
 * Resolve gene name from already-extracted gene-name values.
 */
export function getGeneName(geneNameValues: string[]): string | null {
  return filterAnnotationValues(geneNameValues);
}

/**
 * Resolve protein name from already-extracted protein-name values.
 */
export function getProteinName(proteinNameValues: string[]): string | null {
  return filterAnnotationValues(proteinNameValues);
}

/**
 * Resolve UniProtKB ID from already-extracted uniprot-kb-id values.
 */
export function getUniprotKbId(uniprotKbIdValues: string[]): string | null {
  return filterAnnotationValues(uniprotKbIdValues);
}

/**
 * Determine the annotation header type based on available scores and evidence.
 * Returns 'bitscore' if any scores are present, 'evidence' if any evidence codes
 * are present (but no scores), or null if neither exists.
 */
export function getAnnotationHeaderType(
  scores: (number[] | null)[],
  evidence: (string | null)[],
): 'bitscore' | 'evidence' | null {
  if (scores.some((s) => Array.isArray(s) && s.length > 0)) return 'bitscore';
  if (evidence.some((e) => e != null)) return 'evidence';
  return null;
}
