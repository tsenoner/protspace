import { describe, expect, it } from 'vitest';
import type { ClusterAgreementEntry } from '@protspace/utils';
import {
  formatMetadataKey,
  formatMetadataValue,
  modalCoverage,
  splitMetadata,
} from './projection-metadata-format';

/** One faithfulness entry as the backend writes it: the value plus its provenance. */
function qualityEntry(value: number | null, scope: 'local' | 'global') {
  return { value, scope, k: 15, seed: 42, sampled: false, sample_size: 1428 };
}

/** One Recovers row; only `scored` matters to modalCoverage. */
const recovered = (annotation: string, scored: number | null): ClusterAgreementEntry => ({
  annotation,
  metrics: [],
  categories: null,
  scored,
});

describe('splitMetadata', () => {
  it('splitMetadata separates parameters from quality metrics', () => {
    const { parameters, quality, qualityScope } = splitMetadata({
      dimension: 2,
      name: 'ProtT5 — UMAP 2',
      n_neighbors: 15,
      min_dist: 0.1,
      quality: {
        knn_overlap: qualityEntry(0.5776844070961717, 'local'),
        spearman_distance: qualityEntry(0.53, 'global'),
      },
    });

    // `dimension` and `name` are not parameters; the reducer's knobs carry no description.
    expect(parameters).toEqual([
      { label: 'N Neighbors', value: '15', description: '' },
      { label: 'Min Dist', value: '0.100', description: '' },
    ]);
    // Registry metrics take the registry's spelling, formatStatValue's two decimals and a scope.
    expect(quality.map(({ label, value, scope }) => ({ label, value, scope }))).toEqual([
      { label: 'kNN Overlap', value: '0.58', scope: 'local' },
      { label: 'Spearman Distance', value: '0.53', scope: 'global' },
    ]);
    expect(quality.every((row) => row.description.length > 0)).toBe(true);
    expect(qualityScope).toBe('1,428 proteins compared');
  });

  it('a JSON-string field is parsed into its quality entries', () => {
    const { parameters, quality, qualityScope } = splitMetadata({
      info_json: JSON.stringify({
        n_components: 2,
        quality: {
          trustworthiness: { value: 0.97, scope: 'local', sampled: true, sample_size: 5000 },
        },
      }),
    });
    expect(parameters).toEqual([{ label: 'N Components', value: '2', description: '' }]);
    expect(quality).toHaveLength(1);
    expect(quality[0]).toMatchObject({ label: 'Trustworthiness', value: '0.97', scope: 'local' });
    expect(qualityScope).toBe('5,000 proteins compared · subsampled');

    // A JSON-named field that does not parse stays one parameter, shown as written.
    expect(splitMetadata({ info_json: 'not json' }).parameters).toEqual([
      { label: 'Info Json', value: 'not json', description: '' },
    ]);
  });

  it('an empty or missing metadata gives no rows', () => {
    const empty = { parameters: [], quality: [], qualityScope: '' };
    expect(splitMetadata(undefined)).toEqual(empty);
    expect(splitMetadata({})).toEqual(empty);
    expect(splitMetadata({ dimension: 2, name: 'PCA 2' })).toEqual(empty);
  });

  it('a metric the backend skipped reads N/A', () => {
    const { quality } = splitMetadata({ quality: { continuity: qualityEntry(null, 'local') } });
    expect(quality[0]).toMatchObject({ label: 'Continuity', value: 'N/A', scope: 'local' });
  });
});

describe('metadata formatting', () => {
  it('formatMetadataKey turns a snake_case or camelCase key into words', () => {
    expect(formatMetadataKey('n_neighbors')).toBe('N Neighbors');
    expect(formatMetadataKey('minDist')).toBe('Min Dist');
    expect(formatMetadataKey('random_state')).toBe('Random State');
  });

  it('formatMetadataValue gives explained variance two decimals and other fractions three', () => {
    expect(formatMetadataValue([0.71234, 0.2], 'explained_variance_ratio')).toBe('0.71, 0.20');
    expect(formatMetadataValue(0.12345, 'min_dist')).toBe('0.123');
    expect(formatMetadataValue(15, 'n_neighbors')).toBe('15');
    expect(formatMetadataValue(true, 'whiten')).toBe('Yes');
    expect(formatMetadataValue(null, 'seed')).toBe('N/A');
    expect(formatMetadataValue({ a: 1 }, 'extra')).toBe('{"a":1}');
  });
});

describe('modalCoverage', () => {
  it('modalCoverage picks the coverage most entries share and ignores unscored ones', () => {
    expect(
      modalCoverage([
        recovered('family', 811),
        recovered('ec', 192),
        recovered('order', 811),
        recovered('kingdom', null),
        recovered('phylum', null),
      ]),
    ).toBe(811);
    // A tie keeps the first value seen.
    expect(modalCoverage([recovered('ec', 192), recovered('family', 811)])).toBe(192);
  });

  it('modalCoverage of no scored entries is null', () => {
    expect(modalCoverage([])).toBeNull();
    expect(modalCoverage([recovered('family', null)])).toBeNull();
  });
});
