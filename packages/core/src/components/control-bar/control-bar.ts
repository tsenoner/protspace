import { LitElement, html } from 'lit';
import { property, state } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import { controlBarStyles } from './control-bar.styles';
import type {
  DataChangeDetail,
  ProtspaceData,
  ScatterplotElementLike,
  StructureViewerElement,
} from './types';
import {
  handleDropdownEscape,
  isAnyDropdownOpen,
  scrollHighlightedIntoView,
} from '../../utils/dropdown-helpers';
import { AfterPaintCommit } from '../../utils/after-paint-commit';
import {
  DENSITY_DEFAULT,
  DENSITY_LAYER_MODES,
  isEatConfidenceAnnotation,
  type DensityLayerMode,
  type ProjectionStatisticRow,
} from '@protspace/utils';
import { toggleProteinSelection, mergeProteinSelections } from './control-bar-helpers';
import {
  createSelectionDisabledNotificationDetail,
  type DensityLayerChangeDetail,
  type SelectionDisabledNotificationDetail,
} from './control-bar.events';
import type { BrushSelectionDetail, ProteinClickDetail } from '../scatter-plot/scatter-plot.events';
import './search';
import './annotation-select';

/** Stable empty statistics — a fresh [] per render would dirty the child on every update. */
const NO_STATISTICS: readonly ProjectionStatisticRow[] = [];

/** Annotations used only for tooltip display, hidden from the annotation dropdown */
const TOOLTIP_ONLY_ANNOTATIONS = new Set(['gene_name', 'protein_name', 'uniprot_kb_id']);

/** Menu copy per mode; the tokens stay off/auto/on (URL, config), only 'on' reads as 'Always'. */
const DENSITY_MODE_LABELS: Record<DensityLayerMode, { label: string; hint: string }> = {
  off: { label: 'Off', hint: 'No contours' },
  auto: {
    label: 'Auto',
    hint: 'Fades out as you zoom in; faint or hidden when few points are shown',
  },
  on: { label: 'Always', hint: 'Full strength at every zoom level' },
};

const DENSITY_MODES = DENSITY_LAYER_MODES.map((mode) => ({ mode, ...DENSITY_MODE_LABELS[mode] }));

@customElement('protspace-control-bar')
export class ProtspaceControlBar extends LitElement {
  @property({ type: Array }) projections: string[] = [];
  @state() private projectionsMeta: Array<{
    name: string;
    metadata?: { dimension?: 2 | 3 };
  }> = [];
  @property({ type: Array }) annotations: string[] = [];
  @property({ type: String, attribute: 'selected-projection' })
  selectedProjection: string = '';
  @property({ type: String, attribute: 'selected-annotation' })
  selectedAnnotation: string = '';
  @property({ type: Array }) tooltipAnnotations: string[] = [];
  @property({ type: Boolean, attribute: 'selection-mode' })
  selectionMode: boolean = false;
  @property({ type: String, attribute: 'selection-tool' })
  selectionTool: 'rectangle' | 'lasso' = 'rectangle';
  @property({ type: String, attribute: 'density-layer' })
  densityLayer: DensityLayerMode = DENSITY_DEFAULT;
  @property({ type: Number, attribute: 'selected-proteins-count' })
  selectedProteinsCount: number = 0;
  @property({ type: Boolean, attribute: 'isolation-mode' })
  isolationMode: boolean = false;
  @property({ type: Array, attribute: 'isolation-history' })
  isolationHistory: string[][] = [];
  @state() private _eatAnnotationKeys: string[] = [];

  @state() private _selectionDisabled: boolean = false;

  // Auto-sync properties (optional, can be derived from events)
  @property({ type: String, attribute: 'scatterplot-selector' })
  scatterplotSelector: string = 'protspace-scatterplot';
  @property({ type: Boolean, attribute: 'auto-sync' })
  autoSync: boolean = true;

  @state() private showProjectionMenu: boolean = false;
  @state() private showDensityMenu: boolean = false;
  @state() private densityHighlightIndex: number = -1;
  @state() private _currentData: ProtspaceData | undefined;
  @state() private projectionHighlightIndex: number = -1;

  private _scatterplotElement: ScatterplotElementLike | null = null;
  /**
   * The one pending auto-sync timer — a scatter plot lookup retry or the initial
   * sync. Cleared on disconnect so a removed control bar stops polling (and never
   * fires after a test environment's `document` is gone).
   */
  private _autoSyncTimer: ReturnType<typeof setTimeout> | null = null;

  // Search state
  @state() private allProteinIds: string[] = [];
  @state() private selectedIdsChips: string[] = [];

  // A pick from the annotation, projection or contour menu, the search box or the
  // Clear button re-stages every point. The menu closes and the pick shows in the
  // frame of the input; the change itself runs after that frame is painted. One
  // commit per control, so a newer pick replaces one still waiting, and a
  // programmatic apply drops it.
  private readonly _annotationCommit = new AfterPaintCommit();
  private readonly _projectionCommit = new AfterPaintCommit();
  private readonly _densityCommit = new AfterPaintCommit();
  private readonly _selectionCommit = new AfterPaintCommit();
  /** The menu pick waiting for its commit; the trigger shows it until then. */
  @state() private _pendingAnnotation: string | null = null;
  @state() private _pendingProjection: string | null = null;

