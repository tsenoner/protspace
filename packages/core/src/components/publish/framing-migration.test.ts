import { describe, expect, it } from 'vitest';
import { seededRandom } from '../../test-support/seeded-random';
import {
  currentFraming,
  legacyFraming,
  reframePublishState,
  type Framing,
} from './framing-migration';
import { createDefaultPublishState, PUBLISH_FRAMING, type PublishState } from './publish-state';

/** Where data point (x, y) sits in `framing`, normalised over the plot area. */
function norm(framing: Framing, x: number, y: number): { u: number; v: number } {
  const { domain: d } = framing;
  return {
    u: framing.left + ((x - d.xMin) / (d.xMax - d.xMin)) * framing.width,
    v: framing.top + ((d.yMax - y) / (d.yMax - d.yMin)) * framing.height,
  };
}

const EXTENT = { xMin: -12, xMax: 30, yMin: 4, yMax: 9 };
const PADDED = { xMin: -12.84, xMax: 30.84, yMin: 3.9, yMax: 9.1 };
// A wide extent in a 1600 × 1000 plot area: fitted by x, centred vertically.
const INFO = { marginLeft: 24, marginRight: 24, marginTop: 420, marginBottom: 420 };
const FROM = legacyFraming(EXTENT);
const TO = currentFraming(PADDED, INFO, 1600, 1000);

function withPlaced(placed: Partial<PublishState>): PublishState {
  const state = { ...createDefaultPublishState(), ...placed };
  delete state.framing;
  return state;
}

describe('legacyFraming', () => {
  it('pads the extent by 5 % and keeps 40 px of an 800 × 600 reference on every side', () => {
    expect(FROM.domain.xMin).toBeCloseTo(-14.1);
    expect(FROM.domain.xMax).toBeCloseTo(32.1);
    expect(FROM.domain.yMin).toBeCloseTo(3.75);
    expect(FROM.domain.yMax).toBeCloseTo(9.25);
    expect(FROM.left).toBeCloseTo(0.05);
    expect(FROM.width).toBeCloseTo(0.9);
    expect(FROM.top).toBeCloseTo(1 / 15);
    expect(FROM.height).toBeCloseTo(13 / 15);
  });
});

