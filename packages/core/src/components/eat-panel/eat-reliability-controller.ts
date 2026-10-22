import {
  html,
  type ReactiveController,
  type ReactiveControllerHost,
  type TemplateResult,
} from 'lit';
import {
  clampReliabilityBound,
  DEFAULT_EAT_RELIABILITY,
  isSameReliability,
  NEUTRAL_BOUND,
  normalizeReliability,
  RELIABILITY_BOUNDS,
  type EatReliabilityMode,
  type EatReliabilityState,
} from '@protspace/utils';
import type { PsSegmented } from '../kit/segmented';
import type { PsSwitch } from '../kit/switch';
import { formatPercent } from '../query-builder/eat-reliability';

/**
 * Debounce window (ms) for committing an EAT reliability slider drag. The slider's
 * visual value + percent readout update live on every tick, but the expensive
 * downstream apply (reliability query re-eval + geometry/point index rebuild at 570k
 * points) is deferred to a drag-pause/release so dragging stays smooth.
 */
export const EAT_THRESHOLD_COMMIT_DELAY_MS = 150;

/**
 * Smallest gap the two `between` thumbs may be dragged to. Doubles as the sliders'
 * `step`, so "one step apart" is literally true: the thumbs never occupy the same
 * pixel, where whichever sits on top would be the only one the pointer could reach.
 */
const EAT_BAND_MIN_GAP = 0.01;

/** How far Shift+Arrow moves a reliability handle. */
const EAT_SHIFT_STEP = 0.1;

/** Arrow keys and the direction each one steps a handle. */
const SHIFT_STEP_KEYS: Readonly<Record<string, 1 | -1>> = {
  ArrowRight: 1,
  ArrowUp: 1,
  ArrowLeft: -1,
  ArrowDown: -1,
};

/**
 * Which end of the reliability range a control edits. Deliberately the field name on
 * `EatReliabilityState`, so a bound indexes its own value, its own neutral position
 * (`NEUTRAL_BOUND`) and its own row in `RELIABILITY_BOUNDS` with no hand-written
 * lower/upper -> min/max mapping in between.
 */
type EatBound = 'min' | 'max';

const EAT_BOUNDS: readonly EatBound[] = ['min', 'max'];

function boundsForMode(mode: EatReliabilityMode): readonly EatBound[] {
  const uses = RELIABILITY_BOUNDS[mode];
  return EAT_BOUNDS.filter((bound) => uses[bound]);
}

/**
 * Which bounds each mode renders a thumb and a percent box for — derived from the
 * shared `RELIABILITY_BOUNDS` rather than restated, so the control cannot offer a
 * widget for a bound the filter ignores. `atMost` used to render the lower bound
 * anyway, disabled and stuck at 0: a dead slider and a dead number box taking up half
 * the control. Keyed by the mode union, so a fourth mode is a compile error here.
 */
const EAT_BOUNDS_FOR_MODE: Record<EatReliabilityMode, readonly EatBound[]> = {
  atLeast: boundsForMode('atLeast'),
  atMost: boundsForMode('atMost'),
  between: boundsForMode('between'),
};

/**
 * Per-bound identity and accessible names. `soloLabel` is what the slider is called
 * when its mode renders it alone — a single thumb is the filter's threshold, not one
 * end of a band.
 */
const EAT_BOUND_UI: Record<
  EatBound,
  { id: string; sliderLabel: string; soloLabel: string; percentLabel: string }
> = {
  min: {
    id: 'eat-reliability-threshold',
    sliderLabel: 'EAT reliability filter lower bound',
    soloLabel: 'EAT reliability filter threshold',
    percentLabel: 'EAT reliability filter percentage',
  },
  max: {
    id: 'eat-reliability-upper',
    sliderLabel: 'EAT reliability filter upper bound',
    soloLabel: 'EAT reliability filter upper bound',
    percentLabel: 'EAT reliability upper bound percentage',
  },
};

/** The `eat-overlay-change` detail the EAT panel dispatches. */
export interface EatOverlayChangeDetail {
  enabled: boolean;
  confidenceThreshold: number;
  reliability: EatReliabilityState;
}

/** What the controller tells its host, the EAT panel. */
interface EatControlsOptions {
  /** Dispatch `eat-overlay-change` from the host. */
  emit(detail: EatOverlayChangeDetail): void;
}

