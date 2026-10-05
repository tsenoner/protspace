import type { PlotData, ScalePair } from '@protspace/utils';
import { perfCounters } from '../../../utils/perf-counters';
import { PointGridIndex } from './point-grid-index';

/**
 * Visible slots below 1 / this of all get a grid of their own (see `_sparse`):
 * the full grid would make a query walk mostly hidden slots.
 */
const SPARSE_INDEX_SHARE = 4;

interface PointGridHost {
  /** The plot data to index. */
  plotData(): PlotData;
  /** Its scales: null while there is nothing to plot. */
  scales(): ScalePair | null;
  /** What the scales are built at besides the plot data: the plot's size and margins. */
  scalesKey(): string;
  /** The interactive slots of `plotData()`, marked 1 in `visible`, and how many there are. */
  interactable(): { readonly visible: Uint8Array; readonly count: number };
  /** The index is about to change: stop the work that reads the old one. */
  onIndexInvalid(): void;
  /** A build found nothing to index. */
  onIndexEmpty(): void;
  /** The visible slots were marked anew. */
  onIndexMarked(): void;
}

/** A grid `detach` handed over: the plot data it indexes and the scales it was built at. */
export interface GridStash {
  readonly plotData: PlotData;
  readonly grid: PointGridIndex;
  readonly scales: string;
}

/**
 * The point grid that hit-testing, brushing, lasso and the duplicate stacks
 * query. It indexes every slot of the plot data and answers for the
 * interactive ones, which it marks: a change of which points are visible
 * re-marks them, and only a change of the plot data or its scales rebuilds it.
 */
export class PointGridController {
  private _grid = new PointGridIndex();
  // The plot data `_grid` indexes: null before the first build and after `clear`.
  private _source: PlotData | null = null;
  // The slots queries see, from the host's `interactable()`.
  private _visible: Uint8Array | null = null;
  // A grid of just the visible slots, kept while they are a small share of all,
  // so a query walks them alone, as it did when the grid held only them.
  private _sparse: PointGridIndex | null = null;
  // The slots `_visible` marks, built when first asked for. Retained for the
  // duplicate-badge capture path (#301): the full-extent compute iterates it
  // against the raw PlotData arrays instead of traversing the point index (~93×
  // slower at 570k points).
  private _slots: number[] | null = null;
  private _frameId: number | null = null;
  private _rebuildPending = false;
  private _remarkPending = false;
  // Set by `adopt`: the scales the adopted grid was built at.
  private _adoptedScales: string | null = null;

  constructor(private readonly host: PointGridHost) {}

  /** The grid over every slot. */
  get grid(): PointGridIndex {
    return this._grid;
  }

  /**
   * The `visible` of the `interactable()` the slots were last marked from: null
   * before the first build with something to index and after `clear`.
   */
  get marks(): Uint8Array | null {
    return this._visible;
  }

  /** The index that answers for the visible slots: theirs alone while they are few. */
  index(): PointGridIndex {
    return this._sparse ?? this._grid;
  }

  /** The visible slots in ascending order, or null before the first build. */
  visibleSlots(): number[] | null {
    const visible = this._visible;
    if (!visible) return null;
    if (!this._slots) {
      const slots: number[] = [];
      for (let s = 0; s < visible.length; s++) if (visible[s]) slots.push(s);
      this._slots = slots;
    }
    return this._slots;
  }

  /** Rebuild the grid on the next frame: the plot data or its scales changed. */
  scheduleRebuild() {
    this._rebuildPending = true;
    this._schedule();
  }

  /**
   * Re-mark the interactive slots on the next frame, for a change of which
   * points are visible only: the grid holds every slot, so it needs no rebuild.
   * A pending rebuild absorbs it, and so does plot data the grid was not built from.
   */
  scheduleRemark() {
    this._remarkPending = true;
    this._schedule();
  }

  /**
   * Drop the frame a schedule asked for. What it was asked for stays pending,
   * for the next schedule to do.
   */
  cancel() {
    if (this._frameId === null) return;
    cancelAnimationFrame(this._frameId);
    this._frameId = null;
  }

