import { describe, it, expect } from 'vitest';
import {
  getProteinAnnotationValues,
  getProteinDisplayValues,
  getProteinNumericValue,
  getProteinNumericType,
  getProteinScores,
  getProteinEvidence,
  buildTooltipView,
} from './plot-data-accessors';
import type { CsrAnnotationData, CsrEvidence, CsrScores, VisualizationData } from '../types';

const baseData = (): VisualizationData => ({
  protein_ids: ['p0', 'p1', 'p2'],
  projections: [
    {
      name: 't',
      data: Float32Array.of(0, 0, 1, 1, 2, 2),
      dimension: 2,
    },
  ],
  annotations: {
    species: {
      kind: 'categorical',
      values: ['human', 'mouse', '__NA__'],
      colors: ['#f00', '#0f0', '#ccc'],
      shapes: ['circle', 'square', 'circle'],
    },
    gene_name: {
      kind: 'categorical',
      values: ['BRCA1', '__NA__'],
      colors: ['#00f', '#ccc'],
      shapes: ['circle', 'circle'],
    },
  },
  annotation_data: {
    species: Int32Array.of(0, 1, 2),
    gene_name: Int32Array.of(0, -1, -1),
  },
});

describe('plot-data-accessors', () => {
  describe('getProteinAnnotationValues', () => {
    it('returns mapped value for Int32Array storage with populated slot', () => {
      expect(getProteinAnnotationValues(baseData(), 0, 'species')).toEqual(['human']);
      expect(getProteinAnnotationValues(baseData(), 1, 'species')).toEqual(['mouse']);
    });

    it('returns __NA__ for missing slot (-1) in Int32Array column', () => {
      expect(getProteinAnnotationValues(baseData(), 1, 'gene_name')).toEqual([]);
    });

    it('returns mapped values for multi-valued (number[][]) storage', () => {
      const data = baseData();
      data.annotation_data.species = [[0, 1], [2], []];
      expect(getProteinAnnotationValues(data, 0, 'species')).toEqual(['human', 'mouse']);
      expect(getProteinAnnotationValues(data, 2, 'species')).toEqual([]);
    });

    it('returns empty array when annotation key is missing from annotation_data', () => {
      expect(getProteinAnnotationValues(baseData(), 0, 'nonexistent')).toEqual([]);
    });
  });

  describe('getProteinDisplayValues', () => {
    it('returns raw values when annotation has no numeric bin label map', () => {
      expect(getProteinDisplayValues(baseData(), 0, 'species')).toEqual(['human']);
    });

    it('substitutes numeric bin labels when annotation has binning metadata', () => {
      const data = baseData();
      data.annotations.score = {
        kind: 'numeric',
        values: ['0', '1'],
        colors: ['#000', '#fff'],
        shapes: ['circle', 'circle'],
        numericMetadata: {
          strategy: 'linear',
          binCount: 2,
          numericType: 'float',
          signature: 'sig',
          topologySignature: 'topo',
          logSupported: false,
          bins: [
            { id: '0', label: 'low', lowerBound: 0, upperBound: 5, count: 1 },
            { id: '1', label: 'high', lowerBound: 5, upperBound: 10, count: 1 },
          ],
        },
      };
      data.annotation_data.score = Int32Array.of(0, 1, -1);
      expect(getProteinDisplayValues(data, 0, 'score')).toEqual(['low']);
      expect(getProteinDisplayValues(data, 1, 'score')).toEqual(['high']);
    });
  });

  describe('getProteinNumericValue', () => {
    it('returns the numeric value at the protein index', () => {
      const data = baseData();
      data.numeric_annotation_data = { score: [3.14, 2.71, null] };
      expect(getProteinNumericValue(data, 0, 'score')).toBe(3.14);
      expect(getProteinNumericValue(data, 2, 'score')).toBeNull();
    });

    it('returns null when the column is absent', () => {
      expect(getProteinNumericValue(baseData(), 0, 'score')).toBeNull();
    });
  });

  describe('getProteinNumericType', () => {
    it('returns the annotation numericType when present', () => {
      const data = baseData();
      data.annotations.score = {
        kind: 'numeric',
        values: ['x'],
        colors: ['#000'],
        shapes: ['circle'],
        numericType: 'int',
      };
      expect(getProteinNumericType(data, 'score')).toBe('int');
    });

    it("defaults to 'float' when annotation is missing", () => {
      expect(getProteinNumericType(baseData(), 'absent')).toBe('float');
    });
  });

  describe('getProteinScores', () => {
    it('returns the score array for the protein index', () => {
      const data = baseData();
      data.annotation_scores = { species: [[[1.5]], [null], [null]] };
      expect(getProteinScores(data, 0, 'species')).toEqual([[1.5]]);
    });

    it('returns empty array when scores are absent', () => {
      expect(getProteinScores(baseData(), 0, 'species')).toEqual([]);
    });
  });

  describe('getProteinEvidence', () => {
    it('returns the evidence array for the protein index', () => {
      const data = baseData();
      data.annotation_evidence = { species: [['ECO:1'], [null], [null]] };
      expect(getProteinEvidence(data, 0, 'species')).toEqual(['ECO:1']);
    });

    it('returns empty array when evidence is absent', () => {
      expect(getProteinEvidence(baseData(), 0, 'species')).toEqual([]);
    });
  });

  describe('buildTooltipView', () => {
    it('returns header values from gene_name / protein_name / uniprot_kb_id keys', () => {
      const data = baseData();
      data.annotations.protein_name = {
        kind: 'categorical',
        values: ['BRCA1 protein'],
        colors: ['#000'],
        shapes: ['circle'],
      };
      data.annotation_data.protein_name = Int32Array.of(0, -1, -1);
      data.annotations.uniprot_kb_id = {
        kind: 'categorical',
        values: ['P00001'],
        colors: ['#000'],
        shapes: ['circle'],
      };
      data.annotation_data.uniprot_kb_id = Int32Array.of(0, -1, -1);
      const view = buildTooltipView(data, 0, 'species');
      expect(view.geneName).toEqual(['BRCA1']);
      expect(view.proteinName).toEqual(['BRCA1 protein']);
      expect(view.uniprotKbId).toEqual(['P00001']);
      expect(view.blocks).toHaveLength(1);
      expect(view.blocks[0].key).toBe('species');
      expect(view.blocks[0].displayValues).toEqual(['human']);
    });

    it('falls back to "Gene name" / "Protein name" keys when snake_case keys are absent', () => {
      const data: VisualizationData = {
        protein_ids: ['p0'],
        projections: [{ name: 't', data: Float32Array.of(0, 0), dimension: 2 as const }],
        annotations: {
          'Gene name': {
            kind: 'categorical',
            values: ['BRCA1'],
            colors: ['#000'],
            shapes: ['circle'],
          },
          'Protein name': {
            kind: 'categorical',
            values: ['BRCA1 protein'],
            colors: ['#000'],
            shapes: ['circle'],
          },
        },
        annotation_data: {
          'Gene name': Int32Array.of(0),
          'Protein name': Int32Array.of(0),
        },
      };
      const view = buildTooltipView(data, 0, null);
      expect(view.geneName).toEqual(['BRCA1']);
      expect(view.proteinName).toEqual(['BRCA1 protein']);
    });

    it('prefers gene_name over "Gene name" / protein_name over "Protein name" when both are present', () => {
      const data: VisualizationData = {
        protein_ids: ['p0'],
        projections: [{ name: 't', data: Float32Array.of(0, 0), dimension: 2 as const }],
        annotations: {
          gene_name: {
            kind: 'categorical',
            values: ['BRCA1'],
            colors: ['#000'],
            shapes: ['circle'],
          },
          'Gene name': {
            kind: 'categorical',
            values: ['DUPLICATE'],
            colors: ['#000'],
            shapes: ['circle'],
          },
          protein_name: {
            kind: 'categorical',
            values: ['BRCA1 protein'],
            colors: ['#000'],
            shapes: ['circle'],
          },
          'Protein name': {
            kind: 'categorical',
            values: ['DUPLICATE'],
            colors: ['#000'],
            shapes: ['circle'],
          },
        },
        annotation_data: {
          gene_name: Int32Array.of(0),
          'Gene name': Int32Array.of(0),
          protein_name: Int32Array.of(0),
          'Protein name': Int32Array.of(0),
        },
      };
      const view = buildTooltipView(data, 0, null);
      expect(view.geneName).toEqual(['BRCA1']);
      expect(view.proteinName).toEqual(['BRCA1 protein']);
    });

    it('returns no annotation blocks when primaryAnnotation is null and no extras provided', () => {
      const view = buildTooltipView(baseData(), 0, null);
      expect(view.blocks).toEqual([]);
    });

    it('returns empty header arrays when the named annotations are absent', () => {
      const view = buildTooltipView(baseData(), 0, 'species');
      expect(view.geneName).toEqual(['BRCA1']); // baseData has gene_name
      // No protein_name / uniprot_kb_id in baseData
      expect(view.proteinName).toEqual([]);
      expect(view.uniprotKbId).toEqual([]);
    });

    it('returns extra annotation blocks after the primary, in given order', () => {
      const view = buildTooltipView(baseData(), 0, 'species', ['gene_name']);
      expect(view.blocks.map((b) => b.key)).toEqual(['species', 'gene_name']);
      expect(view.blocks[0].displayValues).toEqual(['human']);
      expect(view.blocks[1].displayValues).toEqual(['BRCA1']);
    });

    it('deduplicates extras against the primary', () => {
      const view = buildTooltipView(baseData(), 0, 'species', ['species', 'gene_name']);
      expect(view.blocks.map((b) => b.key)).toEqual(['species', 'gene_name']);
    });

    it('deduplicates repeated extras', () => {
      const view = buildTooltipView(baseData(), 0, 'species', ['gene_name', 'gene_name']);
      expect(view.blocks.map((b) => b.key)).toEqual(['species', 'gene_name']);
    });

    it('drops extras whose annotation is missing from the dataset', () => {
      const view = buildTooltipView(baseData(), 0, 'species', ['nonexistent', 'gene_name']);
      expect(view.blocks.map((b) => b.key)).toEqual(['species', 'gene_name']);
    });

    it('drops the per-point silhouette an auto-cluster column carries', () => {
      // Bundles prepared before the backend stopped attaching it still ship
      // `cluster N|0.4970`, which the loader parses into annotation_scores. The
      // legend strips report each cluster's silhouette instead, so the tooltip must
      // not be the one place in the app showing a separation score per protein.
      const data: VisualizationData = {
        ...baseData(),
        annotations: {
          ...baseData().annotations,
          cluster_elbow_t: {
            kind: 'categorical',
            values: ['cluster 0', 'cluster 1'],
            colors: ['#f00', '#0f0'],
            shapes: ['circle', 'circle'],
          },
        },
        annotation_data: { ...baseData().annotation_data, cluster_elbow_t: Int32Array.of(0, 1, 0) },
        annotation_scores: { cluster_elbow_t: [[[0.497]], [[0.601]], [[0.3]]], species: [[[42]]] },
        statisticsRows: [
          {
            space_kind: 'projection',
            space_name: 't',
            annotation: '',
            stat_family: 'cluster_validity',
            label_kind: 'kmeans_elbow',
            metric: 'n_clusters',
            metric_kind: 'meta',
            value: 2,
          },
        ],
      };

      const view = buildTooltipView(data, 0, 'cluster_elbow_t', ['species']);
      expect(view.blocks[0].displayValues).toEqual(['cluster 0']);
      expect(view.blocks[0].scores).toEqual([]);
      // A real scored annotation in the same tooltip keeps its bit score.
      expect(view.blocks[1].scores).toEqual([[42]]);
    });

    it('drops it from the column name alone, with no statistics rows present', () => {
      // The decision cannot depend on `statisticsRows`: `sliceVisualizationDataByIndices`
      // clears them for a filtered or isolated view, and a bundle exported from that view
      // still carries the `cluster_*` column and its `label|silhouette` payload. Judged
      // from the rows, that re-opened bundle resurrects the per-point number — and
      // `getAnnotationHeaderType` labels any surviving score "Bitscore", so it comes back
      // both restored and mislabelled as a bit score.
      const data: VisualizationData = {
        ...baseData(),
        annotations: {
          ...baseData().annotations,
          cluster_elbow_t: {
            kind: 'categorical',
            values: ['cluster 0', 'cluster 1'],
            colors: ['#f00', '#0f0'],
            shapes: ['circle', 'circle'],
          },
        },
        annotation_data: { ...baseData().annotation_data, cluster_elbow_t: Int32Array.of(0, 1, 0) },
        annotation_scores: { cluster_elbow_t: [[[0.497]], [[0.601]], [[0.3]]] },
        // No statisticsRows at all — the filtered-export case.
      };

      const view = buildTooltipView(data, 0, 'cluster_elbow_t');
      expect(view.blocks[0].displayValues).toEqual(['cluster 0']);
      expect(view.blocks[0].scores).toEqual([]);
    });

    it('keeps scores on a curated column whose name merely mentions cluster', () => {
      // Only the two generated prefixes count; an ordinary annotation must be untouched.
      const data: VisualizationData = {
        ...baseData(),
        annotations: {
          ...baseData().annotations,
          cluster_of_differentiation: {
            kind: 'categorical',
            values: ['CD4'],
            colors: ['#f00'],
            shapes: ['circle'],
          },
        },
        annotation_data: {
          ...baseData().annotation_data,
          cluster_of_differentiation: Int32Array.of(0, 0, 0),
        },
        annotation_scores: { cluster_of_differentiation: [[[88]]] },
      };

      const view = buildTooltipView(data, 0, 'cluster_of_differentiation');
      expect(view.blocks[0].scores).toEqual([[88]]);
    });

    it('returns only extra blocks when primary is null', () => {
      const view = buildTooltipView(baseData(), 0, null, ['gene_name']);
      expect(view.blocks.map((b) => b.key)).toEqual(['gene_name']);
      expect(view.blocks[0].displayValues).toEqual(['BRCA1']);
    });

    it('adds transferred value and provenance only for the active EAT annotation', () => {
      const data = baseData();
      data.annotation_predicted = {
        species: [{ value: 'mouse', confidence: 0.76, source: 'p1' }, null, null],
      };
      const view = buildTooltipView(data, 0, 'species', ['gene_name'], true);
      expect(view.blocks[0].displayValues).toEqual(['mouse']);
      expect(view.blocks[0].predicted).toEqual({
        value: 'mouse',
        confidence: 0.76,
        source: 'p1',
      });
      expect(view.blocks[1].predicted).toBeNull();
    });

    it('keeps structured transferred labels and aligned metadata in the tooltip block', () => {
      const data = baseData();
      data.annotation_predicted = {
        species: [
          {
            value: 'mouse;rat',
            values: ['mouse', 'rat'],
            scores: [[0.9], null],
            evidence: [null, 'EXP'],
            confidence: 0.76,
            source: 'p1',
          },
          null,
          null,
        ],
      };

      const block = buildTooltipView(data, 0, 'species', [], true).blocks[0];
      expect(block.displayValues).toEqual(['mouse', 'rat']);
      expect(block.scores).toEqual([[0.9], null]);
      expect(block.evidence).toEqual([null, 'EXP']);
    });
  });
});

