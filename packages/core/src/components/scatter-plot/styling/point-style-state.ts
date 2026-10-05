import type { PlotData, ScatterplotConfig, VisualizationData } from '@protspace/utils';
import type { PointMarks } from '../webgl/types';
import { createStyleGetters } from './style-getters';
import { computeVisibilityModel } from './visibility-model';
import type { VisibilityInputs, VisibilityModel } from './visibility-model';

type StyleGetters = ReturnType<typeof createStyleGetters>;

interface PointStyleHost {
  /** The materialized data the points are styled from. */
  data(): VisualizationData | null;
  selectedAnnotation(): string;
  hiddenAnnotationValues(): string[];
  otherAnnotationValues(): string[];
  selectedProteinIds(): string[];
  highlightedProteinIds(): string[];
  /** Shift+hover: the hovered point's category values; every other point fades. */
  focusedValues(): string[] | null;
  eatOverlayEnabled(): boolean;
  /** The point size and the three opacity tiers. */
  config(): Required<ScatterplotConfig>;
  /** The legend's mappings, null until it sends them. */
  zOrderMapping(): Record<string, number> | null;
  colorMapping(): Record<string, string> | null;
  shapeMapping(): Record<string, string> | null;
  /** Whether the renderer can draw marks for the dataset; true without a renderer. */
  canDrawMarks(): boolean;
  /** The id index found a protein id more than once. */
  onIdsRepeat(): void;
}

/**
 * Memoization key for `model()`. Stored as a plain struct so each field is
 * compared by strict equality (===). An identity-compared object or array ref
 * cannot go into a string hash — the coercion loses identity and causes
 * spurious cache hits — so the struct approach is the correct trade-off here.
 */
type VisibilityModelMemoKey = {
  data: VisualizationData | null;
  selectedAnnotation: string;
  hiddenAnnotationValues: string[];
  selectedProteinIds: string[];
  highlightedProteinIds: string[];
  baseOpacity: number;
  selectedOpacity: number;
  fadedOpacity: number;
  eatOverlayEnabled: boolean;
  focusedValues: string[] | null;
};

/** The interactive slots of some plot data, see `interactable`. */
interface InteractableSlots {
  /** What they were marked for: the plot data's slots and the model's `interactivityKey`. */
  readonly originalIndices: Int32Array | null;
  readonly length: number;
  readonly interactivityKey: object;
  readonly visible: Uint8Array;
  readonly count: number;
  /** The protein ids of the slots `visible` marks, in slot order; gathered on the first call. */
  ids(): ReadonlySet<string>;
}

/**
 * Run `task` once the main thread is idle (at most 2 s on), or after a short
 * delay where `requestIdleCallback` is missing (Safari). Returns its cancel.
 */
function whenIdle(task: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(task, { timeout: 2000 });
    return () => cancelIdleCallback(handle);
  }
  const handle = setTimeout(task, 500);
  return () => clearTimeout(handle);
}

/**
 * How every point is styled: the visibility model, the style getters over it,
 * what the live view stages while the GPU draws the selection and highlight as
 * marks, the marks themselves, and which slots are interactive. Each is built
 * when first asked for, from the host's current inputs, and kept while they are
 * the same.
 */
export class PointStyleState {
  private _styleGetters: StyleGetters | null = null;
  // The getters over the model with nothing marked (`stageGetters`), with the
  // getters and model they were built from.
  private _unmarkedGetters: {
    from: StyleGetters;
    model: VisibilityModel;
    getters: StyleGetters;
  } | null = null;
  // The last marks `pointMarks` built, with the plot slots and the selection
  // and highlight they were built for.
  private _pointMarks: {
    proteinIds: readonly string[];
    originalIndices: Int32Array | null;
    selected: string[];
    highlighted: string[];
    marks: PointMarks;
  } | null = null;
  // The last lasso or brush selection with its mark per protein index, built
  // from its slots (`selectSlots`).
  private _slotSelection: VisibilityInputs['selectionMask'] = null;
  // Never cleared on a mapping change (unlike `_styleGetters`): the key covers
  // every input of the model, and the mappings, the "Other" values and the
  // point size are not among them.
  private _visibilityModel: VisibilityModel | null = null;
  private _visibilityModelKey: VisibilityModelMemoKey | null = null;
  // Which slots are INTERACTIVE (opacityOf > 0), how many, and their ids: the
  // point-count label, provenance and the point grid's marks share this one
  // pass. Keyed on the visibility model's `interactivityKey`, which a selection
  // changes only while some opacity tier is 0 (a configured fadedOpacity of 0
  // makes non-selected points non-interactive). Plot data is keyed by
  // (originalIndices ref + length), NOT the container ref: a projection switch
  // clones the plot data (new container, same originalIndices) and must reuse
  // the slots since interactivity is independent of x/y coordinates.
  private _interactable: InteractableSlots | null = null;
  // Cancels the pending idle build of the protein id index (`scheduleIdIndex`).
  private _cancelIdIndex: (() => void) | null = null;

  constructor(private readonly host: PointStyleHost) {}

