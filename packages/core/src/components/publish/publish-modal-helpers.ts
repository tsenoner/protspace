/**
 * Pure helper functions extracted from the publish modal component.
 *
 * Each function takes state as input and returns a partial state patch —
 * no DOM access, no side effects, fully testable. The Resample toggle
 * decides which axis the algebra (widthPx = widthMm × dpi / 25.4) resolves
 * around: Resample=ON keeps mm fixed and recomputes px; Resample=OFF keeps
 * px fixed and recomputes dpi (so mm follows).
 */

import type { PublishState } from './publish-state';
import { getPreset, resolvePresetDimensions, type PresetId } from './journal-presets';
import { adjustDpiForWidthMm, mmToPx, pxToMm } from './dimension-utils';

type ViewFingerprint = { projection: string; dimensionality: number };

/** Return the active preset's mm constraints, or null for px-based / custom presets. */
export function getActivePresetConstraints(
  state: PublishState,
): { widthMm: number; maxHeightMm: number | undefined } | null {
  const preset = getPreset(state.preset);
  if (!preset || preset.widthMm === undefined) return null;
  return { widthMm: preset.widthMm, maxHeightMm: preset.maxHeightMm };
}

/** Width pinned by the active mm-based preset, in pixels at the current dpi. */
export function getActivePresetWidthPx(state: PublishState): number | null {
  const c = getActivePresetConstraints(state);
  if (!c) return null;
  return mmToPx(c.widthMm, state.dpi);
}

/** Height ceiling enforced by the active mm-based preset, in pixels at the current dpi. */
export function getActivePresetMaxHeightPx(state: PublishState): number | null {
  const c = getActivePresetConstraints(state);
  if (!c?.maxHeightMm) return null;
  return mmToPx(c.maxHeightMm, state.dpi);
}

/**
 * Width input in pixels. Caller is responsible for only invoking this when the UI
 * unit is 'px'; DPI is unaffected regardless of resample mode.
 */
export function computeWidthPxUpdate(state: PublishState, widthPx: number): Partial<PublishState> {
  if (widthPx <= 0) return {};
  const patch: Partial<PublishState> = { widthPx, preset: 'custom' };
  if (state.aspectLocked && state.widthPx > 0) {
    const ratio = state.heightPx / state.widthPx;
    patch.heightPx = Math.max(1, Math.round(widthPx * ratio));
  }
  return patch;
}

/** Width input in mm/in/cm. Branches on `state.resample`. */
export function computeWidthMmUpdate(state: PublishState, widthMm: number): Partial<PublishState> {
  if (widthMm <= 0) return {};
  if (state.resample) {
    const widthPx = Math.max(1, mmToPx(widthMm, state.dpi));
    const patch: Partial<PublishState> = { widthPx, preset: 'custom' };
    if (state.aspectLocked && state.widthPx > 0) {
      const ratio = state.heightPx / state.widthPx;
      patch.heightPx = Math.max(1, Math.round(widthPx * ratio));
    }
    return patch;
  }
  // Resample=OFF: pixels locked, dpi recomputes.
  const dpi = Math.max(1, adjustDpiForWidthMm(state.widthPx, widthMm));
  return { dpi, preset: 'custom' };
}

/**
 * Height input in pixels. Caller is responsible for only invoking this when the UI
 * unit is 'px'; DPI is unaffected regardless of resample mode.
 */
export function computeHeightPxUpdate(
  state: PublishState,
  heightPx: number,
): Partial<PublishState> {
  if (heightPx <= 0) return {};
  const patch: Partial<PublishState> = { heightPx, preset: 'custom' };
  if (state.aspectLocked && state.heightPx > 0) {
    const ratio = state.widthPx / state.heightPx;
    patch.widthPx = Math.max(1, Math.round(heightPx * ratio));
  }
  return patch;
}

/** Height input in mm/in/cm. Branches on `state.resample`. */
export function computeHeightMmUpdate(
  state: PublishState,
  heightMm: number,
): Partial<PublishState> {
  if (heightMm <= 0) return {};
  if (state.resample) {
    const heightPx = Math.max(1, mmToPx(heightMm, state.dpi));
    const patch: Partial<PublishState> = { heightPx, preset: 'custom' };
    if (state.aspectLocked && state.heightPx > 0) {
      const ratio = state.widthPx / state.heightPx;
      patch.widthPx = Math.max(1, Math.round(heightPx * ratio));
    }
    return patch;
  }
  const dpi = Math.max(1, adjustDpiForWidthMm(state.heightPx, heightMm));
  return { dpi, preset: 'custom' };
}

/** DPI input. Branches on `state.resample`. Preserves the active preset (DPI is part of preset semantics). */
export function computeDpiUpdate(state: PublishState, dpi: number): Partial<PublishState> {
  if (dpi <= 0) return {};
  if (state.resample) {
    const widthMm = pxToMm(state.widthPx, state.dpi);
    const heightMm = pxToMm(state.heightPx, state.dpi);
    return {
      dpi,
      widthPx: Math.max(1, mmToPx(widthMm, dpi)),
      heightPx: Math.max(1, mmToPx(heightMm, dpi)),
    };
  }
  return { dpi };
}

/** Compute state patch for applying a journal preset. Always forces resample=true. */
export function computePresetApplication(presetId: string): {
  preset: PresetId;
  widthPx: number;
  heightPx: number | undefined;
  dpi: number;
  resample: true;
} | null {
  const preset = getPreset(presetId);
  if (!preset) return null;
  const dims = resolvePresetDimensions(preset);
  return {
    preset: presetId as PresetId,
    widthPx: dims.widthPx,
    heightPx: dims.heightPx,
    dpi: preset.dpi,
    resample: true,
  };
}

/** Check whether saved overlays may be stale due to a projection change. */
export function shouldShowFingerprintWarning(
  saved: ViewFingerprint | undefined,
  current: ViewFingerprint | null,
): boolean {
  if (!saved || !current) return false;
  return saved.projection !== current.projection || saved.dimensionality !== current.dimensionality;
}

/** What the legend hands the figure editor (mirrors the export-utils reader). */
export interface LegendExportState {
  annotation: string;
  otherItemsCount: number;
  items: Array<{
    value: string;
    displayValue?: string;
    color: string;
    shape: string;
    count: number;
    isVisible: boolean;
    zOrder: number;
  }>;
}

/** The legend's export data, or null when the element has none, it has no items, or it throws. */
export function readLegendExportState(
  el: (Element & { getLegendExportData?: () => LegendExportState }) | null,
): LegendExportState | null {
  if (!el || typeof el.getLegendExportData !== 'function') return null;
  try {
    const s = el.getLegendExportData();
    if (s && Array.isArray(s.items)) return s;
  } catch (e) {
    console.warn('Failed to read legend export state:', e);
  }
  return null;
}
