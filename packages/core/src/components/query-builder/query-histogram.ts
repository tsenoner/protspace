/**
 * The distribution a numeric condition card draws above its slider: about 40 bins over the
 * annotation's range, and the scale that maps a slider position to a value.
 *
 * One pass over the column per annotation, cached by the column's own `Float64Array`, so a
 * dataset swap (a new array) drops it and typing or dragging never re-bins. A cold pass over
 * 573K values takes about 7 ms, so it runs on the card's first render rather than at idle time.
 */

export const BIN_COUNT = 40;

/** Slider positions for a continuous range; an integer range narrower than this gets one per value. */
const MAX_STEPS = 1000;

export interface NumericHistogram {
  min: number;
  max: number;
  /** 'log' when the values are positive, span 2+ decades and pile into the low eighth. */
  scale: 'linear' | 'log';
  /** Every value is a whole number, so the slider gives whole numbers too. */
  integer: boolean;
  /** Slider positions run 0..steps. */
  steps: number;
  counts: Uint32Array;
  peak: number;
}

const cache = new WeakMap<Float64Array, NumericHistogram | null>();

/** Bins the column once; later calls for the same array return the cached result. */
export function histogramOf(values: Float64Array): NumericHistogram | null {
  const cached = cache.get(values);
  if (cached !== undefined) return cached;
  const histogram = binValues(values);
  cache.set(values, histogram);
  return histogram;
}

function binValues(values: Float64Array): NumericHistogram | null {
  let min = Infinity;
  let max = -Infinity;
  let integer = true;
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    total++;
    if (v < min) min = v;
    if (v > max) max = v;
    if (integer && v !== Math.floor(v)) integer = false;
  }
  if (total === 0) return null;

  const linear = fill(values, min, max, 'linear');
  let low = 0;
  for (let i = 0; i < BIN_COUNT / 8; i++) low += linear[i];
  const skewed = min > 0 && max / min >= 100 && low >= total * 0.6;
  const scale = skewed ? 'log' : 'linear';
  const counts = skewed ? fill(values, min, max, 'log') : linear;
  const span = max - min;
  const steps = integer && scale === 'linear' && span > 0 && span <= MAX_STEPS ? span : MAX_STEPS;
  let peak = 0;
  for (const c of counts) if (c > peak) peak = c;
  return { min, max, scale, integer, steps, counts, peak };
}

function fill(
  values: Float64Array,
  min: number,
  max: number,
  scale: 'linear' | 'log',
): Uint32Array {
  const counts = new Uint32Array(BIN_COUNT);
  const lo = scale === 'log' ? Math.log(min) : min;
  const width = (scale === 'log' ? Math.log(max) : max) - lo;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    const x = scale === 'log' ? Math.log(v) : v;
    const bin = width > 0 ? Math.floor(((x - lo) / width) * BIN_COUNT) : 0;
    counts[bin >= BIN_COUNT ? BIN_COUNT - 1 : bin]++;
  }
  return counts;
}

/** Where a value sits along the range, 0..1 (clamped). */
export function fractionOf(h: NumericHistogram, value: number): number {
  if (h.max === h.min) return 0;
  const f =
    h.scale === 'log'
      ? (Math.log(Math.max(value, h.min)) - Math.log(h.min)) / (Math.log(h.max) - Math.log(h.min))
      : (value - h.min) / (h.max - h.min);
  return Math.min(1, Math.max(0, f));
}

/** The slider position (0..steps) nearest a value. */
export function positionOf(h: NumericHistogram, value: number): number {
  return Math.round(fractionOf(h, value) * h.steps);
}

/** The value at a slider position, rounded to what one step can tell apart. */
export function valueAt(h: NumericHistogram, position: number): number {
  if (position <= 0) return h.min;
  if (position >= h.steps) return h.max;
  const f = position / h.steps;
  const raw =
    h.scale === 'log'
      ? Math.exp(Math.log(h.min) + f * (Math.log(h.max) - Math.log(h.min)))
      : h.min + f * (h.max - h.min);
  if (h.integer) return Math.round(raw);
  const stepSize = h.scale === 'log' ? raw * 0.01 : (h.max - h.min) / h.steps;
  const decimals = Math.max(0, -Math.floor(Math.log10(stepSize)));
  return Number(raw.toFixed(Math.min(decimals, 12)));
}
