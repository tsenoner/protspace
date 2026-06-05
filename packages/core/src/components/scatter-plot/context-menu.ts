// packages/core/src/components/scatter-plot/context-menu.ts
import { LitElement, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { contextMenuStyles } from './context-menu.styles';

export interface ContextMenuAction {
  type: 'copy-id' | 'view-uniprot';
  proteinId: string;
}

export interface MenuItem {
  label: string;
  icon: string;
  action: ContextMenuAction;
  shortcut?: string;
  disabled?: boolean;
  separator?: boolean;
}

interface PointHit {
  proteinId: string;
  hasAccession: boolean;
  dataCoords: [number, number];
}

export function resolveMenuItems(hit: PointHit | null): MenuItem[] {
  if (!hit) return [];
  return [
    {
      label: 'Copy ID',
      icon: '📋',
      action: { type: 'copy-id', proteinId: hit.proteinId },
    },
    {
      label: 'View in UniProt',
      icon: '🔗',
      action: { type: 'view-uniprot', proteinId: hit.proteinId },
      disabled: !hit.hasAccession,
    },
  ];
}

@customElement('protspace-context-menu')
class ProtspaceContextMenu extends LitElement {
  static styles = contextMenuStyles;

  @property({ type: Boolean }) open = false;
  @property({ type: Array }) items: MenuItem[] = [];

  // Use composedPath() to correctly detect clicks inside nested shadow DOMs.
  // With nested shadow DOM, e.target at the document level is retargeted to
  // the outermost shadow host, so this.contains(e.target) always returns false.
  private _onClickOutside = (e: MouseEvent) => {
    if (!e.composedPath().includes(this)) {
      this._close();
    }
  };

  private _onEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      this._close();
    }
  };

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('mousedown', this._onClickOutside);
    document.addEventListener('keydown', this._onEscape);
  }

  disconnectedCallback() {
    document.removeEventListener('mousedown', this._onClickOutside);
    document.removeEventListener('keydown', this._onEscape);
    super.disconnectedCallback();
  }

  private _close() {
    this.open = false;
    this.dispatchEvent(new CustomEvent('context-menu-close'));
  }

  private _handleItemClick(item: MenuItem) {
    if (item.disabled) return;
    this.dispatchEvent(
      new CustomEvent<ContextMenuAction>('context-menu-action', {
        detail: item.action,
        bubbles: true,
        composed: true,
      }),
    );
    this._close();
  }

  render() {
    if (!this.open) return nothing;

    return html`
      <div class="menu" role="menu">
        ${this.items.map((item) =>
          item.separator
            ? html`<div class="separator"></div>`
            : html`
                <button
                  class="menu-item"
                  role="menuitem"
                  aria-disabled="${item.disabled ? 'true' : 'false'}"
                  @click="${() => this._handleItemClick(item)}"
                >
                  <span class="icon">${item.icon}</span>
                  <span>${item.label}</span>
                  ${item.shortcut ? html`<span class="shortcut">${item.shortcut}</span>` : nothing}
                </button>
              `,
        )}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-context-menu': ProtspaceContextMenu;
  }
}
