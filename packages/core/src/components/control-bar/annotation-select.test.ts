import { describe, it, expect } from 'vitest';
import {
  filterGroupedAnnotations,
  flattenGroupedAnnotations,
  groupAnnotations,
  type GroupedAnnotation,
} from './annotation-categories';

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
    const columns = [
      'gene_name',
      'reviewed',
      'protein_families',
      'pfam',
      'cath',
      'species',
      'genus',
      'custom_field',
    ];
    const grouped = groupAnnotations(columns);
    const filter = (query: string) => filterGroupedAnnotations(columns, query);
    const names = flattenGroupedAnnotations;

    it('returns all annotations when query is empty', () => {
      expect(filter('')).toEqual(grouped);
    });

    it('matches the displayed label, not the column name', () => {
      // `cath` comes along because its label is "CATH-Gene3D" — visible text.
      expect(names(filter('gene'))).toEqual(['cath', 'gene_name']);
    });

    it('filters across multiple categories', () => {
      const all = names(filter('e'));
      expect(all).toContain('gene_name');
      expect(all).toContain('reviewed');
      expect(all).toContain('species');
      expect(all).toContain('genus');
    });

    it('removes categories with no matching annotations', () => {
      const result = filter('pfam');
      expect(result.length).toBe(1);
      expect(result[0].category).toBe('InterPro');
    });

    it('handles case insensitive search', () => {
      expect(names(filter('GENE'))).toEqual(names(filter('gene')));
    });

    it('trims whitespace from query', () => {
      expect(names(filter('  gene  '))).toEqual(names(filter('gene')));
    });

    it('returns empty array when no matches found', () => {
      expect(filter('xyz123')).toEqual([]);
    });

    it('handles partial matches', () => {
      // both via their labels, "Pfam" and "Protein family"
      expect(names(filter('fam')).sort()).toEqual(['pfam', 'protein_families']);
    });

    it('does not match a column name the picker does not display', () => {
      // the reported case: `predicted` offered the Biocentral columns, which read
      // "Membrane", "Transmembrane", … — the word is nowhere on screen
      const biocentral = ['predicted_membrane', 'predicted_transmembrane', 'ted_domains'];
      expect(names(filterGroupedAnnotations(biocentral, 'predicted'))).toEqual([]);
      expect(names(filterGroupedAnnotations(biocentral, 'ted'))).toEqual(['ted_domains']);
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
