import { LitElement, html, nothing, type PropertyValues } from 'lit';
import { property, state, query } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import { StructureService, formatCount, getBaseAccession } from '@protspace/utils';
import type { StructureData } from '@protspace/utils';
import { structureViewerStyles } from './structure-viewer.styles';
import {
  createMolstarViewer,
  molstarColor,
  prefetchMolstar,
  type MolstarViewer,
  type StructureColorMode,
} from './molstar-loader';
import { renderResourceLinks } from '../common/resource-links';
import { resourceLinkStyles } from '../common/resource-links.styles';
import { observeTheme } from '../../utils/theme-observer';
import '../kit/menu';
import type { PsMenu } from '../kit/menu';
import '../kit/tooltip';
import { icon } from '../kit/icon';
import {
  createStructureErrorEventDetail,
  createStructureLoadDetail,
  createStructureProteinChangeDetail,
} from './structure-viewer.events';
import type { StructureErrorEvent, StructureLoadEvent } from './types';
import type { ProteinClickDetail } from '../scatter-plot/scatter-plot.events';

/** The most selected proteins the header's menu lists; the shown one is always added. */
export const MAX_STRUCTURE_CHOICES = 50;
/** Above this many choices the menu gets a search field. */
const SEARCHABLE_CHOICES = 8;

/**
 * A protein's 3D structure (Mol*), its resource links and colouring.
 *
 * @slot header-actions - Buttons placed in the header, before the close button.
 * @csspart header - The header row: title, protein id (a picker with several choices) and actions.
 * @csspart links - The resource links, in their own wrapping row under the header.
 * @fires structure-protein-change - `{ proteinId }`: the user picked another selected protein.
 */
@customElement('protspace-structure-viewer')
export class ProtspaceStructureViewer extends LitElement {
  static styles = [structureViewerStyles, resourceLinkStyles];

  // Properties
  @property({ type: String }) proteinId: string | null = null;
  @property({ type: String }) title = 'Protein Structure';
  @property({ type: Boolean }) showHeader = true;
  @property({ type: Boolean }) showCloseButton = true;
  @property({ type: Boolean }) showTips = true;
  @property({ type: String }) height = '400px';
  /**
   * The selected proteins the header offers, in selection order. With more than one, the
   * protein id opens a menu of them; a pick shows it and fires `structure-protein-change`.
   * Empty, the default, leaves the id plain text.
   */
  @property({ attribute: false }) proteinChoices: readonly string[] = [];

  // Auto-sync properties
  @property({ type: String, attribute: 'scatterplot-selector' })
  scatterplotSelector: string = 'protspace-scatterplot';
  @property({ type: Boolean, attribute: 'auto-sync' })
  autoSync: boolean = true;
  @property({ type: Boolean, attribute: 'auto-show' })
  autoShow: boolean = true; // Automatically show/hide based on selections

  // State
  @state() private _isLoading = false;
  @state() private _error: string | null = null;
  @state() private _viewer: MolstarViewer | null = null;
  @state() private _structureData: StructureData | null = null;
  @state() private _colorMode: StructureColorMode = 'plddt';
  @state() private _pickOpen = false;
  @query('.protein-pick') private _pickButton?: HTMLButtonElement;
  @query('ps-menu.protein-menu') private _pickMenu?: PsMenu;
  private _loadController: AbortController | null = null;
  private _scatterplotElement: Element | null = null;
  private _stopThemeObserver: (() => void) | null = null;
  /** The background last given to the current Mol* viewer, so a theme change that keeps it repaints nothing. */
  private _appliedBackground: number | null = null;
  /** Keeps the Mol* mount on whole device pixels while the viewer's box changes size. */
  private _snapObserver: ResizeObserver | null = null;

  // Refs
  @query('.viewer-content') private _viewerContainer!: HTMLElement;

