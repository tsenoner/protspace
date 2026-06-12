import { describe, it, expect } from 'vitest';
import type { StyleConfig } from './style-getters';
import { createStyleGetters } from './style-getters';
import type { VisualizationData, PlotDataPoint } from '@protspace/utils';

/**
 * Tests for style-getters.ts focusing on N/A value handling.
 *
 * The legend uses '__NA__' internally to represent N/A values. After ingestion-time
 * normalization, missing values reach style-getters as `null` (or are absent), so these
 * tests focus on the canonical null → '__NA__' lookup contract.
 */

describe('style-getters', () => {
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

    describe('getOpacity with hidden N/A values', () => {
      it('should hide points with null annotation values when __NA__ is hidden', () => {
        const data = createMockData([null, 'value1', 'value2']);
        const config = createDefaultStyleConfig({
          hiddenAnnotationValues: ['__NA__'],
        });

        const getters = createStyleGetters(data, config);
        const nullPoint = createMockPoint('protein_0', 0);

        expect(getters.getOpacity(nullPoint)).toBe(0);
      });

      it('should NOT hide non-N/A points when __NA__ is hidden', () => {
        const data = createMockData([null, 'value1', 'value2']);
        const config = createDefaultStyleConfig({
          hiddenAnnotationValues: ['__NA__'],
        });

        const getters = createStyleGetters(data, config);
        const regularPoint = createMockPoint('protein_1', 1);

        expect(getters.getOpacity(regularPoint)).toBe(1);
      });

      it('should show N/A points when __NA__ is NOT hidden', () => {
        const data = createMockData([null, 'value1', 'value2']);
        const config = createDefaultStyleConfig({
          hiddenAnnotationValues: [],
        });

        const getters = createStyleGetters(data, config);
        const nullPoint = createMockPoint('protein_0', 0);

        expect(getters.getOpacity(nullPoint)).toBe(1);
      });
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

    describe('normalizeToKey behavior', () => {
      it('should treat __NA__ string as-is (not double-convert)', () => {
        // If someone explicitly uses '__NA__' as a value, it should work correctly
        const data = createMockData(['__NA__', 'value1']);
        const config = createDefaultStyleConfig({
          hiddenAnnotationValues: ['__NA__'],
        });

        const getters = createStyleGetters(data, config);
        const naStringPoint = createMockPoint('protein_0', 0);

        // __NA__ string should be hidden when __NA__ is in hiddenAnnotationValues
        expect(getters.getOpacity(naStringPoint)).toBe(0);
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

      // Depth should be identical — hiding doesn't affect sort order
      expect(depthHidden).toBe(depthVisible);
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

    it('should still return opacity=0 for hidden points', () => {
      const data = createMockData(['categoryA', 'categoryB']);
      const point = createMockPoint('p0', 0);

      const getters = createStyleGetters(
        data,
        createDefaultStyleConfig({ hiddenAnnotationValues: ['categoryA'] }),
      );

      // Opacity reflects hidden state
      expect(getters.getOpacity(point)).toBe(0);
      // But depth is based on base opacity (not 0)
      expect(getters.getDepth(point)).toBeLessThan(1);
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

    it('should produce consistent depth values for the same configuration', () => {
      const data = createMockData(['categoryA', 'categoryB', 'categoryC']);
      const point = createMockPoint(0);

      const config = createDefaultStyleConfig({
        zOrderMapping: {
          categoryA: 0,
          categoryB: 1,
          categoryC: 2,
        },
      });

      // Create style getters multiple times with same config
      const getters1 = createStyleGetters(data, config);
      const getters2 = createStyleGetters(data, config);
      const getters3 = createStyleGetters(data, config);

      // All should produce identical depth values
      expect(getters1.getDepth(point)).toBe(getters2.getDepth(point));
      expect(getters2.getDepth(point)).toBe(getters3.getDepth(point));
    });

    it('should maintain z-order ordering across all points', () => {
      const data = createMockData(['categoryA', 'categoryB', 'categoryC']);
      const pointA = createMockPoint(0);
      const pointB = createMockPoint(1);
      const pointC = createMockPoint(2);

      const config = createDefaultStyleConfig({
        zOrderMapping: {
          categoryA: 0, // front (smallest depth)
          categoryB: 1, // middle
          categoryC: 2, // back (largest depth)
        },
      });

      const getters = createStyleGetters(data, config);

      // Lower z-order = smaller depth = rendered on top (WebGL LESS depth test)
      const depthA = getters.getDepth(pointA);
      const depthB = getters.getDepth(pointB);
      const depthC = getters.getDepth(pointC);

      // Strict ordering should be maintained
      expect(depthA).toBeLessThan(depthB);
      expect(depthB).toBeLessThan(depthC);
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

  describe('hidden vs selection/fading/highlight precedence', () => {
    // Each protein maps 1-to-1 to a value at the same index.
    // NOTE: produces array-of-arrays annotation_data only; Int32Array/sentinel paths (used inline by T1.3) are not covered by this helper.
    const createMockData = (values: string[]): VisualizationData => ({
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

    it('T1.1 hidden-beats-selected: selected point whose value is hidden returns 0, not opacities.selected', () => {
      // p0 is selected AND its annotation value ('hiddenVal') is hidden.
      // The hidden-check fires before getBaseOpacity, so 0 wins over opacities.selected.
      const data = createMockData(['hiddenVal', 'visibleVal']);
      const cfg = createDefaultStyleConfig({
        selectedProteinIds: ['p0'],
        hiddenAnnotationValues: ['hiddenVal'],
      });
      const { getOpacity } = createStyleGetters(data, cfg);
      expect(getOpacity(createMockPoint('p0', 0))).toBe(0);
    });

    it('T1.2 selection-fading × hidden: non-selected visible → faded; non-selected hidden → 0; selected visible → selected', () => {
      // Three proteins with distinct values; one hidden category; p0 is selected.
      const data = createMockData(['visibleA', 'visibleB', 'hiddenC']);
      const cfg = createDefaultStyleConfig({
        selectedProteinIds: ['p0'],
        hiddenAnnotationValues: ['hiddenC'],
      });
      const { getOpacity } = createStyleGetters(data, cfg);
      // p1: non-selected, visible value → faded
      expect(getOpacity(createMockPoint('p1', 1))).toBe(cfg.opacities.faded);
      // p2: non-selected, hidden value → 0 (hidden overrides faded)
      expect(getOpacity(createMockPoint('p2', 2))).toBe(0);
      // p0: selected, visible value → selected
      expect(getOpacity(createMockPoint('p0', 0))).toBe(cfg.opacities.selected);
    });

    it('T1.3 vacuous-truth: Int32Array sentinel -1 (zero annotation values) returns opacity 0 even with empty hiddenAnnotationValues', () => {
      // Int32Array sentinel -1 → getProteinAnnotationIndices returns [] → annotationValue = [].
      // [].every(...) is vacuously true, so the hidden-check short-circuits to 0.
      const data: VisualizationData = {
        protein_ids: ['p0', 'p1'],
        projections: [
          {
            name: 'test',
            data: Float32Array.of(0, 0, 0, 1, 1, 0),
            dimension: 3,
          },
        ],
        annotations: {
          test_annotation: {
            kind: 'categorical',
            values: ['categoryA', 'categoryB'],
            colors: ['#ff0000', '#00ff00'],
            shapes: ['circle', 'circle'],
          },
        },
        annotation_data: {
          test_annotation: Int32Array.of(0, -1), // p1 has no annotation value
        },
      };
      const cfg = createDefaultStyleConfig({ hiddenAnnotationValues: [] });
      const { getOpacity } = createStyleGetters(data, cfg);
      expect(getOpacity(createMockPoint('p1', 1))).toBe(0);
    });

    it('T1.4 all-hidden: getOpacity returns base-tier opacity (hatch rescues it); getColors returns [] for non-Other point (colors are NOT rescued)', () => {
      // When every annotation value is hidden, computeAllHidden() returns true.
      // getOpacity skips the hidden-check and falls through to getBaseOpacity.
      // getColors has no all-hidden guard: hidden values are filtered to undefined,
      // so the result is [].
      const data = createMockData(['catA', 'catB']);
      const cfg = createDefaultStyleConfig({
        hiddenAnnotationValues: ['catA', 'catB'],
        colorMapping: { catA: '#aabbcc', catB: '#ddeeff' },
      });
      const { getOpacity, getColors } = createStyleGetters(data, cfg);
      const point = createMockPoint('p0', 0);
      expect(getOpacity(point)).toBe(cfg.opacities.base);
      expect(getColors(point)).toEqual([]);
    });

    it('T1.5 highlight-only: highlighted point gets opacities.selected; non-highlighted point keeps opacities.base (no fading)', () => {
      // With selectedProteinIds empty, hasSelection is false so non-highlighted
      // points are NOT faded — they stay at opacities.base.
      const data = createMockData(['catA', 'catB']);
      const cfg = createDefaultStyleConfig({
        highlightedProteinIds: ['p0'],
        selectedProteinIds: [],
      });
      const { getOpacity } = createStyleGetters(data, cfg);
      expect(getOpacity(createMockPoint('p0', 0))).toBe(cfg.opacities.selected);
      expect(getOpacity(createMockPoint('p1', 1))).toBe(cfg.opacities.base);
    });
  });
});
