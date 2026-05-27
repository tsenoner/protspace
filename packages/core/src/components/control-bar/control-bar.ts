import { LitElement, html } from 'lit';
import { property, state } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import { controlBarStyles } from './control-bar.styles';
import type {
  DataChangeDetail,
  ProtspaceData,
  ScatterplotElementLike,
  DataLoaderElement,
  StructureViewerElement,
} from './types';
import { handleDropdownEscape, isAnyDropdownOpen } from '../../utils/dropdown-helpers';
import {
  EXPORT_DEFAULTS,
  isProjection3D,
  getProjectionPlane,
  toggleProteinSelection,
  mergeProteinSelections,
} from './control-bar-helpers';
import {
  createSelectionDisabledNotificationDetail,
  type SelectionDisabledNotificationDetail,
} from './control-bar.events';
import './search';
import './annotation-select';
import './query-builder';
import type { FilterQuery } from './query-types';
import { createCondition } from './query-types';

/** Annotations used only for tooltip display, hidden from the annotation dropdown */
const TOOLTIP_ONLY_ANNOTATIONS = new Set(['gene_name', 'protein_name', 'uniprot_kb_id']);

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
  @property({ type: String, attribute: 'projection-plane' })
  projectionPlane: 'xy' | 'xz' | 'yz' = 'xy';
  @property({ type: Boolean, attribute: 'selection-mode' })
  selectionMode: boolean = false;
  @property({ type: String, attribute: 'selection-tool' })
  selectionTool: 'rectangle' | 'lasso' = 'rectangle';
  @property({ type: Number, attribute: 'selected-proteins-count' })
  selectedProteinsCount: number = 0;
  @property({ type: Boolean, attribute: 'isolation-mode' })
  isolationMode: boolean = false;
  @property({ type: Array, attribute: 'isolation-history' })
  isolationHistory: string[][] = [];
  @property({ type: Boolean, attribute: 'has-file-settings' })
  hasFileSettings: boolean = false;
  @property({ type: String, attribute: 'current-dataset-name' })
  currentDatasetName: string = '';
  @property({ type: Boolean, attribute: 'current-dataset-is-demo' })
  currentDatasetIsDemo: boolean = false;

  @state() private _selectionDisabled: boolean = false;

  // Auto-sync properties (optional, can be derived from events)
  @property({ type: String, attribute: 'scatterplot-selector' })
  scatterplotSelector: string = 'protspace-scatterplot';
  @property({ type: Boolean, attribute: 'auto-sync' })
  autoSync: boolean = true;

  @state() private showExportMenu: boolean = false;
  @state() private showImportMenu: boolean = false;
  @state() private showFilterMenu: boolean = false;
  @state() private showProjectionMenu: boolean = false;
  @state() private filterQuery: FilterQuery = [];
  @state() private filterActive = false;
  @state() private _currentData: ProtspaceData | undefined;
  @state() private projectionHighlightIndex: number = -1;

  // Export configuration state
  @state() private exportFormat: 'png' | 'pdf' | 'ids' | 'parquet' = EXPORT_DEFAULTS.FORMAT;
  @state() private exportIncludeLegendSettings: boolean = true;
  private _scatterplotElement: ScatterplotElementLike | null = null;

  // Search state
  @state() private allProteinIds: string[] = [];
  @state() private selectedIdsChips: string[] = [];

  // Stable listeners for proper add/remove
  private _onDocumentClick = (event: Event) => this.handleDocumentClick(event);
  private _onDocumentKeydown = (event: KeyboardEvent) => this.handleDocumentKeydown(event);
  private _onDataChange = (event: Event) => this._handleDataChange(event);
  private _onProteinClick = (event: Event) => this._handleProteinSelection(event);
  private _onDataIsolation = (event: Event) => this._handleDataIsolation(event);
  private _onDataIsolationReset = (event: Event) => this._handleDataIsolationReset(event);
  private _onAutoDisableSelection = (event: Event) => this._handleAutoDisableSelection(event);
  private _onBrushSelection = (event: Event) => this._handleBrushSelection(event);

  static styles = controlBarStyles;

  /**
   * Close all dropdowns except the specified one
   */
  private closeOtherDropdowns(except: 'projection' | 'filter' | 'export' | 'import') {
    if (except !== 'projection') this.showProjectionMenu = false;
    if (except !== 'filter') this.showFilterMenu = false;
    if (except !== 'export') this.showExportMenu = false;
    if (except !== 'import') this.showImportMenu = false;

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

  applyProjectionSelection(projection: string) {
    this.selectedProjection = projection;
    this.showProjectionMenu = false;
    this.projectionHighlightIndex = -1;

    // If auto-sync is enabled, directly update the scatterplot
    if (this.autoSync && this._scatterplotElement) {
      const projectionIndex = this.projections.findIndex((p) => p === projection);
      if (projectionIndex !== -1 && 'selectedProjectionIndex' in this._scatterplotElement) {
        (this._scatterplotElement as ScatterplotElementLike).selectedProjectionIndex =
          projectionIndex;

        const is3D = isProjection3D(this.selectedProjection, this.projectionsMeta);
        const nextPlane = getProjectionPlane(is3D, this.projectionPlane);
        if ('projectionPlane' in this._scatterplotElement) {
          (this._scatterplotElement as ScatterplotElementLike).projectionPlane = nextPlane;
        }
        this.projectionPlane = nextPlane;
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
        this.applyProjectionSelection(this.projections[index]);
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
    this.updateComplete.then(() => {
      const highlighted =
        this.shadowRoot?.querySelector('.dropdown-item.highlighted') ||
        this.shadowRoot?.querySelector('.filter-menu-list-item.highlighted');
      if (highlighted) {
        highlighted.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
  }

  private handlePlaneChange(event: Event) {
    const target = event.target as HTMLSelectElement;
    const plane = target.value as 'xy' | 'xz' | 'yz';
    if (
      this.autoSync &&
      this._scatterplotElement &&
      'projectionPlane' in this._scatterplotElement
    ) {
      (this._scatterplotElement as ScatterplotElementLike).projectionPlane = plane;
      this.projectionPlane = plane;
    }
    const customEvent = new CustomEvent('projection-plane-change', {
      detail: { plane },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(customEvent);
  }

  applyAnnotationSelection(annotation: string) {
    this.selectedAnnotation = annotation;

    // If auto-sync is enabled, directly update the scatterplot
    if (this.autoSync && this._scatterplotElement) {
      if ('selectedAnnotation' in this._scatterplotElement) {
        (this._scatterplotElement as ScatterplotElementLike).selectedAnnotation = annotation;
      }
    }

    const customEvent = new CustomEvent('annotation-change', {
      detail: { annotation },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(customEvent);
  }

  private handleAnnotationSelected(event: CustomEvent<{ annotation: string }>) {
    this.applyAnnotationSelection(event.detail.annotation);
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

  private handleClearSelections() {
    const customEvent = new CustomEvent('clear-selections', {
      detail: {},
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(customEvent);

    // If auto-sync is enabled, directly clear selections in scatterplot
    if (this.autoSync && this._scatterplotElement) {
      if ('selectedProteinIds' in this._scatterplotElement) {
        (this._scatterplotElement as ScatterplotElementLike).selectedProteinIds = [];
        this.selectedProteinsCount = 0;
      }
    }

    // Clear search chips
    this.selectedIdsChips = [];

    // Dispatch a single, consistent event for all selection changes
    this.dispatchEvent(
      new CustomEvent('protein-selection-change', {
        detail: { proteinIds: [] },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private handleSplitData() {
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

  private handleExport() {
    const customEvent = new CustomEvent('export', {
      detail: {
        type: this.exportFormat,
        imageWidth: EXPORT_DEFAULTS.IMAGE_WIDTH,
        imageHeight: EXPORT_DEFAULTS.IMAGE_HEIGHT,
        legendWidthPercent: EXPORT_DEFAULTS.LEGEND_WIDTH_PERCENT,
        legendFontSizePx: EXPORT_DEFAULTS.LEGEND_FONT_SIZE_PX,
        includeLegend: EXPORT_DEFAULTS.INCLUDE_LEGEND,
        includeLegendSettings: this.exportIncludeLegendSettings,
      },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(customEvent);
    this.showExportMenu = false;
  }

  private handleOpenPublishEditor() {
    const customEvent = new CustomEvent('open-publish-editor', {
      detail: {},
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(customEvent);
    this.showExportMenu = false;
  }

  private toggleExportMenu(event?: Event) {
    event?.stopPropagation();
    this.showExportMenu = !this.showExportMenu;
    if (this.showExportMenu) {
      this.closeOtherDropdowns('export');
      this.updateComplete.then(() => {
        const firstFormatBtn = this.shadowRoot?.querySelector(
          '.export-format-options button',
        ) as HTMLButtonElement | null;
        firstFormatBtn?.focus();
      });
    }
  }

  private toggleImportMenu(event?: Event) {
    event?.stopPropagation();
    this.showImportMenu = !this.showImportMenu;
    if (this.showImportMenu) {
      this.closeOtherDropdowns('import');
      this.updateComplete.then(() => {
        const firstImportAction = this.shadowRoot?.querySelector(
          '.import-menu button',
        ) as HTMLButtonElement | null;
        firstImportAction?.focus();
      });
    }
  }

  private handleExportKeydown(event: KeyboardEvent) {
    if (!this.showExportMenu) {
      // Handle trigger button keys
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.toggleExportMenu();
      }
      return;
    }

    // Only handle Escape to close (native form navigation handles the rest)
    if (event.key === 'Escape') {
      handleDropdownEscape(event, () => {
        this.showExportMenu = false;
      });
    }
  }

  private handleImportKeydown(event: KeyboardEvent) {
    if (!this.showImportMenu) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.toggleImportMenu();
      }
      return;
    }

    if (event.key === 'Escape') {
      handleDropdownEscape(event, () => {
        this.showImportMenu = false;
      });
    }
  }

  public clearForNewDataset(_datasetHash: string, _clearPersistedState: boolean = true): void {
    this.exportFormat = EXPORT_DEFAULTS.FORMAT;
  }

  private openFileDialog() {
    this.showImportMenu = false;
    const loader = document.querySelector('protspace-data-loader') as DataLoaderElement;
    const fileInput = loader?.shadowRoot?.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement | null;
    fileInput?.click();
  }

  private handleLoadDemoDataset() {
    this.showImportMenu = false;
    this.dispatchEvent(
      new CustomEvent('load-demo-dataset', {
        bubbles: true,
        composed: true,
      }),
    );
  }

  render() {
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
                  ${this.selectedProjection || 'Select projection'}
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
                              @click=${() => this.applyProjectionSelection(projection)}
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

          ${(() => {
            return isProjection3D(this.selectedProjection, this.projectionsMeta)
              ? html`
                  <div class="control-group">
                    <label for="plane-select">Plane:</label>
                    <select
                      id="plane-select"
                      .value=${this.projectionPlane}
                      @change=${this.handlePlaneChange}
                    >
                      <option value="xy">XY</option>
                      <option value="xz">XZ</option>
                      <option value="yz">YZ</option>
                    </select>
                  </div>
                `
              : null;
          })()}

          <!-- Annotation selection -->
          <div class="control-group">
            <label for="annotation-select">Annotation:</label>
            <protspace-annotation-select
              id="annotation-select"
              .annotations=${this.annotations}
              .selectedAnnotation=${this.selectedAnnotation}
              @annotation-select=${this.handleAnnotationSelected}
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
          ></protspace-protein-search>
        </div>

        <!-- Right side controls -->
        <div class="right-controls">
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
                  <div class="tool-toggle" role="group" aria-label="Selection tool">
                    <button
                      class=${this.selectionTool === 'rectangle'
                        ? 'tool-toggle-btn active'
                        : 'tool-toggle-btn'}
                      @click=${() => this.handleSelectionToolChange('rectangle')}
                      title="Rectangle selection"
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
                      class=${this.selectionTool === 'lasso'
                        ? 'tool-toggle-btn active'
                        : 'tool-toggle-btn'}
                      @click=${() => this.handleSelectionToolChange('lasso')}
                      title="Lasso selection"
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

          <!-- Filter / Export / Import group -->
          <div class="data-actions-group" data-driver-id="data-actions">
            <div class="filter-container right-controls-filter">
              <button
                class="dropdown-trigger ${this.showFilterMenu ? 'open' : ''} ${this.filterActive
                  ? 'filter-active'
                  : ''}"
                @click=${this.toggleFilterMenu}
                title="Filter Options"
              >
                <svg class="icon" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M3 5h18M6 12h12M10 19h4"
                  />
                </svg>
                Filter
                ${this.filterActive
                  ? html`<span class="filter-badge">${this.filterQuery.length}</span>`
                  : html`<svg class="chevron-down" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>`}
              </button>
            </div>

            <!-- Export dropdown -->
            <div class="export-container right-controls-export">
              <button
                class="dropdown-trigger ${this.showExportMenu ? 'open' : ''}"
                @click=${this.toggleExportMenu}
                @keydown=${this.handleExportKeydown}
                title="${this.hasFileSettings
                  ? 'Export Options (file contains custom settings)'
                  : 'Export Options'}"
              >
                <svg class="icon" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
                Export
                <svg class="chevron-down" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              ${this.showExportMenu
                ? html`
                    <div class="export-menu" @keydown=${this.handleExportKeydown}>
                      <div class="export-menu-header">
                        <span>Export Options</span>
                      </div>

                      <div class="export-menu-content">
                        <!-- Format Selection -->
                        <div class="export-option-group">
                          <label class="export-option-label">Format</label>
                          <div class="export-format-options">
                            <button
                              class="btn-secondary btn-compact ${this.exportFormat === 'png'
                                ? 'active'
                                : ''}"
                              @click=${() => {
                                this.exportFormat = 'png';
                              }}
                              title="Export as PNG image"
                            >
                              PNG
                            </button>
                            <button
                              class="btn-secondary btn-compact ${this.exportFormat === 'pdf'
                                ? 'active'
                                : ''}"
                              @click=${() => {
                                this.exportFormat = 'pdf';
                              }}
                              title="Export as PDF document"
                            >
                              PDF
                            </button>
                            <button
                              class="btn-secondary btn-compact ${this.exportFormat === 'ids'
                                ? 'active'
                                : ''}"
                              @click=${() => {
                                this.exportFormat = 'ids';
                              }}
                              title="Export protein IDs list"
                            >
                              IDs
                            </button>
                            <button
                              class="btn-secondary btn-compact ${this.exportFormat === 'parquet'
                                ? 'active'
                                : ''}"
                              @click=${() => {
                                this.exportFormat = 'parquet';
                              }}
                              title="Export as Parquet bundle"
                            >
                              Parquet
                            </button>
                          </div>
                        </div>

                        <!-- Parquet Settings -->
                        ${this.exportFormat === 'parquet'
                          ? html`
                              <div class="export-option-group">
                                <label class="export-checkbox-label">
                                  <input
                                    type="checkbox"
                                    class="export-checkbox"
                                    .checked=${this.exportIncludeLegendSettings}
                                    @change=${(e: Event) => {
                                      this.exportIncludeLegendSettings = (
                                        e.target as HTMLInputElement
                                      ).checked;
                                    }}
                                  />
                                  <span>Include legend settings</span>
                                </label>
                                <div class="export-parquet-help">
                                  Legend customizations can be saved in the file and restored when
                                  loading.
                                </div>
                              </div>
                            `
                          : ''}

                        <!-- Image export actions (PNG/PDF) or direct export (IDs/Parquet) -->
                        ${this.exportFormat === 'png' || this.exportFormat === 'pdf'
                          ? html`
                              <div class="export-image-actions">
                                <button
                                  class="btn-primary"
                                  @click=${this.handleOpenPublishEditor}
                                  title="Open full-screen figure editor with live preview, journal presets, and annotation tools"
                                >
                                  <svg class="icon" viewBox="0 0 24 24">
                                    <path
                                      stroke-linecap="round"
                                      stroke-linejoin="round"
                                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                                    />
                                  </svg>
                                  Figure Editor
                                </button>
                                <button class="btn-secondary" @click=${this.handleExport}>
                                  <svg class="icon" viewBox="0 0 24 24">
                                    <path
                                      stroke-linecap="round"
                                      stroke-linejoin="round"
                                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                                    />
                                  </svg>
                                  Quick Export ${this.exportFormat.toUpperCase()}
                                </button>
                              </div>
                              <div class="export-image-hint">
                                Figure Editor offers live preview, journal presets, annotations, and
                                more.
                              </div>
                            `
                          : html`
                              <button
                                class="btn-primary export-action-btn"
                                @click=${this.handleExport}
                              >
                                <svg class="icon" viewBox="0 0 24 24">
                                  <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                                  />
                                </svg>
                                Export ${this.exportFormat.toUpperCase()}
                              </button>
                            `}
                      </div>
                    </div>
                  `
                : ''}
            </div>
            <div class="export-container right-controls-data" data-driver-id="import">
              <button
                class="dropdown-trigger ${this.showImportMenu ? 'open' : ''}"
                @click=${this.toggleImportMenu}
                @keydown=${this.handleImportKeydown}
                title="Import Data"
                aria-haspopup="menu"
                aria-expanded=${this.showImportMenu}
              >
                <svg class="icon" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L9 8m3-4v12"
                  />
                </svg>
                <span class="dropdown-trigger-text">Import</span>
                <svg class="chevron-down" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              ${this.showImportMenu
                ? html`
                    <div class="dropdown-menu align-right import-menu" role="menu">
                      <div class="import-current-dataset">
                        <span class="import-current-dataset-label">Current dataset</span>
                        <span
                          class="import-current-dataset-name"
                          title=${this.currentDatasetName || 'No dataset loaded'}
                        >
                          ${this.currentDatasetName || 'No dataset loaded'}
                        </span>
                      </div>
                      <div class="import-actions">
                        <button
                          class="btn-primary"
                          @click=${this.openFileDialog}
                          data-driver-id="import-own-dataset"
                        >
                          Load your dataset
                        </button>
                        <button
                          class="btn-secondary"
                          @click=${this.handleLoadDemoDataset}
                          data-driver-id="import-demo-dataset"
                          ?disabled=${this.currentDatasetIsDemo}
                        >
                          Load demo dataset
                        </button>
                      </div>
                    </div>
                  `
                : ''}
            </div>
          </div>
        </div>
      </div>

      ${this.showFilterMenu
        ? html`
            <div class="query-builder-overlay" @click=${this._handleOverlayClick}>
              <div
                class="query-builder-modal"
                role="dialog"
                aria-modal="true"
                aria-label="Filter Query Builder"
                @click=${(e: Event) => e.stopPropagation()}
              >
                <protspace-query-builder
                  .annotations=${this.annotations}
                  .data=${this._currentData}
                  .query=${this.filterQuery}
                  @query-changed=${this._handleQueryChanged}
                  @query-apply=${this._handleQueryApply}
                  @query-reset=${this._handleQueryReset}
                  @query-close=${this._handleQueryClose}
                ></protspace-query-builder>
              </div>
            </div>
          `
        : ''}
    `;
  }

  private _handleOverlayClick() {
    this.showFilterMenu = false;
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('click', this._onDocumentClick);
    document.addEventListener('keydown', this._onDocumentKeydown);

    // Listen for annotation opening
    this.addEventListener('annotation-opened', () => {
      this.showProjectionMenu = false;
      this.showFilterMenu = false;
      this.showExportMenu = false;
      this.showImportMenu = false;
      // Close search when annotation opens
      this.shadowRoot
        ?.querySelector('protspace-protein-search')
        ?.dispatchEvent(new CustomEvent('close-search', { bubbles: false }));
    });

    // Listen for search opening
    this.addEventListener('search-opened', () => {
      this.showProjectionMenu = false;
      this.showFilterMenu = false;
      this.showExportMenu = false;
      this.showImportMenu = false;
      // Close annotation when search opens
      this.shadowRoot
        ?.querySelector('protspace-annotation-select')
        ?.dispatchEvent(new CustomEvent('close-dropdown', { bubbles: false }));
    });

    if (this.autoSync) {
      this._setupAutoSync();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('click', this._onDocumentClick);
    document.removeEventListener('keydown', this._onDocumentKeydown);

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

  private handleDocumentKeydown(event: KeyboardEvent) {
    const path = event.composedPath?.() ?? [];
    const inAriaModal = path.some(
      (n) => n instanceof HTMLElement && n.getAttribute('aria-modal') === 'true',
    );
    if (inAriaModal) {
      // ESC inside the filter modal closes the modal
      if (event.key === 'Escape' && this.showFilterMenu) {
        this.showFilterMenu = false;
      }
      return;
    }

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
          export: this.showExportMenu,
          import: this.showImportMenu,
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
      this.shadowRoot?.querySelector('.filter-menu'), // Filter
      this.shadowRoot?.querySelector('.export-menu'), // Export
      this.shadowRoot?.querySelector('.import-menu'), // Import
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
      this.showExportMenu = false;
      this.showImportMenu = false;
      this.showFilterMenu = false;
      this.showProjectionMenu = false;
      this.projectionHighlightIndex = -1;

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

  private _setupAutoSync() {
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
        setTimeout(() => {
          this._syncWithScatterplot();
        }, 50);
      } else if (attempts < 10) {
        // Retry up to 10 times with increasing delay
        setTimeout(() => trySetup(attempts + 1), 100 + attempts * 50);
      }
    };

    trySetup();
  }

  private _handleDataChange(event: Event) {
    const { data } = (event as CustomEvent<DataChangeDetail>).detail || {};
    if (!data) return;

    this._updateOptionsFromData(data);

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
    // Keep current data reference for query builder — use materialized (full) data
    // so match count reflects the full dataset, not the isolated subset
    if (this._scatterplotElement) {
      const sp = this._scatterplotElement as ScatterplotElementLike;
      this._currentData = sp.getMaterializedData?.() ?? sp.getCurrentData?.();
    }

    this.requestUpdate();
  }

  private _handleProteinSelection(event: Event) {
    const customEvent = event as CustomEvent<{
      proteinId: string;
      modifierKeys: { ctrl: boolean; meta: boolean; shift: boolean };
    }>;
    const { proteinId, modifierKeys } = customEvent.detail;
    if (!proteinId) return;

    let newSelection: string[];

    // Toggle mode: When selectionMode is active OR modifier keys are pressed
    if (this.selectionMode || modifierKeys.ctrl || modifierKeys.meta) {
      newSelection = toggleProteinSelection(proteinId, this.selectedIdsChips);
    }
    // Replace mode: No modifier keys and selectionMode inactive
    else {
      const isOnlySelected =
        this.selectedIdsChips.length === 1 && this.selectedIdsChips[0] === proteinId;
      newSelection = isOnlySelected ? [] : [proteinId];
    }
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

  private _updateOptionsFromData(data: ProtspaceData) {
    // Update projections and annotations
    this.projectionsMeta = data.projections || [];
    this.projections = this.projectionsMeta.map((p) => p.name) || [];
    this.annotations = Object.keys(data.annotations || {}).filter(
      (a) => !TOOLTIP_ONLY_ANNOTATIONS.has(a),
    );

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
    const newSelection = event.detail.proteinIds;
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
  }

  private _handleSearchSelectionAdd(event: CustomEvent<{ proteinId: string }>) {
    const { proteinId } = event.detail;
    if (!proteinId || this.selectedIdsChips.includes(proteinId)) return;

    const newSelection = [...this.selectedIdsChips, proteinId];
    this.selectedIdsChips = newSelection;
    this.selectedProteinsCount = newSelection.length;

    if (
      this.autoSync &&
      this._scatterplotElement &&
      'selectedProteinIds' in this._scatterplotElement
    ) {
      (this._scatterplotElement as ScatterplotElementLike).selectedProteinIds = [...newSelection];
    }

    const viewers = Array.from(
      document.querySelectorAll('protspace-structure-viewer'),
    ) as StructureViewerElement[];
    viewers.forEach((v) => v?.loadProtein?.(proteinId));

    this.dispatchEvent(
      new CustomEvent('protein-selection-change', {
        detail: { proteinIds: newSelection.slice() },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _handleSearchSelectionAddMultiple(event: CustomEvent<{ proteinIds: string[] }>) {
    const { proteinIds } = event.detail;
    if (!proteinIds || proteinIds.length === 0) return;

    const currentSelectedSet = new Set(this.selectedIdsChips);
    const newUniqueIds = proteinIds.filter((id) => !currentSelectedSet.has(id));

    if (newUniqueIds.length === 0) return;

    const newSelection = [...this.selectedIdsChips, ...newUniqueIds];
    this.selectedIdsChips = newSelection;
    this.selectedProteinsCount = newSelection.length;

    if (
      this.autoSync &&
      this._scatterplotElement &&
      'selectedProteinIds' in this._scatterplotElement
    ) {
      (this._scatterplotElement as ScatterplotElementLike).selectedProteinIds = [...newSelection];
    }

    const lastAddedId = newUniqueIds[newUniqueIds.length - 1];
    const viewers = Array.from(
      document.querySelectorAll('protspace-structure-viewer'),
    ) as StructureViewerElement[];
    viewers.forEach((v) => v?.loadProtein?.(lastAddedId));

    this.dispatchEvent(
      new CustomEvent('protein-selection-change', {
        detail: { proteinIds: newSelection.slice() },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _handleBrushSelection(event: Event) {
    const customEvent = event as CustomEvent<{ proteinIds: string[]; isMultiple: boolean }>;
    const ids = Array.isArray(customEvent.detail?.proteinIds) ? customEvent.detail.proteinIds : [];

    // When selectionMode is active, merge with existing; otherwise replace
    const newSelection = this.selectionMode
      ? mergeProteinSelections(this.selectedIdsChips, ids)
      : ids.slice();

    this.selectedIdsChips = newSelection;
    this.selectedProteinsCount = newSelection.length;

    // Sync with scatterplot if auto-sync is enabled
    if (
      this.autoSync &&
      this._scatterplotElement &&
      'selectedProteinIds' in this._scatterplotElement
    ) {
      (this._scatterplotElement as ScatterplotElementLike).selectedProteinIds = [...newSelection];
    }

    // Dispatch a single, consistent event for all selection changes
    this.dispatchEvent(
      new CustomEvent('protein-selection-change', {
        detail: { proteinIds: newSelection.slice() },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private toggleFilterMenu(event?: Event) {
    event?.stopPropagation();
    const opening = !this.showFilterMenu;
    this.showFilterMenu = opening;
    if (opening) {
      this.closeOtherDropdowns('filter');
      // Refresh current data for the query builder — use materialized (full) data
      // so match count reflects the full dataset, not the isolated subset
      if (this._scatterplotElement) {
        const sp = this._scatterplotElement as ScatterplotElementLike;
        this._currentData = sp.getMaterializedData?.() ?? sp.getCurrentData?.();
      }
      // Seed with one empty condition so the user sees a row immediately
      if (this.filterQuery.length === 0) {
        this.filterQuery = [createCondition()];
      }
    }
  }

  private _handleQueryClose() {
    this.showFilterMenu = false;
  }

  private _handleQueryChanged(e: CustomEvent<{ query: FilterQuery }>) {
    this.filterQuery = e.detail.query;
  }

  private _handleQueryApply(e: CustomEvent<{ matchedIndices: Set<number> }>) {
    if (!this._scatterplotElement) return;
    const sp = this._scatterplotElement as ScatterplotElementLike;
    const data = sp.getCurrentData?.();
    const proteinIds = data?.protein_ids;
    if (!proteinIds) return;

    // Convert indices to protein IDs
    const matchedIds = Array.from(e.detail.matchedIndices).map((i) => proteinIds[i]);

    // Set selection and isolate (dispatch event for downstream listeners)
    sp.selectedProteinIds = matchedIds;
    this.dispatchEvent(
      new CustomEvent('isolate-data', { detail: {}, bubbles: true, composed: true }),
    );
    sp.isolateSelection?.();

    this.filterActive = true;
    this.showFilterMenu = false;
  }

  private _handleQueryReset() {
    if (!this._scatterplotElement) return;
    const sp = this._scatterplotElement as ScatterplotElementLike;
    this.dispatchEvent(
      new CustomEvent('reset-isolation', { detail: {}, bubbles: true, composed: true }),
    );
    sp.resetIsolation?.();

    this.filterQuery = [createCondition()];
    this.filterActive = false;
    this.isolationMode = false;
    this.isolationHistory = [];
    // Do NOT close popover -- user may want to start a new query
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-control-bar': ProtspaceControlBar;
  }
}