  // Stable listeners for proper add/remove
  private _onDocumentClick = (event: Event) => this.handleDocumentClick(event);
  private _onDocumentKeydown = (event: KeyboardEvent) => this.handleDocumentKeydown(event);
  private _onDataChange = (event: Event) => this._handleDataChange(event);
  private _onProteinClick = (event: Event) => this._handleProteinSelection(event);
  private _onDataIsolation = (event: Event) => this._handleDataIsolation(event);
  private _onDataIsolationReset = (event: Event) => this._handleDataIsolationReset(event);
  private _onAutoDisableSelection = (event: Event) => this._handleAutoDisableSelection(event);
  private _onBrushSelection = (event: Event) => this._handleBrushSelection(event);
  // Bound fields, not inline closures: an inline closure cannot be removed, so every
  // re-attach of this element stacked another handler (and leaked the detached element).
  private _onAnnotationOpened = () => {
    this.showProjectionMenu = false;
    this.showDensityMenu = false;
    // Close search when annotation opens
    this.shadowRoot
      ?.querySelector('protspace-protein-search')
      ?.dispatchEvent(new CustomEvent('close-search', { bubbles: false }));
  };
  private _onSearchOpened = () => {
    this.showProjectionMenu = false;
    this.showDensityMenu = false;
    // Close annotation when search opens
    this.shadowRoot
      ?.querySelector('protspace-annotation-select')
      ?.dispatchEvent(new CustomEvent('close-dropdown', { bubbles: false }));
  };

  static styles = controlBarStyles;

  /**
   * Close all dropdowns except the specified one
   */
  private closeOtherDropdowns(except: 'projection' | 'density') {
    if (except !== 'projection') this.showProjectionMenu = false;
    if (except !== 'density') this.showDensityMenu = false;

    // Close annotation dropdown via event
    this.shadowRoot
      ?.querySelector('protspace-annotation-select')
      ?.dispatchEvent(new CustomEvent('close-dropdown', { bubbles: false }));
    // Close search via event
    this.shadowRoot
      ?.querySelector('protspace-protein-search')
      ?.dispatchEvent(new CustomEvent('close-search', { bubbles: false }));
  }

  private toggleProjectionMenu(event?: Event) {
    event?.stopPropagation();
    this.showProjectionMenu = !this.showProjectionMenu;
    if (this.showProjectionMenu) {
      this.closeOtherDropdowns('projection');
      const currentIndex = this.projections.findIndex((p) => p === this.selectedProjection);
      this.projectionHighlightIndex = currentIndex >= 0 ? currentIndex : 0;
    } else {
      this.projectionHighlightIndex = -1;
    }
  }

  private selectProjectionFromMenu(projection: string) {
    this.showProjectionMenu = false;
    this.projectionHighlightIndex = -1;
    this._pendingProjection = projection;
    this._projectionCommit.schedule(() => this.applyProjectionSelection(projection));
  }

