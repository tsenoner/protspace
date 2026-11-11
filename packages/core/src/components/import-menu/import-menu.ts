import { LitElement, html, nothing } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { IMPORT_FORMAT_NOTE } from '@protspace/utils';
import { customElement } from '../../utils/safe-custom-element';
import '../common/info-popover';
import '../kit/button';
import { deepActiveElement, flatContains } from '../kit/focus';
import { icon } from '../kit/icon';
import '../kit/popover';
import type { PsPopover } from '../kit/popover';
import type { Placement } from '../kit/position';
import { importMenuStyles } from './import-menu.styles';
import type { ExampleDatasetSummary, LastFile } from './types';

/**
 * Focus went into an open dialog, such as the host's confirmation of Remove. The panel then stays,
 * so focus can come back to it. A focusout's target is retargeted, often to the ps-dialog host.
 */
function movedIntoDialog(next: Node): boolean {
  for (let node: Node | null = next; node; ) {
    if (node instanceof HTMLDialogElement && node.open) return true;
    if (node instanceof Element && node.localName === 'ps-dialog' && node.hasAttribute('open')) {
      return true;
    }
    node = (node as Element).assignedSlot ?? node.parentNode ?? (node as ShadowRoot).host ?? null;
  }
  return false;
}

/**
 * The Import panel: "Open a file…", the last imported file and the host's example catalog
 * (design decisions 1 and 15). Its own Import button opens it, and so does any control the host
 * passes to `openFrom`/`toggleFrom` (the app bar's dataset name, the empty plot's "Pick an
 * example"). The panel is a `ps-popover` with role dialog, a layer of the kit's layer stack:
 * Escape and a press outside close it, and focus returns to the control that opened it. It only
 * asks: `open-file-dialog`, `open-last-file`, `remove-last-file`, `load-example-dataset` and (with
 * `exportable`) `open-export-menu` are the host's to act on.
 */
@customElement('protspace-import-menu')
export class ProtspaceImportMenu extends LitElement {
  static styles = importMenuStyles;

  /** The host's example catalog, listed under "Examples". */
  @property({ attribute: false }) exampleDatasets: readonly ExampleDatasetSummary[] = [];
  /** The host's page about its examples, linked from the "Examples" heading; no link when empty. */
  @property({ attribute: 'examples-docs-url' }) examplesDocsUrl = '';
  /** The example on screen, or null for a user import; its item is disabled with a check. */
  @property({ attribute: 'current-example-id' }) currentExampleId: string | null = null;
  /**
   * The stored import the panel offers to reopen, or null for none (or while it is on screen).
   * `storedAt`, its save time, goes back to the host with `remove-last-file`.
   */
  @property({ attribute: false }) lastFile: LastFile | null = null;
  /**
   * The panel also offers "Export…", for a host whose dataset control is the one place for the
   * data on screen. It asks, as the rest does: `open-export-menu` carries the control the panel
   * opened from, for the host to open its Export panel there.
   */
  @property({ type: Boolean }) exportable = false;

  @state() private open = false;
  /** The control the panel opened from; null until the first opening (the trigger by default). */
  @state() private anchorEl: HTMLElement | null = null;
  @query('.trigger') private trigger!: HTMLButtonElement;
  @query('ps-popover') private panelPopover!: PsPopover;
  /** Focus was on Last file when the host removed it: the next update moves it on. */
  private refocusAfterLastFile = false;

  connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener('focusout', this.onFocusOut);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener('focusout', this.onFocusOut);
    this.open = false;
    // The popover releases its layer on disconnect; the anchor must not stay "expanded".
    this.anchorEl?.setAttribute('aria-expanded', 'false');
  }

  /** Opens the panel under `anchor`, which then reads as this panel's disclosure button. */
  openFrom(anchor: HTMLElement): void {
    if (this.open) {
      if (this.anchorEl === anchor) return;
      // Close first, so the popover returns focus to the old anchor and takes the new one's.
      this.close();
      void this.updateComplete
        .then(() => this.panelPopover.updateComplete)
        .then(() => this.openFrom(anchor));
      return;
    }
    this.anchorEl = anchor;
    this.open = true;
    void this.focusFirstAction();
  }

  /** Closes the panel when it is open from `anchor`, otherwise opens it there. */
  toggleFrom(anchor: HTMLElement): void {
    if (this.open && this.anchorEl === anchor) this.close();
    else this.openFrom(anchor);
  }

  protected willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (!changed.has('lastFile') || this.lastFile || !this.open) return;
    const section = this.renderRoot.querySelector('.import-last-file');
    this.refocusAfterLastFile = !!section && flatContains(section, deepActiveElement());
  }

  // A plain Map: `anchorEl` is private, so it is not a key PropertyValues<this> accepts.
  protected updated(changed: Map<PropertyKey, unknown>): void {
    if (this.refocusAfterLastFile) {
      this.refocusAfterLastFile = false;
      // The item that took its place, else "Open a file…" above it.
      const actions = this.actions();
      (actions[1] ?? actions[0])?.focus();
    }
    if (!changed.has('open') && !changed.has('anchorEl')) return;
    const previous = changed.get('anchorEl') as HTMLElement | null | undefined;
    if (previous && previous !== this.anchorEl) previous.setAttribute('aria-expanded', 'false');
    const anchor = this.anchorEl ?? this.trigger;
    anchor.setAttribute('aria-haspopup', 'dialog');
    anchor.setAttribute('aria-expanded', String(this.open));
  }

  render() {
    const anchor = this.anchorEl ?? this.trigger ?? null;
    // Under its own trigger, at the app bar's right, the panel opens leftward.
    const placement: Placement = anchor === this.trigger ? 'bottom-end' : 'bottom-start';
    return html`<button
        class="trigger"
        part="trigger"
        type="button"
        aria-label="Import"
        aria-haspopup="dialog"
        aria-expanded="false"
        @click=${this.onTriggerClick}
      >
        ${icon('upload', 16)}<span part="trigger-label">Import</span>
      </button>
      <ps-popover
        .anchor=${anchor}
        .open=${this.open}
        placement=${placement}
        panel-role="dialog"
        panel-label="Import"
        @ps-close=${this.onPopoverClose}
      >
        ${this.open ? this.renderPanel() : nothing}
      </ps-popover>`;
  }

  private renderPanel() {
    return html`<div class="import-menu" @keydown=${this.onPanelKeydown}>
      <section class="import-section">
        <ps-button
          class="import-open-file"
          variant="primary"
          data-driver-id="import-own-dataset"
          data-import-action
          @click=${this.openFileDialog}
          ><span slot="start">${icon('upload', 16)}</span>Open a file…</ps-button
        >
        <p class="import-note">${IMPORT_FORMAT_NOTE}</p>
      </section>
      ${this.lastFile ? this.renderLastFile(this.lastFile) : nothing}
      ${this.exampleDatasets.length > 0 ? this.renderExamples() : nothing}
      ${this.exportable
        ? html`<section class="import-section import-export">
            <ps-button
              class="import-export-button"
              variant="secondary"
              data-import-action
              aria-haspopup="dialog"
              @click=${this.openExportMenu}
              ><span slot="start">${icon('download', 16)}</span>Export…</ps-button
            >
          </section>`
        : nothing}
    </div>`;
  }

  /**
   * The row reopens the file; the red × beside it (a sibling, as an example's ⓘ) removes the stored
   * copy, and so do Delete and Backspace on the row. The × is a Tab stop outside the arrow keys.
   */
  private renderLastFile(file: LastFile) {
    const removeLabel = `Remove ${file.name} from this browser`;
    return html`<section class="import-section import-last-file">
      <h3 class="import-section-label">Last file</h3>
      <div class="import-last-file-row">
        <button
          type="button"
          class="import-row"
          data-import-action
          aria-label=${`Reopen ${file.name}`}
          aria-keyshortcuts="Delete Backspace"
          @click=${this.openLastFile}
          @keydown=${this.onLastFileKeydown}
        >
          <span class="import-row-label">${file.name}</span>
          <span class="import-row-meta">${file.sizeLabel}</span>
        </button>
        <ps-icon-button
          class="import-last-file-remove"
          icon="x"
          size="sm"
          label=${removeLabel}
          @click=${this.removeLastFile}
        ></ps-icon-button>
      </div>
    </section>`;
  }

  private renderExamples() {
    return html`<section class="import-section import-examples">
      <div class="import-examples-header">
        <h3 class="import-section-label import-examples-label">Examples</h3>
        ${this.examplesDocsUrl
          ? html`<a
              class="import-examples-docs"
              href=${this.examplesDocsUrl}
              target="_blank"
              rel="noopener noreferrer"
              >About these examples${icon('external-link', 14)}<span
                class="import-examples-docs-hint"
              >
                (opens in a new tab)</span
              ></a
            >`
          : nothing}
      </div>
      <p class="import-examples-hint">Examples open in a curated view; your changes aren't kept.</p>
      <div class="import-example-list">
        ${this.exampleDatasets.map((example) => {
          const current = example.id === this.currentExampleId;
          return html`<div class="import-example-row">
            <button
              type="button"
              class="import-row import-example-button"
              data-driver-id="import-example-dataset"
              data-example-id=${example.id}
              data-import-action
              ?disabled=${current}
              aria-current=${current ? 'true' : nothing}
              @click=${() => this.loadExample(example.id)}
            >
              <span class="import-row-check">${current ? icon('check', 14) : nothing}</span>
              ${this.renderExampleLabel(example.label)}
              ${example.large ? html`<span class="import-example-badge">Large</span>` : nothing}
            </button>
            ${this.renderExampleInfo(example)}
          </div>`;
        })}
      </div>
    </section>`;
  }

  /** "Name · 7.8K · 1.0 MB": the name wraps, the size and count stay on one line, as Last file's. */
  private renderExampleLabel(label: string) {
    const [name, ...meta] = label.split(' · ');
    return html`<span class="import-example-label">${name}</span>${meta.length > 0
        ? html`<span class="import-row-meta">${meta.join(' · ')}</span>`
        : nothing}`;
  }

  /**
   * An example's "ⓘ": its description, insight and docs link. A sibling of the item's button,
   * never inside it: interactive content inside a `<button>` is invalid, and a click on it would
   * load the example. The current example keeps its ⓘ (the app bar's name has none).
   */
  private renderExampleInfo(example: ExampleDatasetSummary) {
    return html`<protspace-info-popover
      class="import-example-info"
      placement="side"
      beside-row
      data-example-info=${example.id}
      .description=${example.description}
      .detail=${example.insight ?? ''}
      docs-url=${example.docsUrl ?? ''}
      label=${example.label}
    ></protspace-info-popover>`;
  }

  /** The panel's actions in order, without the disabled current example. */
  private actions(): HTMLElement[] {
    return [...this.renderRoot.querySelectorAll<HTMLElement>('[data-import-action]')].filter(
      (action) => !(action as HTMLButtonElement).disabled,
    );
  }

  private async focusFirstAction(): Promise<void> {
    await this.updateComplete;
    await this.panelPopover.updateComplete;
    // Keyboard users land on the panel's first action, as in the other menus.
    if (this.open) this.actions()[0]?.focus();
  }

  private onPanelKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const actions = this.actions();
    if (actions.length === 0) return;
    event.preventDefault();
    const active = (this.renderRoot as ShadowRoot).activeElement as HTMLElement | null;
    const last = actions.length - 1;
    let next: number;
    const current = active ? actions.indexOf(active) : -1;
    if (current < 0 && active) {
      // An example's ⓘ: continue from its row's button, the last action before it.
      const before =
        actions.filter(
          (action) => action.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).length - 1;
      next = event.key === 'ArrowDown' ? (before === last ? 0 : before + 1) : Math.max(before, 0);
    } else {
      next =
        event.key === 'ArrowDown'
          ? current < 0 || current === last
            ? 0
            : current + 1
          : current <= 0
            ? last
            : current - 1;
    }
    actions[next].focus();
  };

  /**
   * Tab out of the panel closes it. Focus moving inside the shadow root reaches this host listener
   * retargeted to the host itself; a null target (a press on the panel's background, or the
   * window losing focus) leaves it open. The anchor counts as inside, as for the popover's
   * outside press: a press on it focuses it first, and its own click then toggles the panel.
   */
  private onFocusOut = (event: FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    if (!this.open || !next || flatContains(this, next)) return;
    if (this.anchorEl && flatContains(this.anchorEl, next)) return;
    if (movedIntoDialog(next)) return;
    this.close();
  };

  private onTriggerClick = () => {
    this.toggleFrom(this.trigger);
  };

  /** The popover closed itself (Escape or a press outside) and has already returned focus. */
  private onPopoverClose = (event: Event) => {
    event.stopPropagation();
    this.open = false;
  };

  /**
   * Closes the panel; focus that was inside it goes back to the anchor. Moved here, not left to
   * the popover: the render that closes the panel also removes its contents, so by the popover's
   * own `hide()` the focused item is gone and focus has fallen to `<body>`. `open` is cleared
   * first, so the focusout this focus move causes finds the panel already closed.
   */
  private close(): void {
    if (!this.open) return;
    const focusWasInside = flatContains(this, deepActiveElement());
    this.open = false;
    if (focusWasInside) (this.anchorEl ?? this.trigger).focus();
  }

  private openFileDialog = () => {
    this.close();
    // Still inside the click, so the host's file picker keeps the user's activation.
    this.dispatchEvent(
      new CustomEvent('open-file-dialog', { detail: {}, bubbles: true, composed: true }),
    );
  };

  /**
   * Hands over to the host's Export panel, under the same control. This panel closes first and
   * releases its layer, so the one that opens next is the top layer and Escape closes it alone.
   */
  private openExportMenu = async () => {
    const anchor = this.anchorEl ?? this.trigger;
    this.close();
    await this.updateComplete;
    await this.panelPopover.updateComplete;
    this.dispatchEvent(
      new CustomEvent('open-export-menu', { detail: { anchor }, bubbles: true, composed: true }),
    );
  };

  private openLastFile = () => {
    this.close();
    this.dispatchEvent(
      new CustomEvent('open-last-file', { detail: {}, bubbles: true, composed: true }),
    );
  };

  private onLastFileKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    event.preventDefault();
    this.removeLastFile();
  };

  /** Asks the host to remove the stored copy. The panel stays open while the host confirms. */
  private removeLastFile = () => {
    if (!this.lastFile) return;
    const { name, storedAt } = this.lastFile;
    this.dispatchEvent(
      new CustomEvent('remove-last-file', {
        detail: { name, storedAt },
        bubbles: true,
        composed: true,
      }),
    );
  };

  private loadExample(id: string): void {
    this.close();
    this.dispatchEvent(
      new CustomEvent('load-example-dataset', { detail: { id }, bubbles: true, composed: true }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-import-menu': ProtspaceImportMenu;
  }
}