/**
 * The EAT overlay switch and the reliability filter's position, with the 150 ms commit of a
 * slider drag.
 *
 * The position is one value rather than a mode and two loose bounds (#380): `atLeast` hides
 * low-confidence predictions (the original, default behaviour); `atMost` hides high-confidence
 * ones, which is how you inspect what you would throw away; `between` isolates a band — the
 * mid-confidence transfers worth reviewing by hand. Curated proteins stay visible in all three.
 * The three are only ever written together, by `set`, so no reader reassembles them and no
 * writer has to remember all three.
 */
export class EatReliabilityController implements ReactiveController {
  private readonly host: ReactiveControllerHost;
  private readonly options: EatControlsOptions;
  private _reliability: EatReliabilityState = DEFAULT_EAT_RELIABILITY;
  private _overlayEnabled = true;
  private _commitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(host: ReactiveControllerHost, options: EatControlsOptions) {
    this.host = host;
    this.options = options;
    host.addController(this);
  }

  /** The reliability filter as the filter builder models it: a mode plus bounds. */
  get reliability(): EatReliabilityState {
    return this._reliability;
  }

  get overlayEnabled(): boolean {
    return this._overlayEnabled;
  }

  hostDisconnected(): void {
    // A drag left in flight must not emit after teardown.
    this.cancelCommit();
  }

  /**
   * Bundle restore: the saved overlay switch plus the saved reliability position.
   *
   * A bundle stores the LOWER bound only, so restoring it means "hide below x" — the
   * mode has to come along with it. Writing the bound into whatever mode the control
   * happens to be in loses it outright in `atMost` (normalization blanks the bound that
   * mode ignores, so a saved 60% restores as no filter) and reinterprets it in `between`
   * (a band against a stale upper bound). Both contradict the documented round trip,
   * which is that a bundle reopens on "Hide below" at the saved value.
   */
  applySettings(enabled: boolean, threshold: number): void {
    // A discrete apply supersedes any pending debounced threshold commit — cancel it
    // so it can't fire a stale late emit.
    this.cancelCommit();
    this._set({ mode: 'atLeast', min: threshold, max: NEUTRAL_BOUND.max });
    this.setOverlayEnabled(enabled);
  }

  /**
   * Publish the overlay switch. The switch still coalesces predictions into the base
   * annotation on the scatter plot; the reliability position only feeds the query
   * filter, so it rides the emit rather than being pushed onto the plot as a dimming
   * input.
   *
   * Separate from `applySettings` because the switch decides visibility and nothing
   * else. Routing it through the restore path made every toggle a bundle restore too,
   * which snapped the mode back to "Hide below" and dropped the bound with it — in
   * `atMost` the lower bound it round-tripped is 0, so flipping the switch off and on
   * silently cleared a "hide above 40%" filter.
   */
  setOverlayEnabled(enabled: boolean): void {
    this.mirrorOverlayEnabled(enabled);
    this._emit();
  }

  /** Set the switch without emitting: a reset. */
  mirrorOverlayEnabled(enabled: boolean): void {
    if (this._overlayEnabled === enabled) return;
    this._overlayEnabled = enabled;
    this.host.requestUpdate();
  }

  /**
   * Reverse mirror: set the control's position from the query filter WITHOUT
   * re-emitting `eat-overlay-change`, so the filter-controller->panel direction does not
   * loop back into the panel->filter-controller direction (#6b).
   *
   * Cancels any pending drag commit first: a discrete update from the query side
   * supersedes an in-flight drag, and leaving the timer armed let a stale late emit
   * overwrite what the user had just typed into the Filter builder (#380).
   */
  mirror(state: EatReliabilityState): void {
    this.cancelCommit();
    this._set(state);
  }

  /** Drop a pending threshold commit without emitting (an immediate apply supersedes it). */
  cancelCommit(): void {
    if (this._commitTimer !== null) {
      clearTimeout(this._commitTimer);
      this._commitTimer = null;
    }
  }

  /** Which bounds the selected mode filters on, and therefore which controls exist. */
  get activeBounds(): readonly EatBound[] {
    return EAT_BOUNDS_FOR_MODE[this._reliability.mode];
  }

