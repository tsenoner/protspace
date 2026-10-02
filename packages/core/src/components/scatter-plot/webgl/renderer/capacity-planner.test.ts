import { describe, it, expect } from 'vitest';
import { planRendererCapacity, shouldReplanCapacityResource } from './capacity-planner';

const FLOOR = 1024;
const ROW = 256;
/** The pre-clamp behaviour the seven original cases below lock in. */
const UNBOUNDED = Number.POSITIVE_INFINITY;

describe('planRendererCapacity', () => {
  it('first load 573230, current 0 → 573440 (NOT next pow2 1048576)', () => {
    const result = planRendererCapacity(573230, 0, FLOOR, ROW, UNBOUNDED);
    expect(result).toBe(573440);
    expect(result).not.toBe(1048576);
  });

  it('result is always a multiple of 256', () => {
    const inputs = [1, 100, 573230, 700000, 1000000, 1500000, 256, 512, 1024];
    for (const n of inputs) {
      const result = planRendererCapacity(n, 0, FLOOR, ROW, UNBOUNDED);
      expect(result % ROW).toBe(0);
    }
  });

  it('below floor: minCapacity 100, current 0 → 1024 (floor, multiple of 256)', () => {
    const result = planRendererCapacity(100, 0, FLOOR, ROW, UNBOUNDED);
    expect(result).toBe(1024);
    expect(result % ROW).toBe(0);
  });

  it('exact multiple at floor: minCapacity 512, current 0 → 1024 (floor wins, still multiple of 256)', () => {
    // 512 < FLOOR (1024), so floor wins; 1024 is already a multiple of 256
    const result = planRendererCapacity(512, 0, FLOOR, ROW, UNBOUNDED);
    expect(result).toBe(1024);
    expect(result % ROW).toBe(0);
  });

  it('growth across reloads: minCapacity 700000, current 573440 → 860160', () => {
    // ceil(573440 * 1.5) = 860160, which is already a multiple of 256
    const result = planRendererCapacity(700000, 573440, FLOOR, ROW, UNBOUNDED);
    expect(result).toBe(860160);
    expect(result % ROW).toBe(0);
  });

  it('large first load 1_500_000, current 0 → 1500160', () => {
    // ceil(1500000 / 256) * 256 = 5860 * 256 = 1500160
    const result = planRendererCapacity(1_500_000, 0, FLOOR, ROW, UNBOUNDED);
    expect(result).toBe(1500160);
  });

  it('result >= minCapacity and >= minCapacityFloor in all cases', () => {
    const cases: Array<[number, number]> = [
      [573230, 0],
      [100, 0],
      [512, 0],
      [700000, 573440],
      [1_500_000, 0],
      [1024, 0],
      [1025, 0],
      [300000, 200000],
    ];
    for (const [min, cur] of cases) {
      const result = planRendererCapacity(min, cur, FLOOR, ROW, UNBOUNDED);
      expect(result).toBeGreaterThanOrEqual(min);
      expect(result).toBeGreaterThanOrEqual(FLOOR);
    }
  });

  describe('maxCapacity bound', () => {
    const CAP = 1_000_000;

    it('stops geometric growth overshooting the renderer cap', () => {
      // Unbounded, 900,096 -> 1.5x = 1,350,144, whose label atlas needs 5274 rows and
      // fails on a 4096 device at a point count well under a million.
      expect(planRendererCapacity(950_000, 900_096, FLOOR, ROW, UNBOUNDED)).toBe(1_350_144);
      expect(planRendererCapacity(950_000, 900_096, FLOOR, ROW, CAP)).toBe(1_000_192);
    });

    it('leaves an ordinary load untouched', () => {
      expect(planRendererCapacity(573_649, 0, FLOOR, ROW, CAP)).toBe(573_696);
    });

    it('does not starve a load larger than the cap', () => {
      // The bound is floored at the snapped requirement, so a caller asking for more
      // than the cap still gets buffers big enough for what it asked for.
      expect(planRendererCapacity(1_500_000, 0, FLOOR, ROW, CAP)).toBe(1_500_160);
    });
  });

  describe('shrink hysteresis', () => {
    const CAP = 2_000_000;

    it('releases a footprint more than 4x the requirement', () => {
      // "Load 2M, then open the 5K demo". Grow-only retention held the 2M
      // footprint for the rest of the session (#456 follow-up).
      expect(planRendererCapacity(5_000, 2_000_128, FLOOR, ROW, CAP)).toBe(5_120);
    });

    it('retains capacity on an ordinary dataset switch', () => {
      // Within 4x the requirement, what we hold is returned unchanged, so the
      // caller reuses the buffers instead of reallocating them.
      expect(planRendererCapacity(200_000, 400_128, FLOOR, ROW, CAP)).toBe(400_128);
    });

    it('never shrinks below the floor', () => {
      expect(planRendererCapacity(1, 2_000_128, FLOOR, ROW, CAP)).toBe(FLOOR);
    });
  });

  describe('shouldReplanCapacityResource', () => {
    it('re-plans a resource too small for the capacity', () => {
      expect(shouldReplanCapacityResource(5_120, 400_128, FLOOR)).toBe(true);
    });

    it('keeps a resource that merely overshoots a little', () => {
      expect(shouldReplanCapacityResource(600_192, 400_128, FLOOR)).toBe(false);
    });

    it('re-plans a resource left far above the capacity', () => {
      // The label atlas after a shrink: large enough, and 64 MB of texels.
      expect(shouldReplanCapacityResource(2_000_128, 5_120, FLOOR)).toBe(true);
    });

    it('uses the floor so tiny datasets do not thrash the atlas', () => {
      expect(shouldReplanCapacityResource(4_096, 1, FLOOR)).toBe(false);
    });
  });
});
