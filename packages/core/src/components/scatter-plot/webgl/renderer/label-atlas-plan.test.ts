import { describe, expect, it } from 'vitest';
import { MAX_LABELS, planLabelAtlas } from './label-atlas-plan';

// Capacities are the row-snapped values planRendererCapacity actually produces,
// so these cases describe geometry the renderer can really ask for.
const SWISS_PROT_CAPACITY = 573_696; // 573,649 proteins snapped to 256
const CLAMPED_CAPACITY = 1_000_192; // the old 1,000,000 renderer clamp, snapped to 256
const TWO_MILLION_CAPACITY = 2_000_128; // the ceiling #456 raises the clamp to

describe('planLabelAtlas', () => {
  it('keeps the historical geometry on a device with ample limits', () => {
    // The no-change lock. ~97% of WebGL2 devices report >= 8192, and they must
    // allocate exactly what they allocated before this module existed:
    // 2048 wide, capacity/256 rows, 8 slices per point.
    expect(planLabelAtlas(SWISS_PROT_CAPACITY, 8192)).toEqual({
      width: 2048,
      height: 2241,
      stride: MAX_LABELS,
      pointCapacity: SWISS_PROT_CAPACITY,
      byteLength: 2048 * 2241 * 4,
    });
  });

  it('keeps that same geometry at 4096, where the clamp is what saves it', () => {
    expect(planLabelAtlas(SWISS_PROT_CAPACITY, 4096)).toMatchObject({
      width: 2048,
      height: 2241,
      stride: MAX_LABELS,
    });
    // The clamped capacity is the worst case a 4096 device can be asked for,
    // and it still fits at full fidelity: 1,000,192 * 8 / 2048 = 3907 <= 4096.
    expect(planLabelAtlas(CLAMPED_CAPACITY, 4096)).toMatchObject({
      width: 2048,
      height: 3907,
      stride: MAX_LABELS,
    });
  });

  it('reduces slices, not points, on a device at the WebGL2 floor', () => {
    // 573,696 * 8 / 2048 = 2241 rows, over the limit. No wider texture is
    // available at 2048, so the stride drops instead — every point keeps a pie.
    expect(planLabelAtlas(SWISS_PROT_CAPACITY, 2048)).toEqual({
      width: 2048,
      height: 1121,
      stride: 4,
      pointCapacity: SWISS_PROT_CAPACITY,
      byteLength: 2048 * 1121 * 4,
    });
  });

  it('widens before it reduces fidelity', () => {
    // At 2M the narrow texture needs 7813 rows, but a 4096-wide one needs 3907,
    // so a 4096 device keeps all eight slices rather than dropping to four.
    expect(planLabelAtlas(TWO_MILLION_CAPACITY, 4096)).toMatchObject({
      width: 4096,
      height: 3907,
      stride: MAX_LABELS,
    });
  });

  it('falls to the two-slice floor only when no width fits', () => {
    expect(planLabelAtlas(TWO_MILLION_CAPACITY, 2048)).toMatchObject({
      width: 2048,
      height: 1954,
      stride: 2,
    });
  });

  it('returns null when even the floor cannot fit', () => {
    // Below the spec floor no candidate width is usable at all.
    expect(planLabelAtlas(SWISS_PROT_CAPACITY, 1024)).toBeNull();
  });

  it('rejects nonsense inputs rather than planning an unbounded texture', () => {
    expect(planLabelAtlas(SWISS_PROT_CAPACITY, Number.NaN)).toBeNull();
    expect(planLabelAtlas(SWISS_PROT_CAPACITY, 0)).toBeNull();
    expect(planLabelAtlas(0, 8192)).toBeNull();
    expect(planLabelAtlas(Number.NaN, 8192)).toBeNull();
  });

  it('never plans a texture the device cannot hold, and never under-allocates', () => {
    const limits = [1024, 2048, 4096, 8192, 16384];
    const capacities = [1024, SWISS_PROT_CAPACITY, CLAMPED_CAPACITY, TWO_MILLION_CAPACITY];

    for (const maxTextureSize of limits) {
      for (const capacity of capacities) {
        const plan = planLabelAtlas(capacity, maxTextureSize);
        if (plan === null) continue;
        expect(plan.width).toBeLessThanOrEqual(maxTextureSize);
        expect(plan.height).toBeLessThanOrEqual(maxTextureSize);
        // Every point's slices must have somewhere to live.
        expect(capacity * plan.stride).toBeLessThanOrEqual(plan.width * plan.height);
        expect(plan.byteLength).toBe(plan.width * plan.height * 4);
      }
    }
  });
});

describe('planLabelAtlas stride inheritance', () => {
  // The export renderer plans against its OWN context's limit but must never
  // exceed the live view's fidelity, or a figure would show eight segments where
  // the user saw four. Capacities differ between the two (export is not
  // row-snapped), so the bound has to be the stride, not the geometry.
  it('never exceeds the inherited stride even when the device could hold more', () => {
    const plan = planLabelAtlas(SWISS_PROT_CAPACITY, 8192, 4);
    expect(plan).toMatchObject({ stride: 4 });
  });

  it('takes the smaller of the device limit and the inherited stride', () => {
    // Device forces 4; live view is at 8. The device wins.
    expect(planLabelAtlas(SWISS_PROT_CAPACITY, 2048, MAX_LABELS)).toMatchObject({ stride: 4 });
    // Device allows 8; live view is at 2. The live view wins.
    expect(planLabelAtlas(SWISS_PROT_CAPACITY, 8192, 2)).toMatchObject({ stride: 2 });
  });

  it('plans no atlas at all when the live view has none', () => {
    expect(planLabelAtlas(SWISS_PROT_CAPACITY, 8192, null)).toBeNull();
  });
});
