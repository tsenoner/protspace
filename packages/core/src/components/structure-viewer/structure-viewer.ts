import { LitElement, html } from 'lit';
import { property, state, query } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import { StructureService, getBaseAccession } from '@protspace/utils';
import type { StructureData } from '@protspace/utils';
import { structureViewerStyles } from './structure-viewer.styles';
import {
  createMolstarViewer,
  prefetchMolstar,
  type MolstarViewer,
  type StructureColorMode,
} from './molstar-loader';
import { RESOURCE_LINKS } from './header-links';
import {
  createStructureErrorEventDetail,
  createStructureLoadDetail,
} from './structure-viewer.events';
import type { StructureErrorEvent, StructureLoadEvent } from './types';

@customElement('protspace-structure-viewer')
export class ProtspaceStructureViewer extends LitElement {
  static styles = structureViewerStyles;

  // Properties
  @property({ type: String }) proteinId: string | null = null;
  @property({ type: String }) title = 'Protein Structure';
  @property({ type: Boolean }) showHeader = true;
  @property({ type: Boolean }) showCloseButton = true;
  @property({ type: Boolean }) showTips = true;
  @property({ type: String }) height = '400px';

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
  private _loadController: AbortController | null = null;
  private _scatterplotElement: Element | null = null;

  // Refs
  @query('.viewer-content') private _viewerContainer!: HTMLElement;

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
  }

  connectedCallback() {
    super.connectedCallback();

    if (this.autoSync) {
      this._setupAutoSync();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._cleanup();

    if (this._scatterplotElement && this._proteinClickHandler) {
      this._scatterplotElement.removeEventListener('protein-click', this._proteinClickHandler);
      this._scatterplotElement.removeEventListener('protein-hover', this._proteinHoverHandler);
    }
  }

  private _proteinClickHandler: (e: Event) => void = (e: Event) => this._handleProteinClick(e);

  /**
   * The first point the pointer rests on is the earliest sign the user may open a structure, and
   * it comes seconds before the click. Prefetching then (rather than on page load) keeps the
   * ~1.3 MB download off every visit that never reaches a structure, touch devices included.
   */
  private _proteinHoverHandler: (e: Event) => void = (e: Event) => {
    if ((e as CustomEvent).detail?.proteinId == null) return;
    this._scatterplotElement?.removeEventListener('protein-hover', this._proteinHoverHandler);
    prefetchMolstar();
  };

  private _setupAutoSync() {
    // Find scatterplot element
    setTimeout(() => {
      this._scatterplotElement = document.querySelector(this.scatterplotSelector);

      if (this._scatterplotElement) {
        // Listen for protein clicks
        this._scatterplotElement.addEventListener('protein-click', this._proteinClickHandler);
        this._scatterplotElement.addEventListener('protein-hover', this._proteinHoverHandler);

        // Initially hide if autoShow is enabled
        if (this.autoShow && !this.proteinId) {
          this.style.display = 'none';
        }
      }
    }, 100);
  }

  private _handleProteinClick(event: Event) {
    const customEvent = event as CustomEvent;
    const { proteinId, modifierKeys } = customEvent.detail;

    // Only respond to single clicks (not multi-selection)
    if (!modifierKeys.ctrl && !modifierKeys.meta && !modifierKeys.shift && this.autoShow) {
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
      this._viewerContainer.appendChild(mount);
      const viewer = await createMolstarViewer(mount, structureData.tedDomains);
      if (signal.aborted) {
        this._disposeViewer(viewer);
        return;
      }
      this._viewer = viewer;

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

  private _cleanup() {
    this._loadController?.abort();
    this._loadController = null;
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
            <div class="header">
              <div class="header-info">
                <div class="header-title-row">
                  <span class="title">${this.title}</span>
                  <span class="protein-id">${proteinId}</span>
                </div>
                <ul class="header-links" role="list" aria-label="External resources">
                  ${RESOURCE_LINKS.map(
                    (resource) => html`
                      <li class="header-links-item">
                        <a
                          class="header-link"
                          href=${resource.build(proteinId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open in ${resource.label} (opens in a new tab)"
                        >
                          <span class="header-link-label">${resource.label}</span
                          ><span class="header-link-external" aria-hidden="true">↗</span>
                        </a>
                      </li>
                    `,
                  )}
                </ul>
              </div>
              <div class="header-actions">
                ${this.showCloseButton
                  ? html` <button class="close-button" @click=${this._handleClose}>✕</button> `
                  : ''}
              </div>
            </div>
          `
        : ''}

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
                  title=${this._tedButtonTitle}
                  @click=${() => this._handleColorModeChange('ted-domains')}
                >
                  TED domains
                </button>
              </div>
            </div>
          `
        : ''}
      ${this.showTips && !this._error
        ? html`
            <div class="tips">
              <span class="interaction-tip">
                <strong>Tip:</strong> Left-click and drag to rotate. Click and drag to move. Scroll
                to zoom.
              </span>
              <span class="color-description">
                ${this._colorMode === 'ted-domains'
                  ? 'Colors distinguish TED domains; gray residues are unassigned.'
                  : 'Colors show pLDDT confidence (blue = high, red = low).'}
              </span>
            </div>
          `
        : ''}
    `;
  }
}

// Global type declarations
declare global {
  interface HTMLElementTagNameMap {
    'protspace-structure-viewer': ProtspaceStructureViewer;
  }
}
