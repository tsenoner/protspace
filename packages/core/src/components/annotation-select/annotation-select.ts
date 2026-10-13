import { LitElement, html, nothing, type PropertyValues } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import {
  annotationStatSummary,
  clusterAgreement,
  getAnnotationMeta,
  hasAnnotationStats,
  type Annotation,
  type ProjectionStatisticRow,
} from '@protspace/utils';
import { AfterPaintCommit } from '../../utils/after-paint-commit';
import { handleListboxKeydown, scrollHighlightedIntoView } from '../../utils/dropdown-helpers';
import { customElement } from '../../utils/safe-custom-element';
import {
  filterGroupedAnnotations,
  flattenGroupedAnnotations,
  type GroupedAnnotation,
} from '../common/annotation-categories';
import { predictedMark, renderAnnotationName } from '../common/annotation-name';
import '../common/info-popover';
import { icon } from '../kit/icon';
import '../kit/popover';
import type { PsPopover } from '../kit/popover';
import '../kit/tooltip';
import { annotationSelectStyles } from './annotation-select.styles';

const LISTBOX_ID = 'annotation-listbox';
const HINT_ID = 'annotation-search-hint';
const TOGGLE_HINT = 'Shift+Enter shows or hides the highlighted annotation in the hover tooltip';
const EAT_NOTE = 'EAT predictions available.';
const STATS_NOTE =
  'Quality statistics available: select this annotation and open the projection details.';

const optionId = (index: number) => `annotation-option-${index}`;