describe('reframePublishState', () => {
  it('keeps every overlay on the data it marked', () => {
    const random = seededRandom(555);
    const point = () => ({
      x: EXTENT.xMin + random() * (EXTENT.xMax - EXTENT.xMin),
      y: EXTENT.yMin + random() * (EXTENT.yMax - EXTENT.yMin),
    });
    for (let round = 0; round < 50; round++) {
      const [a, b, c] = [point(), point(), point()];
      const [na, nb, nc] = [norm(FROM, a.x, a.y), norm(FROM, b.x, b.y), norm(FROM, c.x, c.y)];
      const state = withPlaced({
        overlays: [
          {
            type: 'circle',
            cx: na.u,
            cy: na.v,
            rx: 0.1,
            ry: 0.05,
            rotation: 0.3,
            color: '#f00',
            strokeWidth: 2,
          },
          { type: 'arrow', x1: na.u, y1: na.v, x2: nb.u, y2: nb.v, color: '#000', width: 2 },
          {
            type: 'label',
            x: nc.u,
            y: nc.v,
            text: 'here',
            fontSize: 14,
            rotation: 0,
            color: '#000',
          },
        ],
      });

      const moved = reframePublishState(state, FROM, TO);
      const [circle, arrow, label] = moved.overlays;
      const [ta, tb, tc] = [norm(TO, a.x, a.y), norm(TO, b.x, b.y), norm(TO, c.x, c.y)];
      expect(circle).toMatchObject({ type: 'circle', rotation: 0.3, color: '#f00' });
      if (circle.type !== 'circle' || arrow.type !== 'arrow' || label.type !== 'label') throw 0;
      expect(circle.cx).toBeCloseTo(ta.u, 10);
      expect(circle.cy).toBeCloseTo(ta.v, 10);
      expect(arrow.x1).toBeCloseTo(ta.u, 10);
      expect(arrow.y1).toBeCloseTo(ta.v, 10);
      expect(arrow.x2).toBeCloseTo(tb.u, 10);
      expect(arrow.y2).toBeCloseTo(tb.v, 10);
      expect(label.x).toBeCloseTo(tc.u, 10);
      expect(label.y).toBeCloseTo(tc.v, 10);
      expect(label.fontSize).toBe(14);
    }
  });

  it("scales a circle's radii with their axis", () => {
    const state = withPlaced({
      overlays: [
        {
          type: 'circle',
          cx: 0.5,
          cy: 0.5,
          rx: 0.1,
          ry: 0.1,
          rotation: 0,
          color: '#f00',
          strokeWidth: 2,
        },
      ],
    });
    const [circle] = reframePublishState(state, FROM, TO).overlays;
    if (circle.type !== 'circle') throw 0;
    // A radius is a data length: the same data span in each framing's units.
    const xUnitsFrom = FROM.width / (FROM.domain.xMax - FROM.domain.xMin);
    const xUnitsTo = TO.width / (TO.domain.xMax - TO.domain.xMin);
    const yUnitsFrom = FROM.height / (FROM.domain.yMax - FROM.domain.yMin);
    const yUnitsTo = TO.height / (TO.domain.yMax - TO.domain.yMin);
    expect(circle.rx).toBeCloseTo(0.1 * (xUnitsTo / xUnitsFrom), 10);
    expect(circle.ry).toBeCloseTo(0.1 * (yUnitsTo / yUnitsFrom), 10);
  });

  it("moves an inset's source onto the same data and leaves its target and a free legend in place", () => {
    const lo = norm(FROM, 0, 8);
    const hi = norm(FROM, 10, 5);
    const target = { x: 0.6, y: 0.05, w: 0.3, h: 0.3 };
    const state = withPlaced({
      insets: [
        {
          sourceRect: { x: lo.u, y: lo.v, w: hi.u - lo.u, h: hi.v - lo.v },
          targetRect: target,
          border: 2,
          connector: 'lines',
        },
      ],
    });
    state.legend = { ...state.legend, position: 'free', freePos: { nx: 0.8, ny: 0.1 } };

    const moved = reframePublishState(state, FROM, TO);
    const [inset] = moved.insets;
    const tlo = norm(TO, 0, 8);
    const thi = norm(TO, 10, 5);
    expect(inset.sourceRect.x).toBeCloseTo(tlo.u, 10);
    expect(inset.sourceRect.y).toBeCloseTo(tlo.v, 10);
    expect(inset.sourceRect.w).toBeCloseTo(thi.u - tlo.u, 10);
    expect(inset.sourceRect.h).toBeCloseTo(thi.v - tlo.v, 10);
    expect(inset.targetRect).toEqual(target);
    expect(inset).toMatchObject({ border: 2, connector: 'lines' });
    expect(moved.legend.freePos).toEqual({ nx: 0.8, ny: 0.1 });
  });

  it('holds a moved inset source inside the plot area', () => {
    const state = withPlaced({
      insets: [
        {
          sourceRect: { x: 0, y: 0, w: 1, h: 1 },
          targetRect: { x: 0, y: 0, w: 0.2, h: 0.2 },
          border: 1,
          connector: 'none',
        },
      ],
    });
    const { sourceRect } = reframePublishState(state, FROM, TO).insets[0];
    expect(sourceRect.x).toBeGreaterThanOrEqual(0);
    expect(sourceRect.y).toBeGreaterThanOrEqual(0);
    expect(sourceRect.x + sourceRect.w).toBeLessThanOrEqual(1);
    expect(sourceRect.y + sourceRect.h).toBeLessThanOrEqual(1);
  });

  it('marks the state as in the current framing', () => {
    expect(reframePublishState(withPlaced({}), FROM, TO).framing).toBe(PUBLISH_FRAMING);
  });

  it('leaves an axis without a span where it was', () => {
    const flat = { ...EXTENT, yMin: 5, yMax: 5 };
    const from = legacyFraming(flat);
    const to = currentFraming({ ...PADDED, yMin: 5, yMax: 5 }, INFO, 1600, 1000);
    const state = withPlaced({
      overlays: [
        { type: 'label', x: 0.3, y: 0.4, text: 't', fontSize: 12, rotation: 0, color: '#000' },
      ],
    });
    const [label] = reframePublishState(state, from, to).overlays;
    if (label.type !== 'label') throw 0;
    expect(label.y).toBe(0.4);
    expect(label.x).not.toBe(0.3);
  });
});
