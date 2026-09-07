import type { ScatterplotConfig } from '@protspace/utils';

// Centralized default configuration for the scatterplot component
export const DEFAULT_CONFIG: Required<ScatterplotConfig> = {
  width: 800,
  height: 600,
  margin: { top: 40, right: 40, bottom: 40, left: 40 },
  pointSize: 240,
  zoomExtent: [0.1, 1000],
  baseOpacity: 0.9,
  selectedOpacity: 1.0,
  fadedOpacity: 0.15,
  enableDuplicateStackUI: false,
  densityLayer: 'off',
};

export const NEUTRAL_VALUE_COLOR = '#888888';
