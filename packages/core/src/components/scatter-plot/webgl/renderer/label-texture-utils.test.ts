import { describe, it, expect, vi } from 'vitest';
import { fillLabelColorTexels } from './label-texture-utils';

// Mock resolveColor so tests don't depend on a Canvas 2D context (unavailable in jsdom).
// Each hex color maps to a predictable normalized RGB triple.
vi.mock('../color-utils', () => ({
  resolveColor: vi.fn((color: string): [number, number, number] => {
    const map: Record<string, [number, number, number]> = {
      '#ff0000': [1, 0, 0],
      '#00ff00': [0, 1, 0],
      '#0000ff': [0, 0, 1],
      '#ffffff': [1, 1, 1],
      '#000000': [0, 0, 0],
    };
    return map[color] ?? [0.5, 0.5, 0.5];
  }),
}));

const MAX_LABELS = 8;

function makeData(slots: number): Uint8Array {
  return new Uint8Array(slots * MAX_LABELS * 4); // initialized to 0
}

describe('fillLabelColorTexels', () => {
  it('0 colors → no bytes written', () => {
    const data = makeData(4);
    fillLabelColorTexels(data, 0, [], MAX_LABELS);
    expect(data.every((b) => b === 0)).toBe(true);
  });

  it('1 color (single-label) → no bytes written (dead-slot optimization)', () => {
    const data = makeData(4);
    fillLabelColorTexels(data, 0, ['#ff0000'], MAX_LABELS);
    // Single-label points use v_color in the shader; texture is never sampled.
    expect(data.every((b) => b === 0)).toBe(true);
  });

  it('2 colors → texels for slices 0 and 1 written; slice 2 region untouched', () => {
    const data = makeData(4);
    fillLabelColorTexels(data, 0, ['#ff0000', '#00ff00'], MAX_LABELS);

    // slice 0 → [255, 0, 0, 255]
    expect(data[0]).toBe(255);
    expect(data[1]).toBe(0);
    expect(data[2]).toBe(0);
    expect(data[3]).toBe(255);

    // slice 1 → [0, 255, 0, 255]
    expect(data[4]).toBe(0);
    expect(data[5]).toBe(255);
    expect(data[6]).toBe(0);
    expect(data[7]).toBe(255);

    // slice 2 region (bytes 8–11) must remain 0
    expect(data[8]).toBe(0);
    expect(data[9]).toBe(0);
    expect(data[10]).toBe(0);
    expect(data[11]).toBe(0);
  });

  it('more colors than maxLabels → only maxLabels slices written', () => {
    const smallMax = 4;
    // data sized for idx 0..1 with smallMax slots each
    const data = new Uint8Array(2 * smallMax * 4);
    const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffffff', '#000000']; // 5 > smallMax=4
    fillLabelColorTexels(data, 0, colors, smallMax);

    // Exactly 4 slices filled (smallMax), 5th not written
    // slice 3 → #ffffff → [255, 255, 255, 255]
    const base3 = 3 * 4;
    expect(data[base3]).toBe(255);
    expect(data[base3 + 1]).toBe(255);
    expect(data[base3 + 2]).toBe(255);
    expect(data[base3 + 3]).toBe(255);

    // No bytes beyond index 0..smallMax*4-1 should be non-zero
    for (let i = smallMax * 4; i < data.length; i++) {
      expect(data[i]).toBe(0);
    }
  });

  it('idx offset correct: idx=2 writes start at byte 2 * maxLabels * 4; idx 0/1 untouched', () => {
    const data = makeData(4); // 4 point slots
    fillLabelColorTexels(data, 2, ['#ff0000', '#0000ff'], MAX_LABELS);

    // idx 0 and idx 1 regions must be all zero
    for (let i = 0; i < 2 * MAX_LABELS * 4; i++) {
      expect(data[i]).toBe(0);
    }

    const base = 2 * MAX_LABELS * 4;

    // idx 2, slice 0 → [255, 0, 0, 255]
    expect(data[base]).toBe(255);
    expect(data[base + 1]).toBe(0);
    expect(data[base + 2]).toBe(0);
    expect(data[base + 3]).toBe(255);

    // idx 2, slice 1 → [0, 0, 255, 255]
    expect(data[base + 4]).toBe(0);
    expect(data[base + 5]).toBe(0);
    expect(data[base + 6]).toBe(255);
    expect(data[base + 7]).toBe(255);
  });

  it('bounds: small buffer where idx would overflow → no throw, no out-of-range writes', () => {
    // Only enough room for 1 point slot with MAX_LABELS texels
    const data = new Uint8Array(MAX_LABELS * 4);
    // idx=1 would start at byte MAX_LABELS*4, which is exactly data.length → all guarded
    expect(() => {
      fillLabelColorTexels(data, 1, ['#ff0000', '#00ff00'], MAX_LABELS);
    }).not.toThrow();
    // The existing slot 0 bytes must remain 0 (idx 1 guard skipped all writes)
    expect(data.every((b) => b === 0)).toBe(true);
  });
});
