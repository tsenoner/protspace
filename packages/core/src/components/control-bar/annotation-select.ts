import { LitElement, html, type PropertyValues } from 'lit';
import { property, state } from 'lit/decorators.js';
import { AfterPaintCommit } from '../../utils/after-paint-commit';
import { customElement } from '../../utils/safe-custom-element';
import { pushLayer } from '../kit/layers';
import { annotationSelectStyles } from './annotation-select.styles';
import { handleListboxKeydown, scrollHighlightedIntoView } from '../../utils/dropdown-helpers';
import {
  filterGroupedAnnotations,
  flattenGroupedAnnotations,
  type GroupedAnnotation,
} from '../common/annotation-categories';
import { predictedBadge, renderAnnotationName } from '../common/annotation-name';
import {
  annotationLabel,
  annotationStatSummary,
  clusterAgreement,
  getAnnotationMeta,
  hasAnnotationStats,
  type Annotation,
  type ProjectionStatisticRow,
} from '@protspace/utils';
import '../common/info-popover';

/**
 * The view bar's Color by picker (design decision 9): a searchable, grouped list of annotations,
 * each row with its hover-tooltip toggle. A pick shows at once and reaches listeners as
 * `annotation-change` after the next paint, because recolouring re-stages every point;
 * `applySelection` applies at once. The open list is a layer: Escape and a press outside close
 * it before anything else.
 *
 * @fires annotation-change - `{ annotation }`: the colouring annotation changed.
 * @fires tooltip-annotations-change - `{ tooltipAnnotations }`: the tooltip's extras changed.
 */
@customElement('protspace-annotation-select')
export class ProtspaceAnnotationSelect extends LitElement {
  static styles = annotationSelectStyles;

  @property({ type: Array }) annotations: string[] = [];
  @property({ type: Object }) annotationDefinitions: Record<string, Pick<Annotation, 'runtime'>> =
    {};
  @property({ type: Array }) eatAnnotations: string[] = [];
  @property({ type: String, attribute: 'selected-annotation' }) selectedAnnotation: string = '';
  @property({ type: Array }) tooltipAnnotations: string[] = [];
  @property({ type: String }) placeholder: string = 'Select annotation';
  /** The key shown before the value; part of the trigger's accessible name. */
  @property({ type: String }) label: string = 'Color by';
  /** Rows of the bundle's optional statistics part; empty when it was prepared without `--stats`. */
  @property({ type: Array }) statisticsRows: readonly ProjectionStatisticRow[] = [];
  /** Projection the statistics are reported for; statistics are scored per projection. */
  @property({ type: String, attribute: 'selected-projection' }) selectedProjection: string = '';

  @state() private open: boolean = false;
  @state() private query: string = '';
  @state() private highlightIndex: number = -1;
  /** A pick waiting for its commit after the next paint; the trigger shows it until then. */
  @state() private pending: string | null = null;

  private readonly commit = new AfterPaintCommit();
  /** Releases the open list's layer; set while the list is open. */
  private releaseLayer?: () => void;

  /**
   * Makes `annotation` the colouring now, drops a pick still waiting, and tells listeners. The
   * new primary is implicitly in the tooltip, so it then leaves the extras.
   */
  applySelection(annotation: string): void {
    this.commit.cancel();
    this.pending = null;
    this.selectedAnnotation = annotation;
    this.dispatchEvent(
      new CustomEvent('annotation-change', {
        detail: { annotation },
        bubbles: true,
        composed: true,
      }),
    );
    if (this.tooltipAnnotations.includes(annotation)) {
      this.applyTooltipSelection(this.tooltipAnnotations.filter((name) => name !== annotation));
    }
  }

