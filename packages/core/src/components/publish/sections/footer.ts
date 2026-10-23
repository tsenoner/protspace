import { html, nothing, type TemplateResult } from 'lit';
import '../../kit/button';
import { icon } from '../../kit/icon';
import '../../kit/tooltip';

/** What New figure and Reset say they did, beside their Undo. */
export type UndoMessage = 'Overlays and insets cleared' | 'Settings reset';

interface FooterModel {
  undo: UndoMessage | null;
  exportError: string | null;
  format: 'png' | 'pdf';
}

interface FooterHandlers {
  newFigure(): void;
  reset(): void;
  undo(): void;
  /** Focus entered the Undo strip: hold its 8 s. */
  holdUndo(): void;
  /** Focus left the Undo strip: start its 8 s again. */
  releaseUndo(): void;
  close(): void;
  exportFigure(): void;
}

/**
 * The dialog's footer: New figure and Reset, then what one of them just did (with Undo) or why an
 * export failed, then Close and Export. Feedback lives here, not in a toast: a toast would sit
 * under the modal dialog.
 */
export function renderFooter(model: FooterModel, handlers: FooterHandlers): TemplateResult {
  return html`
    <div class="publish-footer" slot="footer">
      <ps-button variant="ghost" @click=${handlers.newFigure}>New figure</ps-button>
      <ps-tooltip text="Clear overlays and insets, keep the layout"></ps-tooltip>
      <ps-button variant="ghost" @click=${handlers.reset}>Reset</ps-button>
      <ps-tooltip text="Reset every setting to its default"></ps-tooltip>
      <div class="publish-footer-status">
        ${model.exportError
          ? html`<p class="publish-export-error" role="alert">${model.exportError}</p>`
          : nothing}
        <div
          class="publish-undo"
          role="status"
          @focusin=${handlers.holdUndo}
          @focusout=${handlers.releaseUndo}
        >
          ${model.undo
            ? html`<span>${model.undo}</span>
                <ps-button size="sm" variant="ghost" @click=${handlers.undo}
                  ><span slot="start" class="publish-undo-icon">${icon('undo-2', 14)}</span
                  >Undo</ps-button
                >`
            : nothing}
        </div>
      </div>
      <ps-button variant="secondary" @click=${handlers.close}>Close</ps-button>
      <ps-button variant="primary" @click=${handlers.exportFigure}>Export</ps-button>
      <ps-tooltip text=${`Export ${model.format.toUpperCase()}`}></ps-tooltip>
    </div>
  `;
}