/**
 * The view bar's Color by picker (design decision 9): a searchable, grouped listbox of
 * annotations, each row with its hover-tooltip toggle beside it. A pick shows at once and reaches
 * listeners as `annotation-change` after the next paint, because recolouring re-stages every
 * point; `applySelection` applies at once. The list opens in a ps-popover, so it sits in the top
 * layer and Escape and a press outside close it before anything else.
 *
 * The rows stay this element's own listbox rather than a ps-menu: each row carries an eye toggle
 * and an ⓘ, which cannot sit inside a menu item, and the search matches only the labels shown.
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

  @query('.dropdown-trigger') private trigger!: HTMLButtonElement;
  @query('ps-popover') private popoverEl!: PsPopover;
  private readonly commit = new AfterPaintCommit();

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
  }

  protected firstUpdated(): void {
    // Set once: the list opens beside the trigger, and a press on the trigger is not outside.
    this.popoverEl.anchor = this.trigger;
  }

  /** The popover closed itself (Escape or a press outside); it gives focus back to the trigger. */
  private onPopoverClose = (event: Event) => {
    event.stopPropagation();
    this.closeList();
  };

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

    // Shift+Enter shows or hides the highlighted annotation in the hover tooltip: the keyboard
    // way to the eye toggle, which is not a Tab stop.
    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault();
      const annotation = this.highlightedAnnotation();
      if (annotation !== null) this.toggleTooltipAnnotation(annotation, event);
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
      // The popover's layer normally takes Escape first; this covers an event that never reached
      // the window.
      onEscape: () => this.closeList(),
      onSelect: (annotation) => this.selectAnnotation(annotation, event),
      root: this.shadowRoot,
      itemSelector: '.dropdown-item',
      valueAttribute: 'data-annotation',
    });
  }

  /** The annotation the keyboard highlight is on, or null. */
  private highlightedAnnotation(): string | null {
    const values = flattenGroupedAnnotations(this.getFilteredGroupedAnnotations());
    return this.highlightIndex >= 0 && this.highlightIndex < values.length
      ? values[this.highlightIndex]
      : null;
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
      void this.updateComplete.then(() => this.trigger?.focus());
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
    const shown = this.pending ?? this.selectedAnnotation;

    return html`
      <div class="annotation-select-container">
        <button
          type="button"
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
          <span class="chevron-down" aria-hidden="true">${icon('chevron-down', 14)}</span>
        </button>
        <ps-popover
          placement="bottom-start"
          panel-role="none"
          .open=${this.open}
          @ps-close=${this.onPopoverClose}
          >${this.open ? this.renderPanel(shown) : nothing}</ps-popover
        >
      </div>
    `;
  }

  /** The search field and the grouped listbox, rendered only while the list is open. */
  private renderPanel(shown: string) {
    const groups = this.getFilteredGroupedAnnotations();
    const active = this.highlightIndex >= 0 ? optionId(this.highlightIndex) : nothing;
    let index = 0;
    return html`
      <div class="dropdown-menu" @click=${(e: Event) => e.stopPropagation()}>
        <div class="annotation-search-container">
          ${icon('search', 14)}
          <input
            id="annotation-search-input"
            class="annotation-search-input"
            type="text"
            role="combobox"
            aria-label="Search annotations"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls=${LISTBOX_ID}
            aria-activedescendant=${active}
            aria-describedby=${HINT_ID}
            autocomplete="off"
            .value=${this.query}
            placeholder="Search annotations"
            @input=${this.handleSearchInput}
            @keydown=${this.handleKeydown}
          />
          <span id=${HINT_ID} class="sr-only">${TOGGLE_HINT}</span>
        </div>
        <div
          class="annotation-list-container"
          id=${LISTBOX_ID}
          role="listbox"
          aria-label=${this.label}
        >
          ${groups.map(
            (group, g) => html`
              <div
                class="annotation-section"
                role="group"
                aria-labelledby=${`annotation-group-${g}`}
              >
                <div
                  class="annotation-section-header"
                  id=${`annotation-group-${g}`}
                  role="presentation"
                >
                  ${group.category}
                </div>
                <div class="annotation-section-items" role="none">
                  ${group.annotations.map((annotation) =>
                    this.renderRow(annotation, index++, shown),
                  )}
                </div>
              </div>
            `,
          )}
        </div>
        ${groups.length === 0
          ? html`<p class="no-results" role="status">No matching annotations</p>`
          : nothing}
      </div>
    `;
  }

  /**
   * One row: the option (check, label, predicted mark, badges) and, beside it, the ⓘ and the
   * eye toggle. Hover styling is CSS `:hover` only: mirroring it into `highlightIndex`
   * re-rendered every row the pointer crossed. The index is for keyboard navigation.
   */
  private renderRow(annotation: string, index: number, shown: string) {
    const definition = this.annotationDefinitions[annotation];
    const meta = getAnnotationMeta(annotation, definition);
    const isSelected = annotation === shown;
    const isInTooltip = this.tooltipAnnotations.includes(annotation);
    const eat = this.eatAnnotations.includes(annotation);
    const stats = this.hasStatistics(annotation);
    const hasDocs = meta.description.length > 0 || !!meta.docsUrl;
    const id = optionId(index);
    const notes = [eat ? EAT_NOTE : '', stats ? STATS_NOTE : ''].filter(Boolean).join(' ');
    return html`
      <div
        class="dropdown-item ${index === this.highlightIndex ? 'highlighted' : ''} ${isSelected
          ? 'selected'
          : ''}"
        role="none"
        data-annotation=${annotation}
        @click=${(e: Event) => this.selectAnnotation(annotation, e)}
      >
        <div
          class="dropdown-option"
          id=${id}
          role="option"
          aria-selected=${isSelected ? 'true' : 'false'}
          aria-describedby=${notes ? `${id}-notes` : nothing}
        >
          <span class="selected-check">${isSelected ? icon('check', 14) : nothing}</span>
          <span class="dropdown-item-label">${meta.label}</span>
          ${predictedMark(annotation)}
          ${eat ? html`<span class="menu-badge eat-badge" aria-hidden="true">EAT</span>` : nothing}
          ${stats
            ? html`<span class="menu-badge stats-badge" aria-hidden="true">STATS</span>`
            : nothing}
        </div>
        ${notes ? html`<span id=${`${id}-notes`} hidden>${notes}</span>` : nothing}
        ${hasDocs
          ? html`<protspace-info-popover
              class="annotation-info"
              placement="side"
              .description=${meta.description}
              docs-url=${meta.docsUrl ?? ''}
              label=${meta.label}
              @click=${(e: Event) => e.stopPropagation()}
            ></protspace-info-popover>`
          : nothing}
        <span class="tooltip-toggle-slot">
          ${isSelected
            ? nothing
            : html`<button
                  type="button"
                  tabindex="-1"
                  class="tooltip-toggle-btn ${isInTooltip ? 'is-active' : ''}"
                  aria-label=${isInTooltip
                    ? `Hide ${meta.label} from hover tooltip`
                    : `Show ${meta.label} in hover tooltip`}
                  aria-pressed=${isInTooltip ? 'true' : 'false'}
                  @click=${(e: Event) => this.toggleTooltipAnnotation(annotation, e)}
                  @mousedown=${(e: Event) => e.stopPropagation()}
                >
                  ${icon(isInTooltip ? 'eye' : 'eye-off', 14)}
                </button>
                <ps-tooltip
                  names-target
                  text=${isInTooltip ? 'Hide from hover tooltip' : 'Show in hover tooltip'}
                ></ps-tooltip>`}
        </span>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-annotation-select': ProtspaceAnnotationSelect;
  }
}
