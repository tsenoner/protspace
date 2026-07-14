import { describe, expect, it } from 'vitest';
import {
  buildSearchParamsWithExploreView,
  getResolvedExploreViewNormalization,
  parseExploreViewRequest,
  resolveExploreView,
} from './url-state';

describe('explore url state', () => {
  it('parses a bare URL without requested values', () => {
    const parsed = parseExploreViewRequest(new URLSearchParams(''));

    expect(parsed).toEqual({
      requested: {
        tooltip: undefined,
      },
      present: {
        annotation: false,
        projection: false,
        tooltip: false,
      },
      normalize: {
        annotation: false,
        projection: false,
        tooltip: false,
      },
    });
  });

  it('uses the first duplicate value for requested params and marks them for normalization', () => {
    const parsed = parseExploreViewRequest(
      new URLSearchParams('annotation=ec&annotation=pfam&projection=UMAP&projection=PCA'),
    );

    expect(parsed).toEqual({
      requested: {
        annotation: 'ec',
        projection: 'UMAP',
        tooltip: undefined,
      },
      present: {
        annotation: true,
        projection: true,
        tooltip: false,
      },
      normalize: {
        annotation: true,
        projection: true,
        tooltip: false,
      },
    });
  });

  it('treats empty values as invalid and normalizes them', () => {
    const parsed = parseExploreViewRequest(new URLSearchParams('annotation=&projection=%20'));
    const resolved = resolveExploreView(parsed.requested, ['ec', 'pfam'], ['UMAP', 'PCA']);

    expect(parsed).toEqual({
      requested: {
        tooltip: undefined,
      },
      present: {
        annotation: true,
        projection: true,
        tooltip: false,
      },
      normalize: {
        annotation: true,
        projection: true,
        tooltip: false,
      },
    });
    expect(resolved).toEqual({
      effective: {
        annotation: 'ec',
        projection: 'UMAP',
        tooltip: [],
      },
      matchesRequested: {
        annotation: false,
        projection: false,
        tooltip: false,
      },
    });
    expect(getResolvedExploreViewNormalization(parsed, resolved!)).toEqual({
      annotation: true,
      projection: true,
      tooltip: false,
    });
  });

  it('keeps both requested values when they are valid', () => {
    const parsed = parseExploreViewRequest(new URLSearchParams('annotation=pfam&projection=PCA'));
    const resolved = resolveExploreView(parsed.requested, ['ec', 'pfam'], ['UMAP', 'PCA']);

    expect(resolved).toEqual({
      effective: {
        annotation: 'pfam',
        projection: 'PCA',
        tooltip: [],
      },
      matchesRequested: {
        annotation: true,
        projection: true,
        tooltip: false,
      },
    });
    expect(getResolvedExploreViewNormalization(parsed, resolved!)).toEqual({
      annotation: false,
      projection: false,
      tooltip: false,
    });
  });

  it('normalizes duplicate params even when the first values are valid', () => {
    const parsed = parseExploreViewRequest(
      new URLSearchParams('annotation=pfam&annotation=ec&projection=PCA&projection=UMAP'),
    );
    const resolved = resolveExploreView(parsed.requested, ['ec', 'pfam'], ['UMAP', 'PCA']);

    expect(resolved).toEqual({
      effective: {
        annotation: 'pfam',
        projection: 'PCA',
        tooltip: [],
      },
      matchesRequested: {
        annotation: true,
        projection: true,
        tooltip: false,
      },
    });
    expect(getResolvedExploreViewNormalization(parsed, resolved!)).toEqual({
      annotation: true,
      projection: true,
      tooltip: false,
    });
  });

  it('resolves partial validity independently', () => {
    const parsed = parseExploreViewRequest(
      new URLSearchParams('annotation=pfam&projection=UNKNOWN'),
    );
    const resolved = resolveExploreView(parsed.requested, ['ec', 'pfam'], ['UMAP', 'PCA']);

    expect(resolved).toEqual({
      effective: {
        annotation: 'pfam',
        projection: 'UMAP',
        tooltip: [],
      },
      matchesRequested: {
        annotation: true,
        projection: false,
        tooltip: false,
      },
    });
    expect(getResolvedExploreViewNormalization(parsed, resolved!)).toEqual({
      annotation: false,
      projection: true,
      tooltip: false,
    });
  });

  it('normalizes both keys when both requested values are invalid', () => {
    const parsed = parseExploreViewRequest(
      new URLSearchParams('annotation=unknown&projection=UNKNOWN'),
    );
    const resolved = resolveExploreView(parsed.requested, ['ec', 'pfam'], ['UMAP', 'PCA']);

    expect(resolved).toEqual({
      effective: {
        annotation: 'ec',
        projection: 'UMAP',
        tooltip: [],
      },
      matchesRequested: {
        annotation: false,
        projection: false,
        tooltip: false,
      },
    });
    expect(getResolvedExploreViewNormalization(parsed, resolved!)).toEqual({
      annotation: true,
      projection: true,
      tooltip: false,
    });
  });

  it('returns null when the dataset has no available view options yet', () => {
    const parsed = parseExploreViewRequest(new URLSearchParams('annotation=ec&projection=UMAP'));

    expect(resolveExploreView(parsed.requested, [], ['UMAP'])).toBeNull();
    expect(resolveExploreView(parsed.requested, ['ec'], [])).toBeNull();
  });

  it('preserves unrelated params for user-driven writes', () => {
    const next = buildSearchParamsWithExploreView(
      new URLSearchParams('webglPerf=1&dataset=demo'),
      {
        annotation: 'pfam',
        projection: 'PCA',
        tooltip: [],
      },
      { mode: 'user' },
    );

    expect(next.toString()).toBe('webglPerf=1&dataset=demo&annotation=pfam&projection=PCA');
  });

  it('normalizes only invalid keys during replace writes', () => {
    const next = buildSearchParamsWithExploreView(
      new URLSearchParams('annotation=pfam&projection=UNKNOWN&webglPerf=1'),
      {
        annotation: 'pfam',
        projection: 'UMAP',
        tooltip: [],
      },
      {
        mode: 'normalize',
        normalize: {
          annotation: false,
          projection: true,
          tooltip: false,
        },
      },
    );

    expect(next.toString()).toBe('annotation=pfam&projection=UMAP&webglPerf=1');
  });

  describe('tooltip param', () => {
    it('parses comma-separated tooltip annotations', () => {
      const parsed = parseExploreViewRequest(
        new URLSearchParams('annotation=pfam&tooltip=ec%2Cgo'),
      );
      expect(parsed.requested.tooltip).toEqual(['ec', 'go']);
      expect(parsed.present.tooltip).toBe(true);
      expect(parsed.normalize.tooltip).toBe(false);
    });

    it('drops duplicates within the tooltip param and marks for normalization', () => {
      const parsed = parseExploreViewRequest(new URLSearchParams('tooltip=ec%2Cec%2Cgo'));
      expect(parsed.requested.tooltip).toEqual(['ec', 'go']);
      expect(parsed.normalize.tooltip).toBe(true);
    });

    it('drops empty segments within the tooltip param and marks for normalization', () => {
      const parsed = parseExploreViewRequest(new URLSearchParams('tooltip=ec%2C%2Cgo'));
      expect(parsed.requested.tooltip).toEqual(['ec', 'go']);
      expect(parsed.normalize.tooltip).toBe(true);
    });

    it('treats a fully empty tooltip param as present but invalid', () => {
      const parsed = parseExploreViewRequest(new URLSearchParams('tooltip='));
      expect(parsed.requested.tooltip).toBeUndefined();
      expect(parsed.present.tooltip).toBe(true);
      expect(parsed.normalize.tooltip).toBe(true);
    });

    it('flags duplicate tooltip keys for normalization', () => {
      const parsed = parseExploreViewRequest(new URLSearchParams('tooltip=ec&tooltip=go'));
      expect(parsed.requested.tooltip).toEqual(['ec']);
      expect(parsed.normalize.tooltip).toBe(true);
    });

    it('drops tooltip entries equal to the effective primary annotation', () => {
      const parsed = parseExploreViewRequest(
        new URLSearchParams('annotation=pfam&tooltip=pfam%2Cec'),
      );
      const resolved = resolveExploreView(parsed.requested, ['ec', 'pfam', 'go'], ['UMAP']);

      expect(resolved!.effective.tooltip).toEqual(['ec']);
      expect(resolved!.matchesRequested.tooltip).toBe(false);
      expect(getResolvedExploreViewNormalization(parsed, resolved!).tooltip).toBe(true);
    });

    it('drops tooltip entries not present in the dataset', () => {
      const parsed = parseExploreViewRequest(
        new URLSearchParams('annotation=pfam&tooltip=ec%2Cunknown%2Cgo'),
      );
      const resolved = resolveExploreView(parsed.requested, ['ec', 'pfam', 'go'], ['UMAP']);

      expect(resolved!.effective.tooltip).toEqual(['ec', 'go']);
      expect(resolved!.matchesRequested.tooltip).toBe(false);
      expect(getResolvedExploreViewNormalization(parsed, resolved!).tooltip).toBe(true);
    });

    it('preserves a valid tooltip set without normalization', () => {
      const parsed = parseExploreViewRequest(
        new URLSearchParams('annotation=pfam&tooltip=ec%2Cgo'),
      );
      const resolved = resolveExploreView(parsed.requested, ['ec', 'pfam', 'go'], ['UMAP']);

      expect(resolved!.effective.tooltip).toEqual(['ec', 'go']);
      expect(resolved!.matchesRequested.tooltip).toBe(true);
      expect(getResolvedExploreViewNormalization(parsed, resolved!).tooltip).toBe(false);
    });

    it('serializes tooltip annotations on user writes', () => {
      const next = buildSearchParamsWithExploreView(
        new URLSearchParams(),
        {
          annotation: 'pfam',
          projection: 'UMAP',
          tooltip: ['ec', 'go'],
        },
        { mode: 'user' },
      );

      expect(next.get('tooltip')).toBe('ec,go');
    });

    it('removes the tooltip param when the effective set is empty on user writes', () => {
      const next = buildSearchParamsWithExploreView(
        new URLSearchParams('tooltip=ec'),
        {
          annotation: 'pfam',
          projection: 'UMAP',
          tooltip: [],
        },
        { mode: 'user' },
      );

      expect(next.has('tooltip')).toBe(false);
    });

    it('normalizes the tooltip param when flagged during replace writes', () => {
      const next = buildSearchParamsWithExploreView(
        new URLSearchParams('annotation=pfam&projection=UMAP&tooltip=pfam%2Cec'),
        {
          annotation: 'pfam',
          projection: 'UMAP',
          tooltip: ['ec'],
        },
        {
          mode: 'normalize',
          normalize: {
            annotation: false,
            projection: false,
            tooltip: true,
          },
        },
      );

      expect(next.get('tooltip')).toBe('ec');
    });
  });
});
