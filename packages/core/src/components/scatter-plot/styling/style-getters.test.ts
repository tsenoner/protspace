import { describe, it, expect } from 'vitest';
import type { StyleConfig } from './style-getters';
import { createStyleGetters } from './style-getters';
import type { VisualizationData, PlotDataPoint } from '@protspace/utils';

/**
 * Tests for style-getters.ts: colour, shape and depth resolution (including the
 * canonical null → '__NA__' lookup), plus one check that the opacity config
 * reaches the visibility model. getOpacity is `visibility.opacityOf`, so the
 * opacity rules themselves are tested in visibility-model.test.ts.
 */

describe('style-getters', () => {
  describe('EAT glyph classification', () => {
    const data: VisualizationData = {
      protein_ids: ['observed', 'predicted'],
      projections: [{ name: 'test', data: new Float32Array(6), dimension: 3 }],
      annotations: {
        family: {
          values: ['A'],
          colors: ['#ff0000'],
          shapes: ['circle'],
        },
      },
      annotation_data: { family: new Int32Array([0, 0]) },
      annotation_predicted: {
        family: [null, { value: 'A', confidence: 0.8, source: 'observed' }],
      },
    };
    const baseConfig: StyleConfig = {
      selectedProteinIds: [],
      highlightedProteinIds: [],
      selectedAnnotation: 'family',
      hiddenAnnotationValues: [],
      otherAnnotationValues: [],
      zOrderMapping: null,
      colorMapping: null,
      shapeMapping: null,
      sizes: { base: 10 },
      opacities: { base: 1, selected: 1, faded: 0.3 },
    };

    it('classifies only transferred points while the EAT overlay is enabled', () => {
      const getters = createStyleGetters(data, { ...baseConfig, eatOverlayEnabled: true });

      expect(getters.isPredicted({ id: 'observed', x: 0, y: 0, originalIndex: 0 })).toBe(false);
      expect(getters.isPredicted({ id: 'predicted', x: 0, y: 0, originalIndex: 1 })).toBe(true);
    });

    it('uses solid glyphs when the EAT overlay is disabled', () => {
      const getters = createStyleGetters(data, { ...baseConfig, eatOverlayEnabled: false });

      expect(getters.isPredicted({ id: 'predicted', x: 0, y: 0, originalIndex: 1 })).toBe(false);
    });
  });

  describe('N/A value handling', () => {
    const createMockData = (annotationValues: (string | null)[]): VisualizationData => ({
      protein_ids: annotationValues.map((_, i) => `protein_${i}`),
      projections: [
        {
          name: 'test',
          data: new Float32Array(annotationValues.length * 3),
          dimension: 3,
        },
      ],
      annotations: {
        test_annotation: {
          values: annotationValues,
          colors: annotationValues.map(() => '#ff0000'),
          shapes: annotationValues.map(() => 'circle'),
        },
      },
      annotation_data: {
        test_annotation: annotationValues.map((v) => [annotationValues.indexOf(v)]),
      },
    });

    const createMockPoint = (id: string, originalIndex: number): PlotDataPoint => ({
      id,
      x: 0,
      y: 0,
      originalIndex,
    });

    const createDefaultStyleConfig = (overrides: Partial<StyleConfig> = {}): StyleConfig => ({
      selectedProteinIds: [],
      highlightedProteinIds: [],
      selectedAnnotation: 'test_annotation',
      hiddenAnnotationValues: [],
      otherAnnotationValues: [],
      zOrderMapping: null,
      colorMapping: null,
      shapeMapping: null,
      sizes: { base: 10 },
      opacities: { base: 1, selected: 1, faded: 0.3 },
      ...overrides,
    });

    describe('getColors with N/A color mapping', () => {
      it('should use color from colorMapping for null annotation values', () => {
        const data = createMockData([null, 'value1']);
        const config = createDefaultStyleConfig({
          colorMapping: {
            __NA__: '#dddddd',
            value1: '#ff0000',
          },
        });

        const getters = createStyleGetters(data, config);
        const nullPoint = createMockPoint('protein_0', 0);

        expect(getters.getColors(nullPoint)).toEqual(['#dddddd']);
      });
    });

    describe('getPointShape with N/A shape mapping', () => {
      it('should use shapeMapping.__NA__ for N/A annotation values', () => {
        const data = createMockData([null, 'value1']);
        const config = createDefaultStyleConfig({
          shapeMapping: {
            __NA__: 'square',
            value1: 'diamond',
          },
        });

        const getters = createStyleGetters(data, config);
        const naPoint = createMockPoint('protein_0', 0);

        expect(getters.getPointShape(naPoint)).toBe('square');
      });
    });

    describe('getDepth with N/A z-order mapping', () => {
      it('should use z-order from zOrderMapping for null annotation values', () => {
        const data = createMockData([null, 'value1', 'value2']);
        const config = createDefaultStyleConfig({
          zOrderMapping: {
            __NA__: 0,
            value1: 1,
            value2: 2,
          },
        });

        const getters = createStyleGetters(data, config);
        const nullPoint = createMockPoint('protein_0', 0);
        const value1Point = createMockPoint('protein_1', 1);

        // Lower z-order (0) should result in smaller depth value (rendered on top)
        const nullDepth = getters.getDepth(nullPoint);
        const value1Depth = getters.getDepth(value1Point);

        expect(nullDepth).toBeLessThan(value1Depth);
      });
    });
  });

  describe('depth stability across visibility toggles', () => {
    const createMockData = (annotationValues: string[]): VisualizationData => ({
      protein_ids: annotationValues.map((_, i) => `protein_${i}`),
      projections: [
        {
          name: 'test',
          data: new Float32Array(annotationValues.length * 3),
          dimension: 3,
        },
      ],
      annotations: {
        test_annotation: {
          values: annotationValues,
          colors: annotationValues.map(() => '#ff0000'),
          shapes: annotationValues.map(() => 'circle'),
        },
      },
      annotation_data: {
        test_annotation: annotationValues.map((v) => [annotationValues.indexOf(v)]),
      },
    });

    const createMockPoint = (id: string, originalIndex: number): PlotDataPoint => ({
      id,
      x: 0,
      y: 0,
      originalIndex,
    });

    const createDefaultStyleConfig = (overrides: Partial<StyleConfig> = {}): StyleConfig => ({
      selectedProteinIds: [],
      highlightedProteinIds: [],
      selectedAnnotation: 'test_annotation',
      hiddenAnnotationValues: [],
      otherAnnotationValues: [],
      zOrderMapping: null,
      colorMapping: null,
      shapeMapping: null,
      sizes: { base: 10 },
      opacities: { base: 1, selected: 1, faded: 0.3 },
      ...overrides,
    });

    it('should return the same depth for a point regardless of hidden state', () => {
      const data = createMockData(['categoryA', 'categoryB', 'categoryC']);
      const point = createMockPoint('p0', 0);

      // Depth with nothing hidden
      const gettersVisible = createStyleGetters(
        data,
        createDefaultStyleConfig({ hiddenAnnotationValues: [] }),
      );
      const depthVisible = gettersVisible.getDepth(point);

      // Depth with categoryA hidden (the point's own category)
      const gettersHidden = createStyleGetters(
        data,
        createDefaultStyleConfig({ hiddenAnnotationValues: ['categoryA'] }),
      );
      const depthHidden = gettersHidden.getDepth(point);

      // Depth should be identical — hiding doesn't affect sort order. It comes
      // from the base opacity (1 → depth 0), not the hidden alpha (0 → depth 1).
      expect(depthHidden).toBe(depthVisible);
      expect(depthHidden).toBe(0);
    });

    it('should return the same depth with z-order mapping regardless of hidden state', () => {
      const data = createMockData(['categoryA', 'categoryB', 'categoryC']);
      const pointA = createMockPoint('p0', 0);
      const pointB = createMockPoint('p1', 1);

      const zOrderMapping = { categoryA: 0, categoryB: 1, categoryC: 2 };

      const gettersVisible = createStyleGetters(
        data,
        createDefaultStyleConfig({ zOrderMapping, hiddenAnnotationValues: [] }),
      );
      const gettersHidden = createStyleGetters(
        data,
        createDefaultStyleConfig({ zOrderMapping, hiddenAnnotationValues: ['categoryA'] }),
      );

      // Depths stable across visibility toggle
      expect(gettersHidden.getDepth(pointA)).toBe(gettersVisible.getDepth(pointA));
      expect(gettersHidden.getDepth(pointB)).toBe(gettersVisible.getDepth(pointB));

      // Relative ordering preserved
      expect(gettersHidden.getDepth(pointA)).toBeLessThan(gettersHidden.getDepth(pointB));
    });

    it('reads annotation values correctly from Int32Array storage', () => {
      // Phase 2's converter produces Int32Array for single-valued columns;
      // ensure style getters resolve through it (production hot path).
      const data: VisualizationData = {
        protein_ids: ['p0', 'p1', 'p2'],
        projections: [
          {
            name: 'test',
            data: Float32Array.of(0, 0, 0, 1, 1, 0, 2, 2, 0),
            dimension: 3,
          },
        ],
        annotations: {
          test_annotation: {
            kind: 'categorical',
            values: ['categoryA', 'categoryB', 'categoryC'],
            colors: ['#ff0000', '#00ff00', '#0000ff'],
            shapes: ['circle', 'circle', 'circle'],
          },
        },
        annotation_data: {
          test_annotation: Int32Array.of(0, 1, 2),
        },
      };
      const config = createDefaultStyleConfig({
        colorMapping: {
          categoryA: '#aa0000',
          categoryB: '#00aa00',
          categoryC: '#0000aa',
        },
      });
      const getters = createStyleGetters(data, config);
      const point = createMockPoint('p1', 1);
      expect(getters.getColors(point)).toEqual(['#00aa00']);
    });
  });

  describe('z-order change consistency', () => {
    const createMockData = (annotationValues: string[]): VisualizationData => ({
      protein_ids: annotationValues.map((_, i) => `protein_${i}`),
      projections: [
        {
          name: 'test',
          data: new Float32Array(annotationValues.length * 3),
          dimension: 3,
        },
      ],
      annotations: {
        test_annotation: {
          values: annotationValues,
          colors: annotationValues.map(() => '#ff0000'),
          shapes: annotationValues.map(() => 'circle'),
        },
      },
      annotation_data: {
        test_annotation: annotationValues.map((v) => [annotationValues.indexOf(v)]),
      },
    });

    const createMockPoint = (originalIndex: number): PlotDataPoint => ({
      id: 'test_protein',
      x: 0,
      y: 0,
      originalIndex,
    });

    const createDefaultStyleConfig = (overrides: Partial<StyleConfig> = {}): StyleConfig => ({
      selectedProteinIds: [],
      highlightedProteinIds: [],
      selectedAnnotation: 'test_annotation',
      hiddenAnnotationValues: [],
      otherAnnotationValues: [],
      zOrderMapping: null,
      colorMapping: null,
      shapeMapping: null,
      sizes: { base: 10 },
      opacities: { base: 1, selected: 1, faded: 0.3 },
      ...overrides,
    });

    it('should produce different depth values when zOrderMapping changes', () => {
      const data = createMockData(['categoryA', 'categoryB', 'categoryC']);
      const pointA = createMockPoint(0);
      const pointB = createMockPoint(1);
      const pointC = createMockPoint(2);

      // First z-order: A=0, B=1, C=2
      const config1 = createDefaultStyleConfig({
        zOrderMapping: {
          categoryA: 0,
          categoryB: 1,
          categoryC: 2,
        },
      });
      const getters1 = createStyleGetters(data, config1);
      const depthA1 = getters1.getDepth(pointA);
      const depthB1 = getters1.getDepth(pointB);
      const depthC1 = getters1.getDepth(pointC);

      // Second z-order: reversed - A=2, B=1, C=0
      const config2 = createDefaultStyleConfig({
        zOrderMapping: {
          categoryA: 2,
          categoryB: 1,
          categoryC: 0,
        },
      });
      const getters2 = createStyleGetters(data, config2);
      const depthA2 = getters2.getDepth(pointA);
      const depthB2 = getters2.getDepth(pointB);
      const depthC2 = getters2.getDepth(pointC);

      // Depths should change when z-order changes
      expect(depthA1).not.toEqual(depthA2);
      expect(depthC1).not.toEqual(depthC2);

      // In config1: A should have smallest depth (top), C largest (bottom)
      expect(depthA1).toBeLessThan(depthB1);
      expect(depthB1).toBeLessThan(depthC1);

      // In config2: C should have smallest depth (top), A largest (bottom)
      expect(depthC2).toBeLessThan(depthB2);
      expect(depthB2).toBeLessThan(depthA2);
    });

    it('should handle null zOrderMapping gracefully', () => {
      const data = createMockData(['categoryA', 'categoryB']);
      const pointA = createMockPoint(0);
      const pointB = createMockPoint(1);

      const config = createDefaultStyleConfig({
        zOrderMapping: null,
      });

      const getters = createStyleGetters(data, config);

      // Without z-order mapping, depth should still be computable (based on opacity)
      const depthA = getters.getDepth(pointA);
      const depthB = getters.getDepth(pointB);

      // Both should have the same depth (only opacity matters, which is the same)
      expect(depthA).toBe(depthB);
      expect(depthA).toBeGreaterThanOrEqual(0);
      expect(depthA).toBeLessThanOrEqual(1);
    });
  });

  describe('opacity wiring into the visibility model', () => {
    // Each protein maps 1-to-1 to a value at the same index.
    const createMockData = (values: (string | null)[]): VisualizationData => ({
      protein_ids: values.map((_, i) => `p${i}`),
      projections: [{ name: 'test', data: new Float32Array(values.length * 3), dimension: 3 }],
      annotations: {
        test_annotation: {
          kind: 'categorical',
          values,
          colors: values.map(() => '#ff0000'),
          shapes: values.map(() => 'circle'),
        },
      },
      annotation_data: {
        test_annotation: values.map((_, i) => [i]),
      },
    });

    const createMockPoint = (id: string, originalIndex: number): PlotDataPoint => ({
      id,
      x: 0,
      y: 0,
      originalIndex,
    });

    const createDefaultStyleConfig = (overrides: Partial<StyleConfig> = {}): StyleConfig => ({
      selectedProteinIds: [],
      highlightedProteinIds: [],
      selectedAnnotation: 'test_annotation',
      hiddenAnnotationValues: [],
      otherAnnotationValues: [],
      zOrderMapping: null,
      colorMapping: null,
      shapeMapping: null,
      sizes: { base: 10 },
      opacities: { base: 0.8, selected: 1.0, faded: 0.2 },
      ...overrides,
    });

    it('passes the hidden, selected, highlighted and opacity config through to getOpacity', () => {
      // One point per tier, each tier with its own opacity, so any config field
      // that fails to reach computeVisibilityModel changes a value here.
      const data = createMockData([null, 'a', 'b', 'c']);
      const cfg = createDefaultStyleConfig({
        hiddenAnnotationValues: ['__NA__'],
        selectedProteinIds: ['p1'],
        highlightedProteinIds: ['p2'],
      });
      const { getOpacity } = createStyleGetters(data, cfg);
      expect(getOpacity(createMockPoint('p0', 0))).toBe(0); // null value, __NA__ hidden
      expect(getOpacity(createMockPoint('p1', 1))).toBe(cfg.opacities.selected);
      expect(getOpacity(createMockPoint('p2', 2))).toBe(cfg.opacities.selected); // highlighted
      expect(getOpacity(createMockPoint('p3', 3))).toBe(cfg.opacities.faded);

      const unselected = createStyleGetters(data, createDefaultStyleConfig());
      expect(unselected.getOpacity(createMockPoint('p3', 3))).toBe(cfg.opacities.base);
    });

    it('all-hidden: getColors returns [] for a non-Other point (colours are NOT rescued)', () => {
      // The visibility model's all-hidden escape hatch rescues opacity only.
      // getColors has no all-hidden guard: hidden values are filtered to
      // undefined, so the result is [].
      const data = createMockData(['catA', 'catB']);
      const cfg = createDefaultStyleConfig({
        hiddenAnnotationValues: ['catA', 'catB'],
        colorMapping: { catA: '#aabbcc', catB: '#ddeeff' },
      });
      const { getColors } = createStyleGetters(data, cfg);
      expect(getColors(createMockPoint('p0', 0))).toEqual([]);
    });
  });

  describe('isMultilabel', () => {
    /**
     * The atlas gate. Pinned HERE, at the layer that decides it, because the
     * property that makes it safe to gate a 32 B/point GPU allocation on is a
     * property of `createStyleGetters` — that it answers from stored values and
     * not from rendered colours — and nothing downstream can restate it.
     */
    const multiLabelData = (): VisualizationData => ({
      protein_ids: ['p0', 'p1'],
      projections: [{ name: 'test', data: new Float32Array(6), dimension: 3 }],
      annotations: {
        family: {
          values: ['A', 'B'],
          colors: ['#ff0000', '#00ff00'],
          shapes: ['circle', 'circle'],
        },
      },
      annotation_data: {
        family: [
          [0, 1],
          [0, 1],
        ],
      },
    });

    const config = (overrides: Partial<StyleConfig> = {}): StyleConfig => ({
      selectedProteinIds: [],
      highlightedProteinIds: [],
      selectedAnnotation: 'family',
      hiddenAnnotationValues: [],
      otherAnnotationValues: [],
      zOrderMapping: null,
      colorMapping: null,
      shapeMapping: null,
      sizes: { base: 10 },
      opacities: { base: 1, selected: 1, faded: 0.3 },
      ...overrides,
    });

    it('is true when the selected annotation stores more than one value for a protein', () => {
      expect(createStyleGetters(multiLabelData(), config()).isMultilabel()).toBe(true);
    });

    it('is false for a single-value annotation, and for no data or no selection', () => {
      const single: VisualizationData = {
        ...multiLabelData(),
        annotation_data: { family: new Int32Array([0, 1]) },
      };
      expect(createStyleGetters(single, config()).isMultilabel()).toBe(false);
      expect(createStyleGetters(null, config()).isMultilabel()).toBe(false);
      expect(
        createStyleGetters(multiLabelData(), config({ selectedAnnotation: '' })).isMultilabel(),
      ).toBe(false);
    });

    it('answers from STORAGE, so hiding a value cannot retract it', () => {
      // The regression this exists to catch: a colour-shaped gate
      // (`getColors(p).length > 1`) reads false the moment hiding collapses every
      // point to one colour — releasing the atlas exactly one un-hide before it is
      // needed again, at 573K points a full realloc and upload per legend click.
      const getters = createStyleGetters(
        multiLabelData(),
        config({ hiddenAnnotationValues: ['B'] }),
      );
      const point: PlotDataPoint = { id: 'p0', x: 0, y: 0, originalIndex: 0 };

      // Colour-shaped would now say "single"...
      expect(getters.getColors(point)).toHaveLength(1);
      // ...storage-shaped still says multi.
      expect(getters.isMultilabel()).toBe(true);
    });
  });
});