  /** Sets the tooltip's extra annotations now, without the primary or repeats, and tells listeners. */
  applyTooltipSelection(names: readonly string[]): void {
    const next = Array.from(new Set(names.filter((name) => name !== this.selectedAnnotation)));
    this.tooltipAnnotations = next;
    this.dispatchEvent(
      new CustomEvent('tooltip-annotations-change', {
        detail: { tooltipAnnotations: [...next] },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Drops a pick still waiting, as a new dataset does. */
  cancelPending(): void {
    this.commit.cancel();
    this.pending = null;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.cancelPending();
    this.releaseLayer?.();
    this.releaseLayer = undefined;
  }

  protected updated(changed: Map<string, unknown>): void {
    if (!changed.has('open')) return;
    if (this.open) {
      this.releaseLayer ??= pushLayer({ close: () => this.closeFromLayer(), elements: [this] });
    } else {
      this.releaseLayer?.();
      this.releaseLayer = undefined;
    }
  }

  /** Escape or a press outside: close, and give focus back to the trigger when it was in the list. */
  private closeFromLayer(): void {
    const hadFocus = this.shadowRoot?.activeElement != null;
    this.closeList();
    if (hadFocus) {
      (this.shadowRoot?.querySelector('.dropdown-trigger') as HTMLElement | null)?.focus();
    }
  }

  private openList() {
    this.open = true;
    this.updateComplete.then(() => {
      const searchInput = this.shadowRoot?.querySelector(
        '#annotation-search-input',
      ) as HTMLInputElement | null;
      searchInput?.focus();
    });
  }

  private closeList() {
    this.open = false;
    this.query = '';
    this.highlightIndex = -1;
  }

  private toggleDropdown(event?: Event) {
    event?.stopPropagation();
    if (this.open) this.closeList();
    else this.openList();
  }

  private handleSearchInput(event: Event) {
    const target = event.target as HTMLInputElement;
    this.query = target.value;
    this.highlightIndex = -1; // Reset highlight when query changes
  }

  private handleKeydown(event: KeyboardEvent) {
    if (!this.open) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.toggleDropdown(event);
      }
      return;
    }

    handleListboxKeydown(event, {
      // Lazy: only the arrow and Enter keys pay for re-filtering the list.
      getValues: () => flattenGroupedAnnotations(this.getFilteredGroupedAnnotations()),
      highlightIndex: this.highlightIndex,
      setHighlightIndex: (index) => {
        this.highlightIndex = index;
        this.scrollToHighlighted();
      },
      // The layer normally takes Escape first; this covers an event that never reached the window.
      onEscape: () => this.closeList(),
      onSelect: (annotation) => this.selectAnnotation(annotation, event),
      root: this.shadowRoot,
      itemSelector: '.dropdown-item',
      valueAttribute: 'data-annotation',
    });
  }

  private scrollToHighlighted() {
    this.updateComplete.then(() =>
      scrollHighlightedIntoView(this.shadowRoot, '.dropdown-item.highlighted'),
    );
  }

  /** A user's pick: shown at once, committed after the next paint (the newest pick wins). */
  private selectAnnotation(annotation: string, event?: Event) {
    event?.stopPropagation();
    // A keyboard pick removes the focused search input: give focus back to the trigger.
    const hadFocus = this.shadowRoot?.activeElement != null;
    this.closeList();
    if (hadFocus) {
      void this.updateComplete.then(() =>
        this.shadowRoot?.querySelector<HTMLElement>('.dropdown-trigger')?.focus(),
      );
    }
    // Re-picking the committed annotation changes nothing, and drops a pick still waiting.
    if (annotation === this.selectedAnnotation) {
      this.cancelPending();
      return;
    }
    this.pending = annotation;
    this.commit.schedule(() => this.applySelection(annotation));
  }

  private toggleTooltipAnnotation(annotation: string, event: Event) {
    event.stopPropagation();
    event.preventDefault();
    if (annotation === (this.pending ?? this.selectedAnnotation)) {
      return;
    }
    const isActive = this.tooltipAnnotations.includes(annotation);
    this.applyTooltipSelection(
      isActive
        ? this.tooltipAnnotations.filter((name) => name !== annotation)
        : [...this.tooltipAnnotations, annotation],
    );
  }

  private getFilteredGroupedAnnotations(): GroupedAnnotation[] {
    return filterGroupedAnnotations(this.annotations, this.query, this.annotationDefinitions);
  }

  /**
   * Which annotations the panel would show at least one metric row for in this projection,
   * rebuilt only when those inputs change: render() re-runs on every search keystroke and arrow
   * press while the dropdown is open, and deriving each row's answer there re-scans the whole
   * statistics table per row. The scores themselves live in the projection-metadata panel; the
   * badge only says they exist.
   */
  private hasStats = new Map<string, boolean>();

  willUpdate(changed: PropertyValues<this>) {
    if (changed.has('statisticsRows') || changed.has('selectedProjection')) {
      this.hasStats.clear();
    }
  }

  /**
   * Shares `hasAnnotationStats` with the projection-metadata panel's render gate rather than
   * re-deriving "has stats" from `annotationStatSummary` alone: that would go stale for an
   * ordinary annotation with agreement rows but no validity rows (badges something the panel
   * renders empty) and for a `cluster_*` column, which never has a `summary` of its own but does
   * have agreement rows naming it (would badge nothing for something the panel does render).
   */
  private hasStatistics(annotation: string): boolean {
    let scored = this.hasStats.get(annotation);
    if (scored === undefined) {
      const summary = annotationStatSummary(
        this.statisticsRows,
        annotation,
        this.selectedProjection,
      );
      const agreement = clusterAgreement(this.statisticsRows, annotation);
      scored = hasAnnotationStats(summary, agreement);
      this.hasStats.set(annotation, scored);
    }
    return scored;
  }

  render() {
    const filtered = this.getFilteredGroupedAnnotations();
    const shown = this.pending ?? this.selectedAnnotation;

    return html`
      <div class="annotation-select-container">
        <button
          class="dropdown-trigger ${this.open ? 'open' : ''}"
          part="trigger"
          @click=${this.toggleDropdown}
          @keydown=${this.handleKeydown}
          aria-expanded=${this.open}
          aria-haspopup="listbox"
        >
          <span class="key" part="key">${this.label}</span>
          ${shown
            ? renderAnnotationName(
                shown,
                this.annotationDefinitions[shown],
                'dropdown-trigger-text',
              )
            : html`<span class="dropdown-trigger-text">${this.placeholder}</span>`}
          <svg class="chevron-down" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        ${this.open
          ? html`
              <div class="dropdown-menu align-left" @click=${(e: Event) => e.stopPropagation()}>
                <div class="annotation-search-container">
                  <input
                    id="annotation-search-input"
                    class="annotation-search-input"
                    type="text"
                    .value=${this.query}
                    placeholder="Search annotations..."
                    @input=${this.handleSearchInput}
                    @keydown=${this.handleKeydown}
                  />
                </div>

                <div class="annotation-list-container">
                  ${filtered.length === 0
                    ? html` <div class="no-results">No matching annotations</div> `
                    : filtered.map((group) => {
                        let currentIndex = 0;
                        // Find starting index for this group
                        for (const g of filtered) {
                          if (g === group) break;
                          currentIndex += g.annotations.length;
                        }

                        return html`
                          <div class="annotation-section">
                            <div class="annotation-section-header">${group.category}</div>
                            <div class="annotation-section-items">
                              ${group.annotations.map((annotation) => {
                                // Hover styling comes from `dropdownMixin`'s `.dropdown-item:hover`.
                                // Mirroring it into `highlightIndex` re-rendered every row per row
                                // the pointer crossed. The index is for keyboard navigation only.
                                const itemIndex = currentIndex++;
                                const isHighlighted = itemIndex === this.highlightIndex;
                                const isSelected = annotation === shown;
                                const isInTooltip = this.tooltipAnnotations.includes(annotation);
                                const hasEatPredictions = this.eatAnnotations.includes(annotation);
                                const definition = this.annotationDefinitions[annotation];
                                const meta = getAnnotationMeta(annotation, definition);
                                const hasDocs = meta.description.length > 0 || !!meta.docsUrl;
                                const stats = this.hasStatistics(annotation);
                                return html`
                                  <div
                                    class="dropdown-item ${isHighlighted
                                      ? 'highlighted'
                                      : ''} ${isSelected ? 'selected' : ''}"
                                    data-annotation=${annotation}
                                    @click=${(e: Event) => this.selectAnnotation(annotation, e)}
                                  >
                                    <span
                                      class="primary-indicator"
                                      aria-hidden="true"
                                      data-active=${isSelected ? 'true' : 'false'}
                                    >
                                      ${isSelected ? html`<span class="primary-dot"></span>` : ''}
                                    </span>
                                    ${hasDocs
                                      ? html`<protspace-info-popover
                                          class="annotation-info"
                                          placement="side"
                                          .description=${meta.description}
                                          docs-url=${meta.docsUrl ?? ''}
                                          label=${annotationLabel(annotation, definition)}
                                          @click=${(e: Event) => e.stopPropagation()}
                                        ></protspace-info-popover>`
                                      : ''}
                                    <span class="dropdown-item-label"
                                      >${annotationLabel(annotation, definition)}</span
                                    >
                                    ${hasEatPredictions
                                      ? html`<span
                                          class="menu-badge eat-badge"
                                          title="Embedding Annotation Transfer predictions available"
                                          aria-label="EAT predictions available"
                                          >EAT</span
                                        >`
                                      : ''}
                                    ${stats
                                      ? html`<span
                                          class="menu-badge stats-badge"
                                          title="Quality statistics available: select this annotation and open the projection metadata panel"
                                          aria-label="Quality statistics available"
                                          >STATS</span
                                        >`
                                      : ''}
                                    ${predictedBadge(annotation)}
                                    <span class="tooltip-toggle-slot">
                                      ${isSelected
                                        ? ''
                                        : html`<button
                                            type="button"
                                            class="tooltip-toggle-btn ${isInTooltip
                                              ? 'is-active'
                                              : ''}"
                                            title=${isInTooltip
                                              ? 'Hide from hover tooltip'
                                              : 'Show in hover tooltip'}
                                            aria-label=${isInTooltip
                                              ? `Hide ${annotation} from hover tooltip`
                                              : `Show ${annotation} in hover tooltip`}
                                            aria-pressed=${isInTooltip ? 'true' : 'false'}
                                            @click=${(e: Event) =>
                                              this.toggleTooltipAnnotation(annotation, e)}
                                            @mousedown=${(e: Event) => e.stopPropagation()}
                                          >
                                            ${isInTooltip
                                              ? html`<svg
                                                  viewBox="0 0 24 24"
                                                  width="16"
                                                  height="16"
                                                  fill="none"
                                                  stroke="currentColor"
                                                  stroke-width="2"
                                                  stroke-linecap="round"
                                                  stroke-linejoin="round"
                                                  aria-hidden="true"
                                                >
                                                  <path
                                                    d="M1.5 12s4-7.5 10.5-7.5S22.5 12 22.5 12 18.5 19.5 12 19.5 1.5 12 1.5 12z"
                                                  />
                                                  <circle cx="12" cy="12" r="3" />
                                                </svg>`
                                              : html`<svg
                                                  viewBox="0 0 24 24"
                                                  width="16"
                                                  height="16"
                                                  fill="none"
                                                  stroke="currentColor"
                                                  stroke-width="2"
                                                  stroke-linecap="round"
                                                  stroke-linejoin="round"
                                                  aria-hidden="true"
                                                >
                                                  <path d="M3 3l18 18" />
                                                  <path d="M10.585 10.587a2 2 0 0 0 2.83 2.828" />
                                                  <path
                                                    d="M16.681 16.673A8.717 8.717 0 0 1 12 18C6 18 2 12 2 12a13.16 13.16 0 0 1 3.176-3.836"
                                                  />
                                                  <path
                                                    d="M9.88 5.18A8.717 8.717 0 0 1 12 5c6 0 10 7 10 7a13.198 13.198 0 0 1-1.668 2.06"
                                                  />
                                                </svg>`}
                                          </button>`}
                                    </span>
                                  </div>
                                `;
                              })}
                            </div>
                          </div>
                        `;
                      })}
                </div>
              </div>
            `
          : ''}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-annotation-select': ProtspaceAnnotationSelect;
  }
}