  applyProjectionSelection(projection: string) {
    this._projectionCommit.cancel();
    this._pendingProjection = null;
    this.selectedProjection = projection;
    this.showProjectionMenu = false;
    this.projectionHighlightIndex = -1;

    // If auto-sync is enabled, directly update the scatterplot
    if (this.autoSync && this._scatterplotElement) {
      const projectionIndex = this.projections.findIndex((p) => p === projection);
      if (projectionIndex !== -1 && 'selectedProjectionIndex' in this._scatterplotElement) {
        (this._scatterplotElement as ScatterplotElementLike).selectedProjectionIndex =
          projectionIndex;
      }
    }

    const customEvent = new CustomEvent('projection-change', {
      detail: { projection },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(customEvent);
  }

  private handleProjectionKeydown(event: KeyboardEvent) {
    if (!this.showProjectionMenu) {
      // Handle trigger button keys
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.toggleProjectionMenu();
      }
      return;
    }

    this.handleDropdownKeydown(event, {
      items: this.projections,
      highlightIndex: this.projectionHighlightIndex,
      onHighlightChange: (index) => {
        this.projectionHighlightIndex = index;
      },
      onSelect: (index) => {
        this.selectProjectionFromMenu(this.projections[index]);
      },
      onClose: () => {
        this.showProjectionMenu = false;
        this.projectionHighlightIndex = -1;
      },
      supportHomeEnd: true,
    });
  }

  /**
   * Shared keyboard navigation handler for all dropdowns
   * Centralizes common keyboard navigation logic following DRY principle
   */
  private handleDropdownKeydown(
    event: KeyboardEvent,
    options: {
      items: unknown[];
      highlightIndex: number;
      onHighlightChange: (index: number) => void;
      onSelect: (index: number) => void;
      onClose: () => void;
      supportHomeEnd?: boolean;
    },
  ) {
    const { items, highlightIndex, onHighlightChange, onSelect, onClose, supportHomeEnd } = options;

    switch (event.key) {
      case 'Escape':
        handleDropdownEscape(event, onClose);
        break;
      case 'ArrowDown':
        event.preventDefault();
        if (items.length > 0) {
          const nextIndex = Math.min(highlightIndex + 1, items.length - 1);
          onHighlightChange(nextIndex);
          this.scrollDropdownItemIntoView();
        }
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (items.length > 0) {
          const nextIndex = Math.max(highlightIndex - 1, 0);
          onHighlightChange(nextIndex);
          this.scrollDropdownItemIntoView();
        }
        break;
      case 'Home':
        if (supportHomeEnd) {
          event.preventDefault();
          if (items.length > 0) {
            onHighlightChange(0);
            this.scrollDropdownItemIntoView();
          }
        }
        break;
      case 'End':
        if (supportHomeEnd) {
          event.preventDefault();
          if (items.length > 0) {
            onHighlightChange(items.length - 1);
            this.scrollDropdownItemIntoView();
          }
        }
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (highlightIndex >= 0 && highlightIndex < items.length) {
          onSelect(highlightIndex);
        }
        break;
    }
  }

  /**
   * Shared helper to scroll highlighted dropdown item into view
   * Works for all dropdown types (.dropdown-item, .filter-menu-list-item)
   */
  private scrollDropdownItemIntoView() {
    this.updateComplete.then(() =>
      scrollHighlightedIntoView(
        this.shadowRoot,
        '.dropdown-item.highlighted',
        '.filter-menu-list-item.highlighted',
      ),
    );
  }

  applyAnnotationSelection(annotation: string) {
    this._annotationCommit.cancel();
    this._pendingAnnotation = null;
    this.selectedAnnotation = annotation;

    // If auto-sync is enabled, directly update the scatterplot
    if (this.autoSync && this._scatterplotElement) {
      if ('selectedAnnotation' in this._scatterplotElement) {
        (this._scatterplotElement as ScatterplotElementLike).selectedAnnotation = annotation;
      }
    }

    // The new primary is implicitly in the tooltip; drop it from the extras
    // so the dropdown does not also show an active toggle for it.
    if (this.tooltipAnnotations.includes(annotation)) {
      this.applyTooltipAnnotationsSelection(
        this.tooltipAnnotations.filter((name) => name !== annotation),
      );
    }

    const customEvent = new CustomEvent('annotation-change', {
      detail: { annotation },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(customEvent);
  }

  private handleAnnotationSelected(event: CustomEvent<{ annotation: string }>) {
    const { annotation } = event.detail;
    this._pendingAnnotation = annotation;
    this._annotationCommit.schedule(() => this.applyAnnotationSelection(annotation));
  }

  applyTooltipAnnotationsSelection(tooltipAnnotations: string[]) {
    const sanitized = Array.from(
      new Set(tooltipAnnotations.filter((name) => name !== this.selectedAnnotation)),
    );
    this.tooltipAnnotations = sanitized;

    if (this.autoSync && this._scatterplotElement) {
      if ('tooltipAnnotations' in this._scatterplotElement) {
        (this._scatterplotElement as ScatterplotElementLike).tooltipAnnotations = [...sanitized];
      }
    }

    this.dispatchEvent(
      new CustomEvent('tooltip-annotations-change', {
        detail: { tooltipAnnotations: [...sanitized] },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private handleTooltipAnnotationToggle(
    event: CustomEvent<{
      annotation: string;
      active: boolean;
      tooltipAnnotations: string[];
    }>,
  ) {
    this.applyTooltipAnnotationsSelection(event.detail.tooltipAnnotations);
  }

  private handleToggleSelectionMode() {
    // Compute and set the new selection mode locally first
    const newSelectionMode = !this.selectionMode;
    this.selectionMode = newSelectionMode;

    // If auto-sync is enabled, update the scatterplot BEFORE notifying listeners
    if (this.autoSync && this._scatterplotElement) {
      const scatterplot = this._scatterplotElement as ScatterplotElementLike;
      if (scatterplot.selectionMode !== undefined) {
        scatterplot.selectionMode = newSelectionMode;
      }
    }

    // Now dispatch the event with the updated state so listeners read the correct value
    const customEvent = new CustomEvent('toggle-selection-mode', {
      detail: { selectionMode: newSelectionMode },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(customEvent);
  }

  private handleSelectionToolChange(tool: 'rectangle' | 'lasso') {
    this.selectionTool = tool;
    if (this.autoSync && this._scatterplotElement) {
      const scatterplot = this._scatterplotElement as ScatterplotElementLike;
      if (scatterplot.selectionTool !== undefined) {
        scatterplot.selectionTool = tool;
      }
    }
    this.dispatchEvent(
      new CustomEvent('selection-tool-change', {
        detail: { selectionTool: tool },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private toggleDensityMenu(event?: Event) {
    event?.stopPropagation();
    this.showDensityMenu = !this.showDensityMenu;
    if (this.showDensityMenu) {
      this.closeOtherDropdowns('density');
      this.densityHighlightIndex = DENSITY_MODES.findIndex((m) => m.mode === this.densityLayer);
    } else {
      this.densityHighlightIndex = -1;
    }
  }

  private handleDensityKeydown(event: KeyboardEvent) {
    if (!this.showDensityMenu) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.toggleDensityMenu();
      }
      return;
    }
    this.handleDropdownKeydown(event, {
      items: [...DENSITY_MODES],
      highlightIndex: this.densityHighlightIndex,
      onHighlightChange: (index) => {
        this.densityHighlightIndex = index;
      },
      onSelect: (index) => this.handleDensityLayerChange(DENSITY_MODES[index].mode),
      onClose: () => {
        this.showDensityMenu = false;
        this.densityHighlightIndex = -1;
      },
      supportHomeEnd: true,
    });
  }

  private handleDensityLayerChange(mode: DensityLayerMode) {
    this.showDensityMenu = false;
    this.densityHighlightIndex = -1;
    this.densityLayer = mode;
    this._densityCommit.schedule(() => {
      if (this.autoSync && this._scatterplotElement) {
        const scatterplot = this._scatterplotElement as ScatterplotElementLike;
        scatterplot.config = {
          ...(scatterplot.config ?? {}),
          densityLayer: mode,
        };
      }
      this.dispatchEvent(
        new CustomEvent<DensityLayerChangeDetail>('density-layer-change', {
          detail: { densityLayer: mode },
          bubbles: true,
          composed: true,
        }),
      );
    });
  }

  /** Set the contours mode from outside the menu: at once, dropping a pick still waiting. */
  applyDensityLayerSelection(mode: DensityLayerMode) {
    this._densityCommit.cancel();
    this.densityLayer = mode;
  }

  private handleClearSelections() {
    const customEvent = new CustomEvent('clear-selections', {
      detail: {},
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(customEvent);

    // Previously this reset `selectedProteinsCount` inside the auto-sync branch, so
    // clearing while `autoSync` was false (as `data-renderer.ts` sets it during a data
    // swap) emptied the chips but left the count stale — keeping the Clear button live
    // and Escape firing against an empty selection.
    this._commitSelection([], { afterPaint: true });
  }

  private handleSplitData() {
    // Isolation reads the scatterplot's selection: land a search pick still waiting first.
    this._selectionCommit.flush();
    const customEvent = new CustomEvent('isolate-data', {
      detail: {},
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(customEvent);

    if (this.autoSync && this._scatterplotElement) {
      const scatterplot = this._scatterplotElement as ScatterplotElementLike;
      scatterplot.isolateSelection?.();
    }
  }

  private handleResetSplit() {
    const customEvent = new CustomEvent('reset-isolation', {
      detail: {},
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(customEvent);

    if (this.autoSync && this._scatterplotElement) {
      const scatterplot = this._scatterplotElement as ScatterplotElementLike;
      scatterplot.resetIsolation?.();
      this.isolationMode = false;
      this.isolationHistory = [];
    }
  }

  public clearForNewDataset(): void {
    this._cancelPendingCommits();
  }

  render() {
    // `density-layer` is a plain attribute: show an unknown token as-is rather than throw.
    const densityLabel = DENSITY_MODE_LABELS[this.densityLayer]?.label ?? this.densityLayer;
    return html`
      <div class="control-bar">
        <!-- Left side controls -->
        <div class="left-controls" data-driver-id="projections">
          <!-- Projection selection -->
          <div class="control-group">
            <label for="projection-trigger">Projection:</label>
            <div class="projection-container">
              <button
                id="projection-trigger"
                class="dropdown-trigger ${this.showProjectionMenu ? 'open' : ''}"
                @click=${this.toggleProjectionMenu}
                @keydown=${this.handleProjectionKeydown}
                aria-haspopup="listbox"
                aria-expanded=${this.showProjectionMenu}
              >
                <span class="dropdown-trigger-text">
                  ${(this._pendingProjection ?? this.selectedProjection) || 'Select projection'}
                </span>
                <svg class="chevron-down" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              ${this.showProjectionMenu
                ? html`
                    <div
                      class="dropdown-menu align-left"
                      role="listbox"
                      @keydown=${this.handleProjectionKeydown}
                    >
                      <div class="dropdown-list">
                        ${this.projections.map(
                          (projection, index) => html`
                            <div
                              class="dropdown-item ${projection === this.selectedProjection
                                ? 'selected'
                                : ''} ${index === this.projectionHighlightIndex
                                ? 'highlighted'
                                : ''}"
                              role="option"
                              aria-selected=${projection === this.selectedProjection}
                              @click=${() => this.selectProjectionFromMenu(projection)}
                              @mouseenter=${() => {
                                this.projectionHighlightIndex = index;
                              }}
                            >
                              ${projection}
                            </div>
                          `,
                        )}
                      </div>
                    </div>
                  `
                : ''}
            </div>
          </div>

          <!-- Annotation selection -->
          <div class="control-group">
            <label for="annotation-select">Annotation:</label>
            <protspace-annotation-select
              id="annotation-select"
              .annotations=${this.annotations}
              .annotationDefinitions=${this._currentData?.annotations ?? {}}
              .eatAnnotations=${this._eatAnnotationKeys}
              .selectedAnnotation=${this._pendingAnnotation ?? this.selectedAnnotation}
              .selectedProjection=${this.selectedProjection}
              .statisticsRows=${this._currentData?.statisticsRows ?? NO_STATISTICS}
              .tooltipAnnotations=${this.tooltipAnnotations}
              @annotation-select=${this.handleAnnotationSelected}
              @tooltip-annotation-toggle=${this.handleTooltipAnnotationToggle}
            ></protspace-annotation-select>
          </div>
        </div>

        <!-- Search selection -->
        <div class="control-group search-group" data-driver-id="search">
          <protspace-protein-search
            .availableProteinIds=${this.allProteinIds}
            .selectedProteinIds=${this.selectedIdsChips}
            @selection-change=${this._handleSearchSelectionChange}
            @add-selection=${this._handleSearchSelectionAdd}
            @add-selection-multiple=${this._handleSearchSelectionAddMultiple}
            @remove-selection=${this._handleSearchSelectionRemove}
          ></protspace-protein-search>
        </div>

        <!-- Right side controls -->
        <div class="right-controls">
          <!-- Density contour mode -->
          <div class="export-container density-container">
            <button
              id="density-layer-trigger"
              class="dropdown-trigger ${this.showDensityMenu ? 'open' : ''} ${this.densityLayer ===
              'off'
                ? ''
                : 'filter-active'}"
              @click=${this.toggleDensityMenu}
              @keydown=${this.handleDensityKeydown}
              title="Contours: ${densityLabel}. One ring set per legend colour; not included in exports."
              aria-label="Contours: ${densityLabel}"
              aria-haspopup="menu"
              aria-expanded=${this.showDensityMenu}
            >
              <svg class="icon" viewBox="0 0 24 24">
                <path
                  d="M12 3.5c4.8 0 8.5 3.4 8.5 7.8 0 4.6-3.9 9.2-8.8 9.2S3.5 16.4 3.5 12 7.2 3.5 12 3.5z"
                />
                <path
                  d="M12.2 7.5c2.6 0 4.6 1.9 4.6 4.2 0 2.5-2.1 4.8-4.8 4.8S7.4 14.5 7.4 12s2.2-4.5 4.8-4.5z"
                />
                <circle cx="12" cy="12" r="1.3" fill="currentColor" />
              </svg>
              <span class="dropdown-trigger-text"
                >Contours${this.densityLayer === 'off' ? '' : `: ${densityLabel}`}</span
              >
              <svg class="chevron-down" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            ${this.showDensityMenu
              ? html`
                  <div
                    class="dropdown-menu align-right density-menu"
                    role="menu"
                    aria-label="Contours"
                    @keydown=${this.handleDensityKeydown}
                  >
                    <div class="dropdown-list">
                      ${DENSITY_MODES.map(
                        ({ mode, label, hint }, index) => html`
                          <div
                            class="dropdown-item density-item ${mode === this.densityLayer
                              ? 'selected'
                              : ''} ${index === this.densityHighlightIndex ? 'highlighted' : ''}"
                            role="menuitemradio"
                            aria-checked=${mode === this.densityLayer}
                            data-mode=${mode}
                            @click=${() => this.handleDensityLayerChange(mode)}
                            @mouseenter=${() => {
                              this.densityHighlightIndex = index;
                            }}
                          >
                            <span class="density-item-label">${label}</span>
                            <span class="density-item-hint">${hint}</span>
                          </div>
                        `,
                      )}
                    </div>
                  </div>
                `
              : ''}
          </div>

          <!-- Selection actions group -->
          <div class="selection-group" data-driver-id="selection">
            <!-- Selection mode toggle -->
            <button
              class=${this.selectionMode
                ? 'btn-primary right-controls-button right-controls-select'
                : 'btn-secondary right-controls-select right-controls-button'}
              ?disabled=${this._selectionDisabled}
              @click=${this.handleToggleSelectionMode}
              title=${this._selectionDisabled
                ? 'Selection disabled: Insufficient data points'
                : 'Select proteins by clicking or dragging to enclose multiple points'}
            >
              <svg class="icon" viewBox="0 0 24 24">
                <rect
                  x="3"
                  y="3"
                  width="18"
                  height="18"
                  rx="1"
                  stroke="currentColor"
                  stroke-dasharray="2 1"
                  fill="none"
                />
                <circle cx="8" cy="8" r="1.5" fill="currentColor" />
                <circle cx="12" cy="14" r="1.5" fill="currentColor" />
                <circle cx="16" cy="10" r="1.5" fill="currentColor" />
                <circle cx="7" cy="16" r="1.5" fill="currentColor" />
                <circle cx="17" cy="17" r="1.5" fill="currentColor" />
              </svg>
              Select
            </button>

            <!-- Selection tool picker (visible only in selection mode) -->
            ${this.selectionMode
              ? html`
                  <div class="segmented segmented--icon" role="group" aria-label="Selection tool">
                    <button
                      type="button"
                      class="segmented-btn"
                      @click=${() => this.handleSelectionToolChange('rectangle')}
                      title="Rectangle selection"
                      aria-label="Rectangle selection"
                      aria-pressed=${this.selectionTool === 'rectangle'}
                    >
                      <svg class="icon" viewBox="0 0 24 24">
                        <rect
                          x="4"
                          y="4"
                          width="16"
                          height="16"
                          rx="1"
                          stroke="currentColor"
                          stroke-dasharray="3 2"
                          fill="none"
                        />
                      </svg>
                    </button>
                    <button
                      type="button"
                      class="segmented-btn"
                      @click=${() => this.handleSelectionToolChange('lasso')}
                      title="Lasso selection"
                      aria-label="Lasso selection"
                      aria-pressed=${this.selectionTool === 'lasso'}
                    >
                      <svg class="icon" viewBox="0 0 24 24">
                        <path
                          d="M12 3C7 3 3 7 3 11c0 3 2 5.5 5 7l1.5 2.5c.3.5.8.5 1 0L12 18c5 0 9-3.5 9-7.5S17 3 12 3z"
                          stroke="currentColor"
                          stroke-width="1.5"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          fill="none"
                        />
                      </svg>
                    </button>
                  </div>
                `
              : ''}

            <!-- Clear selections button -->
            <button
              class="btn-secondary right-controls-button right-controls-clear"
              ?disabled=${this.selectedProteinsCount === 0}
              @click=${this.handleClearSelections}
              title="Clear all selected proteins"
            >
              <svg class="icon" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              Clear
            </button>

            <!-- Isolate data button -->
            <button
              class="btn-secondary right-controls-button right-controls-split"
              ?disabled=${this.selectedProteinsCount === 0}
              @click=${this.handleSplitData}
              title="Isolate selected proteins to focus on them"
            >
              <svg class="icon" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="2" fill="currentColor" />
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.5"
                  d="M12 1v5m0 12v5M3.93 3.93l3.54 3.54m9.06 9.06l3.54 3.54M1 12h5m12 0h5M3.93 20.07l3.54-3.54m9.06-9.06l3.54-3.54"
                  opacity="0.6"
                />
              </svg>
              Isolate
            </button>

            <!-- Reset split button -->
            ${this.isolationMode
              ? html`
                  <button
                    @click=${this.handleResetSplit}
                    title="Reset to original dataset"
                    class="btn-secondary"
                  >
                    <svg class="icon" viewBox="0 0 24 24">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0V9a8.002 8.002 0 0115.356 2m-15.356-2L4 4m15.356 6l2.5-2.5"
                      />
                    </svg>
                    Reset
                  </button>
                `
              : ''}
          </div>
        </div>
      </div>
    `;
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('click', this._onDocumentClick);
    document.addEventListener('keydown', this._onDocumentKeydown);

    // Listen for annotation / search opening
    this.addEventListener('annotation-opened', this._onAnnotationOpened);
    this.addEventListener('search-opened', this._onSearchOpened);

    if (this.autoSync) {
      this._setupAutoSync();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._cancelPendingCommits();
    document.removeEventListener('click', this._onDocumentClick);
    document.removeEventListener('keydown', this._onDocumentKeydown);
    this.removeEventListener('annotation-opened', this._onAnnotationOpened);
    this.removeEventListener('search-opened', this._onSearchOpened);
    this._clearAutoSyncTimer();

    if (this._scatterplotElement) {
      this._scatterplotElement.removeEventListener('data-change', this._onDataChange);
      this._scatterplotElement.removeEventListener('protein-click', this._onProteinClick);
      this._scatterplotElement.removeEventListener('brush-selection', this._onBrushSelection);
      this._scatterplotElement.removeEventListener('data-isolation', this._onDataIsolation);
      this._scatterplotElement.removeEventListener(
        'data-isolation-reset',
        this._onDataIsolationReset,
      );
      this._scatterplotElement.removeEventListener(
        'auto-disable-selection',
        this._onAutoDisableSelection,
      );
    }
  }

  /** A pick made on a dataset or element that is going away must not land later. */
  private _cancelPendingCommits() {
    this._annotationCommit.cancel();
    this._projectionCommit.cancel();
    this._densityCommit.cancel();
    this._selectionCommit.cancel();
    this._pendingAnnotation = null;
    this._pendingProjection = null;
  }

  private handleDocumentKeydown(event: KeyboardEvent) {
    const path = event.composedPath?.() ?? [];
    const inAriaModal = path.some(
      (n) => n instanceof HTMLElement && n.getAttribute('aria-modal') === 'true',
    );
    // A modal (the legend's dialogs, the figure editor) owns its own Escape.
    if (inAriaModal) return;

    if (event.key === 'Escape') {
      // Top priority: close any open duplicate-badge spider on the scatter plot
      // before falling through to selection-clearing. Dropdowns still handle
      // their own Escape (see isAnyDropdownOpen check below).
      if (this._scatterplotElement?.hasExpandedDuplicateStack?.()) {
        event.preventDefault();
        event.stopPropagation();
        this._scatterplotElement.closeExpandedDuplicateStack?.();
        return;
      }

      // Don't handle Escape if any dropdown is open (they handle it themselves)
      if (
        isAnyDropdownOpen({
          projection: this.showProjectionMenu,
          density: this.showDensityMenu,
        })
      ) {
        return;
      }

      // First priority: Clear selections if any exist
      if (this.selectedProteinsCount > 0) {
        event.preventDefault();
        event.stopPropagation();
        this.handleClearSelections();
      }
      // Second priority: Turn off selection mode
      else if (this.selectionMode) {
        event.preventDefault();
        event.stopPropagation();
        this.handleToggleSelectionMode();
      }
    }
  }

  private handleDocumentClick(event: Event) {
    const path = (event as Event & { composedPath?: () => EventTarget[] }).composedPath?.() || [];

    // Check if click is inside ANY open dropdown menu
    const dropdownElements = [
      this.shadowRoot?.querySelector('.dropdown-menu.align-left'), // Projection
      this.shadowRoot?.querySelector('.density-container'), // Contours
      // Get annotation-select element
      this.shadowRoot?.querySelector('protspace-annotation-select'),
      // Get search element
      this.shadowRoot?.querySelector('protspace-protein-search'),
    ].filter(Boolean);

    const clickInsideDropdown = dropdownElements.some((el) => {
      if (!el) return false;
      // Check both the element itself and its shadow root contents
      return path.includes(el) || (el as HTMLElement).contains(event.target as Node);
    });

    // Close ALL dropdowns if click is outside all dropdown menus
    if (!clickInsideDropdown) {
      // Close control-bar dropdowns
      this.showProjectionMenu = false;
      this.projectionHighlightIndex = -1;
      this.showDensityMenu = false;
      this.densityHighlightIndex = -1;

      // Close annotation dropdown via custom event
      const annotationSelect = this.shadowRoot?.querySelector('protspace-annotation-select');
      if (annotationSelect) {
        annotationSelect.dispatchEvent(new CustomEvent('close-dropdown', { bubbles: false }));
      }

      // Close search suggestions via custom event
      const searchElement = this.shadowRoot?.querySelector('protspace-protein-search');
      if (searchElement) {
        searchElement.dispatchEvent(new CustomEvent('close-search', { bubbles: false }));
      }
    }
  }

  private _clearAutoSyncTimer() {
    if (this._autoSyncTimer !== null) {
      clearTimeout(this._autoSyncTimer);
      this._autoSyncTimer = null;
    }
  }

  private _scheduleAutoSync(callback: () => void, delayMs: number) {
    this._autoSyncTimer = setTimeout(() => {
      this._autoSyncTimer = null;
      if (this.isConnected) callback();
    }, delayMs);
  }

  private _setupAutoSync() {
    this._clearAutoSyncTimer();
    // Find scatterplot element with retries
    const trySetup = (attempts: number = 0) => {
      this._scatterplotElement = document.querySelector(
        this.scatterplotSelector,
      ) as ScatterplotElementLike | null;

      if (this._scatterplotElement) {
        // Listen for data changes
        this._scatterplotElement.addEventListener('data-change', this._onDataChange);

        // Listen for protein selection changes
        this._scatterplotElement.addEventListener('protein-click', this._onProteinClick);

        // Listen for brush selection events
        this._scatterplotElement.addEventListener('brush-selection', this._onBrushSelection);

        // Listen for data isolation events
        this._scatterplotElement.addEventListener('data-isolation', this._onDataIsolation);

        this._scatterplotElement.addEventListener(
          'data-isolation-reset',
          this._onDataIsolationReset,
        );

        this._scatterplotElement.addEventListener(
          'auto-disable-selection',
          this._onAutoDisableSelection,
        );

        // Initial sync after a short delay to ensure scatterplot is ready
        this._scheduleAutoSync(() => this._syncWithScatterplot(), 50);
      } else if (attempts < 10) {
        // Retry up to 10 times with increasing delay
        this._scheduleAutoSync(() => trySetup(attempts + 1), 100 + attempts * 50);
      }
    };

    trySetup();
  }

  private _handleDataChange(event: Event) {
    const { data } = (event as CustomEvent<DataChangeDetail>).detail || {};
    if (!data) return;

    const stableData = (this._scatterplotElement as ScatterplotElementLike | null)?.data ?? data;
    this._updateOptionsFromData(data, stableData);

    // Update protein ids for search
    try {
      const ids = data.protein_ids;
      this.allProteinIds = Array.isArray(ids) ? ids : [];
      // Keep chips in sync with scatterplot's selection if available
      if (this._scatterplotElement && 'selectedProteinIds' in this._scatterplotElement) {
        const current = (this._scatterplotElement as ScatterplotElementLike).selectedProteinIds;
        this.selectedIdsChips = Array.isArray(current) ? current : [];
        this.selectedProteinsCount = this.selectedIdsChips.length;
      }
    } catch (e) {
      console.error(e);
    }
    // The annotation select's definitions and statistics read the materialized (full) data, so
    // its badges describe the dataset, not the isolated subset.
    if (this._scatterplotElement) {
      const sp = this._scatterplotElement as ScatterplotElementLike;
      this._currentData = sp.getMaterializedData?.() ?? sp.getCurrentData?.();
    }

    this.requestUpdate();
  }

  /**
   * Single commit point for every selection change: mirror the new selection into local
   * state, into the scatterplot when auto-syncing, and out on `protein-selection-change`.
   * Each caller only derives `newSelection`; keeping the commit here stops the four steps
   * from drifting apart across the handlers that share them.
   *
   * `afterPaint` (search box picks, Clear) also sets the chips and count now, so the next
   * pick builds on this one, and runs the commit after the cleared box is painted.
   * `showProteinId` then loads into the structure viewers with that commit.
   */
  private _commitSelection(
    newSelection: string[],
    { afterPaint = false, showProteinId }: { afterPaint?: boolean; showProteinId?: string } = {},
  ) {
    const commit = () => {
      this.selectedIdsChips = newSelection;
      this.selectedProteinsCount = newSelection.length;
      if (
        this.autoSync &&
        this._scatterplotElement &&
        'selectedProteinIds' in this._scatterplotElement
      ) {
        (this._scatterplotElement as ScatterplotElementLike).selectedProteinIds = [...newSelection];
      }
      this.dispatchEvent(
        new CustomEvent('protein-selection-change', {
          detail: { proteinIds: newSelection.slice() },
          bubbles: true,
          composed: true,
        }),
      );
      if (showProteinId) this._loadIntoStructureViewers(showProteinId);
    };
    if (afterPaint) {
      this.selectedIdsChips = newSelection;
      this.selectedProteinsCount = newSelection.length;
      this._selectionCommit.schedule(commit);
    } else {
      this._selectionCommit.cancel();
      commit();
    }
  }

  /** Load a protein into every mounted structure viewer. */
  private _loadIntoStructureViewers(proteinId: string) {
    const viewers = Array.from(
      document.querySelectorAll('protspace-structure-viewer'),
    ) as StructureViewerElement[];
    viewers.forEach((v) => v?.loadProtein?.(proteinId));
  }

  private _handleProteinSelection(event: Event) {
    const { proteinId, modifierKeys } = (event as CustomEvent<ProteinClickDetail>).detail;
    if (!proteinId) return;

    let newSelection: string[];

    // Toggle mode: When selectionMode is active OR modifier keys are pressed
    if (this.selectionMode || modifierKeys?.ctrl || modifierKeys?.meta) {
      newSelection = toggleProteinSelection(proteinId, this.selectedIdsChips);
    }
    // Replace mode: No modifier keys and selectionMode inactive
    else {
      const isOnlySelected =
        this.selectedIdsChips.length === 1 && this.selectedIdsChips[0] === proteinId;
      newSelection = isOnlySelected ? [] : [proteinId];
    }
    this._commitSelection(newSelection);
    this.requestUpdate();
  }

  private _handleDataIsolation(event: Event) {
    const customEvent = event as CustomEvent;
    const { isolationHistory, isolationMode } = customEvent.detail;
    this.isolationHistory = isolationHistory;
    this.isolationMode = isolationMode;
    this.selectedProteinsCount = 0;
    this.selectedIdsChips = [];
    this.requestUpdate();
  }

  private _handleDataIsolationReset(event: Event) {
    const customEvent = event as CustomEvent;
    const { isolationHistory, isolationMode } = customEvent.detail;
    this.isolationHistory = isolationHistory;
    this.isolationMode = isolationMode;
    this.selectedProteinsCount = 0;
    this.selectedIdsChips = [];

    // Re-enable selection when isolation is reset (back to full data)
    this._selectionDisabled = false;

    this.requestUpdate();
  }

  private _handleAutoDisableSelection(event: Event) {
    const customEvent = event as CustomEvent;
    const { reason, dataSize } = customEvent.detail;

    // Handle the business logic
    this.selectionMode = false;

    // Disable the selection mode toggle when insufficient data
    if (reason === 'insufficient-data' && dataSize <= 1) {
      this._selectionDisabled = true;
    }

    this.requestUpdate();

    // Dispatch a separate notification event for the UI layer to handle
    // This separates business logic from presentation concerns
    const detail: SelectionDisabledNotificationDetail = createSelectionDisabledNotificationDetail(
      reason,
      dataSize,
    );

    this.dispatchEvent(
      new CustomEvent<SelectionDisabledNotificationDetail>('selection-disabled-notification', {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _updateOptionsFromData(data: ProtspaceData, capabilityData: ProtspaceData = data) {
    // Update projections and annotations
    this.projectionsMeta = data.projections || [];
    this.projections = this.projectionsMeta.map((p) => p.name) || [];
    const fullAnnotationKeys = Object.keys(data.annotations || {}).filter(
      (a) => !TOOLTIP_ONLY_ANNOTATIONS.has(a),
    );
    this.annotations = fullAnnotationKeys.filter(
      (key) => !isEatConfidenceAnnotation(data.annotations?.[key]),
    );
    this._eatAnnotationKeys = Object.entries(capabilityData.annotation_predicted ?? {})
      .filter(([, cells]) => cells.some(Boolean))
      .map(([annotation]) => annotation);

    // Default selections if invalid
    if (!this.selectedProjection || !this.projections.includes(this.selectedProjection)) {
      this.selectedProjection = this.projections[0] || '';
    }
    if (!this.selectedAnnotation || !this.annotations.includes(this.selectedAnnotation)) {
      this.selectedAnnotation = this.annotations[0] || '';
    }
  }

  private _syncWithScatterplot() {
    if (this._scatterplotElement && 'getCurrentData' in this._scatterplotElement) {
      const scatterplot = this._scatterplotElement as ScatterplotElementLike;
      let data: ProtspaceData | undefined;
      data = scatterplot.getCurrentData?.();

      if (data) {
        // Extract projections and annotations
        this._updateOptionsFromData(data);

        // Sync current values from scatterplot
        if (scatterplot.selectedAnnotation !== undefined) {
          // Only use the scatterplot's selected annotation if it's still available
          const scatterplotAnnotation = scatterplot.selectedAnnotation;
          if (scatterplotAnnotation && this.annotations.includes(scatterplotAnnotation)) {
            this.selectedAnnotation = scatterplotAnnotation;
          } else {
            this.selectedAnnotation = this.annotations[0] || '';
          }
        }

        if ('selectedProjectionIndex' in scatterplot) {
          const projIndex = scatterplot.selectedProjectionIndex as number | undefined;
          if (
            typeof projIndex === 'number' &&
            projIndex >= 0 &&
            projIndex < this.projections.length
          ) {
            this.selectedProjection = this.projections[projIndex];
          }
        }

        if ('selectionMode' in scatterplot) {
          this.selectionMode = Boolean(scatterplot.selectionMode);
        }

        if ('selectedProteinIds' in scatterplot) {
          this.selectedProteinsCount = ((scatterplot.selectedProteinIds as unknown[]) || []).length;
          this.selectedIdsChips = Array.isArray(scatterplot.selectedProteinIds)
            ? (scatterplot.selectedProteinIds as string[])
            : [];
        }

        this.isolationMode = scatterplot.isIsolationMode?.() ?? false;
        this.isolationHistory = scatterplot.getIsolationHistory?.() ?? [];

        // Set defaults if not already set
        if (!this.selectedProjection && this.projections.length > 0) {
          this.selectedProjection = this.projections[0];
        }
        if (!this.selectedAnnotation && this.annotations.length > 0) {
          this.selectedAnnotation = this.annotations[0];
        }

        this.requestUpdate();
      }
    }
  }

  // Search selection handler
  private _handleSearchSelectionChange(event: CustomEvent<{ proteinIds: string[] }>) {
    // This handles programmatic changes and clearing from within the search component
    this._commitSelection(event.detail.proteinIds);
  }

  private _handleSearchSelectionAdd(event: CustomEvent<{ proteinId: string }>) {
    const { proteinId } = event.detail;
    if (!proteinId || this.selectedIdsChips.includes(proteinId)) return;

    this._commitSelection([...this.selectedIdsChips, proteinId], {
      afterPaint: true,
      showProteinId: proteinId,
    });
  }

  private _handleSearchSelectionRemove(event: CustomEvent<{ proteinId: string }>) {
    const { proteinId } = event.detail;
    if (!proteinId || !this.selectedIdsChips.includes(proteinId)) return;

    // No structure-viewer call here: removal has no "the protein you just picked" to show.
    // The app-level `protein-selection-change` listener still re-points the viewer at the
    // new last-remaining protein (or leaves it alone once the selection empties).
    this._commitSelection(
      this.selectedIdsChips.filter((id) => id !== proteinId),
      { afterPaint: true },
    );
  }

  private _handleSearchSelectionAddMultiple(event: CustomEvent<{ proteinIds: string[] }>) {
    const { proteinIds } = event.detail;
    if (!proteinIds || proteinIds.length === 0) return;

    const currentSelectedSet = new Set(this.selectedIdsChips);
    const newUniqueIds = proteinIds.filter((id) => !currentSelectedSet.has(id));

    if (newUniqueIds.length === 0) return;

    this._commitSelection([...this.selectedIdsChips, ...newUniqueIds], {
      afterPaint: true,
      showProteinId: newUniqueIds[newUniqueIds.length - 1],
    });
  }

  private _handleBrushSelection(event: Event) {
    const customEvent = event as CustomEvent<BrushSelectionDetail>;
    const ids = Array.isArray(customEvent.detail?.proteinIds) ? customEvent.detail.proteinIds : [];
    const distinct = customEvent.detail?.idsUnique === true;

    // When selectionMode is active, merge with existing; otherwise replace
    this._commitSelection(
      this.selectionMode
        ? mergeProteinSelections(this.selectedIdsChips, ids, distinct)
        : ids.slice(),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-control-bar': ProtspaceControlBar;
  }
}
