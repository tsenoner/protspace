import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import {
  annotationLabel,
  countNoun,
  DEFAULT_EAT_RELIABILITY,
  fileNamePart,
  formatCount,
  isSameReliability,
  type EatOutcome,
  type EatReliabilityInput,
  type EatReliabilityState,
  type VisualizationData,
} from '@protspace/utils';
import { customElement } from '../../utils/safe-custom-element';
import '../kit/button';
import { icon } from '../kit/icon';
import '../kit/menu';
import '../kit/segmented';
import '../kit/switch';
import type { PsSegmented, SegmentedOption } from '../kit/segmented';
import type { PsSwitch } from '../kit/switch';
import {
  formatPercent,
  formatReliabilityIn,
  rangeText,
  reliabilityLabel,
} from '../query-builder/eat-reliability';
import {
  DEFAULT_LABEL_SORT,
  renderBreakdown,
  renderEmptyColorBy,
  renderOtherAnnotations,
  shownLabels,
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

/** A reliability filter on another annotation than the one the panel shows. */
interface EatOtherFilter {
  /** The base annotation's key. */
  annotation: string;
  reliability: EatReliabilityState;
}

/** The open drill-down list: a histogram bar's, or a label's (by name, as rows re-sort). */
type OpenDrill = { bin: number } | { label: string };

/** The open Export IDs menu: its trigger, and the bar or label it is scoped to (null: all). */
type ExportMenu = { anchor: HTMLElement; drill: EatDrill | null };

/** How many of a source's lines are drawn (Decision 7). */
type LinesPerSource = 10 | 20 | 50;
const DEFAULT_LINES_PER_SOURCE: LinesPerSource = 20;
const LINES_OPTIONS: readonly LinesPerSource[] = [10, 20, 50];

const OUTCOME_OPTIONS: SegmentedOption[] = [
  { value: 'hide', label: 'Hide' },
  { value: 'dim', label: 'Fade' },
];
const OUTCOME_OPTIONS_OFF = OUTCOME_OPTIONS.map((option) => ({ ...option, disabled: true }));

/**
 * Scrolls `scroller` the least that shows all of `element`, as `block: 'nearest'` does, without
 * scrolling the page around it.
 */
function revealIn(scroller: HTMLElement, element: HTMLElement): void {
  const room = scroller.getBoundingClientRect();
  const box = element.getBoundingClientRect();
  if (box.top < room.top) scroller.scrollTop -= room.top - box.top;
  else if (box.bottom > room.bottom) {
    scroller.scrollTop += Math.min(box.bottom - room.bottom, box.top - room.top);
  }
}

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
 *   asks to fit it); `Select all N in range` selects the predictions in range behind the bar or label.
 * @fires eat-go-to-source - `{ targetId, targetIndex, sourceId }`: the strip's Go to source.
 * @fires eat-trace-source - `{ sourceId, sourceIndex }`: the strip's `source of N predictions`
 *   link draws that source's lines.
 * @fires eat-drawing-change - `{ trace, linesPerSource }`: a Drawing switch changed, or Reset
 *   moved one back to its default.
 * @fires eat-export-ids - `{ proteinIds, fileName }`: Export IDs, the predictions in range or those
 *   outside it in the context (or behind a drill-down's bar or label), in reliability order.
 * @fires eat-clear-filter - `{ annotation }`: Clear on the line about another annotation's
 *   reliability filter.
 * @fires eat-outcome-change - `{ outcome, reliability }`: Predictions outside the range switched
 *   between Hide (the filter) and Fade (`dim`: no filter). A range move in either rides `eat-overlay-change`.
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
  /**
   * Reliability filters still applied to other annotations (a Color by switch keeps them): each
   * gets a line saying so, with Clear.
   */
  @property({ attribute: false }) otherFilters: readonly EatOtherFilter[] = [];
  /** Whether the panel is shown. It computes only while true. */
  @property({ type: Boolean }) active = false;
  /**
   * The phone layout (the shell sets it from the layout mode): a 56 px histogram, and the
   * selected protein's strip in one row.
   */
  @property({ type: Boolean, reflect: true }) compact = false;

  @state() private _outcome: EatOutcome = 'hide';
  @state() private _trace = true;
  @state() private _linesPerSource: LinesPerSource = DEFAULT_LINES_PER_SOURCE;
  @state() private _labelSort: EatLabelSort = DEFAULT_LABEL_SORT;
  @state() private _showAllLabels = false;
  @state() private _othersOpen = false;
  @state() private _displayOpen = false;
  @state() private _drill: OpenDrill | null = null;
  @state() private _exportMenu: ExportMenu | null = null;
  /** The Sort trigger while the label Sort menu is open. */
  @state() private _sortMenu: HTMLElement | null = null;
  /** The lines-cap trigger while its menu is open. */
  @state() private _linesMenu: HTMLElement | null = null;
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

  /** Outside the range: `hide` filters those predictions out, `dim` fades them. */
  get outcome(): EatOutcome {
    return this._outcome;
  }

  /** The lower bound, which is what a bundle stores. */
  get reliabilityThreshold(): number {
    return this._eat.reliability.min;
  }

  /**
   * Show on, the filter keeping everything, Hide, and the Drawing switches at their defaults:
   * Reset has nothing to do, the rail shows no dot.
   */
  get isAtDefaults(): boolean {
    return (
      this._eat.overlayEnabled &&
      this._outcome === 'hide' &&
      reliabilityLabel(this._eat.reliability) === null &&
      this._trace &&
      this._linesPerSource === DEFAULT_LINES_PER_SOURCE
    );
  }

  /**
   * Bundle restore: Show plus the range `threshold..100 %`, as a filter (Hide) or faded (Dim).
   * Emits once.
   */
  applyEatSettings(enabled: boolean, threshold: number, outcome: EatOutcome = 'hide'): void {
    this._outcome = outcome;
    this._eat.applySettings(enabled, threshold);
  }

  /**
   * Follow the applied filter without emitting, so the filter → panel direction cannot loop. A
   * state that filters something came from a condition, which only Hide writes: the panel says Hide.
   */
  setReliabilityState(state: EatReliabilityInput): void {
    if (reliabilityLabel(state) !== null) this._outcome = 'hide';
    this._eat.mirror(state);
  }

  /**
   * Back to the defaults (Show on, keep everything, Hide, trace on, 20 lines). Emits
   * `eat-overlay-change` once, and `eat-drawing-change` when a Drawing switch moved.
   */
  reset(): void {
    this._outcome = 'hide';
    if (!this._trace || this._linesPerSource !== DEFAULT_LINES_PER_SOURCE) {
      this._setDrawing(true, DEFAULT_LINES_PER_SOURCE);
    }
    this._eat.mirror(DEFAULT_EAT_RELIABILITY);
    this._eat.setOverlayEnabled(true);
  }

  /**
   * Back to the defaults for a dataset that has just loaded. Never emits. The Drawing switches are
   * how the user likes lines drawn, not a property of the data, so they stay.
   */
  resetForNewDataset(): void {
    this._outcome = 'hide';
    this._eat.mirror(DEFAULT_EAT_RELIABILITY);
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
   * context change), closes; so does a label's list whose row the sort moved past the rows shown.
   */
  private _dropStaleDrill(summary: EatSummary): void {
    const drill = this._drill;
    if (!drill) return;
    const stale =
      'bin' in drill
        ? !summary.bins[drill.bin]
        : !summary.rows.some((row) => row.label === drill.label && row.kept + row.outside > 0) ||
          !shownLabels(summary.rows, this._labelSort, this._showAllLabels).includes(drill.label);
    if (stale) this._drill = null;
  }

  protected updated(): void {
    // A drill-down's menu goes with its list (closed, or dropped as stale).
    if (this._exportMenu && !this._exportMenu.anchor.isConnected) this._exportMenu = null;
    if (this._sortMenu && !this._sortMenu.isConnected) this._sortMenu = null;
    if (this._linesMenu && !this._linesMenu.isConnected) this._linesMenu = null;
    this._watchCard(this.renderRoot.querySelector<HTMLElement>('.eat-card'));
    this._wrapFacts();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._watchCard(null);
  }

  /** The strip, and what re-lays its lines of facts when its width changes. */
  private _cardWatch: { card: HTMLElement; observer: ResizeObserver } | null = null;

  private _watchCard(card: HTMLElement | null): void {
    if (this._cardWatch?.card === card) return;
    this._cardWatch?.observer.disconnect();
    this._cardWatch = null;
    if (!card) return;
    let width = card.clientWidth;
    // A frame later: re-laying the lines inside the callback would resize what it observes.
    const observer = new ResizeObserver(() => {
      if (card.clientWidth === width) return;
      width = card.clientWidth;
      requestAnimationFrame(() => this._wrapFacts());
    });
    observer.observe(card);
    this._cardWatch = { card, observer };
  }

  /** Marks each line of facts in the strip wrapped when its facts do not fit on one line. */
  private _wrapFacts(): void {
    for (const line of this.renderRoot.querySelectorAll<HTMLElement>('.eat-card-facts')) {
      line.classList.remove('is-wrapped');
      const facts = line.querySelectorAll<HTMLElement>('.eat-card-fact');
      if (facts.length < 2) continue;
      const top = facts[0].offsetTop;
      const wraps = Array.from(facts).some((fact) => fact.offsetTop > top);
      line.classList.toggle('is-wrapped', wraps);
    }
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
      return html`<div class="eat-scroll">
        <p class="eat-empty">${label} has no predicted values.</p>
        ${renderEmptyColorBy(this.data, this.annotation, this._colorBy)}
      </div>`;
    }
    // The sections scroll; the selected protein's strip is a footer under them, so nothing can
    // sit under it.
    return html`<div class="eat-scroll">${this._renderSections()}</div>
      ${this._renderCard()}`;
  }

  private _renderSections(): TemplateResult {
    const summary = this._summary;
    const drill = this._drill;
    return html`<ps-switch
        class="eat-show"
        .checked=${this._eat.overlayEnabled}
        ?disabled=${!summary}
        @change=${this._eat.onToggle}
        >Show predictions</ps-switch
      >
      ${summary && !this._eat.overlayEnabled
        ? html`<p class="eat-help eat-off-note">Predictions are off. The map shows them as N/A.</p>`
        : nothing}
      ${this._renderOtherFilters()} ${this._renderOverview(summary)}
      ${renderReliability(
        this._eat,
        summary,
        this._renderExportButton(null),
        this._renderOutcome(),
        {
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
        },
      )}
      ${summary
        ? renderBreakdown({
            rows: summary.rows,
            sort: this._labelSort,
            showAll: this._showAllLabels,
            labelColors: this.labelColors,
            overallMedian: summary.medianReliability,
            off: !this._eat.overlayEnabled,
            openLabel: drill && 'label' in drill ? drill.label : null,
            list: drill && 'label' in drill ? this._renderDrill() : nothing,
            sortMenu: this._sortMenu,
            onSortMenu: (anchor) => (this._sortMenu = anchor),
            onSort: (sort) => {
              this._labelSort = sort;
              this._dropStaleDrill(summary);
            },
            onShowAll: () => (this._showAllLabels = true),
            onRow: (label) => this._toggleDrill({ label }),
          })
        : nothing}
      ${this._renderDisplayOptions()} ${this._renderExportMenu(summary)}`;
  }

  private _renderCard(): TemplateResult | typeof nothing {
    const index = this._index;
    const data = this.data;
    if (!index || !data || this.focusProtein === null) return nothing;
    return renderCard({
      data,
      annotation: this.annotation,
      index,
      protein: this.focusProtein,
      facts: this._cardFacts(index, data, this.focusProtein),
      labelColors: this.labelColors,
      compact: this.compact,
      reliability: this._eat.reliability,
      shown: this._eat.overlayEnabled,
      faded: this._outcome === 'dim',
      onGoToSource: (detail) => this._emit('eat-go-to-source', detail),
      onTraceSource: (detail) => this._emit('eat-trace-source', detail),
      onShowFaded: () => this._setOutcome('dim'),
    });
  }

  /** `Toxin family is still filtered to reliability 50–100 %  Clear`, one line per annotation. */
  private _renderOtherFilters(): TemplateResult | typeof nothing {
    const data = this.data;
    if (!data || this.otherFilters.length === 0) return nothing;
    return html`${this.otherFilters.map(({ annotation, reliability }) => {
      const label = annotationLabel(annotation, data.annotations[annotation]);
      return html`<p class="eat-other-filter" data-annotation=${annotation}>
        <span
          >${label} is still filtered to reliability
          <span class="eat-nowrap">${rangeText(reliability)}</span></span
        >
        <button
          type="button"
          class="eat-other-filter-clear"
          aria-label=${`Clear the ${label} reliability filter`}
          @click=${() => this._emit('eat-clear-filter', { annotation })}
        >
          Clear
        </button>
      </p>`;
    })}`;
  }

  /** `Predictions outside the range: Hide | Fade` (proposal B §4.4, U21 words). */
  private _renderOutcome(): TemplateResult {
    const off = !this._eat.overlayEnabled;
    return html`<div class="eat-outcome-row">
      <span aria-hidden="true">Predictions outside the range</span>
      <ps-segmented
        label="Predictions outside the range"
        .options=${off ? OUTCOME_OPTIONS_OFF : OUTCOME_OPTIONS}
        .value=${this._outcome}
        @change=${(event: Event) =>
          this._setOutcome((event.currentTarget as PsSegmented).value as EatOutcome)}
      ></ps-segmented>
    </div>`;
  }

  private _setOutcome(outcome: EatOutcome): void {
    if (outcome === this._outcome) return;
    this._outcome = outcome;
    // A discrete decision supersedes a pending drag commit; the event carries the current state.
    this._eat.cancelCommit();
    this._emit('eat-outcome-change', { outcome, reliability: this._eat.reliability });
  }

  private _renderOthers(): TemplateResult | typeof nothing {
    if (!this.data) return nothing;
    return renderOtherAnnotations({
      data: this.data,
      annotation: this.annotation,
      open: this._othersOpen,
      onToggle: (open) => (this._othersOpen = open),
      onColorBy: this._colorBy,
    });
  }

  /**
   * Drawing and the other annotations share one closed disclosure at the bottom (proposal B §6;
   * on every layout since U21). Its summary says how lines are drawn.
   */
  private _renderDisplayOptions(): TemplateResult {
    const drawing = this._trace
      ? `Source lines on click · up to ${this._linesPerSource} from one source`
      : 'No source lines on click';
    return html`<details
      class="eat-display"
      ?open=${this._displayOpen}
      @toggle=${(event: Event) =>
        (this._displayOpen = (event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>
        <span class="eat-display-title">Display options</span>
        <span class="eat-display-state">${drawing}</span>
      </summary>
      <div class="eat-display-body">${this._renderDrawing()} ${this._renderOthers()}</div>
    </details>`;
  }

  /** `Export IDs`: opens the menu for the whole context (`drill` null) or one bar or label. */
  private _renderExportButton(drill: EatDrill | null): TemplateResult {
    // The list's trigger is named apart from the section's, which reads plain `Export IDs`.
    return html`<button
      type="button"
      class="eat-export"
      aria-label=${drill ? 'Export IDs of these predictions' : nothing}
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
    let outside = 0;
    if (menu && index && summary) {
      if (menu.drill) {
        const counts = countIn(index, menu.drill, this.context, this._eat.reliability);
        kept = counts.kept;
        outside = counts.total - counts.kept;
      } else {
        ({ kept, outside } = summary);
      }
    }
    return html`<ps-menu
      label="Export IDs"
      .anchor=${menu?.anchor ?? null}
      .open=${menu !== null}
      @ps-select=${(event: Event) => {
        event.stopPropagation();
        this._exportIds((event as CustomEvent<{ value: 'kept' | 'outside' }>).detail.value);
      }}
      @ps-close=${(event: Event) => {
        event.stopPropagation();
        this._exportMenu = null;
      }}
    >
      <ps-menu-item value="kept" ?disabled=${kept === 0}
        >In range (${formatCount(kept)})</ps-menu-item
      >
      <ps-menu-item value="outside" ?disabled=${outside === 0}
        >Outside the range (${formatCount(outside)})</ps-menu-item
      >
    </ps-menu>`;
  }

  /** One ID per line, named `<annotation>-eat-in-range-ids.txt` or `…-outside-range-ids.txt`. */
  private _exportIds(which: 'kept' | 'outside'): void {
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
      fileName: `${fileNamePart(this.annotation)}-eat-${which === 'kept' ? 'in-range' : 'outside-range'}-ids.txt`,
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

  /** The trace switch and the lines cap (proposal B §4.5, minus rings: Decision 8). */
  private _renderDrawing(): TemplateResult {
    return html`<section class="eat-drawing" aria-label="Drawing">
      <ps-switch
        class="eat-trace"
        .checked=${this._trace}
        @change=${(event: Event) =>
          this._setDrawing((event.currentTarget as PsSwitch).checked, this._linesPerSource)}
        >Draw a line to the source when I click a protein</ps-switch
      >
      <div class="eat-lines-row">
        <span aria-hidden="true">Most lines from one source</span>
        <ps-button
          class="eat-sort eat-lines"
          variant="ghost"
          size="sm"
          @click=${(event: Event) =>
            (this._linesMenu = this._linesMenu ? null : (event.currentTarget as HTMLElement))}
        >
          <span class="sr-only">Most lines from one source</span>
          <span class="eat-sort-value">${this._linesPerSource}</span>
          <span slot="end" class="eat-sort-chevron">${icon('chevron-down', 14)}</span>
        </ps-button>
      </div>
      <ps-menu
        label="Most lines from one source"
        placement="bottom-end"
        .anchor=${this._linesMenu}
        .open=${this._linesMenu !== null}
        @ps-select=${(event: Event) => {
          event.stopPropagation();
          this._linesMenu = null;
          this._setDrawing(
            this._trace,
            Number((event as CustomEvent<{ value: string }>).detail.value) as LinesPerSource,
          );
        }}
        @ps-close=${(event: Event) => {
          event.stopPropagation();
          this._linesMenu = null;
        }}
      >
        ${LINES_OPTIONS.map(
          (n) =>
            html`<ps-menu-item
              type="radio"
              value=${String(n)}
              .checked=${n === this._linesPerSource}
              >${n}</ps-menu-item
            >`,
        )}
      </ps-menu>
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
   * A drill-down row's pick: select its protein, then scroll the row back into view once the
   * strip under the list and the structure's header have taken their room.
   */
  private _pick(id: string): void {
    this._selectProteins([id], true);
    const reveal = () => {
      const scroller = this.renderRoot.querySelector<HTMLElement>('.eat-scroll');
      const row = this.renderRoot.querySelector<HTMLElement>(
        `.eat-drill-row[data-protein="${CSS.escape(id)}"]`,
      );
      if (scroller && row) revealIn(scroller, row);
    };
    // The strip renders with the next update; the shell lays the structure out a frame or two on.
    void this.updateComplete.then(() => {
      reveal();
      requestAnimationFrame(() => requestAnimationFrame(reveal));
    });
  }

  /**
   * The open list: its 5 least reliable predictions in the context, weakest first, each a button
   * that selects the protein and says where its label came from; then `Select all N in range` and
   * `Showing 5 of 41`. A row outside the range says it is hidden (Hide) or faded (Fade), and stays
   * clickable.
   */
  private _renderDrill(): TemplateResult | typeof nothing {
    const index = this._index;
    const data = this.data;
    const open = this._drill;
    if (!index || !data || !open) return nothing;
    let drill: EatDrill;
    if ('bin' in open) {
      drill = { bin: open.bin };
    } else {
      const label = index.labels.indexOf(open.label);
      if (label < 0) return nothing;
      drill = { label };
    }
    const state = this._eat.reliability;
    const weakest = weakestIn(index, drill, this.context);
    const heading =
      'bin' in open
        ? `${weakest.length} least reliable in ${binRange(open.bin)}`
        : countNoun(weakest.length, 'least reliable prediction', 'least reliable predictions');
    const predicted = data.annotation_predicted?.[this.annotation];
    const { total, kept } = countIn(index, drill, this.context, state);
    const hides = this._eat.overlayEnabled;
    const rows = Array.from(weakest, (k) => {
      const confidence = index.confidence[k];
      const labels = labelsAt(index, k);
      const id = data.protein_ids[index.order[k]];
      const reliability = hides
        ? formatReliabilityIn(confidence, state)
        : formatPercent(confidence);
      const hidden = hides && !isKept(state, confidence);
      const why =
        this._outcome === 'dim' ? 'Faded, outside the range' : 'Hidden, outside the range';
      const labelText = labels.join(', ');
      const color = swatchColor(this.labelColors, labels[0] ?? '');
      const source = predicted?.[index.order[k]]?.source ?? '';
      return html`<li>
        <button
          type="button"
          class="eat-drill-row"
          data-protein=${id}
          aria-label=${`${id}, ${reliability}, ${labelText}, from ${source}${hidden ? `, ${why.toLowerCase()}` : ''}`}
          title=${`${labelText}, from ${source}`}
          @click=${() => this._pick(id)}
        >
          <span
            class="eat-ring"
            style=${color ? `border-color:${color}` : nothing}
            aria-hidden="true"
          ></span>
          <span class="eat-drill-id">${id}</span>
          <span class="eat-drill-reliability">${reliability}</span>
          <span class="eat-drill-label">from ${source}</span>
          ${hidden ? html`<span class="eat-drill-hidden">${why}</span>` : nothing}
        </button>
      </li>`;
    });
    return html`<div id="eat-drill" class="eat-drill" role="region" aria-label=${heading}>
      <p class="eat-drill-heading">${heading}</p>
      <p class="eat-help">Pick one to see it on the map and where its label came from.</p>
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
          Select all ${formatCount(kept)} in range
        </button>
        ${this._renderExportButton(drill)}
        <span class="eat-drill-count">Showing ${weakest.length} of ${formatCount(total)}</span>
      </div>
    </div>`;
  }

  private readonly _colorBy = (annotation: string) => this._emit('eat-color-by', { annotation });

  /**
   * `How much is predicted?` (proposal B §4.3, U21): the bar in the map's language (curated solid,
   * predicted hollow, outside the range dashed and faded, no value the empty track) and its key,
   * which carries the counts. `summary` null is the skeleton.
   */
  private _renderOverview(summary: EatSummary | null): TemplateResult {
    const heading = html`<h3 class="eat-heading">How much is predicted?</h3>`;
    if (!summary) {
      return html`<section
        class="eat-overview"
        aria-busy="true"
        aria-label="How much is predicted?"
      >
        ${heading}
        <div class="eat-stack"></div>
      </section>`;
    }
    const enabled = this._eat.overlayEnabled;
    const { inView, curated, predicted, kept, outside, none } = summary;
    const segment = (part: string, name: string, count: number) =>
      count > 0
        ? html`<span
            class="eat-segment"
            data-part=${part}
            style=${`flex-grow:${count}`}
            title=${`${name}: ${formatCount(count)} (${share(count, inView)})`}
          ></span>`
        : nothing;
    const mark = (part: string) =>
      part === 'outside'
        ? html`<svg class="eat-key-mark" data-part="outside" viewBox="0 0 9 9" aria-hidden="true">
            <circle
              cx="4.5"
              cy="4.5"
              r="3.5"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              pathLength="12"
              stroke-dasharray="1.2 0.8"
            />
          </svg>`
        : html`<span class="eat-key-mark" data-part=${part} aria-hidden="true"></span>`;
    const key = (part: string | null, text: string) =>
      html`<span class="eat-key-item">${part ? mark(part) : nothing}${text}</span>`;
    const predictedKey = !enabled
      ? key('kept', `${formatCount(predicted)} predicted (off, shown as N/A)`)
      : outside > 0
        ? html`${key('kept', `${formatCount(kept)} in range`)}
          ${key('outside', `${formatCount(outside)} outside`)}`
        : key('kept', `${formatCount(predicted)} predicted`);
    return html`<section
      class=${enabled ? 'eat-overview' : 'eat-overview is-off'}
      aria-label="How much is predicted?"
    >
      ${heading}
      <div class="eat-stack">
        ${segment('curated', 'Curated', curated)} ${segment('kept', 'Predicted, in range', kept)}
        ${segment('outside', 'Predicted, outside the range', outside)}
        ${segment('none', 'No value', none)}
      </div>
      <p class="eat-counts">
        ${key('curated', `${formatCount(curated)} curated`)} ${predictedKey}
        ${none > 0 ? key(null, `${formatCount(none)} with no value`) : nothing}
      </p>
      ${this.context && this._index
        ? html`<p class="eat-in-view">
            In view: ${formatCount(inView)} of ${formatCount(this._index.total)}
          </p>`
        : nothing}
    </section>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-eat-panel': ProtspaceEatPanel;
  }
}
