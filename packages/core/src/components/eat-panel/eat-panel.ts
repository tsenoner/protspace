import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import {
  annotationLabel,
  DEFAULT_EAT_RELIABILITY,
  formatCount,
  isSameReliability,
  normalizeReliability,
  type EatReliabilityState,
  type VisualizationData,
} from '@protspace/utils';
import { customElement } from '../../utils/safe-custom-element';
import '../kit/switch';
import { formatPercent } from '../query-builder/eat-reliability';
import {
  renderBreakdown,
  renderEmptyColorBy,
  renderOtherAnnotations,
  type EatLabelSort,
} from './eat-panel-breakdown';
import { renderReliability } from './eat-panel-histogram';
import { eatPanelStyles } from './eat-panel.styles';
import {
  EatReliabilityController,
  type EatOverlayChangeDetail,
} from './eat-reliability-controller';
import { getEatIndex, summarizeEat, type EatIndex, type EatSummary } from './eat-summary';

const DEFAULTS = normalizeReliability(DEFAULT_EAT_RELIABILITY);

/** `40 %` of `total`, for a segment's tooltip. */
const share = (count: number, total: number) => formatPercent(total > 0 ? count / total : 0);

/**
 * The EAT panel: every control for the transferred annotations of the Color by annotation. It owns
 * the reliability state and reports it; the app applies it to the plot and the filter. The host
 * draws the header (`EAT · <annotation>`, info, Reset with `reset()`, Close) in its own row.
 *
 * Numbers come from `eat-summary.ts`. Nothing is computed while `active` is false: the index builds
 * on first show, and a hidden panel's summary is not recomputed when the threshold or context moves.
 *
 * @fires eat-overlay-change - `EatOverlayChangeDetail`: the Show switch or the reliability filter
 *   changed (a handle drag commits after `EAT_THRESHOLD_COMMIT_DELAY_MS`).
 * @fires eat-color-by - `{ annotation }`: switch Color by to another annotation with predictions,
 *   or to this one's EAT neighbourhood column.
 */
@customElement('protspace-eat-panel')
export class ProtspaceEatPanel extends LitElement {
  static styles = eatPanelStyles;

  /** The plot's raw data. */
  @property({ attribute: false }) data: VisualizationData | null = null;
  /** The Color by annotation's key. */
  @property({ type: String }) annotation = '';
  /** Proteins that pass every other filter condition (Decision 9); null = every protein. */
  @property({ attribute: false }) context: Uint8Array | null = null;
  /** Label → swatch colour, as the legend draws it. */
  @property({ attribute: false }) labelColors: ReadonlyMap<string, string> = new Map();
  /** Whether the panel is shown. It computes only while true. */
  @property({ type: Boolean }) active = false;

  @state() private _labelSort: EatLabelSort = 'most-predicted';
  @state() private _showAllLabels = false;
  @state() private _othersOpen = false;

  private readonly _eat = new EatReliabilityController(this, {
    emit: (detail) =>
      this.dispatchEvent(
        new CustomEvent<EatOverlayChangeDetail>('eat-overlay-change', {
          detail,
          bubbles: true,
          composed: true,
        }),
      ),
  });

  /** What the index was built for; `undefined` until the first active update. */
  private _indexData: VisualizationData | null | undefined = undefined;
  private _indexAnnotation = '';
  private _index: EatIndex | null = null;
  private _summary: EatSummary | null = null;
  private _summaryState: EatReliabilityState | null = null;
  private _summaryContext: Uint8Array | null = null;

  get reliability(): EatReliabilityState {
    return this._eat.reliability;
  }

  get overlayEnabled(): boolean {
    return this._eat.overlayEnabled;
  }

  /** The lower bound, which is what a bundle stores. */
  get reliabilityThreshold(): number {
    return this._eat.reliability.min;
  }

  /** Show on and the filter keeping everything: Reset has nothing to do, the rail shows no dot. */
  get isAtDefaults(): boolean {
    return this._eat.overlayEnabled && isSameReliability(this._eat.reliability, DEFAULTS);
  }

  /** Bundle restore: Show plus "Keep ≥ threshold". Emits once. */
  applyEatSettings(enabled: boolean, threshold: number): void {
    this._eat.applySettings(enabled, threshold);
  }

  /** Follow the applied filter without emitting, so the filter → panel direction cannot loop. */
  setReliabilityState(state: EatReliabilityState): void {
    this._eat.mirror(state);
  }

