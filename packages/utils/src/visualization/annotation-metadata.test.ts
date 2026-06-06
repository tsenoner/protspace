import { describe, it, expect } from 'vitest';
import {
  ANNOTATION_METADATA,
  PREDICTED_PREFIX,
  getAnnotationMeta,
  isPredictedAnnotation,
  annotationLabel,
  annotationSource,
  prettifyAnnotationName,
} from './annotation-metadata';

describe('annotation-metadata registry', () => {
  it('resolves known annotations to their metadata', () => {
    const ec = getAnnotationMeta('ec');
    expect(ec.label).toBe('EC number');
    expect(ec.source).toBe('UniProt');
    expect(ec.isPredicted).toBe(false);
    expect(ec.description.length).toBeGreaterThan(0);
  });

  it('flags the Biocentral predictions as predicted', () => {
    for (const column of [
      'predicted_subcellular_location',
      'predicted_membrane',
      'predicted_signal_peptide',
      'predicted_transmembrane',
    ]) {
      expect(ANNOTATION_METADATA[column]?.isPredicted).toBe(true);
      expect(ANNOTATION_METADATA[column]?.source).toBe('Biocentral');
    }
  });

  it('marks every predicted entry with the predicted_ prefix', () => {
    for (const [column, meta] of Object.entries(ANNOTATION_METADATA)) {
      if (meta.isPredicted) {
        expect(column.startsWith(PREDICTED_PREFIX)).toBe(true);
      }
    }
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
