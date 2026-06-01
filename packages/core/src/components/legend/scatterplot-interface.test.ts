/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import {
  isScatterplotElement,
  supportsHiddenValues,
  supportsOtherValues,
  supportsConfig,
  supportsIsolationMode,
  supportsIsolationHistory,
  type IScatterplotElement,
} from './scatterplot-interface';

describe('scatterplot-interface', () => {
  describe('isScatterplotElement', () => {
    it('returns false for null', () => {
      expect(isScatterplotElement(null)).toBe(false);
    });

    it('returns false for element without getCurrentData', () => {
      const element = document.createElement('div');
      expect(isScatterplotElement(element)).toBe(false);
    });

    it('returns false for element with only getCurrentData', () => {
      const element = document.createElement('div') as unknown as Element & {
        getCurrentData: () => null;
      };
      element.getCurrentData = () => null;
      expect(isScatterplotElement(element)).toBe(false);
    });

    it('returns false for element with only selectedAnnotation', () => {
      const element = document.createElement('div') as unknown as Element & {
        selectedAnnotation: string;
      };
      element.selectedAnnotation = 'test';
      expect(isScatterplotElement(element)).toBe(false);
    });

    it('returns true for element with both getCurrentData and selectedAnnotation', () => {
      const element = createMockScatterplot();
      expect(isScatterplotElement(element)).toBe(true);
    });
  });

  describe('supportsHiddenValues', () => {
    it('returns true when hiddenAnnotationValues property exists', () => {
      const element = createMockScatterplot({ hiddenAnnotationValues: [] });
      expect(supportsHiddenValues(element)).toBe(true);
    });

    it('returns false when hiddenAnnotationValues property is missing', () => {
      const element = createMockScatterplot();
      delete (element as Partial<IScatterplotElement>).hiddenAnnotationValues;
      expect(supportsHiddenValues(element)).toBe(false);
    });
  });

  describe('supportsOtherValues', () => {
    it('returns true when otherAnnotationValues property exists', () => {
      const element = createMockScatterplot({ otherAnnotationValues: [] });
      expect(supportsOtherValues(element)).toBe(true);
    });

    it('returns false when otherAnnotationValues property is missing', () => {
      const element = createMockScatterplot();
      delete (element as Partial<IScatterplotElement>).otherAnnotationValues;
      expect(supportsOtherValues(element)).toBe(false);
    });
  });

  describe('supportsConfig', () => {
    it('returns true when config property exists', () => {
      const element = createMockScatterplot({ config: {} });
      expect(supportsConfig(element)).toBe(true);
    });

    it('returns false when config property is missing', () => {
      const element = createMockScatterplot();
      delete (element as Partial<IScatterplotElement>).config;
      expect(supportsConfig(element)).toBe(false);
    });
  });

  describe('supportsIsolationMode', () => {
    it('returns true when isIsolationMode is a function', () => {
      const element = createMockScatterplot({
        isIsolationMode: () => false,
      });
      expect(supportsIsolationMode(element)).toBe(true);
    });

    it('returns false when isIsolationMode is missing', () => {
      const element = createMockScatterplot();
      expect(supportsIsolationMode(element)).toBe(false);
    });

    it('returns false when isIsolationMode is not a function', () => {
      const element = createMockScatterplot();
      (element as unknown as { isIsolationMode: boolean }).isIsolationMode = true;
      expect(supportsIsolationMode(element)).toBe(false);
    });
  });

  describe('supportsIsolationHistory', () => {
    it('returns true when getIsolationHistory is a function', () => {
      const element = createMockScatterplot({
        getIsolationHistory: () => [],
      });
      expect(supportsIsolationHistory(element)).toBe(true);
    });

    it('returns false when getIsolationHistory is missing', () => {
      const element = createMockScatterplot();
      expect(supportsIsolationHistory(element)).toBe(false);
    });

    it('returns false when getIsolationHistory is not a function', () => {
      const element = createMockScatterplot();
      (element as unknown as { getIsolationHistory: string[][] }).getIsolationHistory = [];
      expect(supportsIsolationHistory(element)).toBe(false);
    });
  });
});

/**
 * Helper to create a mock scatterplot element with minimal required properties
 */
function createMockScatterplot(overrides: Partial<IScatterplotElement> = {}): IScatterplotElement {
  const element = document.createElement('div') as unknown as IScatterplotElement;

  // Required properties
  element.getCurrentData = () => null;
  element.selectedAnnotation = 'test-annotation';

  // Default optional properties
  element.hiddenAnnotationValues = [];
  element.otherAnnotationValues = [];
  element.config = {};

  // Apply overrides
  Object.assign(element, overrides);

  return element;
}
