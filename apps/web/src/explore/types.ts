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
 *
 * A dataset-change report can also say `'superseded'`, which no load is
 * requested with: a newer user request superseded the load while it was
 * rendering, so it is on screen until that request's own load replaces it,
 * and the URL, which that request owns, must not be written for it.
 */
export type DatasetChangeSource = 'menu' | 'url' | 'user' | 'startup' | 'superseded';

/**
 * The real result of an example load, distinguishing a genuine failure from
 * a request abandoned because a newer user request started (see
 * `beginUserRequest`/`isCurrentRequest` in `persisted-dataset.ts`).
 * Only `'failed'` should trigger a caller's fallback; `'superseded'` means a
 * later request already owns the screen and this one must do nothing more —
 * no toast, no fallback, no emit, no overlay change.
 */
export type ExampleLoadOutcome = 'loaded' | 'failed' | 'superseded';

/** What cancelling the example load in flight did (`cancelPendingExampleLoad`). */
export type ExampleCancelResult =
  /** The example was still downloading or decoding: it is cancelled. */
  | 'cancelled'
  /**
   * The example has begun replacing the stored import and the plot: it can
   * no longer be cancelled, and finishes loading.
   */
  | 'committed'
  /** No such example load is in flight. */
  | 'none';

/**
 * Which example a 'default'-kind load is for, and why it was requested. Only
 * present when the load was started by `loadExampleDataset`
 * (persisted-dataset.ts); a
 * perf-suite load is also 'default' kind but never carries this, so
 * `handleDataLoaded` must key on its presence rather than on `kind`.
 */
export interface ExampleLoadContext {
  entry: ExampleDataset;
  source: DatasetChangeSource;
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
   * The request epoch the load began under (see `beginUserRequest` in
   * persisted-dataset.ts): an example load's, an OPFS restore's or a user
   * import's. A newer user request supersedes the load (`isLoadSuperseded` in
   * dataset-controller.ts), which then renders nothing, and an OPFS restore's
   * parse-failure recovery loads the demo only if none has. Absent for a load
   * no user request supersedes (the perf suite's).
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
   * (Back/Forward away from it). One that has already begun replacing the
   * plot is `'committed'`: it finishes and pushes its own history entry.
   */
  cancelPendingMenuLoad(): ExampleCancelResult;
  subscribeToDatasetChanges(
    callback: (exampleId: string | null, source: DatasetChangeSource) => void,
  ): () => void;
  /** Reports the Retry of a failed `?dataset=` download, for the URL sync hook to re-request. */
  subscribeToExampleRetries(callback: (exampleId: string) => void): () => void;
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
  cancelPendingMenuLoad() {
    return 'none';
  },
  subscribeToDatasetChanges() {
    return () => {};
  },
  subscribeToExampleRetries() {
    return () => {};
  },
  dispose() {},
};
