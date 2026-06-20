interface DataExtent {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export const DATA_EXTENT_PADDING = 0.05;

export function computeExtent(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  length: number,
): DataExtent {
  let xMin = Infinity,
    xMax = -Infinity,
    yMin = Infinity,
    yMax = -Infinity;
  for (let i = 0; i < length; i++) {
    if (xs[i] < xMin) xMin = xs[i];
    if (xs[i] > xMax) xMax = xs[i];
    if (ys[i] < yMin) yMin = ys[i];
    if (ys[i] > yMax) yMax = ys[i];
  }
  return { xMin, xMax, yMin, yMax };
}

export function computePaddedExtent(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  length: number,
): DataExtent {
  const { xMin, xMax, yMin, yMax } = computeExtent(xs, ys, length);
  const xPad = Math.abs(xMax - xMin) * DATA_EXTENT_PADDING;
  const yPad = Math.abs(yMax - yMin) * DATA_EXTENT_PADDING;
  return {
    xMin: xMin - xPad,
    xMax: xMax + xPad,
    yMin: yMin - yPad,
    yMax: yMax + yPad,
  };
}