  readonly onToggle = (event: Event): void => {
    // A discrete decision, like a mode change: it supersedes any pending drag commit.
    this.cancelCommit();
    this.setOverlayEnabled((event.currentTarget as PsSwitch).checked);
  };

  readonly onModeChange = (event: Event): void => {
    const mode = (event.currentTarget as PsSegmented).value as EatReliabilityMode;
    // `normalizeReliability` blanks the bound the new mode does not use, so switching
    // modes cannot leave a stale constraint applied from a side the user can no longer
    // see or edit.
    this._set({ ...this._reliability, mode });
    // A mode change is a discrete decision, not a drag — apply it immediately.
    this.cancelCommit();
    this._emit();
  };

  /** Slider release (@change): apply the pending threshold now, without waiting out the debounce. */
  readonly flushCommit = (): void => {
    if (this._commitTimer !== null) {
      clearTimeout(this._commitTimer);
      this._commitTimer = null;
      this._emit();
    }
  };

  onBoundInput(bound: EatBound, event: Event): void {
    const slider = event.currentTarget as HTMLInputElement;
    const applied = this._setBoundLive(bound, Number(slider.value));

    // Re-pin the slider when a clamp moved the value, or the thumb sails past its
    // neighbour on screen while the filter uses the clamped bound. Lit cannot do this
    // for us: a `.value` binding dirty-checks against the value Lit last committed, not
    // against the DOM, so once the clamp holds the state still the browser is free to
    // keep driving the input and Lit sees nothing to write. (`live()` is the idiomatic
    // fix, but this package externalizes only bare `lit`, so importing a directive
    // bundles a second lit-html copy — which fails at runtime with
    // `currentDirective._$initialize is not a function`.)
    const pinned = String(applied);
    if (slider.value !== pinned) slider.value = pinned;
  }

  /**
   * Shift+Arrow steps a handle by 10 %; a plain arrow keeps the slider's native 1 % step. Applied
   * at once, as the native arrow's `change` would be.
   */
  onBoundKeydown(bound: EatBound, event: KeyboardEvent): void {
    const direction = SHIFT_STEP_KEYS[event.key];
    if (!event.shiftKey || direction === undefined) return;
    event.preventDefault();
    const slider = event.currentTarget as HTMLInputElement;
    const applied = this._setBoundLive(
      bound,
      Math.round((this._reliability[bound] + direction * EAT_SHIFT_STEP) * 100) / 100,
    );
    slider.value = String(applied);
    this.flushCommit();
  }

  onPercentInput(bound: EatBound, event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const raw = input.value;
    // An emptied box reads as "no constraint on this side" — but it cannot be routed
    // through `clampReliabilityBound`'s non-finite fallback to say so, because a number
    // input reports an empty (or unparseable) field as `''` and `Number('')` is 0, not
    // NaN. On the UPPER bound that 0 is `confidence <= 0`, which hides every prediction:
    // the exact opposite of clearing the field.
    const empty = raw.trim() === '';
    const requested = empty ? NEUTRAL_BOUND[bound] : Number(raw) / 100;
    if (!Number.isFinite(requested)) return;

    const applied = this._setBoundLive(bound, requested);
    // Re-pin only when a clamp actually moved the value, for the reason the slider does:
    // a clamp that holds the state still leaves Lit's `.value` dirty-check nothing to
    // write, so the box would keep displaying a bound the filter is not using. A box the
    // user is still typing a valid number into is left alone, and so is an emptied one —
    // pinning that would type the neutral bound back in under them.
    if (empty || applied === requested) return;
    const pinned = String(Math.round(applied * 100));
    if (input.value !== pinned) input.value = pinned;
  }

  /**
   * The one writer for the reliability position, so the control and the query it
   * mirrors cannot disagree about what a state means. Every rule — clamping, blanking
   * the bound the mode ignores, ordering a crossed band — lives in the shared
   * `normalizeReliability`; the legend used to restate each of them by hand and had
   * already drifted (a band dragged past itself stayed crossed on screen while the
   * filter applied the ordered one).
   *
   * An update is requested only when the normalised position differs by value:
   * `normalizeReliability` always returns a fresh object, and re-normalising an unchanged
   * position must not re-render the whole panel.
   */
  private _set(state: EatReliabilityState): void {
    const next = normalizeReliability(state);
    const changed = !isSameReliability(next, this._reliability);
    this._reliability = next;
    if (changed) this.host.requestUpdate();
  }

