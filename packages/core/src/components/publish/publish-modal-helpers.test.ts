import { describe, it, expect } from 'vitest';
import {
  getActivePresetConstraints,
  computeWidthPxUpdate,
  computeWidthMmUpdate,
  computeHeightPxUpdate,
  computeHeightMmUpdate,
  computeDpiUpdate,
  computePresetApplication,
  shouldShowFingerprintWarning,
} from './publish-modal-helpers';
import { createDefaultPublishState, type PublishState } from './publish-state';

function makeState(overrides: Partial<PublishState> = {}): PublishState {
  return { ...createDefaultPublishState(), ...overrides };
}

describe('publish-modal-helpers', () => {
  describe('getActivePresetConstraints', () => {
    it('returns mm constraints for a mm-based preset', () => {
      const state = makeState({ preset: 'nature-1col' });
      const result = getActivePresetConstraints(state);
      expect(result).not.toBeNull();
      expect(result!.widthMm).toBe(89);
      expect(result!.maxHeightMm).toBe(247);
    });

    it('returns null for a px-based preset', () => {
      const state = makeState({ preset: 'slide-16-9' });
      const result = getActivePresetConstraints(state);
      expect(result).toBeNull();
    });

    it('returns null for custom preset', () => {
      const state = makeState({ preset: 'custom' });
      const result = getActivePresetConstraints(state);
      expect(result).toBeNull();
    });

    it('returns null for unknown preset', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const state = makeState({ preset: 'nonexistent' as any });
      const result = getActivePresetConstraints(state);
      expect(result).toBeNull();
    });
  });

  describe('computeWidthPxUpdate', () => {
    it('changes widthPx, leaves dpi untouched', () => {
      const state = makeState({ widthPx: 1051, heightPx: 591, dpi: 300, resample: true });
      const patch = computeWidthPxUpdate(state, 2102);
      expect(patch.widthPx).toBe(2102);
      expect(patch.dpi).toBeUndefined();
    });

    it('aspectLocked=true: scales height proportionally', () => {
      const state = makeState({
        widthPx: 1000,
        heightPx: 500,
        dpi: 300,
        resample: true,
        aspectLocked: true,
      });
      const patch = computeWidthPxUpdate(state, 2000);
      expect(patch.widthPx).toBe(2000);
      expect(patch.heightPx).toBe(1000);
    });

    it('aspectLocked=false: leaves height untouched', () => {
      const state = makeState({
        widthPx: 1000,
        heightPx: 500,
        dpi: 300,
        resample: true,
        aspectLocked: false,
      });
      const patch = computeWidthPxUpdate(state, 2000);
      expect(patch.widthPx).toBe(2000);
      expect(patch.heightPx).toBeUndefined();
    });

    it('marks preset as custom unless preset is already custom', () => {
      const state = makeState({ preset: 'nature-1col', widthPx: 1051, dpi: 300, resample: true });
      const patch = computeWidthPxUpdate(state, 2000);
      expect(patch.preset).toBe('custom');
    });
  });

  describe('computeWidthMmUpdate', () => {
    it('Resample=ON: changes widthPx, leaves dpi fixed', () => {
      const state = makeState({ widthPx: 1051, dpi: 300, resample: true });
      const patch = computeWidthMmUpdate(state, 178);
      expect(patch.widthPx).toBe(2102);
      expect(patch.dpi).toBeUndefined();
    });

    it('Resample=OFF, halving mm doubles dpi', () => {
      const state = makeState({ widthPx: 1051, dpi: 300, resample: false });
      const patch = computeWidthMmUpdate(state, 44.5);
      expect(patch.dpi).toBe(600);
      // Pixels stay locked.
      expect(patch.widthPx).toBeUndefined();
      expect(patch.heightPx).toBeUndefined();
    });

    it('Resample=ON aspectLocked=true: scales height proportionally', () => {
      const state = makeState({
        widthPx: 1000,
        heightPx: 500,
        dpi: 300,
        resample: true,
        aspectLocked: true,
      });
      const patch = computeWidthMmUpdate(state, 169.333);
      expect(patch.widthPx).toBe(2000);
      expect(patch.heightPx).toBe(1000);
    });
  });

  describe('computeHeightPxUpdate', () => {
    it('aspectLocked=true: scales width proportionally', () => {
      const state = makeState({
        widthPx: 1000,
        heightPx: 500,
        dpi: 300,
        resample: true,
        aspectLocked: true,
      });
      const patch = computeHeightPxUpdate(state, 1000);
      expect(patch.heightPx).toBe(1000);
      expect(patch.widthPx).toBe(2000);
    });

    it('aspectLocked=false: leaves width untouched', () => {
      const state = makeState({
        widthPx: 1000,
        heightPx: 500,
        dpi: 300,
        resample: true,
        aspectLocked: false,
      });
      const patch = computeHeightPxUpdate(state, 800);
      expect(patch.heightPx).toBe(800);
      expect(patch.widthPx).toBeUndefined();
    });
  });

  describe('computeHeightMmUpdate', () => {
    it('Resample=ON: changes heightPx, leaves dpi fixed', () => {
      const state = makeState({ widthPx: 1051, heightPx: 591, dpi: 300, resample: true });
      const patch = computeHeightMmUpdate(state, 100);
      expect(patch.heightPx).toBe(1181);
      expect(patch.dpi).toBeUndefined();
    });

    it('Resample=OFF, halving mm doubles dpi', () => {
      const state = makeState({ widthPx: 1051, heightPx: 591, dpi: 300, resample: false });
      const patch = computeHeightMmUpdate(state, 25);
      expect(patch.dpi).toBe(600);
      // Pixels stay locked.
      expect(patch.heightPx).toBeUndefined();
      expect(patch.widthPx).toBeUndefined();
    });

    it('Resample=ON aspectLocked=true: scales width proportionally', () => {
      const state = makeState({
        widthPx: 1000,
        heightPx: 500,
        dpi: 300,
        resample: true,
        aspectLocked: true,
      });
      const patch = computeHeightMmUpdate(state, 84.667);
      expect(patch.heightPx).toBe(1000);
      expect(patch.widthPx).toBe(2000);
    });
  });

  describe('computeDpiUpdate', () => {
    it('Resample=ON: doubles widthPx and heightPx, mm fixed', () => {
      const state = makeState({ widthPx: 1051, heightPx: 591, dpi: 300, resample: true });
      const patch = computeDpiUpdate(state, 600);
      expect(patch.dpi).toBe(600);
      expect(patch.widthPx).toBe(2102);
      expect(patch.heightPx).toBe(1182);
    });

    it('Resample=ON: halves pixels at half DPI', () => {
      const state = makeState({ widthPx: 1051, heightPx: 591, dpi: 300, resample: true });
      const patch = computeDpiUpdate(state, 150);
      expect(patch.widthPx).toBe(526);
      expect(patch.heightPx).toBe(296);
    });

    it('Resample=OFF: dpi changes, pixels stay locked', () => {
      const state = makeState({ widthPx: 1051, heightPx: 591, dpi: 300, resample: false });
      const patch = computeDpiUpdate(state, 600);
      expect(patch.dpi).toBe(600);
      expect(patch.widthPx).toBeUndefined();
      expect(patch.heightPx).toBeUndefined();
    });

    it('Flexible mode + Resample=ON: pixels still recompute', () => {
      const state = makeState({
        preset: 'flexible',
        widthPx: 2048,
        heightPx: 1024,
        dpi: 300,
        resample: true,
      });
      const patch = computeDpiUpdate(state, 600);
      expect(patch.widthPx).toBe(4096);
      expect(patch.heightPx).toBe(2048);
    });

    it('preserves the active preset (DPI is part of preset semantics)', () => {
      const state = makeState({
        preset: 'nature-1col',
        widthPx: 1051,
        heightPx: 591,
        dpi: 300,
        resample: true,
      });
      const patch = computeDpiUpdate(state, 600);
      expect(patch.preset).toBeUndefined();
    });
  });

  describe('computePresetApplication', () => {
    it('resolves a mm-based preset to pixel dimensions', () => {
      const patch = computePresetApplication('nature-1col');
      expect(patch).not.toBeNull();
      expect(patch!.preset).toBe('nature-1col');
      expect(patch!.widthPx).toBe(1051);
      expect(patch!.dpi).toBe(300);
    });

    it('resolves a px-based preset', () => {
      const patch = computePresetApplication('slide-16-9');
      expect(patch).not.toBeNull();
      expect(patch!.preset).toBe('slide-16-9');
      expect(patch!.widthPx).toBeDefined();
      expect(patch!.dpi).toBeDefined();
    });

    it('returns null for unknown preset', () => {
      const patch = computePresetApplication('nonexistent');
      expect(patch).toBeNull();
    });

    it('forces resample to true', () => {
      const patch = computePresetApplication('nature-1col');
      expect(patch).not.toBeNull();
      expect(patch!.resample).toBe(true);
    });
  });

  describe('shouldShowFingerprintWarning', () => {
    it('returns false when no saved fingerprint', () => {
      expect(
        shouldShowFingerprintWarning(undefined, { projection: 'UMAP', dimensionality: 2 }),
      ).toBe(false);
    });

    it('returns false when fingerprints match', () => {
      const fp = { projection: 'UMAP', dimensionality: 2 };
      expect(shouldShowFingerprintWarning(fp, { projection: 'UMAP', dimensionality: 2 })).toBe(
        false,
      );
    });

    it('returns true when projection differs', () => {
      const saved = { projection: 'UMAP', dimensionality: 2 };
      const current = { projection: 'PCA', dimensionality: 2 };
      expect(shouldShowFingerprintWarning(saved, current)).toBe(true);
    });

    it('returns true when dimensionality differs', () => {
      const saved = { projection: 'UMAP', dimensionality: 2 };
      const current = { projection: 'UMAP', dimensionality: 3 };
      expect(shouldShowFingerprintWarning(saved, current)).toBe(true);
    });

    it('returns false when current projection is null', () => {
      const saved = { projection: 'UMAP', dimensionality: 2 };
      expect(shouldShowFingerprintWarning(saved, null)).toBe(false);
    });
  });
});