  /**
   * The shared point-visibility model, the single opacity authority.
   *
   * Pull-based on purpose (design D1): isolation, reset and the numeric-rebin
   * frame rebuild the plot data outside the Lit cycle, and pinned tests drive
   * unattached elements where the lifecycle never runs, so a model recomputed
   * by the lifecycle would be stale there. It is memoized purely on input
   * identity instead: the materialized data, `selectedAnnotation`, the
   * `hiddenAnnotationValues` ref, the selection and highlight refs,
   * `eatOverlayEnabled`, the shift-focus values ref, and the three opacity
   * numbers (taken as numbers because the merged config is rebuilt on
   * unrelated changes such as width/height/margin).
   *
   * Two-level: on a miss the previous model goes to `computeVisibilityModel`,
   * which reuses the O(N) hidden mask when (data, selectedAnnotation, hidden
   * ref) are unchanged, so selection, highlight and opacity changes never redo
   * the mask pass. Isolation is NOT an input: it culls the plot data upstream.
   */
  model(): VisibilityModel {
    const host = this.host;
    // The data `build` styles, so the getters and hit-testing share one model.
    const data = host.data();
    const { baseOpacity, selectedOpacity, fadedOpacity } = host.config();
    const selectedAnnotation = host.selectedAnnotation();
    const hiddenAnnotationValues = host.hiddenAnnotationValues();
    const selectedProteinIds = host.selectedProteinIds();
    const highlightedProteinIds = host.highlightedProteinIds();
    const eatOverlayEnabled = host.eatOverlayEnabled();
    const focusedValues = host.focusedValues();

    const key = this._visibilityModelKey;
    if (
      this._visibilityModel &&
      key &&
      key.data === data &&
      key.selectedAnnotation === selectedAnnotation &&
      key.hiddenAnnotationValues === hiddenAnnotationValues &&
      key.selectedProteinIds === selectedProteinIds &&
      key.highlightedProteinIds === highlightedProteinIds &&
      key.baseOpacity === baseOpacity &&
      key.selectedOpacity === selectedOpacity &&
      key.fadedOpacity === fadedOpacity &&
      key.eatOverlayEnabled === eatOverlayEnabled &&
      key.focusedValues === focusedValues
    ) {
      return this._visibilityModel;
    }

    const model = computeVisibilityModel(
      {
        data,
        selectedAnnotation,
        hiddenAnnotationValues,
        selectedProteinIds,
        highlightedProteinIds,
        opacities: { base: baseOpacity, selected: selectedOpacity, faded: fadedOpacity },
        focusedValues,
        selectionMask: this._slotSelection,
      },
      this._visibilityModel ?? undefined,
    );

    this._visibilityModel = model;
    this._visibilityModelKey = {
      data,
      selectedAnnotation,
      hiddenAnnotationValues,
      selectedProteinIds,
      highlightedProteinIds,
      baseOpacity,
      selectedOpacity,
      fadedOpacity,
      eatOverlayEnabled,
      focusedValues,
    };
    return model;
  }

  /**
   * Build the protein id index of a new dataset while the main thread is idle,
   * so neither the first render nor the first selection waits for it (~22 ms
   * and 4 MB at 573K). If an id repeats, tell the host.
   */
  scheduleIdIndex() {
    this._cancelIdIndex?.();
    this._cancelIdIndex = whenIdle(() => {
      this._cancelIdIndex = null;
      if (!this.model().idsUnique()) this.host.onIdsRepeat();
    });
  }

  cancelIdIndex() {
    this._cancelIdIndex?.();
    this._cancelIdIndex = null;
  }

  /**
   * The interactive slots of `pd`, marked 1 in `visible`, their count, and
   * their ids. Whichever of the point-count label and the point grid's marking
   * runs first pays for the pass. `visible` is shared with the point grid, so
   * it is never written after.
   */
  interactable(pd: PlotData): InteractableSlots {
    const current = this.currentInteractable(pd);
    if (current) return current;
    const model = this.model();
    const oi = pd.originalIndices;
    const proteinIds = pd.proteinIds;
    const visible = new Uint8Array(pd.length);
    let count = 0;
    for (let s = 0; s < pd.length; s++) {
      const origIdx = oi ? oi[s] : s;
      // isInteractive: opacityOf(point) > 0.
      if (model.opacityAt(origIdx, proteinIds[origIdx]) > 0) {
        visible[s] = 1;
        count++;
      }
    }
    let ids: Set<string> | null = null;
    this._interactable = {
      originalIndices: oi,
      length: pd.length,
      interactivityKey: model.interactivityKey,
      visible,
      count,
      ids() {
        if (ids) return ids;
        ids = new Set();
        for (let s = 0; s < visible.length; s++) {
          if (visible[s] === 1) ids.add(proteinIds[oi ? oi[s] : s]);
        }
        return ids;
      },
    };
    return this._interactable;
  }

  /**
   * The last `interactable` slots if they mark the slots of `pd` under the
   * current visibility. Under the default all-positive tiers, connector-owned
   * highlights keep them.
   */
  currentInteractable(pd: PlotData): InteractableSlots | null {
    const slots = this._interactable;
    return slots &&
      slots.originalIndices === pd.originalIndices &&
      slots.length === pd.length &&
      slots.interactivityKey === this.model().interactivityKey
      ? slots
      : null;
  }

