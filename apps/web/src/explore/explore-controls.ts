/** The view a new dataset opens on, as the data renderer resolved it. */
export interface InitialView {
  projection: string;
  annotation: string;
  tooltip: readonly string[];
}

/**
 * The dataset pipeline's one seam to the controls (design decision 9). `dataset-controller.ts` and
 * `data-renderer.ts` reset and fill the controls only through this; `runtime.ts` builds it from
 * the view-bar, filter and selection controllers.
 */
export interface ExploreControls {
  /** A new dataset is on its way: drop per-dataset control state (waiting picks, export format). */
  resetForNewDataset(): void;
  /** The loaded file carries settings that a Parquet export can keep. */
  setHasFileSettings(value: boolean): void;
  /** Show the new dataset's view in the controls, without change events. */
  showInitialView(view: InitialView): void;
  /** Close the previous dataset's structure. */
  clearStructure(): void;
}
