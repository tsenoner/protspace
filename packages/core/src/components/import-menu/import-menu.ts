import { LitElement, html, nothing } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import '../common/info-popover';
import { deepActiveElement, flatContains } from '../kit/focus';
import { icon } from '../kit/icon';
import { pushLayer } from '../kit/layers';
import { importMenuStyles } from './import-menu.styles';
import type { ExampleDatasetSummary } from './types';

/**
 * The Import menu: the dataset on screen, "Load your dataset" and the host's example catalog
 * (design decisions 1 and 9). Its panel is a layer of the kit's layer stack, so Escape and a press
 * outside close it and focus returns to the trigger. It only asks: `load-example-dataset` and
 * `open-file-dialog` are the host's to act on. Phase 4.8 rebuilds the panel on the kit.
 */
@customElement('protspace-import-menu')
export class ProtspaceImportMenu extends LitElement {
  static styles = importMenuStyles;

  /** The host's example catalog, listed under "Examples". */
  @property({ attribute: false }) exampleDatasets: readonly ExampleDatasetSummary[] = [];
  /** The host's page about its examples, linked from the "Examples" heading; no link when empty. */
  @property({ attribute: 'examples-docs-url' }) examplesDocsUrl = '';
  /** The dataset on screen, named at the top of the panel. */
  @property({ attribute: 'current-dataset-name' }) currentDatasetName = '';
  /** The example on screen, or null for a user import; its item is disabled. */
  @property({ attribute: 'current-example-id' }) currentExampleId: string | null = null;

  @state() private open = false;
  @query('.trigger') private trigger!: HTMLButtonElement;
  private releaseLayer?: () => void;

  connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener('focusout', this.onFocusOut);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener('focusout', this.onFocusOut);
    this.releaseLayer?.();
    this.releaseLayer = undefined;
    this.open = false;
  }

  render() {
    return html`<button
        class="trigger"
        type="button"
        aria-label="Import"
        aria-expanded=${String(this.open)}
        @click=${this.toggle}
      >
        ${icon('upload', 16)}<span part="trigger-label">Import</span>
      </button>
      ${this.open ? this.renderPanel() : nothing}`;
  }

  private renderPanel() {
    const current =
      this.currentExampleId === null
        ? undefined
        : this.exampleDatasets.find((example) => example.id === this.currentExampleId);
    return html`<div class="panel import-menu" role="group" aria-label="Import">
      <div class="import-current-dataset">
        <span class="import-current-dataset-label">Current dataset</span>
        <div class="import-current-dataset-row">
          <span class="import-current-dataset-name">
            ${this.currentDatasetName || 'No dataset loaded'}
          </span>
          ${this.renderExampleInfo(current)}
        </div>
      </div>
      <div class="import-actions">
        <button
          type="button"
          class="btn btn-primary"
          data-driver-id="import-own-dataset"
          @click=${this.openFileDialog}
        >
          Load your dataset
        </button>
      </div>
      ${this.exampleDatasets.length > 0 ? this.renderExamples() : nothing}
    </div>`;
  }

  private renderExamples() {
    return html`<div class="import-examples">
      <div class="import-examples-header">
        <span class="import-examples-label">Examples</span>
        ${this.examplesDocsUrl
          ? html`<a
              class="import-examples-docs"
              href=${this.examplesDocsUrl}
              target="_blank"
              rel="noopener noreferrer"
              >About these examples ↗</a
            >`
          : nothing}
      </div>
      <p class="import-examples-hint">Examples open in a curated view; your changes aren't kept.</p>
      <div class="import-actions">
        ${this.exampleDatasets.map(
          (example) =>
            html`<div class="import-example-row">
              <button
                type="button"
                class="btn btn-secondary import-example-button"
                data-driver-id="import-example-dataset"
                data-example-id=${example.id}
                ?disabled=${example.id === this.currentExampleId}
                @click=${() => this.loadExample(example.id)}
              >
                <span class="import-example-label">${example.label}</span>
                ${example.large ? html`<span class="import-example-badge">Large</span>` : nothing}
              </button>
              ${this.renderExampleInfo(example)}
            </div>`,
        )}
      </div>
    </div>`;
  }

  /**
   * An example's "ⓘ": its description, insight and docs link. A sibling of the item's button,
   * never inside it: interactive content inside a `<button>` is invalid, and a click on it would
   * load the example.
   */
  private renderExampleInfo(example: ExampleDatasetSummary | undefined) {
    if (!example) return nothing;
    return html`<protspace-info-popover
      class="import-example-info"
      placement="side"
      data-example-info=${example.id}
      .description=${example.description}
      .detail=${example.insight ?? ''}
      docs-url=${example.docsUrl ?? ''}
      label=${example.label}
    ></protspace-info-popover>`;
  }

  /**
   * Tab out of the panel closes it, as ps-menu does. Focus moving inside the shadow root reaches
   * this host listener retargeted to the host itself; a null target (a press on the panel's
   * background, or the window losing focus) leaves it open.
   */
  private onFocusOut = (event: FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    if (this.open && next && !flatContains(this, next)) this.close();
  };

  private toggle = () => {
    if (this.open) this.close();
    else this.show();
  };

  private show(): void {
    this.open = true;
    this.releaseLayer = pushLayer({ close: () => this.close(), elements: [this] });
    // Keyboard users land on the panel's first action, as in the control bar's menu.
    void this.updateComplete.then(() =>
      this.renderRoot
        .querySelector<HTMLButtonElement>('.import-menu button:not([disabled])')
        ?.focus(),
    );
  }

  /** Closes the panel; focus that was inside the menu goes back to the trigger. */
  private close(): void {
    if (!this.open) return;
    const focusWasInside = flatContains(this, deepActiveElement());
    this.open = false;
    this.releaseLayer?.();
    this.releaseLayer = undefined;
    if (focusWasInside) this.trigger.focus();
  }

  private openFileDialog = () => {
    // Dispatched inside the click, so the host's file picker keeps the user's activation.
    this.dispatchEvent(
      new CustomEvent('open-file-dialog', { detail: {}, bubbles: true, composed: true }),
    );
    this.close();
  };

  private loadExample(id: string): void {
    this.dispatchEvent(
      new CustomEvent('load-example-dataset', { detail: { id }, bubbles: true, composed: true }),
    );
    this.close();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-import-menu': ProtspaceImportMenu;
  }
}
