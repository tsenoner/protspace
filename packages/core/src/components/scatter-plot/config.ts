import { DENSITY_DEFAULT, type ScatterplotConfig } from '@protspace/utils';

// Centralized default configuration for the scatterplot component
export const DEFAULT_CONFIG: Required<ScatterplotConfig> = {
  width: 800,
  height: 600,
  margin: { top: 12, right: 12, bottom: 12, left: 12 },
  pointSize: 80,
  zoomExtent: [0.1, 1000],
  baseOpacity: 0.9,
  selectedOpacity: 1.0,
  fadedOpacity: 0.15,
  enableDuplicateStackUI: false,
  densityLayer: DENSITY_DEFAULT,
};

export const NEUTRAL_VALUE_COLOR = '#888888';
