import { html, svg, type SVGTemplateResult, type TemplateResult } from 'lit';
import type { OverlayTool } from '../publish-state';

interface ToolbarModel {
  tool: OverlayTool;
}

interface ToolbarHandlers {
  setTool(tool: OverlayTool): void;
}

interface ToolButton {
  tool: OverlayTool;
  label: string;
  title: string;
  glyph: SVGTemplateResult;
}

const DRAWING_TOOLS: readonly ToolButton[] = [
  {
    tool: 'select',
    label: 'Select',
    title: 'Select / Move',
    glyph: svg`<path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />`,
  },
  {
    tool: 'circle',
    label: 'Circle',
    title: 'Draw circle highlight',
    glyph: svg`<circle cx="12" cy="12" r="9" />`,
  },
  {
    tool: 'arrow',
    label: 'Arrow',
    title: 'Draw arrow',
    glyph: svg`<path d="M5 12h14m-4-4l4 4-4 4" />`,
  },
  {
    tool: 'label',
    label: 'Label',
    title: 'Add text label',
    glyph: svg`<path d="M4 7V4h16v3M9 20h6M12 4v16" />`,
  },
];

const INSET_TOOL: ToolButton = {
  tool: 'inset-source',
  label: 'Zoom Inset',
  title: 'Add zoom inset',
  glyph: svg`<path d="M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.35-4.35" />`,
};

function toolButton(entry: ToolButton, model: ToolbarModel, handlers: ToolbarHandlers) {
  return html`
    <button
      class="publish-toggle-btn publish-tool-btn ${model.tool === entry.tool ? 'active' : ''}"
      @click=${() => handlers.setTool(entry.tool)}
      title=${entry.title}
    >
      <svg viewBox="0 0 24 24">${entry.glyph}</svg>
      ${entry.label}
    </button>
  `;
}

/** The preview's tools under the canvas: select and the three drawing tools, then the inset. */
export function renderToolbar(model: ToolbarModel, handlers: ToolbarHandlers): TemplateResult {
  return html`
    <div class="publish-preview-toolbar">
      ${DRAWING_TOOLS.map((entry) => toolButton(entry, model, handlers))}
      <div class="tool-separator"></div>
      ${toolButton(INSET_TOOL, model, handlers)}
    </div>
  `;
}