  protected willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('proteinChoices') && this.proteinChoices.length <= 1) this._pickOpen = false;
  }

  protected updated(changedProperties: Map<string | number | symbol, unknown>) {
    if (changedProperties.has('proteinId')) {
      // Cancel the in-flight load now: the deferred _cleanup runs a frame later, and until
      // then the old load would still count as current
      this._loadController?.abort();
      // Defer loading to avoid triggering updates during update cycle
      requestAnimationFrame(() => {
        if (this.proteinId) {
          this._loadStructure();
        } else {
          this._cleanup();
        }
      });
    }
    if (changedProperties.has('height')) {
      this.style.height = this.height;
    }
    // The menu anchors to the id button, which exists only while there is a choice to make.
    if (this._pickMenu && this._pickMenu.anchor !== (this._pickButton ?? null)) {
      this._pickMenu.anchor = this._pickButton ?? null;
    }
  }

  connectedCallback() {
    super.connectedCallback();
    this._stopThemeObserver ??= observeTheme(() => this._applyViewerBackground());

    if (this.autoSync) {
      this._setupAutoSync();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._stopThemeObserver?.();
    this._stopThemeObserver = null;
    this._cleanup();

    if (this._scatterplotElement && this._proteinClickHandler) {
      this._scatterplotElement.removeEventListener('protein-click', this._proteinClickHandler);
      this._scatterplotElement.removeEventListener('protein-hover', this._proteinHoverHandler);
      this._scatterplotElement.removeEventListener('pointerdown', this._plotPointerDownHandler);
    }
  }

  private _proteinClickHandler: (e: Event) => void = (e: Event) => this._handleProteinClick(e);

  /**
   * The first point the pointer rests on is the earliest sign the user may open a structure, and
   * it comes seconds before the click. Prefetching then (rather than on page load) keeps the
   * ~1.3 MB download off every visit that never reaches a structure. Touch has no hover: the first
   * finger on the plot is the sign there.
   */
  private _proteinHoverHandler: (e: Event) => void = (e: Event) => {
    if ((e as CustomEvent).detail?.proteinId == null) return;
    this._prefetchOnce();
  };

  private _plotPointerDownHandler: (e: Event) => void = (e: Event) => {
    if ((e as PointerEvent).pointerType !== 'touch') return;
    this._prefetchOnce();
  };

  /** Prefetches Mol* and stops listening for either sign. */
  private _prefetchOnce(): void {
    this._scatterplotElement?.removeEventListener('protein-hover', this._proteinHoverHandler);
    this._scatterplotElement?.removeEventListener('pointerdown', this._plotPointerDownHandler);
    prefetchMolstar();
  }

  private _setupAutoSync() {
    // Find scatterplot element
    setTimeout(() => {
      this._scatterplotElement = document.querySelector(this.scatterplotSelector);

      if (this._scatterplotElement) {
        // Listen for protein clicks
        this._scatterplotElement.addEventListener('protein-click', this._proteinClickHandler);
        this._scatterplotElement.addEventListener('protein-hover', this._proteinHoverHandler);
        this._scatterplotElement.addEventListener('pointerdown', this._plotPointerDownHandler);

        // Initially hide if autoShow is enabled
        if (this.autoShow && !this.proteinId) {
          this.style.display = 'none';
        }
      }
    }, 100);
  }

  private _handleProteinClick(event: Event) {
    const { proteinId, modifierKeys } = (event as CustomEvent<ProteinClickDetail>).detail;

    // Only respond to single clicks (not multi-selection); no modifierKeys means none held
    if (!modifierKeys?.ctrl && !modifierKeys?.meta && !modifierKeys?.shift && this.autoShow) {
      // Show structure viewer and load protein
      this.proteinId = proteinId;
      this.style.display = 'flex';
    }
  }

  // Public methods for external control
  public hide() {
    if (this.autoShow) {
      this.style.display = 'none';
      this.proteinId = null;
      this._cleanup();
      this._dispatchCloseEvent();
    }
  }

  public show(proteinId?: string) {
    if (this.autoShow) {
      this.style.display = 'flex';
      if (proteinId) {
        this.proteinId = proteinId;
      }
    }
  }

  public close() {
    // Internal close functionality
    this.proteinId = null;
    this._cleanup();
    if (this.autoShow) {
      this.style.display = 'none';
    }
    this._dispatchCloseEvent();
  }

  public loadProtein(proteinId: string) {
    // Public method to load a specific protein
    this.proteinId = proteinId;
    // Defer style change to avoid triggering update during update
    if (this.autoShow) {
      requestAnimationFrame(() => {
        this.style.display = 'flex';
      });
    }
  }

  private async _loadStructure() {
    if (!this.proteinId) {
      this._cleanup();
      return;
    }

    // Clean up any existing viewer; this also cancels any load still in flight
    this._cleanup();
    const loadController = new AbortController();
    this._loadController = loadController;
    const { signal } = loadController;

    this._isLoading = true;
    this._error = null;

    // Dispatch loading event
    this._dispatchStructureLoadEvent('loading');

    try {
      // Use service to load structure data
      const structureData = await StructureService.loadStructure(this.proteinId, signal);
      if (signal.aborted) {
        this._revokeBlobUrl(structureData);
        return;
      }
      this._structureData = structureData;

      // Create Mol* viewer
      await this.updateComplete;
      if (signal.aborted) return;
      if (!this._viewerContainer) {
        throw new Error('Viewer container not available');
      }
      // Each load mounts Mol* into its own element, which cleanup removes, so a viewer that
      // finishes mounting after its load was replaced never shares the replacement's container
      const mount = document.createElement('div');
      mount.className = 'molstar-mount';
      // Hidden until its background is set, or Mol*'s own near-white shows for a frame in dark
      mount.style.visibility = 'hidden';
      this._viewerContainer.appendChild(mount);
      this._snapMount();
      if (typeof ResizeObserver !== 'undefined') {
        this._snapObserver ??= new ResizeObserver(() => this._snapMount());
        this._snapObserver.observe(this);
        this._snapObserver.observe(this._viewerContainer);
      }
      const viewer = await createMolstarViewer(mount, structureData.tedDomains);
      if (signal.aborted) {
        this._disposeViewer(viewer);
        return;
      }
      this._viewer = viewer;
      this._appliedBackground = null;
      this._applyViewerBackground();
      mount.style.visibility = '';

      // Load structure into viewer based on source
      await this._displayStructure(structureData);
      if (signal.aborted) return;

      this._isLoading = false;
      this._dispatchStructureLoadEvent('loaded');
    } catch (error) {
      // A load replaced or closed mid-flight must not surface an error for the current state
      if (signal.aborted) return;
      const originalError = error instanceof Error ? error : undefined;
      const formattedId = this.proteinId ? getBaseAccession(this.proteinId) : '';
      const genericMessage = `No 3D structure was found for ${formattedId}.`;
      const fallbackMessage = 'Failed to load structure. Please try again.';

      if (error instanceof Error) {
        // Map low-level errors to a user-friendly message
        const message = error.message.toLowerCase();
        if (
          message.includes('failed to load structure from both alphafold and pdb') ||
          message.includes('alphafold structure not available')
        ) {
          // Structure not available is expected, no need to log as error
          this._error = genericMessage;
        } else {
          // Unexpected error - log for debugging
          console.error('[StructureViewer] Unexpected structure loading error:', error);
          this._error = fallbackMessage;
        }
      } else {
        console.error('[StructureViewer] Unknown structure loading error:', error);
        this._error = fallbackMessage;
      }
      this._isLoading = false;
      this._dispatchStructureErrorEvent(this._error, originalError);
    }
  }

  /**
   * Gives the Mol* canvas the panel's surface colour (design decision 16), so the docked and the
   * floating card match their frame in both themes: once per viewer, then again only when a theme
   * change resolves --ps-surface to a different colour. Without the token sheet (jsdom, an
   * embedder that never adopted it) Mol* keeps its own background.
   */
  private _applyViewerBackground(): void {
    const viewer = this._viewer;
    if (!viewer) return;
    const surface = getComputedStyle(this).getPropertyValue('--ps-surface').trim();
    if (!surface) return;
    const color = molstarColor(surface);
    if (color === null || this._appliedBackground === color) return;
    if (viewer.setBackground(color)) this._appliedBackground = color;
  }

  private async _displayStructure(structureData: StructureData): Promise<void> {
    if (!this._viewer) {
      throw new Error('Viewer not initialized');
    }

    // Load structure based on source
    switch (structureData.source) {
      case 'alphafold':
        if (structureData.url) {
          await this._viewer.loadStructureFromUrl(
            structureData.url,
            structureData.format,
            structureData.isBinary,
          );
        } else {
          throw new Error('AlphaFold structure URL not available');
        }
        break;
      default:
        throw new Error(`Unsupported structure source: ${structureData.source}`);
    }
  }

  /**
   * Puts the Mol* mount, and so its canvas, on whole device pixels: down by the sub-pixel rest of
   * the container's top (the links row above has a fractional height) and a whole number of
   * pixels tall. A canvas whose bottom edge sits near half a pixel is composited with light dashes
   * along it, plain on the dark surface. The rest under the mount shows the container's surface,
   * the colour Mol* clears to.
   */
  private _snapMount(): void {
    const container = this._viewerContainer;
    const mount = container?.querySelector<HTMLElement>('.molstar-mount');
    if (!mount) return;
    const box = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const shift = (Math.ceil(box.top * dpr) - box.top * dpr) / dpr;
    mount.style.top = `${shift}px`;
    mount.style.height = `${Math.max(0, Math.floor(box.height - shift))}px`;
  }

  private _cleanup() {
    this._loadController?.abort();
    this._loadController = null;
    this._snapObserver?.disconnect();
    this._snapObserver = null;
    this._isLoading = false;
    this._colorMode = 'plddt';

    if (this._viewer) {
      this._disposeViewer(this._viewer);
      this._viewer = null;
    }

    if (this._viewerContainer) {
      this._viewerContainer.innerHTML = '';
    }

    // Clean up blob URL to prevent memory leaks
    this._revokeBlobUrl(this._structureData);
    this._structureData = null;
  }

  private _disposeViewer(viewer: MolstarViewer) {
    try {
      viewer.dispose();
    } catch (error) {
      console.warn('[StructureViewer] Error disposing viewer:', error);
    }
  }

  private _revokeBlobUrl(structureData: StructureData | null) {
    if (structureData?.url && structureData.url.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(structureData.url);
      } catch (error) {
        console.warn('[StructureViewer] Error revoking blob URL:', error);
      }
    }
  }

  private _dispatchStructureLoadEvent(status: 'loading' | 'loaded') {
    this.dispatchEvent(
      new CustomEvent('structure-load', {
        detail: createStructureLoadDetail(this.proteinId!, status, this._structureData),
        bubbles: true,
      }) as StructureLoadEvent,
    );
  }

  private _dispatchStructureErrorEvent(message: string, originalError?: Error) {
    this.dispatchEvent(
      new CustomEvent<StructureErrorEvent['detail']>('structure-error', {
        detail: createStructureErrorEventDetail(this.proteinId!, message, originalError),
        bubbles: true,
        composed: true,
      }) as StructureErrorEvent,
    );
  }

  private _dispatchCloseEvent() {
    this.dispatchEvent(
      new CustomEvent('structure-close', {
        detail: {
          proteinId: this.proteinId,
        },
        bubbles: true,
      }),
    );
  }

  private _handleClose() {
    this.close(); // Use internal close method
  }

  private _togglePick = () => {
    this._pickOpen = !this._pickOpen;
  };

  private _onPickClose = (event: Event) => {
    // The menu's own events stay inside; the viewer's is structure-protein-change.
    event.stopPropagation();
    this._pickOpen = false;
  };

  private _onPick = (event: Event) => {
    event.stopPropagation();
    const { value } = (event as CustomEvent<{ value: string }>).detail;
    this._pickOpen = false;
    if (!value || value === this.proteinId) return;
    this.proteinId = value;
    this.dispatchEvent(
      new CustomEvent('structure-protein-change', {
        detail: createStructureProteinChangeDetail(value),
        bubbles: true,
        composed: true,
      }),
    );
  };

  /** The id, or with several selected proteins a button that opens the menu of them. */
  private _renderProteinId(proteinId: string) {
    const count = this.proteinChoices.length;
    if (count <= 1) return html`<span class="protein-id">${proteinId}</span>`;
    return html`<button
        type="button"
        class="protein-id protein-pick"
        aria-label=${`Structure protein: ${proteinId}, choose from ${formatCount(count)} selected`}
        @click=${this._togglePick}
      >
        <span>${proteinId}</span>${icon('chevron-down', 14)}
      </button>
      <ps-menu
        class="protein-menu"
        label="Selected proteins"
        search-placeholder=${count > MAX_STRUCTURE_CHOICES
          ? `Search the first ${MAX_STRUCTURE_CHOICES}`
          : 'Search proteins'}
        .open=${this._pickOpen}
        ?searchable=${count > SEARCHABLE_CHOICES}
        @ps-select=${this._onPick}
        @ps-close=${this._onPickClose}
        >${this._pickOpen ? this._renderChoices(proteinId) : nothing}</ps-menu
      >`;
  }

  /**
   * The first 50 selected proteins in selection order, plus the shown one. A selection can hold
   * hundreds of thousands, so only these render, and only while the menu is open.
   */
  private _renderChoices(shown: string) {
    const all = this.proteinChoices;
    const first = all.length > MAX_STRUCTURE_CHOICES ? all.slice(0, MAX_STRUCTURE_CHOICES) : all;
    const offered = first.includes(shown) ? first : [...first, shown];
    return html`${all.length > MAX_STRUCTURE_CHOICES
      ? html`<ps-menu-label
          >First ${MAX_STRUCTURE_CHOICES} of ${formatCount(all.length)} selected</ps-menu-label
        >`
      : nothing}${offered.map(
      (id) =>
        html`<ps-menu-item type="radio" value=${id} .checked=${id === shown}>${id}</ps-menu-item>`,
    )}`;
  }

  private get _hasTedDomains(): boolean {
    return !!this._structureData?.tedDomains.length;
  }

  private get _canChangeColorMode(): boolean {
    return !this._isLoading && !!this._viewer;
  }

  private get _tedButtonTitle(): string {
    if (!this._canChangeColorMode) return 'Available once the structure has loaded';
    return this._hasTedDomains
      ? 'Color residues by TED domain'
      : 'TED domain annotations are unavailable for this protein';
  }

  private async _handleColorModeChange(mode: StructureColorMode) {
    const viewer = this._viewer;
    if (!viewer || this._colorMode === mode) return;
    if (mode === 'ted-domains' && !this._hasTedDomains) return;

    // The control reflects the request immediately; the adapter applies requests in order
    const previousMode = this._colorMode;
    this._colorMode = mode;
    try {
      await viewer.setColorTheme(mode);
    } catch (error) {
      // Only roll back if neither a newer request nor a new structure has taken over
      if (this._viewer === viewer && this._colorMode === mode) this._colorMode = previousMode;
      console.warn('[StructureViewer] Failed to change structure color mode:', error);
    }
  }

  render() {
    const { proteinId } = this;
    if (!proteinId) {
      return html`
        <div class="viewer-container">
          <div class="empty-container">
            <div class="empty-title">No protein selected</div>
            <div class="empty-message">
              Select a point in the scatter plot to view its 3D structure.
            </div>
          </div>
          <div class="viewer-content"></div>
        </div>
      `;
    }

    return html`
      ${this.showHeader
        ? html`
            <div class="header" part="header">
              <div class="header-info">
                <div class="header-title-row">
                  <span class="title">${icon('box')}${this.title}</span>
                  ${this._renderProteinId(proteinId)}
                </div>
              </div>
              <div class="header-actions">
                <slot name="header-actions"></slot>
                ${this.showCloseButton
                  ? html`<button
                      type="button"
                      class="close-button"
                      aria-label="Close structure"
                      @click=${this._handleClose}
                    >
                      ${icon('x')}
                    </button>`
                  : ''}
              </div>
            </div>
            ${renderResourceLinks(proteinId)}
          `
        : ''}

      <!-- Everything under the links: a host may hide it (the phone's folded sheet). -->
      <div class="body" part="body">
        <div class="viewer-container">
          ${this._isLoading
            ? html`
                <div class="loading-overlay">
                  <div class="loading-spinner"></div>
                  <div class="loading-text">Loading protein structure...</div>
                </div>
              `
            : ''}
          ${this._error
            ? html`
                <div class="error-container">
                  <div class="error-title">${this._error}</div>
                </div>
              `
            : ''}

          <div class="viewer-content"></div>
        </div>

        ${!this._error
          ? html`
              <div class="color-toolbar">
                <span class="color-toolbar-label">Color by</span>
                <div
                  class="segmented color-mode-group"
                  role="group"
                  aria-label="Structure color mode"
                >
                  <button
                    type="button"
                    class="segmented-btn"
                    data-color-mode="plddt"
                    aria-pressed=${this._colorMode === 'plddt'}
                    .disabled=${!this._canChangeColorMode}
                    @click=${() => this._handleColorModeChange('plddt')}
                  >
                    pLDDT
                  </button>
                  <button
                    type="button"
                    class="segmented-btn"
                    data-color-mode="ted-domains"
                    aria-pressed=${this._colorMode === 'ted-domains'}
                    .disabled=${!this._canChangeColorMode || !this._hasTedDomains}
                    @click=${() => this._handleColorModeChange('ted-domains')}
                  >
                    TED domains
                  </button>
                  <ps-tooltip text=${this._tedButtonTitle}></ps-tooltip>
                </div>
              </div>
            `
          : ''}
        ${this.showTips && !this._error
          ? html`
              <div class="tips">
                <span class="interaction-tip">
                  <strong>Tip:</strong> Left-click and drag to rotate. Click and drag to move.
                  Scroll to zoom.
                </span>
                <span class="color-description">
                  ${this._colorMode === 'ted-domains'
                    ? 'Colors distinguish TED domains; gray residues are unassigned.'
                    : 'Colors show pLDDT confidence (blue = high, red = low).'}
                </span>
              </div>
            `
          : ''}
      </div>
    `;
  }
}

// Global type declarations
declare global {
  interface HTMLElementTagNameMap {
    'protspace-structure-viewer': ProtspaceStructureViewer;
  }
}
