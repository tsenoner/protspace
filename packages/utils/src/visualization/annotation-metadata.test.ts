import { describe, it, expect } from 'vitest';
import {
  ANNOTATION_METADATA,
  PREDICTED_PREFIX,
  TAXONOMY_RANK_ORDER,
  annotationLabel,
  annotationMatchesQuery,
  annotationSource,
  compareTaxonomyRank,
  getAnnotationMeta,
  isPredictedAnnotation,
  prettifyAnnotationName,
} from './annotation-metadata';

/** The Biocentral ML columns, spelled out once. */
const BIOCENTRAL_COLUMNS = [
  'predicted_membrane',
  'predicted_signal_peptide',
  'predicted_subcellular_location',
  'predicted_transmembrane',
];

describe('annotation-metadata registry', () => {
  it('resolves known annotations to their metadata', () => {
    const ec = getAnnotationMeta('ec');
    expect(ec.label).toBe('EC number');
    expect(ec.source).toBe('UniProt');
    expect(ec.isPredicted).toBe(false);
    expect(ec.description.length).toBeGreaterThan(0);
  });

  it('flags the Biocentral predictions as predicted', () => {
    for (const column of BIOCENTRAL_COLUMNS) {
      expect(ANNOTATION_METADATA[column]?.isPredicted).toBe(true);
      expect(ANNOTATION_METADATA[column]?.source).toBe('Biocentral');
    }
  });

  it('also flags the de-novo / structure-based predictors that lack the prefix', () => {
    // Phobius signal_peptide (topology) and TED ted_domains (AlphaFold structure) are computational
    // predictions even though their column names do not use the backend `predicted_` convention.
    expect(ANNOTATION_METADATA.signal_peptide?.isPredicted).toBe(true);
    expect(ANNOTATION_METADATA.ted_domains?.isPredicted).toBe(true);
  });

  it('marks exactly the computational predictors, not reference signatures or curated data', () => {
    const predicted = Object.entries(ANNOTATION_METADATA)
      .filter(([, meta]) => meta.isPredicted)
      .map(([column]) => column)
      .sort();
    expect(predicted).toEqual(
      [
        'predicted_membrane',
        'predicted_signal_peptide',
        'predicted_subcellular_location',
        'predicted_transmembrane',
        'signal_peptide',
        'ted_domains',
      ].sort(),
    );
    // Reference signature databases stay unflagged.
    for (const column of ['pfam', 'cath', 'superfamily', 'panther', 'prosite', 'prints']) {
      expect(ANNOTATION_METADATA[column]?.isPredicted).toBe(false);
    }
  });

  it('keeps the predicted_ prefix on the Biocentral ML columns', () => {
    for (const column of BIOCENTRAL_COLUMNS) {
      expect(column.startsWith(PREDICTED_PREFIX)).toBe(true);
    }
  });
});

describe('taxonomy rank order', () => {
  it('orders ranks general → specific and sorts unknown columns last', () => {
    const shuffled = ['species', 'root', 'genus', 'domain', 'phylum', 'mystery'];
    expect([...shuffled].sort(compareTaxonomyRank)).toEqual([
      'root',
      'domain',
      'phylum',
      'genus',
      'species',
      'mystery',
    ]);
  });

  it('covers the nine taxonomy registry columns', () => {
    const taxonomyColumns = Object.entries(ANNOTATION_METADATA)
      .filter(([, meta]) => meta.source === 'Taxonomy')
      .map(([column]) => column);
    expect([...taxonomyColumns].sort()).toEqual([...TAXONOMY_RANK_ORDER].sort());
  });
});

describe('isPredictedAnnotation', () => {
  it('uses the registry flag for known columns', () => {
    expect(isPredictedAnnotation('predicted_membrane')).toBe(true);
    expect(isPredictedAnnotation('ec')).toBe(false);
  });

  it('falls back to the predicted_ prefix for unknown columns', () => {
    expect(isPredictedAnnotation('predicted_custom_thing')).toBe(true);
    expect(isPredictedAnnotation('my_score')).toBe(false);
  });
});

