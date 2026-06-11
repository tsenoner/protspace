import { describe, it, expect } from 'vitest';
import { groupAnnotations, type GroupedAnnotation } from './annotation-categories';

/**
 * Filter annotations based on search query (mirrors the component's filtering).
 */
export function filterGroupedAnnotations(
  grouped: GroupedAnnotation[],
  query: string,
): GroupedAnnotation[] {
  const queryLower = query.trim().toLowerCase();

  if (!queryLower) {
    return grouped;
  }

  return grouped
    .map((group) => ({
      ...group,
      annotations: group.annotations.filter((annotation) =>
        annotation.toLowerCase().includes(queryLower),
      ),
    }))
    .filter((group) => group.annotations.length > 0); // Remove empty categories
}

/**
 * Flatten grouped annotations into a single array for keyboard navigation.
 */
export function flattenGroupedAnnotations(grouped: GroupedAnnotation[]): string[] {
  const flat: string[] = [];
  for (const group of grouped) {
    flat.push(...group.annotations);
  }
  return flat;
}

describe('annotation-select', () => {
  describe('groupAnnotations', () => {
    it('categorizes UniProt annotations correctly', () => {
      const result = groupAnnotations(['gene_name', 'reviewed', 'protein_families']);

      const uniprotGroup = result.find((g) => g.category === 'UniProt');
      expect(uniprotGroup).toBeDefined();
      expect(uniprotGroup?.annotations).toEqual(['gene_name', 'protein_families', 'reviewed']);
    });

    it('categorizes InterPro annotations correctly', () => {
      const result = groupAnnotations(['pfam', 'cath', 'signal_peptide']);

      const interproGroup = result.find((g) => g.category === 'InterPro');
      expect(interproGroup).toBeDefined();
      expect(interproGroup?.annotations).toEqual(['cath', 'pfam', 'signal_peptide']);
    });

    it('categorizes Taxonomy annotations in correct order', () => {
      const result = groupAnnotations(['species', 'genus', 'kingdom', 'domain', 'phylum']);

      const taxonomyGroup = result.find((g) => g.category === 'Taxonomy');
      expect(taxonomyGroup).toBeDefined();
      expect(taxonomyGroup?.annotations).toEqual([
        'domain',
        'kingdom',
        'phylum',
        'genus',
        'species',
      ]);
    });

    it('groups Biocentral predictions under their source (not a separate Predicted group)', () => {
      const result = groupAnnotations([
        'predicted_membrane',
        'predicted_transmembrane',
        'gene_name',
      ]);

      // No longer a "Predicted" group — predictions stay under their source, badged per-row.
      expect(result.find((g) => g.category === 'Predicted')).toBeUndefined();
      const biocentral = result.find((g) => g.category === 'Biocentral');
      expect(biocentral?.annotations).toEqual(['predicted_membrane', 'predicted_transmembrane']);
      expect(result.find((g) => g.category === 'UniProt')?.annotations).toEqual(['gene_name']);
    });

    it('keeps de-novo InterPro predictors (signal_peptide) in the InterPro group', () => {
      const result = groupAnnotations(['pfam', 'signal_peptide', 'cath']);
      // signal_peptide is marked predicted (⚡ per-row) but its source is still InterPro.
      const interpro = result.find((g) => g.category === 'InterPro');
      expect(interpro?.annotations).toEqual(['cath', 'pfam', 'signal_peptide']);
    });

    it('groups TED domains under a TED section', () => {
      const result = groupAnnotations(['ted_domains', 'gene_name']);
      expect(result.find((g) => g.category === 'TED')?.annotations).toEqual(['ted_domains']);
    });

    it('puts unknown predicted_ columns under Other (grouped by source, badged per-row)', () => {
      const result = groupAnnotations(['predicted_custom_thing', 'gene_name']);

      expect(result.find((g) => g.category === 'Other')?.annotations).toEqual([
        'predicted_custom_thing',
      ]);
    });

    it('orders sections Biocentral, InterPro, TED, Taxonomy, UniProt, Other', () => {
      const result = groupAnnotations([
        'custom',
        'species',
        'pfam',
        'gene_name',
        'predicted_membrane',
        'ted_domains',
      ]);

      expect(result.map((g) => g.category)).toEqual([
        'Biocentral',
        'InterPro',
        'TED',
        'Taxonomy',
        'UniProt',
        'Other',
      ]);
    });

    it('places unknown annotations in Other category', () => {
      const result = groupAnnotations(['custom_field', 'another_unknown']);

      const otherGroup = result.find((g) => g.category === 'Other');
      expect(otherGroup).toBeDefined();
      expect(otherGroup?.annotations).toEqual(['another_unknown', 'custom_field']);
    });

    it('sorts annotations alphabetically within each category', () => {
      const result = groupAnnotations(['reviewed', 'gene_name', 'annotation_score']);

      const uniprotGroup = result.find((g) => g.category === 'UniProt');
      expect(uniprotGroup?.annotations).toEqual(['annotation_score', 'gene_name', 'reviewed']);
    });

    it('returns source categories in order: InterPro, Taxonomy, UniProt, Other', () => {
      const result = groupAnnotations(['custom', 'species', 'pfam', 'gene_name']);

      expect(result.map((g) => g.category)).toEqual(['InterPro', 'Taxonomy', 'UniProt', 'Other']);
    });

    it('handles mixed annotations from multiple categories', () => {
      const result = groupAnnotations(['gene_name', 'pfam', 'species', 'custom_field']);

      expect(result.length).toBe(4);
      expect(result.find((g) => g.category === 'UniProt')?.annotations).toEqual(['gene_name']);
      expect(result.find((g) => g.category === 'InterPro')?.annotations).toEqual(['pfam']);
      expect(result.find((g) => g.category === 'Taxonomy')?.annotations).toEqual(['species']);
      expect(result.find((g) => g.category === 'Other')?.annotations).toEqual(['custom_field']);
    });

    it('handles empty annotations array', () => {
      expect(groupAnnotations([])).toEqual([]);
    });

    it('excludes empty categories from result', () => {
      const result = groupAnnotations(['gene_name']); // Only UniProt

      expect(result.length).toBe(1);
      expect(result[0].category).toBe('UniProt');
    });

    it('handles all taxonomy annotations in order', () => {
      const result = groupAnnotations([
        'species',
        'genus',
        'family',
        'order',
        'class',
        'phylum',
        'kingdom',
        'domain',
        'root',
      ]);

      const taxonomyGroup = result.find((g) => g.category === 'Taxonomy');
      expect(taxonomyGroup?.annotations).toEqual([
        'root',
        'domain',
        'kingdom',
        'phylum',
        'class',
        'order',
        'family',
        'genus',
        'species',
      ]);
    });
  });

  describe('filterGroupedAnnotations', () => {
    const grouped: GroupedAnnotation[] = [
      { category: 'UniProt', annotations: ['gene_name', 'reviewed', 'protein_families'] },
      { category: 'InterPro', annotations: ['pfam', 'cath'] },
      { category: 'Taxonomy', annotations: ['species', 'genus'] },
      { category: 'Other', annotations: ['custom_field'] },
    ];

    it('returns all annotations when query is empty', () => {
      const result = filterGroupedAnnotations(grouped, '');
      expect(result).toEqual(grouped);
    });

    it('filters annotations by substring match (case insensitive)', () => {
      const result = filterGroupedAnnotations(grouped, 'gene');
      expect(result.length).toBe(1);
      expect(result[0].category).toBe('UniProt');
      expect(result[0].annotations).toEqual(['gene_name']);
    });

    it('filters across multiple categories', () => {
      const result = filterGroupedAnnotations(grouped, 'e');
      const allAnnotations = result.flatMap((g) => g.annotations);
      expect(allAnnotations).toContain('gene_name');
      expect(allAnnotations).toContain('reviewed');
      expect(allAnnotations).toContain('species');
      expect(allAnnotations).toContain('genus');
    });

    it('removes categories with no matching annotations', () => {
      const result = filterGroupedAnnotations(grouped, 'pfam');
      expect(result.length).toBe(1);
      expect(result[0].category).toBe('InterPro');
    });

    it('handles case insensitive search', () => {
      const result = filterGroupedAnnotations(grouped, 'GENE');
      expect(result.length).toBe(1);
      expect(result[0].annotations).toEqual(['gene_name']);
    });

    it('trims whitespace from query', () => {
      const result = filterGroupedAnnotations(grouped, '  gene  ');
      expect(result.length).toBe(1);
      expect(result[0].annotations).toEqual(['gene_name']);
    });

    it('returns empty array when no matches found', () => {
      const result = filterGroupedAnnotations(grouped, 'xyz123');
      expect(result).toEqual([]);
    });

    it('handles partial matches', () => {
      const result = filterGroupedAnnotations(grouped, 'fam');
      expect(result.length).toBe(2); // pfam and protein_families
      const allAnnotations = result.flatMap((g) => g.annotations);
      expect(allAnnotations).toContain('pfam');
      expect(allAnnotations).toContain('protein_families');
    });
  });

  describe('flattenGroupedAnnotations', () => {
    it('flattens grouped annotations into single array', () => {
      const grouped: GroupedAnnotation[] = [
        { category: 'UniProt', annotations: ['gene_name', 'reviewed'] },
        { category: 'InterPro', annotations: ['pfam', 'cath'] },
      ];

      const result = flattenGroupedAnnotations(grouped);
      expect(result).toEqual(['gene_name', 'reviewed', 'pfam', 'cath']);
    });

    it('preserves order from grouped annotations', () => {
      const grouped: GroupedAnnotation[] = [
        { category: 'Taxonomy', annotations: ['species'] },
        { category: 'UniProt', annotations: ['gene_name'] },
        { category: 'InterPro', annotations: ['pfam'] },
      ];

      const result = flattenGroupedAnnotations(grouped);
      expect(result).toEqual(['species', 'gene_name', 'pfam']);
    });

    it('handles empty groups', () => {
      expect(flattenGroupedAnnotations([])).toEqual([]);
    });

    it('handles groups with no annotations', () => {
      const grouped: GroupedAnnotation[] = [
        { category: 'UniProt', annotations: [] },
        { category: 'InterPro', annotations: ['pfam'] },
      ];

      const result = flattenGroupedAnnotations(grouped);
      expect(result).toEqual(['pfam']);
    });

    it('handles single group with multiple annotations', () => {
      const grouped: GroupedAnnotation[] = [
        { category: 'UniProt', annotations: ['a', 'b', 'c', 'd'] },
      ];

      const result = flattenGroupedAnnotations(grouped);
      expect(result).toEqual(['a', 'b', 'c', 'd']);
    });
  });
});
