import { LitElement, html } from 'lit';
import { property, state } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import { controlBarStyles } from './control-bar.styles';
import type { DataChangeDetail, ScatterplotElementLike, StructureViewerElement } from './types';
import { AfterPaintCommit } from '../../utils/after-paint-commit';
import { toggleProteinSelection, mergeProteinSelections } from './control-bar-helpers';
import {
  createSelectionDisabledNotificationDetail,
  type SelectionDisabledNotificationDetail,
} from './control-bar.events';
import type { BrushSelectionDetail, ProteinClickDetail } from '../scatter-plot/scatter-plot.events';
import './search';

/**
 * What is left of the control bar while design decision 9 splits it: the protein search and the
 * selection tools. Projection, Color by and contours live in the view bar, Import and Export in
 * the app bar, Filter in its own dialog. Task 2.9 moves the rest and Task 2.10 deletes the element.
 */
@customElement('protspace-control-bar')
export class ProtspaceControlBar extends LitElement {
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

  @state() private _selectionDisabled: boolean = false;

  // Auto-sync properties (optional, can be derived from events)
  @property({ type: String, attribute: 'scatterplot-selector' })
  scatterplotSelector: string = 'protspace-scatterplot';
  @property({ type: Boolean, attribute: 'auto-sync' })
  autoSync: boolean = true;

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

  // A pick from the search box or the Clear button re-stages every point. The chips show it in
  // the frame of the input; the change itself runs after that frame is painted, so a newer pick
  // replaces one still waiting, and a selection committed at once drops it.
  private readonly _selectionCommit = new AfterPaintCommit();

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
    return html`
      <div class="control-bar">
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

    if (this.autoSync) {
      this._setupAutoSync();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._cancelPendingCommits();
    document.removeEventListener('click', this._onDocumentClick);
    document.removeEventListener('keydown', this._onDocumentKeydown);
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
    this._selectionCommit.cancel();
  }

  private handleDocumentKeydown(event: KeyboardEvent) {
    const path = event.composedPath?.() ?? [];
    const inAriaModal = path.some(
      (n) => n instanceof HTMLElement && n.getAttribute('aria-modal') === 'true',
    );
    // A modal (the legend's dialogs, the figure editor) owns its own Escape.
    if (inAriaModal) return;

    if (event.key === 'Escape') {
      // Top priority: close any open duplicate-badge spider on the scatter plot before falling
      // through to selection-clearing. Open menus are layers, which take Escape before this.
      if (this._scatterplotElement?.hasExpandedDuplicateStack?.()) {
        event.preventDefault();
        event.stopPropagation();
        this._scatterplotElement.closeExpandedDuplicateStack?.();
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

  /** A click outside the search box closes its suggestions (its blur also does, 200 ms later). */
  private handleDocumentClick(event: Event) {
    const path = (event as Event & { composedPath?: () => EventTarget[] }).composedPath?.() || [];
    const searchElement = this.shadowRoot?.querySelector('protspace-protein-search');
    if (
      searchElement &&
      !path.includes(searchElement) &&
      !searchElement.contains(event.target as Node)
    ) {
      searchElement.dispatchEvent(new CustomEvent('close-search', { bubbles: false }));
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
        this._scatterplotElement.addEventListener('data-change', this._onDataChange);
        this._scatterplotElement.addEventListener('protein-click', this._onProteinClick);
        this._scatterplotElement.addEventListener('brush-selection', this._onBrushSelection);
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

  /** The search box's protein ids, and the chips from the plot's selection. */
  private _handleDataChange(event: Event) {
    const { data } = (event as CustomEvent<DataChangeDetail>).detail || {};
    if (!data) return;

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

  private _syncWithScatterplot() {
    if (this._scatterplotElement && 'getCurrentData' in this._scatterplotElement) {
      const scatterplot = this._scatterplotElement as ScatterplotElementLike;
      const data = scatterplot.getCurrentData?.();

      if (data) {
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
