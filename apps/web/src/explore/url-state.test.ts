import { describe, expect, it } from 'vitest';
import {
  buildSearchParamsWithExploreView,
  getDatasetParam,
  getDatasetSearchParamsUpdate,
  getResolvedExploreViewNormalization,
  parseExploreViewRequest,
  resolveExploreView,
  setDatasetParam,
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

  describe('dataset defaults', () => {
    const annotations = ['annotation_score', 'ec', 'pfam', 'species', 'gene_name'];
    const projections = ['PCA 2', 'UMAP 2'];
    const defaults = { annotation: 'pfam', projection: 'UMAP 2', tooltip: ['species', 'ec'] };

    it('resolves a landing request to the whole default view with no normalization', () => {
      const parsed = parseExploreViewRequest(new URLSearchParams('dataset=phosphatase'));
      const resolved = resolveExploreView(parsed.requested, annotations, projections, defaults);

      expect(resolved?.effective).toEqual({
        annotation: 'pfam',
        projection: 'UMAP 2',
        tooltip: ['species', 'ec'],
      });
      expect(getResolvedExploreViewNormalization(parsed, resolved!)).toEqual({
        annotation: false,
        projection: false,
        tooltip: false,
      });
    });

    it('fills only the missing field of a partial request, with no tooltip', () => {
      const parsed = parseExploreViewRequest(new URLSearchParams('annotation=ec'));
      const resolved = resolveExploreView(parsed.requested, annotations, projections, defaults);

      expect(resolved?.effective).toEqual({ annotation: 'ec', projection: 'UMAP 2', tooltip: [] });
      expect(getResolvedExploreViewNormalization(parsed, resolved!)).toEqual({
        annotation: false,
        projection: false,
        tooltip: false,
      });
    });

    it('keeps an explicit tooltip over the default one', () => {
      const parsed = parseExploreViewRequest(
        new URLSearchParams('annotation=ec&projection=PCA+2&tooltip=gene_name'),
      );
      const resolved = resolveExploreView(parsed.requested, annotations, projections, defaults);

      expect(resolved?.effective).toEqual({
        annotation: 'ec',
        projection: 'PCA 2',
        tooltip: ['gene_name'],
      });
    });

    it('falls back to the default for an invalid annotation and flags it for normalization', () => {
      const parsed = parseExploreViewRequest(
        new URLSearchParams('annotation=unknown&projection=nope'),
      );
      const resolved = resolveExploreView(parsed.requested, annotations, projections, defaults);

      expect(resolved?.effective).toEqual({
        annotation: 'pfam',
        projection: 'UMAP 2',
        tooltip: [],
      });
      expect(getResolvedExploreViewNormalization(parsed, resolved!)).toEqual({
        annotation: true,
        projection: true,
        tooltip: false,
      });
    });

    it('falls back to the first available names when the defaults drift from the data', () => {
      const parsed = parseExploreViewRequest(new URLSearchParams(''));
      const resolved = resolveExploreView(parsed.requested, annotations, projections, {
        annotation: 'protein_families',
        projection: 'ProtT5 — UMAP 2',
        tooltip: ['kingdom', 'species'],
      });

      expect(resolved?.effective).toEqual({
        annotation: 'annotation_score',
        projection: 'PCA 2',
        tooltip: ['species'],
      });
      expect(getResolvedExploreViewNormalization(parsed, resolved!)).toEqual({
        annotation: false,
        projection: false,
        tooltip: false,
      });
    });

    it('drops the effective annotation from the default tooltip', () => {
      const parsed = parseExploreViewRequest(new URLSearchParams(''));
      const resolved = resolveExploreView(parsed.requested, annotations, projections, {
        annotation: 'ec',
        tooltip: ['ec', 'species'],
      });

      expect(resolved?.effective).toEqual({
        annotation: 'ec',
        projection: 'PCA 2',
        tooltip: ['species'],
      });
    });

    it('matches the first-available behaviour when there are no defaults', () => {
      for (const query of ['', 'annotation=pfam', 'annotation=unknown&projection=UMAP+2']) {
        const parsed = parseExploreViewRequest(new URLSearchParams(query));
        expect(resolveExploreView(parsed.requested, annotations, projections, {})).toEqual(
          resolveExploreView(parsed.requested, annotations, projections),
        );
      }
      const bare = parseExploreViewRequest(new URLSearchParams(''));
      expect(resolveExploreView(bare.requested, annotations, projections)?.effective).toEqual({
        annotation: 'annotation_score',
        projection: 'PCA 2',
        tooltip: [],
      });
    });
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

  describe('dataset param', () => {
    it('reads the dataset param when present', () => {
      expect(getDatasetParam(new URLSearchParams('dataset=demo'))).toBe('demo');
    });

    it('returns null when the dataset param is absent', () => {
      expect(getDatasetParam(new URLSearchParams('annotation=ec'))).toBeNull();
    });

    it('sets the dataset param without touching unrelated params', () => {
      const next = setDatasetParam(new URLSearchParams('annotation=ec'), 'demo');
      expect(next.toString()).toBe('annotation=ec&dataset=demo');
    });

    it('deletes the dataset param when given null', () => {
      const next = setDatasetParam(new URLSearchParams('dataset=demo&annotation=ec'), null);
      expect(next.toString()).toBe('annotation=ec');
    });

    it('is a no-op when deleting an already-absent dataset param', () => {
      const next = setDatasetParam(new URLSearchParams('annotation=ec'), null);
      expect(next.toString()).toBe('annotation=ec');
    });

    describe('getDatasetSearchParamsUpdate', () => {
      it('pushes the dataset param on a menu choice, dropping the view params', () => {
        const update = getDatasetSearchParamsUpdate(
          new URLSearchParams('annotation=ec'),
          'demo',
          'menu',
        );

        expect(update).toEqual({
          next: new URLSearchParams('dataset=demo'),
          replace: false,
        });
      });

      it('keeps unrelated params on a menu choice but drops annotation, projection and tooltip', () => {
        const update = getDatasetSearchParamsUpdate(
          new URLSearchParams(
            'seed=1&annotation=ec&projection=ProtT5+%E2%80%94+UMAP+2&tooltip=pfam,species&dataset=demo',
          ),
          'phosphatase',
          'menu',
        );

        expect(update?.replace).toBe(false);
        expect(update?.next.toString()).toBe('seed=1&dataset=phosphatase');
      });

      it('keeps the view params on a user import and on a startup load', () => {
        const searchParams = new URLSearchParams('dataset=demo&annotation=ec&tooltip=pfam');

        expect(getDatasetSearchParamsUpdate(searchParams, null, 'user')?.next.toString()).toBe(
          'annotation=ec&tooltip=pfam',
        );
        expect(getDatasetSearchParamsUpdate(searchParams, 'demo', 'startup')?.next.toString()).toBe(
          'annotation=ec&tooltip=pfam',
        );
      });

      it('replaces (deletes) the dataset param on a user import', () => {
        const update = getDatasetSearchParamsUpdate(
          new URLSearchParams('dataset=demo&annotation=ec'),
          null,
          'user',
        );

        expect(update).toEqual({
          next: new URLSearchParams('annotation=ec'),
          replace: true,
        });
      });

      it('replaces (deletes) the dataset param on a startup/fallback load', () => {
        const update = getDatasetSearchParamsUpdate(
          new URLSearchParams('dataset=demo'),
          'demo',
          'startup',
        );

        expect(update).toEqual({
          next: new URLSearchParams(),
          replace: true,
        });
      });

      it('never writes anything for a url-sourced load', () => {
        const update = getDatasetSearchParamsUpdate(
          new URLSearchParams('dataset=demo'),
          'demo',
          'url',
        );

        expect(update).toBeNull();
      });

      it('is a no-op when the delete would be a no-op (param already absent)', () => {
        expect(
          getDatasetSearchParamsUpdate(new URLSearchParams('annotation=ec'), null, 'startup'),
        ).toBeNull();
        expect(
          getDatasetSearchParamsUpdate(new URLSearchParams('annotation=ec'), null, 'user'),
        ).toBeNull();
      });
    });
  });
});
