import type {
  EffectiveExploreView,
  ExploreViewChangeSource,
  ExploreViewNormalization,
  ExploreViewRequestState,
} from './view-state';
import type { ExampleDataset } from './example-datasets';

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

/**
 * The real result of an example load, distinguishing a genuine failure from
 * a request abandoned because a newer one started (see
 * `beginExampleRequest`/`isCurrentExampleRequest` in `persisted-dataset.ts`).
 * Only `'failed'` should trigger a caller's fallback; `'superseded'` means a
 * later request already owns the screen and this one must do nothing more —
 * no toast, no fallback, no emit, no overlay change.
 */
export type ExampleLoadOutcome = 'loaded' | 'failed' | 'superseded';

/**
 * Which example a 'default'-kind load is for, and why it was requested. Only
 * present when the load was started by `loadExampleDataset`/
 * `loadExampleDatasetAndClearPersistedFile` (persisted-dataset.ts); a
 * perf-suite load is also 'default' kind but never carries this, so
 * `handleDataLoaded` must key on its presence rather than on `kind`.
 */
export interface ExampleLoadContext {
  entry: ExampleDataset;
  source: DatasetChangeSource;
}

export interface LoadMeta {
  sequence: number;
  kind: DatasetLoadKind;
  example?: ExampleLoadContext;
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
  /** See `ViewController.recordRequestedView` (view-controller.ts). */
  recordRequestedView(requested: ExploreViewRequestState): void;
  subscribeToViewChanges(callback: (change: ExploreViewChange) => void): () => void;
  setRequestedDataset(exampleId: string | null): void;
  subscribeToDatasetChanges(
    callback: (exampleId: string | null, source: DatasetChangeSource) => void,
  ): () => void;
  dispose(): void;
}

export const NOOP_CONTROLLER: ExploreController = {
  setRequestedView() {},
  recordRequestedView() {},
  subscribeToViewChanges() {
    return () => {};
  },
  setRequestedDataset() {},
  subscribeToDatasetChanges() {
    return () => {};
  },
  dispose() {},
};