  /** Back to the defaults (Show on, keep everything). Emits once. */
  reset(): void {
    this._eat.mirror(DEFAULTS);
    this._eat.setOverlayEnabled(true);
  }

  /** Back to the defaults for a dataset that has just loaded. Never emits. */
  resetForNewDataset(): void {
    this._eat.mirror(DEFAULTS);
    this._eat.mirrorOverlayEnabled(true);
  }

  protected willUpdate(): void {
    if (!this.active) return;
    if (this.data !== this._indexData || this.annotation !== this._indexAnnotation) {
      this._indexData = this.data;
      this._indexAnnotation = this.annotation;
      this._index = this.data ? getEatIndex(this.data, this.annotation) : null;
      this._summary = null;
      this._showAllLabels = false;
    }
    if (!this._index) {
      this._summary = null;
      return;
    }
    const state = this._eat.reliability;
    if (
      this._summary &&
      this._summaryContext === this.context &&
      this._summaryState &&
      isSameReliability(this._summaryState, state)
    ) {
      return;
    }
    this._summary = summarizeEat(this._index, state, this.context);
    this._summaryState = state;
    this._summaryContext = this.context;
  }

  render() {
    if (!this.active) return nothing;
    if (this.data && !this._index) {
      const label = annotationLabel(this.annotation, this.data.annotations[this.annotation]);
      return html`<p class="eat-empty">${label} has no predicted values.</p>
        ${renderEmptyColorBy(this.data, this.annotation, this._colorBy)}`;
    }
    const summary = this._summary;
    return html`<ps-switch
        class="eat-show"
        .checked=${this._eat.overlayEnabled}
        ?disabled=${!summary}
        @change=${this._eat.onToggle}
        >Show predictions</ps-switch
      >
      ${this._renderOverview(summary)} ${renderReliability(this._eat, summary)}
      ${summary
        ? renderBreakdown({
            rows: summary.rows,
            sort: this._labelSort,
            showAll: this._showAllLabels,
            labelColors: this.labelColors,
            off: !this._eat.overlayEnabled,
            onSort: (sort) => (this._labelSort = sort),
            onShowAll: () => (this._showAllLabels = true),
          })
        : nothing}
      ${this.data
        ? renderOtherAnnotations({
            data: this.data,
            annotation: this.annotation,
            open: this._othersOpen,
            onToggle: (open) => (this._othersOpen = open),
            onColorBy: this._colorBy,
          })
        : nothing}`;
  }

  private readonly _colorBy = (annotation: string) => {
    this.dispatchEvent(
      new CustomEvent('eat-color-by', { detail: { annotation }, bubbles: true, composed: true }),
    );
  };

  /** The stacked bar and its numbers (proposal B §4.3). `summary` null is the skeleton. */
  private _renderOverview(summary: EatSummary | null): TemplateResult {
    if (!summary) {
      return html`<div class="eat-overview" aria-busy="true">
        <div class="eat-stack"></div>
      </div>`;
    }
    const enabled = this._eat.overlayEnabled;
    const { inView, curated, predicted, kept, below, none } = summary;
    const segment = (part: string, name: string, count: number) =>
      count > 0
        ? html`<span
            class="eat-segment"
            data-part=${part}
            style=${`flex-grow:${count}`}
            title=${`${name}: ${formatCount(count)} (${share(count, inView)})`}
          ></span>`
        : nothing;
    const counts = enabled
      ? `${formatCount(curated)} curated · ${formatCount(predicted)} predicted (${formatCount(kept)} kept) · ${formatCount(none)} none`
      : `${formatCount(curated)} curated · ${formatCount(predicted)} predicted (hidden)`;
    return html`<div class="eat-overview" aria-disabled=${enabled ? nothing : 'true'}>
      <div class="eat-stack">
        ${segment('curated', 'Curated', curated)} ${segment('kept', 'Predicted, kept', kept)}
        ${segment('below', 'Predicted, below threshold', below)}
        ${segment('none', 'No value', none)}
      </div>
      <p class="eat-counts">${counts}</p>
      ${this.context && this._index
        ? html`<p class="eat-in-view">
            In view: ${formatCount(inView)} of ${formatCount(this._index.total)}
          </p>`
        : nothing}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-eat-panel': ProtspaceEatPanel;
  }
}