describe('CSR score and evidence payloads', () => {
  // species rows: p0 -> hits 0,1 ; p1 -> no hits ; p2 -> hit 2
  const csrRows: CsrAnnotationData = {
    kind: 'csr',
    end: Int32Array.from([2, 2, 3]),
    codes: Int32Array.from([0, 1, 2]),
    length: 3,
  };
  // hit 0 -> [1.5]; hit 1 -> no scores; hit 2 -> [0.25, 0.5]
  const csrScores: CsrScores = {
    hitEnd: Int32Array.from([1, 1, 3]),
    values: Float64Array.from([1.5, 0.25, 0.5]),
  };
  const csrEvidence: CsrEvidence = {
    codes: Int32Array.from([0, -1, 1]),
    dict: ['IDA', 'ECO:1'],
  };

  const csrData = (): VisualizationData => {
    const data = baseData();
    data.annotation_data.species = csrRows;
    data.annotation_scores_csr = { species: csrScores };
    data.annotation_evidence_csr = { species: csrEvidence };
    return data;
  };

  it('reads scores per hit, null for a hit with no score values', () => {
    const data = csrData();
    expect(getProteinScores(data, 0, 'species')).toEqual([[1.5], null]);
    expect(getProteinScores(data, 1, 'species')).toEqual([]);
    expect(getProteinScores(data, 2, 'species')).toEqual([[0.25, 0.5]]);
  });

  it('reads evidence per hit, null for code -1', () => {
    const data = csrData();
    expect(getProteinEvidence(data, 0, 'species')).toEqual(['IDA', null]);
    expect(getProteinEvidence(data, 1, 'species')).toEqual([]);
    expect(getProteinEvidence(data, 2, 'species')).toEqual(['ECO:1']);
  });

  it('returns empty for out-of-range and negative protein indices', () => {
    const data = csrData();
    for (const idx of [3, 99, -1]) {
      expect(getProteinScores(data, idx, 'species')).toEqual([]);
      expect(getProteinEvidence(data, idx, 'species')).toEqual([]);
    }
  });

  it('prefers the nested records when both forms are present', () => {
    const data = csrData();
    data.annotation_scores = { species: [[[9]], [], []] };
    data.annotation_evidence = { species: [['NESTED'], [], []] };
    expect(getProteinScores(data, 0, 'species')).toEqual([[9]]);
    expect(getProteinEvidence(data, 0, 'species')).toEqual(['NESTED']);
  });

  it('ignores CSR payloads when the column storage is not CSR', () => {
    // The flat payloads are numbered by CSR hit, so without CSR storage there is
    // no hit range to index them by.
    const data = csrData();
    data.annotation_data.species = Int32Array.of(0, 1, 2);
    expect(getProteinScores(data, 0, 'species')).toEqual([]);
    expect(getProteinEvidence(data, 0, 'species')).toEqual([]);
  });

  it('resolves annotation values through CSR storage', () => {
    expect(getProteinAnnotationValues(csrData(), 0, 'species')).toEqual(['human', 'mouse']);
    expect(getProteinAnnotationValues(csrData(), 1, 'species')).toEqual([]);
  });

  it('feeds the tooltip view without changing its shape', () => {
    const view = buildTooltipView(csrData(), 0, 'species');
    expect(view.blocks[0].scores).toEqual([[1.5], null]);
    expect(view.blocks[0].evidence).toEqual(['IDA', null]);
    expect(view.blocks[0].displayValues).toEqual(['human', 'mouse']);
  });
});
