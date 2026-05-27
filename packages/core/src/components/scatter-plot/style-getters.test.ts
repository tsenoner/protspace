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
      projections: [{ name: 'test', data: annotationValues.map(() => [0, 0, 0]) }],
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
      z: 0,
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
      projections: [{ name: 'test', data: annotationValues.map(() => [0, 0, 0]) }],
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
      z: 0,
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
            data: [
              [0, 0, 0],
              [1, 1, 0],
              [2, 2, 0],
            ],
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
      projections: [{ name: 'test', data: annotationValues.map(() => [0, 0, 0]) }],
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
      z: 0,
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
});
