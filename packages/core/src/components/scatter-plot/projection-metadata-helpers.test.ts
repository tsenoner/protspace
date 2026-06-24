import { describe, it, expect } from 'vitest';
import { buildProjectionMetadataRows } from './projection-metadata-helpers';

describe('buildProjectionMetadataRows', () => {
  it('returns [] for null or empty metadata', () => {
    expect(buildProjectionMetadataRows(null)).toEqual([]);
    expect(buildProjectionMetadataRows({})).toEqual([]);
  });

  it('skips internal dimension/name fields', () => {
    const rows = buildProjectionMetadataRows({ name: 'PCA 2', dimensions: 2, foo: 'bar' });
    const keys = rows.map(([k]) => k);
    expect(keys).not.toContain('Name');
    expect(keys).not.toContain('Dimensions');
    expect(rows).toContainEqual(['Foo', 'bar']);
  });

  it('flattens info_json one level (existing behavior)', () => {
    const rows = buildProjectionMetadataRows({
      info_json: '{"metric":"cosine","n_neighbors":15}',
    });
    expect(rows).toContainEqual(['Metric', 'cosine']);
    expect(rows).toContainEqual(['N Neighbors', '15']);
  });

  it('expands info_json.quality into discrete per-metric rows', () => {
    const info = JSON.stringify({
      metric: 'cosine',
      quality: {
        knn_overlap: { value: 0.83, k: 15, metric: 'cosine' },
        trustworthiness: { value: 0.952, k: 15, metric: 'cosine' },
        continuity: { value: 0.948, k: 15, metric: 'euclidean' },
      },
    });
    const rows = buildProjectionMetadataRows({ info_json: info });
    const map = new Map(rows);
    // NOT a single "Quality" row holding a raw JSON blob
    expect(map.has('Quality')).toBe(false);
    expect(map.get('Knn Overlap')).toBe('0.830 (cosine, k=15)');
    expect(map.get('Trustworthiness')).toBe('0.952 (cosine, k=15)');
    expect(map.get('Continuity')).toBe('0.948 (euclidean, k=15)');
  });

  it('renders a skipped faithfulness metric as N/A with the marker', () => {
    const info = JSON.stringify({
      quality: { knn_overlap: { value: null, skipped: 'n_too_large', n: 30000 } },
    });
    const rows = buildProjectionMetadataRows({ info_json: info });
    expect(new Map(rows).get('Knn Overlap')).toBe('N/A (skipped: n_too_large)');
  });

  it('tolerates a flat (scalar) quality value', () => {
    const info = JSON.stringify({ quality: { knn_overlap: 0.83 } });
    const rows = buildProjectionMetadataRows({ info_json: info });
    expect(new Map(rows).get('Knn Overlap')).toBe('0.830');
  });
});
