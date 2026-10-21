import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import {
  annotationLabel,
  DEFAULT_EAT_RELIABILITY,
  fileNamePart,
  formatCount,
  isSameReliability,
  normalizeReliability,
  type EatReliabilityState,
  type VisualizationData,
} from '@protspace/utils';
import { customElement } from '../../utils/safe-custom-element';
import '../kit/menu';
import '../kit/select';
import '../kit/switch';
import type { PsSelect } from '../kit/select';
import type { PsSwitch } from '../kit/switch';
import { formatPercent } from '../query-builder/eat-reliability';
import {
  renderBreakdown,
  renderEmptyColorBy,
  renderOtherAnnotations,
  swatchColor,
  type EatLabelSort,
} from './eat-panel-breakdown';
import { cardFacts, renderCard, type EatCardFacts } from './eat-panel-card';
import { binRange, renderReliability } from './eat-panel-histogram';
import { eatPanelStyles } from './eat-panel.styles';
import {
  EatReliabilityController,
  type EatOverlayChangeDetail,
} from './eat-reliability-controller';
import {
  countIn,
  getEatIndex,
  isKept,
  labelsAt,
  predictionIds,
  summarizeEat,
  weakestIn,
  type EatDrill,
  type EatIndex,
  type EatSummary,
} from './eat-summary';

const DEFAULTS = normalizeReliability(DEFAULT_EAT_RELIABILITY);

/** The open drill-down list: a histogram bar's, or a label's (by name, as rows re-sort). */
type OpenDrill = { bin: number } | { label: string };

/** The open Export IDs menu: its trigger, and the bar or label it is scoped to (null: all). */
type ExportMenu = { anchor: HTMLElement; drill: EatDrill | null };

