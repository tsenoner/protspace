import { LitElement, html } from 'lit';
import { property, state, query } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import { StructureService } from '@protspace/utils';
import type { StructureData } from '@protspace/utils';
import { structureViewerStyles } from './structure-viewer.styles';
import { createMolstarViewer, type MolstarViewer } from './molstar-loader';
import { buildAlphaFoldUrl, buildInterProUrl, buildTedUrl, buildUniProtUrl } from './header-links';
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
  private _scatterplotElement: Element | null = null;

  // Refs
  @query('.viewer-content') private _viewerContainer!: HTMLElement;

  protected updated(changedProperties: Map<string | number | symbol, unknown>) {
    if (changedProperties.has('proteinId')) {
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
    }
  }

  private _proteinClickHandler: (e: Event) => void = (e: Event) => this._handleProteinClick(e);

  private _setupAutoSync() {
    // Find scatterplot element
    setTimeout(() => {
      this._scatterplotElement = document.querySelector(this.scatterplotSelector);

      if (this._scatterplotElement) {
        // Listen for protein clicks
        this._scatterplotElement.addEventListener('protein-click', this._proteinClickHandler);

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

    this._isLoading = true;
    this._error = null;
    this._structureData = null;

    // Dispatch loading event
    this._dispatchStructureLoadEvent('loading');

    try {
      // Clean up any existing viewer
      this._cleanup();

      // Use service to load structure data
      this._structureData = await StructureService.loadStructure(this.proteinId);

      // Create Mol* viewer
      await this.updateComplete;
      if (!this._viewerContainer) {
        throw new Error('Viewer container not available');
      }
      this._viewer = await createMolstarViewer(this._viewerContainer);

      // Load structure into viewer based on source
      await this._displayStructure(this._structureData);

      this._isLoading = false;
      this._dispatchStructureLoadEvent('loaded');
    } catch (error) {
      const originalError = error instanceof Error ? error : undefined;
      const formattedId = this.proteinId?.split('.')[0] ?? this.proteinId ?? '';
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
    if (this._viewer) {
      try {
        this._viewer.dispose();
      } catch (error) {
        console.warn('[StructureViewer] Error disposing viewer:', error);
      }
      this._viewer = null;
    }

    if (this._viewerContainer) {
      this._viewerContainer.innerHTML = '';
    }

    // Clean up blob URL to prevent memory leaks
    if (this._structureData?.url && this._structureData.url.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(this._structureData.url);
      } catch (error) {
        console.warn('[StructureViewer] Error revoking blob URL:', error);
      }
    }

    this._structureData = null;
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

  render() {
    if (!this.proteinId) {
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
                <a
                  class="title"
                  href=${buildAlphaFoldUrl(this.proteinId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open in AlphaFold DB"
                >
                  ${this.title}
                </a>
                <span class="protein-id">${this.proteinId}</span>
                <span class="header-links">
                  <a
                    class="header-link"
                    href=${buildUniProtUrl(this.proteinId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open in UniProt"
                  >
                    UniProt
                  </a>
                  <span class="header-link-separator">&middot;</span>
                  <a
                    class="header-link"
                    href=${buildInterProUrl(this.proteinId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open in InterPro"
                  >
                    InterPro
                  </a>
                  <span class="header-link-separator">&middot;</span>
                  <a
                    class="header-link"
                    href=${buildTedUrl(this.proteinId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open in TED"
                  >
                    TED
                  </a>
                </span>
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

      ${this.showTips && !this._error
        ? html`
            <div class="tips">
              <strong>Tip:</strong> Left-click and drag to rotate. Click and drag to move. Scroll to
              zoom.<br />Colors show pLDDT confidence (blue = high, red = low).
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
