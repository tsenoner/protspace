import type {
  EffectiveExploreView,
  ExploreViewChangeSource,
  ExploreViewNormalization,
  ExploreViewRequestState,
} from './view-state';

export type {
  EffectiveExploreView,
  ExploreViewChangeSource,
  ExploreViewNormalization,
  ExploreViewRequestState,
} from './view-state';

export type DatasetLoadKind = 'default' | 'opfs' | 'user';

export interface LoadMeta {
  sequence: number;
  kind: DatasetLoadKind;
}

export interface DataLoaderLoadOptions {
  source?: 'user' | 'auto';
}

export interface ExploreViewChange {
  effective: EffectiveExploreView;
  source: ExploreViewChangeSource;
  normalize: ExploreViewNormalization;
}

export interface ExploreController {
  setRequestedView(requested: ExploreViewRequestState): void;
  subscribeToViewChanges(callback: (change: ExploreViewChange) => void): () => void;
  dispose(): void;
}

export const NOOP_CONTROLLER: ExploreController = {
  setRequestedView() {},
  subscribeToViewChanges() {
    return () => {};
  },
  dispose() {},
};
