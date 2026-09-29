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
 * a request abandoned because a newer user request started (see
 * `beginUserRequest`/`isCurrentRequest` in `persisted-dataset.ts`).
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
  /**
   * The request epoch this load was started under (see
   * `beginUserRequest`/`isCurrentRequest` in `persisted-dataset.ts`).
   * `handleDataLoaded` (dataset-controller.ts) checks it against the current
   * epoch before rendering: a newer user request may have started while this
   * one was still decoding, and that request already owns the screen.
   */
  requestId: number;
  /**
   * Whether this load replaces the user's stored import (a menu choice, or
   * the recovery banner's "Load default"). `handleDataLoaded` clears the
   * stored copy only once the example has decoded and is still the current
   * request, so a failed download or parse, or a superseded request, never
   * deletes the import that is still on screen. Absent means false.
   */
  replacesStoredImport?: boolean;
}

export interface LoadMeta {
  sequence: number;
  kind: DatasetLoadKind;
  example?: ExampleLoadContext;
  /**
   * The request epoch an OPFS restore began under, so its parse-failure
   * recovery loads the demo only if no user request has moved past it.
   */
  epoch?: number;
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
  /**
   * Loads the dataset `?dataset=` names (the first call runs the startup
   * load). Settles once that request has loaded, failed or been superseded;
   * never rejects.
   */
  setRequestedDataset(exampleId: string | null): Promise<void>;
  /**
   * Cancels an example chosen from the Import menu that is still loading
   * (Back/Forward away from it); a no-op otherwise.
   */
  cancelPendingMenuLoad(): void;
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
  setRequestedDataset() {
    return Promise.resolve();
  },
  cancelPendingMenuLoad() {},
  subscribeToDatasetChanges() {
    return () => {};
  },
  dispose() {},
};