  /**
   * Build the grid over the host's plot data now; after `adopt`, only re-mark
   * it. Leaves a scheduled frame and what it was asked for alone.
   */
  rebuildNow() {
    // Cancel any in-flight duplicate stack computation — it uses the old point index
    // and would overwrite cleared state with stale results when it finishes.
    this.host.onIndexInvalid();

    const pd = this.host.plotData();
    const scales = pd.length ? this.host.scales() : null;
    if (!scales) {
      this._visible = null;
      this._slots = null;
      this._sparse = null;
      this._source = null;
      this.host.onIndexEmpty();
      // No render here — there is nothing to draw.
      return;
    }
    this._grid.setScales(scales);
    const adoptedScales = this._adoptedScales;
    this._adoptedScales = null;
    if (adoptedScales === this.host.scalesKey() && this._source === pd) {
      // The grid `adopt` put back: only what is visible moved.
      this._mark();
      return;
    }
    // Every slot, hidden ones too: a change of what is visible then re-marks
    // `_visible` instead of rebuilding the grid.
    const slots = new Uint32Array(pd.length);
    for (let s = 0; s < slots.length; s++) slots[s] = s;
    this._grid.rebuild(pd, slots);
    if (perfCounters) perfCounters.gridRebuild++;
    this._source = pd;
    this._mark();
  }

  /**
   * Hand over the grid, if it indexes the host's plot data with no rebuild
   * pending, and carry on as `clear` leaves it. Null, and nothing changes, otherwise.
   */
  detach(): GridStash | null {
    const plotData = this.host.plotData();
    if (!this._isCurrent(plotData)) return null;
    const stash = { plotData, grid: this._grid, scales: this.host.scalesKey() };
    this._grid = new PointGridIndex();
    this.clear();
    return stash;
  }

  /**
   * Put back a grid `detach` handed over, for its plot data. The next build
   * only re-marks it, provided the scales still match the ones it was built at.
   */
  adopt(stash: GridStash) {
    this._grid = stash.grid;
    this._source = stash.plotData;
    this._adoptedScales = stash.scales;
  }

  /** Empty the grid and drop its marks, so they are released before new plot data is allocated. */
  clear() {
    this._grid.clear();
    this._sparse = null;
    this._visible = null;
    this._slots = null;
    this._source = null;
    this._adoptedScales = null;
  }

  /** Whether the grid indexes `pd`, with no rebuild pending. */
  private _isCurrent(pd: PlotData): boolean {
    return this._source === pd && !this._rebuildPending;
  }

  private _schedule() {
    if (this._frameId !== null) {
      cancelAnimationFrame(this._frameId);
    }
    this._frameId = requestAnimationFrame(() => {
      this._frameId = null;
      const rebuild = !this._isCurrent(this.host.plotData());
      this._rebuildPending = false;
      if (rebuild) {
        this.rebuildNow();
      } else if (this._remarkPending) {
        this.host.onIndexInvalid();
        this._mark();
      }
    });
  }

  /**
   * Mark the slots hit-testing, brushing and the duplicate stacks see: the
   * interactive ones, as the point grid used to hold. Queries skip the rest.
   */
  private _mark() {
    const pd = this.host.plotData();
    const { visible, count } = this.host.interactable();
    this._visible = visible;
    this._grid.setVisible(visible);
    this._slots = null;
    this._sparse = null;
    // With few slots visible, give them a grid of their own: it costs what a
    // visible-only rebuild did, and spares every query the hidden slots.
    const scales = count * SPARSE_INDEX_SHARE < pd.length ? this.host.scales() : null;
    if (scales) {
      this._sparse = new PointGridIndex();
      this._sparse.setScales(scales);
      this._sparse.rebuild(pd, this.visibleSlots()!);
    }
    this._remarkPending = false;
    this.host.onIndexMarked();

    // No render: the canvas does not read the point index or the slot list. This
    // render once refreshed the viewport-cull cache, which #456 removed, and
    // every caller that changes what is drawn requests its own render.
  }
}