  /**
   * The protein ids of the interactive points among `slots` of `pd`, in one
   * pass. Reads the interactable slots instead of asking the model per hit,
   * which at ~190K lassoed points of the 573K dataset took ~8 ms. Also keeps
   * their mark per protein index, so the selection the ids come back as is
   * marked without looking each one up (~12 ms at ~190K).
   */
  selectSlots(pd: PlotData, slots: number[]): string[] {
    const oi = pd.originalIndices;
    const { visible } = this.interactable(pd);
    const ids: string[] = [];
    const mask = new Uint8Array(pd.proteinIds.length);
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (visible[s] !== 1) continue;
      const origIdx = oi ? oi[s] : s;
      ids.push(pd.proteinIds[origIdx]);
      mask[origIdx] = 1;
    }
    this._slotSelection = { ids, proteinIds: pd.proteinIds, mask };
    return ids;
  }

  /** The style getters for the current data and visual state, which an export stages. */
  getters(): StyleGetters {
    if (!this._styleGetters) {
      this._styleGetters = this.build();
    }
    return this._styleGetters;
  }

  /** Build the getters again on their next use. */
  invalidateGetters() {
    this._styleGetters = null;
  }

  /** Build the getters again now. */
  refreshGetters() {
    this._styleGetters = this.build();
  }

  /**
   * Whether the renderer draws the selection and highlight as marks on the GPU
   * (`pointMarks`) rather than staging them: not while focus fades points by
   * category, nor with opacities the marks cannot draw as staging does, nor
   * while the renderer cannot draw marks for the dataset.
   */
  marksOnGpu(): boolean {
    return (
      this.host.focusedValues() === null &&
      this.getters().canMarkOnGpu() &&
      this.host.canDrawMarks()
    );
  }

  /** The visibility model the live view stages: with nothing marked while the GPU draws the marks. */
  stageModel(): VisibilityModel {
    const model = this.model();
    return this.marksOnGpu() ? model.unmarked : model;
  }

  /** The style getters the live view stages, over {@link stageModel}. */
  stageGetters(): StyleGetters {
    const getters = this.getters();
    if (!this.marksOnGpu()) {
      this._unmarkedGetters = null;
      return getters;
    }
    const model = this.model().unmarked;
    const cached = this._unmarkedGetters;
    if (cached?.from === getters && cached.model === model) return cached.getters;
    this._unmarkedGetters = { from: getters, model, getters: this.build(model) };
    return this._unmarkedGetters.getters;
  }

  /**
   * The selection and highlight as marks over the points of `pd`, for the
   * renderer to draw on the GPU; null while they are staged instead, or while
   * nothing is marked. Built once per change of either.
   */
  pointMarks(pd: PlotData): PointMarks | null {
    const model = this.marksOnGpu() ? this.model() : null;
    const opacities = model?.marks;
    if (!model || !opacities) {
      this._pointMarks = null;
      return null;
    }
    const selected = this.host.selectedProteinIds();
    const highlighted = this.host.highlightedProteinIds();
    const cached = this._pointMarks;
    if (
      cached &&
      cached.proteinIds === pd.proteinIds &&
      cached.originalIndices === pd.originalIndices &&
      cached.marks.slots.length === pd.length &&
      cached.selected === selected &&
      cached.highlighted === highlighted &&
      cached.marks.marked === opacities.marked &&
      cached.marks.unmarked === opacities.unmarked
    ) {
      return cached.marks;
    }
    const slots = model.markedSlots(pd.proteinIds, pd.originalIndices, pd.length);
    const marks = { slots, ...opacities };
    this._pointMarks = {
      proteinIds: pd.proteinIds,
      originalIndices: pd.originalIndices,
      selected,
      highlighted,
      marks,
    };
    return marks;
  }

  /** Drop the unmarked getters and the last marks, which hold the data they were built over. */
  clearMarks() {
    this._unmarkedGetters = null;
    this._pointMarks = null;
    this._slotSelection = null;
  }

  /** Build style getters for the current data and visual state. */
  private build(model: VisibilityModel = this.model()): StyleGetters {
    const host = this.host;
    const data = host.data();
    const config = host.config();
    return createStyleGetters(
      data,
      {
        selectedProteinIds: host.selectedProteinIds(),
        highlightedProteinIds: host.highlightedProteinIds(),
        selectedAnnotation: host.selectedAnnotation(),
        hiddenAnnotationValues: host.hiddenAnnotationValues(),
        otherAnnotationValues: host.otherAnnotationValues(),
        zOrderMapping: host.zOrderMapping(),
        colorMapping: host.colorMapping(),
        shapeMapping: host.shapeMapping(),
        sizes: {
          base: config.pointSize,
        },
        opacities: {
          base: config.baseOpacity,
          selected: config.selectedOpacity,
          faded: config.fadedOpacity,
        },
        eatOverlayEnabled: host.eatOverlayEnabled(),
      },
      model,
    );
  }
}
