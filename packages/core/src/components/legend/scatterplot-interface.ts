import type { ScatterplotData } from './types';
import type { NumericAnnotationDisplaySettingsMap } from '@protspace/utils';
import type { LegendSortMode } from './types';

/**
 * Interface defining the scatterplot element's API that the legend interacts with.
 * This provides type safety and documents the expected contract.
 */
export interface IScatterplotElement extends Element {
  // Data access
  data?: ScatterplotData;
  getCurrentData(options?: { includeFilteredProteinIds?: boolean }): ScatterplotData | null;
  getMaterializedData?(): ScatterplotData | null;
  selectedAnnotation: string;

  // Annotation values (using scatterplot's property names)
  hiddenAnnotationValues: string[];
  otherAnnotationValues: string[];
  numericAnnotationSettings?: NumericAnnotationDisplaySettingsMap;
  annotationSortModes?: Record<string, LegendSortMode>;
  numericManualOrderIdsByAnnotation?: Record<string, string[]>;

  // Configuration
  config: Record<string, unknown>;

  // Isolation mode (optional - may not exist on all implementations)
  isIsolationMode?(): boolean;
  getIsolationHistory?(): string[][];
}

/**
 * Type guard to check if an element is a scatterplot element
 */
export function isScatterplotElement(element: Element | null): element is IScatterplotElement {
  return element !== null && 'getCurrentData' in element && 'selectedAnnotation' in element;
}

/**
 * Type guard to check if scatterplot supports hidden values
 */
export function supportsHiddenValues(element: IScatterplotElement): boolean {
  return 'hiddenAnnotationValues' in element;
}

/**
 * Type guard to check if scatterplot supports other annotation values
 */
export function supportsOtherValues(element: IScatterplotElement): boolean {
  return 'otherAnnotationValues' in element;
}

/**
 * Type guard to check if scatterplot supports config
 */
export function supportsConfig(element: IScatterplotElement): boolean {
  return 'config' in element;
}

/**
 * Type guard to check if scatterplot supports isolation mode
 */
export function supportsIsolationMode(
  element: IScatterplotElement,
): element is IScatterplotElement & { isIsolationMode(): boolean } {
  return 'isIsolationMode' in element && typeof element.isIsolationMode === 'function';
}

/**
 * Type guard to check if scatterplot supports isolation history
 */
export function supportsIsolationHistory(
  element: IScatterplotElement,
): element is IScatterplotElement & { getIsolationHistory(): string[][] } {
  return 'getIsolationHistory' in element && typeof element.getIsolationHistory === 'function';
}
