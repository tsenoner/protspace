import type { DensityLayerMode, DensityLayerStyle } from '@protspace/utils';

export interface RequestedExploreView {
  annotation?: string;
  projection?: string;
  /**
   * Extra annotations the user has opted into the hover tooltip.
   * `undefined` means the URL didn't request a value; `[]` means it
   * requested an explicitly empty set.
   */
  tooltip?: string[];
  density?: DensityLayerMode;
  densityStyle?: DensityLayerStyle;
}

export interface ExploreViewNormalization {
  annotation: boolean;
  projection: boolean;
  tooltip: boolean;
  density: boolean;
}

export interface ExploreViewRequestState {
  requested: RequestedExploreView;
  present: {
    annotation: boolean;
    projection: boolean;
    tooltip: boolean;
    density: boolean;
  };
  normalize: ExploreViewNormalization;
}

export interface EffectiveExploreView {
  annotation: string;
  projection: string;
  tooltip: string[];
  density: DensityLayerMode;
  densityStyle: DensityLayerStyle;
}

export interface ResolvedExploreView {
  effective: EffectiveExploreView;
  matchesRequested: {
    annotation: boolean;
    projection: boolean;
    tooltip: boolean;
    density: boolean;
  };
}

export type ExploreViewChangeSource = 'user' | 'url' | 'dataset-load';
