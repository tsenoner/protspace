/**
 * Helper functions for control bar component
 * These functions contain the core logic extracted from the component for better testability
 */

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
