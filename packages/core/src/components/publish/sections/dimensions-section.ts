import { html, nothing, type TemplateResult } from 'lit';
import { icon } from '../../kit/icon';
import '../../kit/tooltip';
import { cmToMm, inToMm, mmToCm, mmToIn, pxToMm } from '../dimension-utils';
import { getActivePresetMaxHeightPx, getActivePresetWidthPx } from '../publish-modal-helpers';
import type { PublishState } from '../publish-state';

type Unit = PublishState['unit'];

const RESAMPLE_TOOLTIP =
  'When on, changing the resolution re-renders the figure at a new pixel count. ' +
  'When off, only print-size metadata changes — pixels stay the same.';

interface DimensionsModel {
  state: PublishState;
  showResampleNote: boolean;
}

interface DimensionsHandlers {
  widthPx(px: number): void;
  widthMm(mm: number): void;
  heightPx(px: number): void;
  heightMm(mm: number): void;
  dpi(dpi: number): void;
  unit(unit: Unit): void;
  toggleResample(): void;
  toggleAspectLock(): void;
}

function unitToMm(value: number, unit: Exclude<Unit, 'px'>): number {
  if (unit === 'in') return inToMm(value);
  if (unit === 'cm') return cmToMm(value);
  return value; // 'mm' — no conversion
}

function formatDimensionForUnit(px: number, mm: number, unit: Unit): string {
  if (unit === 'px') return String(px);
  if (unit === 'mm') return mm.toFixed(1);
  if (unit === 'in') return mmToIn(mm).toFixed(2);
  return mmToCm(mm).toFixed(2);
}

/** A typed width or height: whole pixels in px, else converted to mm. A non-positive entry is ignored. */
function readSize(
  event: Event,
  unit: Unit,
  setPx: (px: number) => void,
  setMm: (mm: number) => void,
): void {
  const value = parseFloat((event.target as HTMLInputElement).value);
  if (!Number.isFinite(value) || value <= 0) return;
  if (unit === 'px') setPx(Math.round(value));
  else setMm(unitToMm(value, unit));
}

function renderAspectLink(locked: boolean, disabled: boolean, onToggle: () => void) {
  // Bracket arms (always visible) flow from Width row → chain → Height row,
  // matching Photoshop's Image Size dialog. Chain glyph uses the Lucide
  // link / unlink paths translated to occupy the lower-right of the SVG so
  // the brackets have a clear vertical column on the left to live in.
  // While a journal preset pins width, the chain is meaningless — render it
  // as visibly broken and disabled so the UI matches the actual constraint.
  const effectiveLocked = locked && !disabled;
  return html`
    <button
      class="publish-aspect-lock ${effectiveLocked ? 'locked' : ''}"
      data-publish-input="aspect-lock"
      ?disabled=${disabled}
      @click=${() => {
        if (!disabled) onToggle();
      }}
      aria-label="Link width and height"
      aria-pressed=${effectiveLocked}
    >
      <svg
        viewBox="0 0 32 60"
        width="30"
        height="56"
        aria-hidden="true"
        xmlns="http://www.w3.org/2000/svg"
      >
        <!-- Bracket arms link Width row (top) and Height row (bottom) to the chain. -->
        <path class="aspect-lock-bracket" d="M 0 8 L 8 8 L 8 17" />
        <path class="aspect-lock-bracket" d="M 8 43 L 8 52 L 0 52" />

        <!-- LOCKED: Lucide 'link' icon rotated -45° so the chain axis -->
        <!-- runs straight top-to-bottom (vertical chain). -->
        <g class="aspect-lock-state-locked" transform="translate(8 18) rotate(-45 12 12)">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.72-1.71" />
        </g>

        <!-- UNLOCKED: Lucide 'unlink' rotated -45° — same vertical chain -->
        <!-- pulled apart with four small spark lines indicating a break. -->
        <g class="aspect-lock-state-unlocked" transform="translate(8 18) rotate(-45 12 12)">
          <path d="m18.84 12.25 1.72-1.71a5 5 0 0 0-.12-7.07 5 5 0 0 0-6.95 0l-1.72 1.71" />
          <path d="m5.17 11.75-1.71 1.71a5 5 0 0 0 .12 7.07 5 5 0 0 0 6.95 0l1.71-1.71" />
          <line x1="8" y1="2" x2="8" y2="5" />
          <line x1="2" y1="8" x2="5" y2="8" />
          <line x1="16" y1="19" x2="16" y2="22" />
          <line x1="19" y1="16" x2="22" y2="16" />
        </g>
      </svg>
    </button>
    <ps-tooltip
      text=${disabled
        ? 'Width is fixed by the journal preset; only height is adjustable.'
        : effectiveLocked
          ? 'Linked: editing one rescales the other. Click to unlink.'
          : 'Unlinked: width and height are independent. Click to link.'}
    ></ps-tooltip>
  `;
}

