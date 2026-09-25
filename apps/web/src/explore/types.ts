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

/**
 * Why the app switched to a given example (or to no example): a menu choice,
 * a `?dataset=` URL (deep link or Back/Forward), a user file import, or the
 * default/OPFS startup load (including the fallback after an unknown or
 * failed URL id).
 */
export type DatasetChangeSource = 'menu' | 'url' | 'user' | 'startup';

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
  setRequestedDataset(exampleId: string | null): void;
  subscribeToDatasetChanges(
    callback: (exampleId: string | null, source: DatasetChangeSource) => void,
  ): () => void;
  dispose(): void;
}

export const NOOP_CONTROLLER: ExploreController = {
  setRequestedView() {},
  subscribeToViewChanges() {
    return () => {};
  },
  setRequestedDataset() {},
  subscribeToDatasetChanges() {
    return () => {};
  },
  dispose() {},
};
