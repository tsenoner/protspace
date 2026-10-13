import { html, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import {
  COLOR_SCHEME_INFO,
  COLOR_SCHEMES,
  GRADIENT_COLOR_SCHEME_IDS,
  createColorSchemeLinearGradient,
} from '@protspace/utils';

type PaletteId = keyof typeof COLOR_SCHEME_INFO;

/** How many of a categorical palette's colours its swatch shows. */
const SWATCH_CHIPS = 8;

function paletteIds(gradient: boolean): readonly string[] {
  return (Object.keys(COLOR_SCHEME_INFO) as PaletteId[])
    .filter((id) => GRADIENT_COLOR_SCHEME_IDS.has(id) === gradient)
    .sort((a, b) => COLOR_SCHEME_INFO[a].label.localeCompare(COLOR_SCHEME_INFO[b].label));
}

/** The palettes a categorical legend offers, by label, as the settings dialog listed them. */
export const CATEGORICAL_PALETTE_IDS: readonly string[] = paletteIds(false);

/** The gradients a numeric legend offers, by label. */
export const GRADIENT_PALETTE_IDS: readonly string[] = paletteIds(true);

interface PaletteSwatchesView {
  ids: readonly string[];
  selected: string;
  /** Gradient swatches (a numeric legend) instead of colour chips. */
  gradient: boolean;
  /** Draw gradients high to low, as "Reverse gradient" does. */
  reverse: boolean;
}

const STEP = new Map([
  ['ArrowRight', 1],
  ['ArrowDown', 1],
  ['ArrowLeft', -1],
  ['ArrowUp', -1],
]);

const paletteLabel = (id: string): string => COLOR_SCHEME_INFO[id as PaletteId]?.label ?? id;

function swatchPreview(id: string, view: PaletteSwatchesView): TemplateResult {
  if (view.gradient) {
    const backgroundImage = createColorSchemeLinearGradient(id, view.reverse ? '270deg' : '90deg');
    return html`<span
      class="swatch-gradient"
      aria-hidden="true"
      style=${styleMap({ backgroundImage })}
    ></span>`;
  }
  const colors = (COLOR_SCHEMES[id as PaletteId] ?? COLOR_SCHEMES.kellys).slice(0, SWATCH_CHIPS);
  return html`<span class="swatch-chips" aria-hidden="true"
    >${colors.map(
      (color) => html`<span class="chip" style=${styleMap({ background: color })}></span>`,
    )}</span
  >`;
}

/**
 * The palette picker: a radio group of swatches, each named by its palette. Arrow keys move and
 * pick, as `ps-segmented` does; the checked swatch is the one tab stop.
 */
export function renderPaletteSwatches(
  view: PaletteSwatchesView,
  onPick: (id: string) => void,
): TemplateResult {
  const checked = view.ids.indexOf(view.selected);
  const tabStop = checked < 0 ? 0 : checked;
  const onKeydown = (event: KeyboardEvent) => {
    const count = view.ids.length;
    const from = (event.target as Element).closest<HTMLElement>('[data-palette]');
    const index = from ? view.ids.indexOf(from.dataset.palette ?? '') : tabStop;
    const step = STEP.get(event.key);
    let next: number;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = count - 1;
    else if (step !== undefined) next = (index + step + count) % count;
    else return;
    if (count === 0) return;
    event.preventDefault();
    const id = view.ids[next];
    onPick(id);
    (event.currentTarget as HTMLElement)
      .querySelector<HTMLElement>(`[data-palette="${CSS.escape(id)}"]`)
      ?.focus();
  };
  return html`<div class="swatches" role="radiogroup" aria-label="Palette" @keydown=${onKeydown}>
    ${view.ids.map(
      (id, index) =>
        html`<button
          type="button"
          class="swatch"
          role="radio"
          aria-checked=${String(id === view.selected)}
          tabindex=${index === tabStop ? 0 : -1}
          data-palette=${id}
          @click=${() => onPick(id)}
        >
          ${swatchPreview(id, view)}<span class="swatch-name">${paletteLabel(id)}</span>
        </button>`,
    )}
  </div>`;
}