/** Width, height, unit, resolution and Resample, in the Photoshop Image Size layout. */
export function renderDimensions(
  model: DimensionsModel,
  handlers: DimensionsHandlers,
): TemplateResult {
  const s = model.state;
  const widthMm = pxToMm(s.widthPx, s.dpi);
  const heightMm = pxToMm(s.heightPx, s.dpi);

  const widthDisplay = formatDimensionForUnit(s.widthPx, widthMm, s.unit);
  const heightDisplay = formatDimensionForUnit(s.heightPx, heightMm, s.unit);

  const dimsReadOnly = s.unit === 'px' && !s.resample;
  // Journal presets pin width and (optionally) cap height. While such a
  // preset is active, lock the width inputs and clamp the height slider.
  const widthLocked = getActivePresetWidthPx(s) !== null;
  const heightMaxPx = getActivePresetMaxHeightPx(s);

  return html`
    <div class="publish-section">
      <div class="publish-section-title">Dimensions</div>

      <div class="publish-dim-readout">
        ${dimsReadOnly ? 'Pixel Dims (locked)' : 'Pixel Dims'}:
        <strong>${s.widthPx} × ${s.heightPx} px</strong>
      </div>

      <div class="publish-dim-pair">
        <label class="publish-dim-label">Width</label>
        <div class="publish-dim-control">
          <input
            type="range"
            class="publish-slider"
            data-publish-input="width-slider"
            min="200"
            max="8000"
            step="1"
            ?disabled=${dimsReadOnly || widthLocked}
            .value=${String(s.widthPx)}
            @input=${(e: Event) => {
              const px = parseInt((e.target as HTMLInputElement).value);
              if (Number.isFinite(px) && px > 0) handlers.widthPx(px);
            }}
          />
          <input
            type="number"
            class="publish-row-input publish-dim-value"
            data-publish-input="width"
            ?disabled=${dimsReadOnly || widthLocked}
            .value=${String(widthDisplay)}
            step=${s.unit === 'px' ? '1' : '0.1'}
            @change=${(e: Event) => readSize(e, s.unit, handlers.widthPx, handlers.widthMm)}
          />
          ${widthLocked
            ? html`<ps-tooltip text="Width is fixed by the active journal preset."></ps-tooltip>`
            : nothing}
        </div>
        ${renderAspectLink(s.aspectLocked, widthLocked, handlers.toggleAspectLock)}
        <select
          class="publish-select publish-unit-select"
          data-publish-input="unit"
          .value=${s.unit}
          @change=${(e: Event) => {
            handlers.unit((e.target as HTMLSelectElement).value as Unit);
          }}
        >
          <option value="px">px</option>
          <option value="mm">mm</option>
          <option value="in">in</option>
          <option value="cm">cm</option>
        </select>

        <label class="publish-dim-label">Height</label>
        <div class="publish-dim-control">
          <input
            type="range"
            class="publish-slider"
            data-publish-input="height-slider"
            min="200"
            max=${heightMaxPx !== null ? String(Math.max(200, heightMaxPx)) : '8000'}
            step="1"
            ?disabled=${dimsReadOnly}
            .value=${String(s.heightPx)}
            @input=${(e: Event) => {
              const px = parseInt((e.target as HTMLInputElement).value);
              if (Number.isFinite(px) && px > 0) handlers.heightPx(px);
            }}
          />
          <input
            type="number"
            class="publish-row-input publish-dim-value"
            data-publish-input="height"
            ?disabled=${dimsReadOnly}
            .value=${String(heightDisplay)}
            step=${s.unit === 'px' ? '1' : '0.1'}
            @change=${(e: Event) => readSize(e, s.unit, handlers.heightPx, handlers.heightMm)}
          />
        </div>
      </div>

      <div class="publish-dim-row">
        <label>Resolution</label>
        <div class="publish-input-group">
          <input
            type="number"
            class="publish-row-input"
            data-publish-input="dpi"
            min="1"
            max="2400"
            .value=${String(s.dpi)}
            @change=${(e: Event) => {
              handlers.dpi(parseInt((e.target as HTMLInputElement).value) || s.dpi);
            }}
          />
          <span class="publish-unit">Pixels/Inch</span>
        </div>
      </div>

      <label class="publish-checkbox-label">
        <input
          type="checkbox"
          class="publish-checkbox"
          data-publish-input="resample"
          .checked=${s.resample}
          @change=${() => handlers.toggleResample()}
        />
        Resample
        <span class="publish-info" role="img" aria-label="About Resample" tabindex="0"
          >${icon('info', 14)}</span
        ><ps-tooltip text=${RESAMPLE_TOOLTIP}></ps-tooltip>
      </label>
      ${model.showResampleNote
        ? html`<div class="publish-resample-note">Resample turned on to apply preset.</div>`
        : nothing}
    </div>
  `;
}