describe('unknown-column handling', () => {
  it('synthesizes graceful metadata for unknown columns', () => {
    const meta = getAnnotationMeta('my_score');
    expect(meta.label).toBe('My score');
    expect(meta.source).toBe('Other');
    expect(meta.description).toBe('');
    expect(meta.docsUrl).toBeUndefined();
    expect(meta.isPredicted).toBe(false);
  });

  it('treats unknown predicted_ columns as predictions', () => {
    expect(getAnnotationMeta('predicted_custom_thing').isPredicted).toBe(true);
  });
});

describe('label and source helpers', () => {
  it('returns the registry label or a prettified fallback', () => {
    expect(annotationLabel('ec')).toBe('EC number');
    expect(annotationLabel('some_custom_col')).toBe('Some custom col');
  });

  it('returns the registry source or Other', () => {
    expect(annotationSource('pfam')).toBe('InterPro');
    expect(annotationSource('whatever')).toBe('Other');
  });

  it('describes synthetic EAT confidence as a reliability index', () => {
    const meta = getAnnotationMeta('ec__eat_confidence');
    expect(meta.label).toBe('EC number — EAT confidence');
    expect(meta.source).toBe('UniProt');
    expect(meta.isPredicted).toBe(false);
    expect(meta.description).toContain('reliability index');
    expect(meta.description).toContain('not a calibrated probability');
  });

  it('distinguishes runtime EAT confidence from a user column with the same suffix', () => {
    const userMeta = getAnnotationMeta('ec__eat_confidence', { runtime: undefined });
    expect(userMeta.label).toBe('Ec eat confidence');
    expect(userMeta.source).toBe('Other');

    const runtimeMeta = getAnnotationMeta('ec__eat_confidence__runtime_2', {
      runtime: { role: 'eat-confidence', baseAnnotation: 'ec' },
    });
    expect(runtimeMeta.label).toBe('EC number — EAT confidence');
    expect(runtimeMeta.source).toBe('UniProt');
  });
});

describe('prettifyAnnotationName', () => {
  it('replaces separators and capitalizes', () => {
    expect(prettifyAnnotationName('my_score')).toBe('My score');
    expect(prettifyAnnotationName('some-other-col')).toBe('Some other col');
  });

  it('returns the original when nothing to prettify', () => {
    expect(prettifyAnnotationName('')).toBe('');
  });
});

describe('annotationMatchesQuery', () => {
  it('does not match the middle of a column name', () => {
    // `ted` lives inside `predicted`, and these columns display "Membrane",
    // "Signal peptide", "Subcellular location", "Transmembrane" — no "ted".
    expect(BIOCENTRAL_COLUMNS.filter((c) => annotationMatchesQuery(c, 'ted'))).toEqual([]);
    expect(annotationMatchesQuery('ted_domains', 'ted')).toBe(true);
  });

  it('finds every column by its own full name, separators and all', () => {
    // The word rule has to split the query too, or typing the name you know
    // empties the list at the underscore.
    for (const column of Object.keys(ANNOTATION_METADATA)) {
      expect(annotationMatchesQuery(column, column)).toBe(true);
    }
  });

  it('matches a column name by word', () => {
    expect(BIOCENTRAL_COLUMNS.every((c) => annotationMatchesQuery(c, 'predicted'))).toBe(true);
    expect(annotationMatchesQuery('predicted_subcellular_location', 'loc')).toBe(true);
  });

  it('matches a partial word of the displayed label', () => {
    // mid-word, but on screen: "Subcellular location", "Transmembrane"
    expect(annotationMatchesQuery('predicted_subcellular_location', 'cellular')).toBe(true);
    expect(annotationMatchesQuery('predicted_transmembrane', 'membrane')).toBe(true);
    // a hyphenated label is matched as typed, not word-split: "CATH-Gene3D"
    expect(annotationMatchesQuery('cath', 'cath-gene3d')).toBe(true);
  });

  it('treats an empty query as matching everything, case-insensitively', () => {
    expect(annotationMatchesQuery('predicted_membrane', '   ')).toBe(true);
    expect(annotationMatchesQuery('ted_domains', 'TED')).toBe(true);
  });

  it('reaches a column outside the registry through its derived label', () => {
    // No registry entry, so the label is the prettified column name — which
    // means a mid-word query does reach it. That is the rule working: the
    // reader is looking at "My custom score".
    expect(annotationMatchesQuery('my_custom_score', 'core')).toBe(true);
    expect(annotationMatchesQuery('my_custom_score', 'zzz')).toBe(false);
  });
});
