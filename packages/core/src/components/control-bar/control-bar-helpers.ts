/**
 * Helper functions for control bar component
 * These functions contain the core logic extracted from the component for better testability
 */

/**
 * Export default settings
 */
export const EXPORT_DEFAULTS = {
  FORMAT: 'png' as const,
  IMAGE_WIDTH: 2048,
  IMAGE_HEIGHT: 1024,
  LEGEND_WIDTH_PERCENT: 20,
  LEGEND_FONT_SIZE_PX: 15,
  BASE_FONT_SIZE: 24,
  MIN_LEGEND_FONT_SIZE_PX: 8,
  MAX_LEGEND_FONT_SIZE_PX: 120,
  LOCK_ASPECT_RATIO: true,
  INCLUDE_LEGEND: true,
};

/**
 * Validate selection mode based on data size
 */
export function shouldDisableSelection(dataSize: number): boolean {
  return dataSize <= 1;
}

/**
 * Create selection disabled message
 */
export function getSelectionDisabledMessage(reason: string, dataSize: number): string {
  if (reason === 'insufficient-data') {
    return `Selection mode disabled: Only ${dataSize} point${dataSize !== 1 ? 's' : ''} remaining`;
  }
  return 'Selection mode disabled';
}

/**
 * Toggle protein selection (add or remove)
 */
export function toggleProteinSelection(proteinId: string, currentSelection: string[]): string[] {
  const currentSet = new Set(currentSelection);
  if (currentSet.has(proteinId)) {
    currentSet.delete(proteinId);
  } else {
    currentSet.add(proteinId);
  }
  return Array.from(currentSet);
}

/**
 * Merge multiple protein selections (for brush selection)
 */
export function mergeProteinSelections(
  currentSelection: string[],
  newSelections: string[],
): string[] {
  const merged = new Set(currentSelection);
  newSelections.forEach((id) => merged.add(id));
  return Array.from(merged);
}