/** How many of a source's lines are drawn (Decision 7). */
type LinesPerSource = 10 | 20 | 50;
const DEFAULT_LINES_PER_SOURCE: LinesPerSource = 20;
const LINES_OPTIONS = [10, 20, 50].map((n) => ({ value: String(n), label: String(n) }));

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
 * @fires eat-select-proteins - `{ proteinIds, zoom }`: a drill-down row selects its protein (and
 *   asks to fit it); `Select all N kept` selects the kept predictions behind the bar or label.
 * @fires eat-go-to-source - `{ targetId, targetIndex, sourceId }`: the card's Go to source.
 * @fires eat-trace-source - `{ sourceId, sourceIndex }`: the card's `lent its label to N` link
 *   draws that source's lines.
 * @fires eat-drawing-change - `{ trace, linesPerSource }`: a Drawing switch changed, or Reset
 *   moved one back to its default.
 * @fires eat-export-ids - `{ proteinIds, fileName }`: Export IDs, the kept or the below-threshold
 *   predictions in the context (or behind a drill-down's bar or label), in reliability order.
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
  /** The single selected protein's index, for the card; null with none or several selected. */
  @property({ attribute: false }) focusProtein: number | null = null;
  /** Whether the panel is shown. It computes only while true. */
  @property({ type: Boolean }) active = false;

  @state() private _trace = true;
  @state() private _linesPerSource: LinesPerSource = DEFAULT_LINES_PER_SOURCE;
  @state() private _labelSort: EatLabelSort = 'most-predicted';
  @state() private _showAllLabels = false;
  @state() private _othersOpen = false;
  @state() private _drill: OpenDrill | null = null;
  @state() private _exportMenu: ExportMenu | null = null;
  /** The last opened menu's scope; the menu closes before it reports the pick. */
  private _exportDrill: EatDrill | null = null;
  /** The histogram bar holding the bar group's one tab stop. */
  @state() private _focusBin = 0;

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
  /** The card's threshold-free facts, kept across renders while the index and protein stay. */
  private _card: { index: EatIndex; protein: number; facts: EatCardFacts } | null = null;

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

  /**
   * Show on, the filter keeping everything and the Drawing switches at their defaults: Reset has
   * nothing to do, the rail shows no dot.
   */
  get isAtDefaults(): boolean {
    return (
      this._eat.overlayEnabled &&
      isSameReliability(this._eat.reliability, DEFAULTS) &&
      this._trace &&
      this._linesPerSource === DEFAULT_LINES_PER_SOURCE
    );
  }

  /** Bundle restore: Show plus "Keep ≥ threshold". Emits once. */
  applyEatSettings(enabled: boolean, threshold: number): void {
    this._eat.applySettings(enabled, threshold);
  }

  /** Follow the applied filter without emitting, so the filter → panel direction cannot loop. */
  setReliabilityState(state: EatReliabilityState): void {
    this._eat.mirror(state);
  }

  /**
   * Back to the defaults (Show on, keep everything, trace on, 20 lines). Emits
   * `eat-overlay-change` once, and `eat-drawing-change` when a Drawing switch moved.
   */
  reset(): void {
    if (!this._trace || this._linesPerSource !== DEFAULT_LINES_PER_SOURCE) {
      this._setDrawing(true, DEFAULT_LINES_PER_SOURCE);
    }
    this._eat.mirror(DEFAULTS);
    this._eat.setOverlayEnabled(true);
  }

  /**
   * Back to the defaults for a dataset that has just loaded. Never emits. The Drawing switches are
   * how the user likes lines drawn, not a property of the data, so they stay.
   */
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
      this._drill = null;
      this._exportMenu = null;
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
    this._dropStaleDrill(this._summary);
  }

  /**
   * A list whose bin emptied, or whose label left the view or has no prediction left in it (a
   * context change), closes.
   */
  private _dropStaleDrill(summary: EatSummary): void {
    const drill = this._drill;
    if (!drill) return;
    const stale =
      'bin' in drill
        ? !summary.bins[drill.bin]
        : !summary.rows.some((row) => row.label === drill.label && row.kept + row.below > 0);
    if (stale) this._drill = null;
  }

  protected updated(): void {
    // A drill-down's menu goes with its list (closed, or dropped as stale).
    if (this._exportMenu && !this._exportMenu.anchor.isConnected) this._exportMenu = null;
  }

  private _cardFacts(index: EatIndex, data: VisualizationData, protein: number): EatCardFacts {
    const cached = this._card;
    if (cached?.index === index && cached.protein === protein) return cached.facts;
    const facts = cardFacts(data, this.annotation, index, protein);
    this._card = { index, protein, facts };
    return facts;
  }

  render() {
    if (!this.active) return nothing;
    if (this.data && !this._index) {
      const label = annotationLabel(this.annotation, this.data.annotations[this.annotation]);
      return html`<p class="eat-empty">${label} has no predicted values.</p>
        ${renderEmptyColorBy(this.data, this.annotation, this._colorBy)}`;
    }
    const summary = this._summary;
    const drill = this._drill;
    return html`<ps-switch
        class="eat-show"
        .checked=${this._eat.overlayEnabled}
        ?disabled=${!summary}
        @change=${this._eat.onToggle}
        >Show predictions</ps-switch
      >
      ${this._renderOverview(summary)}
      ${renderReliability(this._eat, summary, this._renderExportButton(null), {
        openBin: drill && 'bin' in drill ? drill.bin : null,
        focusBin: this._focusBin,
        list: drill && 'bin' in drill ? this._renderDrill() : nothing,
        onBar: (bin) => {
          this._focusBin = bin;
          this._toggleDrill({ bin });
        },
        onFocusBin: (bin) => {
          this._focusBin = bin;
          void this.updateComplete.then(() => this._bar(bin)?.focus());
        },
      })}
      ${this._renderDrawing()}
      ${this._index && this.data && this.focusProtein !== null
        ? renderCard({
            data: this.data,
            annotation: this.annotation,
            index: this._index,
            protein: this.focusProtein,
            facts: this._cardFacts(this._index, this.data, this.focusProtein),
            labelColors: this.labelColors,
            onGoToSource: (detail) => this._emit('eat-go-to-source', detail),
            onTraceSource: (detail) => this._emit('eat-trace-source', detail),
          })
        : nothing}
      ${summary
        ? renderBreakdown({
            rows: summary.rows,
            sort: this._labelSort,
            showAll: this._showAllLabels,
            labelColors: this.labelColors,
            off: !this._eat.overlayEnabled,
            openLabel: drill && 'label' in drill ? drill.label : null,
            list: drill && 'label' in drill ? this._renderDrill() : nothing,
            onSort: (sort) => (this._labelSort = sort),
            onShowAll: () => (this._showAllLabels = true),
            onRow: (label) => this._toggleDrill({ label }),
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
        : nothing}
      ${this._renderExportMenu(summary)}`;
  }

  /** `Export IDs`: opens the menu for the whole context (`drill` null) or one bar or label. */
  private _renderExportButton(drill: EatDrill | null): TemplateResult {
    return html`<button
      type="button"
      class="eat-export"
      @click=${(event: Event) => {
        const anchor = event.currentTarget as HTMLElement;
        this._exportDrill = drill;
        this._exportMenu = this._exportMenu?.anchor === anchor ? null : { anchor, drill };
      }}
    >
      Export IDs
    </button>`;
  }

  /** The one Export IDs menu, at whichever trigger opened it. */
  private _renderExportMenu(summary: EatSummary | null): TemplateResult | typeof nothing {
    const menu = this._exportMenu;
    const index = this._index;
    let kept = 0;
    let below = 0;
    if (menu && index && summary) {
      if (menu.drill) {
        const counts = countIn(index, menu.drill, this.context, this._eat.reliability);
        kept = counts.kept;
        below = counts.total - counts.kept;
      } else {
        ({ kept, below } = summary);
      }
    }
    return html`<ps-menu
      label="Export IDs"
      .anchor=${menu?.anchor ?? null}
      .open=${menu !== null}
      @ps-select=${(event: Event) => {
        event.stopPropagation();
        this._exportIds((event as CustomEvent<{ value: 'kept' | 'below' }>).detail.value);
      }}
      @ps-close=${(event: Event) => {
        event.stopPropagation();
        this._exportMenu = null;
      }}
    >
      <ps-menu-item value="kept" ?disabled=${kept === 0}
        >Kept predictions (${formatCount(kept)})</ps-menu-item
      >
      <ps-menu-item value="below" ?disabled=${below === 0}
        >Below threshold (${formatCount(below)})</ps-menu-item
      >
    </ps-menu>`;
  }

  /** One ID per line, named `<annotation>-eat-kept-ids.txt` or `…-below-ids.txt` (Decision 12). */
  private _exportIds(which: 'kept' | 'below'): void {
    const index = this._index;
    const data = this.data;
    this._exportMenu = null;
    if (!index || !data) return;
    const proteinIds = predictionIds(
      index,
      data,
      this._eat.reliability,
      which,
      this.context,
      this._exportDrill ?? undefined,
    );
    this._emit('eat-export-ids', {
      proteinIds,
      fileName: `${fileNamePart(this.annotation)}-eat-${which}-ids.txt`,
    });
  }

  constructor() {
    super();
    // Escape inside the panel closes the open list first, and focus goes back to its opener. A
    // list that is not on screen (its row sorted away) is dropped without claiming the key, so
    // Escape still reaches the selection and connector fallbacks.
    this.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !this._drill) return;
      const opener = this._opener(this._drill);
      const shown = this.renderRoot.querySelector('#eat-drill');
      this._drill = null;
      if (!opener || !shown) return;
      event.preventDefault();
      void this.updateComplete.then(() => opener.focus());
    });
  }

  /** Opens `next`, or closes it when it is the open list; one list is open at a time. */
  private _toggleDrill(next: OpenDrill): void {
    const open = this._drill;
    const same =
      open !== null &&
      ('bin' in next
        ? 'bin' in open && open.bin === next.bin
        : 'label' in open && open.label === next.label);
    this._drill = same ? null : next;
  }

  private _bar(bin: number): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>(`.eat-bar[data-bin="${bin}"]`);
  }

  private _opener(drill: OpenDrill): HTMLElement | null {
    if ('bin' in drill) return this._bar(drill.bin);
    const rows = this.renderRoot.querySelectorAll<HTMLElement>('.eat-label-row');
    return Array.from(rows).find((row) => row.dataset.label === drill.label) ?? null;
  }

  /** Trace source on click and Lines per source (proposal B §4.5, minus rings: Decision 8). */
  private _renderDrawing(): TemplateResult {
    return html`<section class="eat-drawing" aria-label="Drawing">
      <h4 class="eat-heading">Drawing</h4>
      <ps-switch
        class="eat-trace"
        .checked=${this._trace}
        @change=${(event: Event) =>
          this._setDrawing((event.currentTarget as PsSwitch).checked, this._linesPerSource)}
        >Trace source on click</ps-switch
      >
      <div class="eat-lines-row">
        <span aria-hidden="true">Lines per source</span>
        <ps-select
          size="sm"
          label="Lines per source"
          .options=${LINES_OPTIONS}
          .value=${String(this._linesPerSource)}
          @change=${(event: Event) =>
            this._setDrawing(
              this._trace,
              Number((event.currentTarget as PsSelect).value) as LinesPerSource,
            )}
        ></ps-select>
      </div>
    </section>`;
  }

  private _setDrawing(trace: boolean, linesPerSource: LinesPerSource): void {
    this._trace = trace;
    this._linesPerSource = linesPerSource;
    this._emit('eat-drawing-change', { trace, linesPerSource });
  }

  private _emit(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  private _selectProteins(proteinIds: string[], zoom: boolean): void {
    this._emit('eat-select-proteins', { proteinIds, zoom });
  }

  /**
   * The open list: its weakest 5 predictions in the context, weakest first, each a button that
   * selects the protein; then `Select all N kept` and `5 of 41`. In Hide mode, a row below the
   * threshold says so, and stays clickable.
   */
  private _renderDrill(): TemplateResult | typeof nothing {
    const index = this._index;
    const data = this.data;
    const open = this._drill;
    if (!index || !data || !open) return nothing;
    let drill: EatDrill;
    let heading: string;
    if ('bin' in open) {
      drill = { bin: open.bin };
      heading = `Weakest in ${binRange(open.bin)}`;
    } else {
      const label = index.labels.indexOf(open.label);
      if (label < 0) return nothing;
      drill = { label };
      heading = `Weakest ${open.label}`;
    }
    const state = this._eat.reliability;
    const weakest = weakestIn(index, drill, this.context);
    const { total, kept } = countIn(index, drill, this.context, state);
    const hides = this._eat.overlayEnabled;
    const rows = Array.from(weakest, (k) => {
      const confidence = index.confidence[k];
      const labels = labelsAt(index, k);
      const id = data.protein_ids[index.order[k]];
      const reliability = formatPercent(confidence);
      const hidden = hides && !isKept(state, confidence);
      const labelText = labels.join(', ');
      const color = swatchColor(this.labelColors, labels[0] ?? '');
      return html`<li>
        <button
          type="button"
          class="eat-drill-row"
          data-protein=${id}
          aria-label=${`${id}, ${reliability}, ${labelText}${hidden ? ', hidden by the threshold' : ''}`}
          @click=${() => this._selectProteins([id], true)}
        >
          <span
            class="eat-ring"
            style=${color ? `border-color:${color}` : nothing}
            aria-hidden="true"
          ></span>
          <span class="eat-drill-id">${id}</span>
          <span class="eat-drill-reliability">${reliability}</span>
          <span class="eat-drill-label" title=${labelText}>${labelText}</span>
          ${hidden ? html`<span class="eat-drill-hidden">Hidden by the threshold</span>` : nothing}
        </button>
      </li>`;
    });
    return html`<div id="eat-drill" class="eat-drill" role="region" aria-label=${heading}>
      <p class="eat-drill-heading">${heading}</p>
      <ul class="eat-drill-list">
        ${rows}
      </ul>
      <div class="eat-drill-foot">
        <button
          type="button"
          class="eat-drill-select"
          ?disabled=${kept === 0}
          @click=${() =>
            this._selectProteins(
              predictionIds(index, data, state, 'kept', this.context, drill),
              false,
            )}
        >
          Select all ${formatCount(kept)} kept
        </button>
        ${this._renderExportButton(drill)}
        <span class="eat-drill-count">${weakest.length} of ${formatCount(total)}</span>
      </div>
    </div>`;
  }

  private readonly _colorBy = (annotation: string) => this._emit('eat-color-by', { annotation });

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
    return html`<div class=${enabled ? 'eat-overview' : 'eat-overview is-off'}>
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
