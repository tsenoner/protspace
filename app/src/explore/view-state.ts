export interface RequestedExploreView {
  annotation?: string;
  projection?: string;
  /**
   * Extra annotations the user has opted into the hover tooltip.
   * `undefined` means the URL didn't request a value; `[]` means it
   * requested an explicitly empty set.
   */
  tooltip?: string[];
}

export interface ExploreViewNormalization {
  annotation: boolean;
  projection: boolean;
  tooltip: boolean;
}

export interface ExploreViewRequestState {
  requested: RequestedExploreView;
  present: {
    annotation: boolean;
    projection: boolean;
    tooltip: boolean;
  };
  normalize: ExploreViewNormalization;
}

export interface EffectiveExploreView {
  annotation: string;
  projection: string;
  tooltip: string[];
}

export interface ResolvedExploreView {
  effective: EffectiveExploreView;
  matchesRequested: {
    annotation: boolean;
    projection: boolean;
    tooltip: boolean;
  };
}

export type ExploreViewChangeSource = 'user' | 'url' | 'dataset-load';
