import { html, nothing, type TemplateResult } from 'lit';
import { icon } from '../../kit/icon';
import '../../kit/tooltip';
import type { Inset, Overlay } from '../publish-state';
import { renderSliderInput } from './legend-section';

type Selected = { kind: 'overlay' | 'inset'; index: number };

interface AnnotationsModel {
  overlays: readonly Overlay[];
  insets: readonly Inset[];
  selected: Selected | null;
}

interface AnnotationsHandlers {
  select(selected: Selected): void;
  removeOverlay(index: number): void;
  updateOverlay(index: number, partial: Partial<Overlay>): void;
  removeInset(index: number): void;
  updateInset(index: number, partial: Partial<Inset>): void;
}

/** A row's ✕: removes that item whether or not it is selected, and does not select it. */
function removeButton(onRemove: () => void) {
  return html`
    <button
      type="button"
      class="delete-btn"
      aria-label="Remove"
      @click=${(e: Event) => {
        e.stopPropagation();
        onRemove();
      }}
    >
      ${icon('x', 14)}
    </button>
    <ps-tooltip text="Remove" names-target></ps-tooltip>
  `;
}

function renderOverlayProps(a: Overlay, i: number, handlers: AnnotationsHandlers) {
  switch (a.type) {
    case 'circle':
      return html`
        <div class="publish-row publish-row-tight">
          <label>Stroke</label>
          ${renderSliderInput({
            min: 0.5,
            max: 10,
            step: 0.5,
            value: a.strokeWidth,
            unit: 'px',
            onChange: (v) => handlers.updateOverlay(i, { strokeWidth: v }),
          })}
        </div>
      `;
    case 'arrow':
      return html`
        <div class="publish-row publish-row-tight">
          <label>Stroke</label>
          ${renderSliderInput({
            min: 0.5,
            max: 10,
            step: 0.5,
            value: a.width,
            unit: 'px',
            onChange: (v) => handlers.updateOverlay(i, { width: v }),
          })}
        </div>
      `;
    case 'label':
      return html`
        <div class="publish-row publish-row-text">
          <label>Text</label>
          <input
            type="text"
            class="publish-row-input publish-label-input"
            .value=${a.text}
            @change=${(e: Event) => {
              handlers.updateOverlay(i, {
                text: (e.target as HTMLInputElement).value || 'Label',
              });
            }}
          />
        </div>
        <div class="publish-row publish-row-tight">
          <label>Size</label>
          ${renderSliderInput({
            min: 8,
            max: 72,
            value: a.fontSize,
            unit: 'px',
            onChange: (v) => handlers.updateOverlay(i, { fontSize: v }),
          })}
        </div>
      `;
  }
}

function renderOverlays(model: AnnotationsModel, handlers: AnnotationsHandlers) {
  const anns = model.overlays;
  return html`
    <div class="publish-section">
      <div class="publish-section-title">Overlays (${anns.length})</div>
      ${anns.map((a, i) => {
        const isSel = model.selected?.kind === 'overlay' && model.selected.index === i;
        return html`
          <div
            class="publish-overlay-item ${isSel ? 'selected' : ''}"
            data-publish-item="overlay-${i}"
            @click=${() => handlers.select({ kind: 'overlay', index: i })}
          >
            <div class="publish-item-head">
              <span>${a.type}${a.type === 'label' ? `: ${a.text}` : ''}</span>
              ${removeButton(() => handlers.removeOverlay(i))}
            </div>
            ${renderOverlayProps(a, i, handlers)}
          </div>
        `;
      })}
      ${anns.length === 0
        ? html`<span class="publish-empty-hint">Use toolbar to add</span>`
        : nothing}
    </div>
  `;
}

function renderInsets(model: AnnotationsModel, handlers: AnnotationsHandlers) {
  const ins = model.insets;
  return html`
    <div class="publish-section">
      <div class="publish-section-title">Zoom Insets (${ins.length})</div>
      ${ins.map(
        (inset, i) => html`
          <div
            class="publish-overlay-item ${model.selected?.kind === 'inset' &&
            model.selected.index === i
              ? 'selected'
              : ''}"
            data-publish-item="inset-${i}"
            @click=${() => handlers.select({ kind: 'inset', index: i })}
          >
            <div class="publish-item-head">
              <span>Inset ${i + 1}</span>
              ${removeButton(() => handlers.removeInset(i))}
            </div>
            <div class="publish-row publish-row-tight">
              <label>Dot size</label>
              <ps-tooltip
                text="Dot size in the zoomed view, relative to the main plot. 1× matches."
              ></ps-tooltip>
              ${renderSliderInput({
                min: 0.5,
                max: 20,
                step: 0.1,
                value: Number((inset.pointSizeScale ?? 1).toFixed(1)),
                unit: '×',
                onChange: (v) => handlers.updateInset(i, { pointSizeScale: v }),
              })}
            </div>
            <div class="publish-row publish-row-tight">
              <label>Border</label>
              ${renderSliderInput({
                min: 0.5,
                max: 10,
                step: 0.5,
                value: inset.border,
                unit: 'px',
                onChange: (v) => handlers.updateInset(i, { border: v }),
              })}
            </div>
          </div>
        `,
      )}
      ${ins.length === 0
        ? html`<span class="publish-empty-hint">Use toolbar to add</span>`
        : nothing}
    </div>
  `;
}

/** The overlays, then the zoom insets: each listed with its own controls and a remove button. */
export function renderAnnotations(
  model: AnnotationsModel,
  handlers: AnnotationsHandlers,
): TemplateResult {
  return html`${renderOverlays(model, handlers)} ${renderInsets(model, handlers)}`;
}