  private _emit(): void {
    this.options.emit({
      enabled: this._overlayEnabled,
      confidenceThreshold: this._reliability.min,
      reliability: this._reliability,
    });
  }

  /**
   * Bound drag: update the slider's visual value immediately (thumb + percent
   * readout stay live), but debounce the expensive downstream apply — the
   * `eat-overlay-change` emit that re-runs the reliability query and rebuilds
   * geometry — to a drag-pause/release.
   */
  private _setBoundLive(bound: EatBound, value: number): number {
    // Each bound falls back to its own "constrains nothing" position, so a non-finite
    // value reads as no constraint on that side.
    const next = this._clampBandBound(bound, clampReliabilityBound(value, NEUTRAL_BOUND[bound]));
    // Through the one writer, so a live drag lands in the same canonical form as every
    // other path and what the thumbs settle on is the band the filter will apply.
    this._set({ ...this._reliability, [bound]: next });
    this._debounceCommit();
    // The bound the state actually settled on, so the caller pins its control onto the
    // value the filter will use. Not `next`: normalization runs after the band clamp and
    // can still move it (a band whose upper bound sits at 0 clamps the lower one to
    // -0.01, which `normalizeReliability` then pulls back to 0).
    return this._reliability[bound];
  }

  /**
   * On the shared `between` track a thumb stops at its neighbour instead of passing it.
   *
   * Two independent bars could cross, and the crossed pair was only put back in order
   * later, by `normalizeReliability` at commit time — so the bounds swapped under the
   * user's thumb, and which band they ended up with depended on whether they happened
   * to pause for the debounce mid-drag. On one track that would be visible nonsense:
   * the fill would invert. Stopping at the neighbour is what a range control does, and
   * it makes the crossed state unreachable rather than corrected after the fact.
   *
   * The bounds stop one step short of each other so the two thumbs can never land on
   * the same pixel, where the one on top would be the only one you could grab.
   */
  private _clampBandBound(bound: EatBound, value: number): number {
    const { mode, min, max } = this._reliability;
    if (mode !== 'between') return value;
    return bound === 'min'
      ? Math.min(value, max - EAT_BAND_MIN_GAP)
      : Math.max(value, min + EAT_BAND_MIN_GAP);
  }

  private _debounceCommit(): void {
    if (this._commitTimer !== null) {
      clearTimeout(this._commitTimer);
    }
    this._commitTimer = setTimeout(() => {
      this._commitTimer = null;
      this._emit();
    }, EAT_THRESHOLD_COMMIT_DELAY_MS);
  }
}

export function renderReliabilityRange(
  ctrl: EatReliabilityController,
  bound: EatBound,
  disabled: boolean,
): TemplateResult {
  const ui = EAT_BOUND_UI[bound];
  return html`
    <input
      id=${ui.id}
      type="range"
      min=${NEUTRAL_BOUND.min}
      max=${NEUTRAL_BOUND.max}
      step=${EAT_BAND_MIN_GAP}
      .value=${String(ctrl.reliability[bound])}
      ?disabled=${disabled}
      aria-label=${ctrl.activeBounds.length > 1 ? ui.sliderLabel : ui.soloLabel}
      aria-valuetext=${formatPercent(ctrl.reliability[bound])}
      @input=${(event: Event) => ctrl.onBoundInput(bound, event)}
      @keydown=${(event: KeyboardEvent) => ctrl.onBoundKeydown(bound, event)}
      @change=${ctrl.flushCommit}
    />
  `;
}

export function renderReliabilityPercent(
  ctrl: EatReliabilityController,
  bound: EatBound,
  disabled: boolean,
): TemplateResult {
  return html`
    <input
      class="eat-threshold-percent"
      type="number"
      min="0"
      max="100"
      step="1"
      .value=${String(Math.round(ctrl.reliability[bound] * 100))}
      ?disabled=${disabled}
      aria-label=${EAT_BOUND_UI[bound].percentLabel}
      @input=${(event: Event) => ctrl.onPercentInput(bound, event)}
      @change=${ctrl.flushCommit}
    />
  `;
}
