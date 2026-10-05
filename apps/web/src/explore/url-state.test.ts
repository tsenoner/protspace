import { describe, expect, it } from 'vitest';
import {
  buildSearchParamsWithExploreView,
  createEmptyExploreViewRequest,
  createExploreViewRequestFromView,
  decideUrlChange,
  getDatasetParam,
  getDatasetSearchParamsUpdate,
  getExploreViewSearchParamsUpdate,
  getResolvedExploreViewNormalization,
  parseExploreViewRequest,
  resolveExploreView,
  setDatasetParam,
} from './url-state';

/** A normalization that rewrites none of the view parameters. */
const NO_NORMALIZATION = { annotation: false, projection: false, tooltip: false, density: false };

describe('explore url state', () => {
  it('parses a bare URL without requested values', () => {
    const parsed = parseExploreViewRequest(new URLSearchParams(''));

    expect(parsed).toEqual({
      requested: {
        tooltip: undefined,
        density: undefined,
      },
      present: {
        annotation: false,
        projection: false,
        tooltip: false,
        density: false,
      },
      normalize: NO_NORMALIZATION,
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
        density: undefined,
      },
      present: {
        annotation: true,
        projection: true,
        tooltip: false,
        density: false,
      },
      normalize: { ...NO_NORMALIZATION, annotation: true, projection: true },
    });
  });

  it('treats empty values as invalid and normalizes them', () => {
    const parsed = parseExploreViewRequest(new URLSearchParams('annotation=&projection=%20'));
    const resolved = resolveExploreView(parsed, ['ec', 'pfam'], ['UMAP', 'PCA']);

    expect(parsed).toEqual({
      requested: {
        tooltip: undefined,
        density: undefined,
      },
      present: {
        annotation: true,
        projection: true,
        tooltip: false,
        density: false,
      },
      normalize: { ...NO_NORMALIZATION, annotation: true, projection: true },
    });
    expect(resolved).toEqual({
      effective: {
        annotation: 'ec',
        projection: 'UMAP',
        tooltip: [],
        density: 'off',
      },
      matchesRequested: {
        annotation: false,
        projection: false,
        tooltip: false,
        density: false,
      },
    });
    expect(getResolvedExploreViewNormalization(parsed, resolved!)).toEqual({
      ...NO_NORMALIZATION,
      annotation: true,
      projection: true,
    });
  });

  it('keeps both requested values when they are valid', () => {
    const parsed = parseExploreViewRequest(new URLSearchParams('annotation=pfam&projection=PCA'));
    const resolved = resolveExploreView(parsed, ['ec', 'pfam'], ['UMAP', 'PCA']);

    expect(resolved).toEqual({
      effective: {
        annotation: 'pfam',
        projection: 'PCA',
        tooltip: [],
        density: 'off',
      },
      matchesRequested: {
        annotation: true,
        projection: true,
        tooltip: false,
        density: false,
      },
    });
    expect(getResolvedExploreViewNormalization(parsed, resolved!)).toEqual(NO_NORMALIZATION);
  });

  it('normalizes duplicate params even when the first values are valid', () => {
    const parsed = parseExploreViewRequest(
      new URLSearchParams('annotation=pfam&annotation=ec&projection=PCA&projection=UMAP'),
    );
    const resolved = resolveExploreView(parsed, ['ec', 'pfam'], ['UMAP', 'PCA']);

    expect(resolved).toEqual({
      effective: {
        annotation: 'pfam',
        projection: 'PCA',
        tooltip: [],
        density: 'off',
      },
      matchesRequested: {
        annotation: true,
        projection: true,
        tooltip: false,
        density: false,
      },
    });
    expect(getResolvedExploreViewNormalization(parsed, resolved!)).toEqual({
      ...NO_NORMALIZATION,
      annotation: true,
      projection: true,
    });
  });

  it('resolves partial validity independently', () => {
    const parsed = parseExploreViewRequest(
      new URLSearchParams('annotation=pfam&projection=UNKNOWN'),
    );
    const resolved = resolveExploreView(parsed, ['ec', 'pfam'], ['UMAP', 'PCA']);

    expect(resolved).toEqual({
      effective: {
        annotation: 'pfam',
        projection: 'UMAP',
        tooltip: [],
        density: 'off',
      },
      matchesRequested: {
        annotation: true,
        projection: false,
        tooltip: false,
        density: false,
      },
    });
    expect(getResolvedExploreViewNormalization(parsed, resolved!)).toEqual({
      ...NO_NORMALIZATION,
      projection: true,
    });
  });

  it('normalizes both keys when both requested values are invalid', () => {
    const parsed = parseExploreViewRequest(
      new URLSearchParams('annotation=unknown&projection=UNKNOWN'),
    );
    const resolved = resolveExploreView(parsed, ['ec', 'pfam'], ['UMAP', 'PCA']);

    expect(resolved).toEqual({
      effective: {
        annotation: 'ec',
        projection: 'UMAP',
        tooltip: [],
        density: 'off',
      },
      matchesRequested: {
        annotation: false,
        projection: false,
        tooltip: false,
        density: false,
      },
    });
    expect(getResolvedExploreViewNormalization(parsed, resolved!)).toEqual({
      ...NO_NORMALIZATION,
      annotation: true,
      projection: true,
    });
  });

  it('returns null when the dataset has no available view options yet', () => {
    const parsed = parseExploreViewRequest(new URLSearchParams('annotation=ec&projection=UMAP'));

    expect(resolveExploreView(parsed, [], ['UMAP'])).toBeNull();
    expect(resolveExploreView(parsed, ['ec'], [])).toBeNull();
  });

  it('preserves unrelated params for user-driven writes', () => {
    const next = buildSearchParamsWithExploreView(
      new URLSearchParams('webglPerf=1&dataset=demo'),
      {
        annotation: 'pfam',
        projection: 'PCA',
        tooltip: [],
        density: 'off',
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
        density: 'off',
      },
      {
        mode: 'normalize',
        normalize: { ...NO_NORMALIZATION, projection: true },
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
      const resolved = resolveExploreView(parsed, annotations, projections, defaults);

      expect(resolved?.effective).toEqual({
        annotation: 'pfam',
        projection: 'UMAP 2',
        tooltip: ['species', 'ec'],
        density: 'off',
      });
      expect(getResolvedExploreViewNormalization(parsed, resolved!)).toEqual(NO_NORMALIZATION);
    });

    it('treats a parameter named with an empty value as named, not as a landing', () => {
      const emptyTooltip = parseExploreViewRequest(
        new URLSearchParams('dataset=phosphatase&tooltip='),
      );
      const resolvedTooltip = resolveExploreView(emptyTooltip, annotations, projections, defaults);
      expect(resolvedTooltip?.effective).toEqual({
        annotation: 'pfam',
        projection: 'UMAP 2',
        tooltip: [],
        density: 'off',
      });
      // The empty parameter is dropped from the URL; the curated tooltip is
      // never written into it.
      const normalize = getResolvedExploreViewNormalization(emptyTooltip, resolvedTooltip!);
      expect(normalize).toEqual({ ...NO_NORMALIZATION, tooltip: true });
      expect(
        buildSearchParamsWithExploreView(
          new URLSearchParams('dataset=phosphatase&tooltip='),
          resolvedTooltip!.effective,
          { mode: 'normalize', normalize },
        ).toString(),
      ).toBe('dataset=phosphatase');

      const emptyAnnotation = parseExploreViewRequest(
        new URLSearchParams('dataset=phosphatase&annotation='),
      );
      expect(
        resolveExploreView(emptyAnnotation, annotations, projections, defaults)?.effective,
      ).toEqual({ annotation: 'pfam', projection: 'UMAP 2', tooltip: [], density: 'off' });
    });

    it('fills only the missing field of a partial request, with no tooltip', () => {
      const parsed = parseExploreViewRequest(new URLSearchParams('annotation=ec'));
      const resolved = resolveExploreView(parsed, annotations, projections, defaults);

      expect(resolved?.effective).toEqual({
        annotation: 'ec',
        projection: 'UMAP 2',
        tooltip: [],
        density: 'off',
      });
      expect(getResolvedExploreViewNormalization(parsed, resolved!)).toEqual(NO_NORMALIZATION);
    });

    it('keeps an explicit tooltip over the default one', () => {
      const parsed = parseExploreViewRequest(
        new URLSearchParams('annotation=ec&projection=PCA+2&tooltip=gene_name'),
      );
      const resolved = resolveExploreView(parsed, annotations, projections, defaults);

      expect(resolved?.effective).toEqual({
        annotation: 'ec',
        projection: 'PCA 2',
        tooltip: ['gene_name'],
        density: 'off',
      });
    });

    it('falls back to the default for an invalid annotation and flags it for normalization', () => {
      const parsed = parseExploreViewRequest(
        new URLSearchParams('annotation=unknown&projection=nope'),
      );
      const resolved = resolveExploreView(parsed, annotations, projections, defaults);

      expect(resolved?.effective).toEqual({
        annotation: 'pfam',
        projection: 'UMAP 2',
        tooltip: [],
        density: 'off',
      });
      expect(getResolvedExploreViewNormalization(parsed, resolved!)).toEqual({
        ...NO_NORMALIZATION,
        annotation: true,
        projection: true,
      });
    });

    it('falls back to the first available names when the defaults drift from the data', () => {
      const parsed = parseExploreViewRequest(new URLSearchParams(''));
      const resolved = resolveExploreView(parsed, annotations, projections, {
        annotation: 'protein_families',
        projection: 'ProtT5 — UMAP 2',
        tooltip: ['kingdom', 'species'],
      });

      expect(resolved?.effective).toEqual({
        annotation: 'annotation_score',
        projection: 'PCA 2',
        tooltip: ['species'],
        density: 'off',
      });
      expect(getResolvedExploreViewNormalization(parsed, resolved!)).toEqual(NO_NORMALIZATION);
    });

    it('drops the effective annotation from the default tooltip', () => {
      const parsed = parseExploreViewRequest(new URLSearchParams(''));
      const resolved = resolveExploreView(parsed, annotations, projections, {
        annotation: 'ec',
        tooltip: ['ec', 'species'],
      });

      expect(resolved?.effective).toEqual({
        annotation: 'ec',
        projection: 'PCA 2',
        tooltip: ['species'],
        density: 'off',
      });
    });

    it('matches the first-available behaviour when there are no defaults', () => {
      for (const query of ['', 'annotation=pfam', 'annotation=unknown&projection=UMAP+2']) {
        const parsed = parseExploreViewRequest(new URLSearchParams(query));
        expect(resolveExploreView(parsed, annotations, projections, {})).toEqual(
          resolveExploreView(parsed, annotations, projections),
        );
      }
      const bare = parseExploreViewRequest(new URLSearchParams(''));
      expect(resolveExploreView(bare, annotations, projections)?.effective).toEqual({
        annotation: 'annotation_score',
        projection: 'PCA 2',
        tooltip: [],
        density: 'off',
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
      const resolved = resolveExploreView(parsed, ['ec', 'pfam', 'go'], ['UMAP']);

      expect(resolved!.effective.tooltip).toEqual(['ec']);
      expect(resolved!.matchesRequested.tooltip).toBe(false);
      expect(getResolvedExploreViewNormalization(parsed, resolved!).tooltip).toBe(true);
    });

    it('drops tooltip entries not present in the dataset', () => {
      const parsed = parseExploreViewRequest(
        new URLSearchParams('annotation=pfam&tooltip=ec%2Cunknown%2Cgo'),
      );
      const resolved = resolveExploreView(parsed, ['ec', 'pfam', 'go'], ['UMAP']);

      expect(resolved!.effective.tooltip).toEqual(['ec', 'go']);
      expect(resolved!.matchesRequested.tooltip).toBe(false);
      expect(getResolvedExploreViewNormalization(parsed, resolved!).tooltip).toBe(true);
    });

    it('preserves a valid tooltip set without normalization', () => {
      const parsed = parseExploreViewRequest(
        new URLSearchParams('annotation=pfam&tooltip=ec%2Cgo'),
      );
      const resolved = resolveExploreView(parsed, ['ec', 'pfam', 'go'], ['UMAP']);

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
          density: 'off',
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
          density: 'off',
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
          density: 'off',
        },
        {
          mode: 'normalize',
          normalize: { ...NO_NORMALIZATION, tooltip: true },
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
      it("writes nothing for a load a newer request superseded: the URL is that request's", () => {
        expect(
          getDatasetSearchParamsUpdate(
            new URLSearchParams('dataset=demo'),
            'phosphatase',
            'superseded',
          ),
        ).toBeNull();
        expect(
          getDatasetSearchParamsUpdate(new URLSearchParams('dataset=demo'), null, 'superseded'),
        ).toBeNull();
      });

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

      it('drops density on a menu choice, so the example opens with contours Off', () => {
        const update = getDatasetSearchParamsUpdate(
          new URLSearchParams('annotation=ec&density=on&dataset=demo'),
          'phosphatase',
          'menu',
        );

        expect(update?.next.toString()).toBe('dataset=phosphatase');
      });

      // The menu load resets the recorded request to an empty one before it
      // renders (dataset-controller.ts), then the URL sync applies the pushed
      // entry. Every view parameter the URL can carry must be dropped, or the
      // entry re-applies what the reset just cleared.
      it('pushes an entry that resolves to the same view as the menu reset', () => {
        const previous = buildSearchParamsWithExploreView(
          new URLSearchParams('seed=1'),
          { annotation: 'ec', projection: 'PCA', tooltip: ['pfam'], density: 'on' },
          { mode: 'user' },
        );
        const update = getDatasetSearchParamsUpdate(previous, 'phosphatase', 'menu');
        const annotations = ['ec', 'pfam', 'species'];
        const projections = ['UMAP', 'PCA'];
        const defaults = { annotation: 'species', projection: 'UMAP', tooltip: ['pfam'] };

        expect(update).not.toBeNull();
        expect(
          resolveExploreView(
            parseExploreViewRequest(update!.next),
            annotations,
            projections,
            defaults,
          ),
        ).toEqual(
          resolveExploreView(createEmptyExploreViewRequest(), annotations, projections, defaults),
        );
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

  describe('density param', () => {
    it('parses a valid density mode', () => {
      const parsed = parseExploreViewRequest(new URLSearchParams('density=auto'));

      expect(parsed.requested.density).toBe('auto');
      expect(parsed.present.density).toBe(true);
      expect(parsed.normalize.density).toBe(false);
    });

    it('rejects a value outside the three modes and marks it for normalization', () => {
      const parsed = parseExploreViewRequest(new URLSearchParams('density=bogus'));

      expect(parsed.requested.density).toBeUndefined();
      expect(parsed.normalize.density).toBe(true);
    });

    it('flags duplicate density keys for normalization', () => {
      const parsed = parseExploreViewRequest(new URLSearchParams('density=auto&density=on'));

      expect(parsed.requested.density).toBe('auto');
      expect(parsed.normalize.density).toBe(true);
    });

    it('resolves a requested mode and falls back to off', () => {
      const on = resolveExploreView(
        parseExploreViewRequest(new URLSearchParams('density=on')),
        ['ec'],
        ['UMAP'],
      );
      expect(on?.effective.density).toBe('on');
      expect(on?.matchesRequested.density).toBe(true);

      const bare = resolveExploreView(
        parseExploreViewRequest(new URLSearchParams('')),
        ['ec'],
        ['UMAP'],
      );
      expect(bare?.effective.density).toBe('off');
      expect(bare?.matchesRequested.density).toBe(false);
    });

    it('keeps the default out of the URL and writes every other mode', () => {
      const base = { annotation: 'pfam', projection: 'PCA', tooltip: [] as string[] };

      const off = buildSearchParamsWithExploreView(
        new URLSearchParams('density=on'),
        { ...base, density: 'off' },
        { mode: 'user' },
      );
      expect(off.has('density')).toBe(false);

      const auto = buildSearchParamsWithExploreView(
        new URLSearchParams(''),
        {
          ...base,
          density: 'auto',
        },
        { mode: 'user' },
      );
      expect(auto.get('density')).toBe('auto');
    });

    it.each(['off', 'auto', 'on'])('parses %s', (token) => {
      const parsed = parseExploreViewRequest(new URLSearchParams(`density=${token}`));

      expect(parsed.requested.density).toBe(token);
      expect(parsed.normalize.density).toBe(false);
    });

    it.each(['contour-on', 'contour-bogus'])('normalizes the invalid token %s', (token) => {
      const parsed = parseExploreViewRequest(new URLSearchParams(`density=${token}`));

      expect(parsed.requested.density).toBeUndefined();
      expect(parsed.normalize.density).toBe(true);
    });
  });
});

describe('decideUrlChange', () => {
  it.each([
    // The URL names another dataset than the app reflects.
    ['A', 'B', false, 'switch-dataset'],
    // Also while a switch is pending: the newer dataset wins.
    ['A', 'B', true, 'switch-dataset'],
    // Back to an entry without `dataset=`.
    [null, 'B', false, 'switch-dataset'],
    // The second of two quick Backs lands on another entry of the dataset
    // being fetched: the pending load applies it, not the dataset on screen.
    ['A', 'A', true, 'record-view'],
    // The view applies to the dataset on screen when no switch is pending.
    ['A', 'A', false, 'apply-view'],
    [null, null, false, 'apply-view'],
  ] as const)(
    'dataset=%s with %s on screen (switch pending: %s) is a %s',
    (datasetParam, currentDatasetId, switchPending, expected) => {
      expect(decideUrlChange({ datasetParam, currentDatasetId, switchPending })).toBe(expected);
    },
  );
});

describe('after a failed Back/Forward', () => {
  const effective = {
    annotation: 'pfam',
    projection: 'PCA',
    tooltip: ['go'],
    density: 'off' as const,
  };
  const userChange = {
    effective,
    source: 'user' as const,
    normalize: NO_NORMALIZATION,
  };

  it('a user change names the displayed dataset in its new entry', () => {
    // The entry still names the example that failed (A); B is on screen.
    const update = getExploreViewSearchParamsUpdate(
      new URLSearchParams('dataset=A&annotation=x&seed=1'),
      userChange,
      { pendingUrlRequest: false, displayedDatasetId: 'B' },
    );

    expect(update?.replace).toBe(false);
    expect(update?.next.get('dataset')).toBe('B');
    expect(update?.next.get('annotation')).toBe('pfam');
    expect(update?.next.get('seed')).toBe('1');
  });

  it('drops dataset= when the displayed dataset is not an example', () => {
    const update = getExploreViewSearchParamsUpdate(
      new URLSearchParams('dataset=A&annotation=x'),
      userChange,
      { pendingUrlRequest: false, displayedDatasetId: null },
    );

    expect(update?.next.has('dataset')).toBe(false);
  });

  it('leaves dataset= alone without a displayed dataset id, and for normalizations', () => {
    const kept = getExploreViewSearchParamsUpdate(
      new URLSearchParams('dataset=A&annotation=x'),
      userChange,
      { pendingUrlRequest: false },
    );
    expect(kept?.next.get('dataset')).toBe('A');

    const normalized = getExploreViewSearchParamsUpdate(
      new URLSearchParams('dataset=A&annotation=x'),
      {
        effective,
        source: 'url',
        normalize: { ...NO_NORMALIZATION, annotation: true },
      },
      { pendingUrlRequest: true, displayedDatasetId: 'B' },
    );
    expect(normalized?.replace).toBe(true);
    expect(normalized?.next.get('dataset')).toBe('A');
  });

  it('records the view on screen as the request a URL naming it would parse to', () => {
    expect(createExploreViewRequestFromView(effective)).toEqual(
      parseExploreViewRequest(new URLSearchParams('annotation=pfam&projection=PCA&tooltip=go')),
    );
    const withoutTooltip = createExploreViewRequestFromView({ ...effective, tooltip: [] });
    expect(withoutTooltip.present).toEqual({
      annotation: true,
      projection: true,
      tooltip: false,
      density: false,
    });
    expect(withoutTooltip.requested.tooltip).toBeUndefined();
  });
});
