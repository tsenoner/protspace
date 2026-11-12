import { padDomain, type DataDomain } from '@protspace/utils';

export function computeExtent(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  length: number,
): DataDomain {
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

/** The extent padded as the live scales pad it, so on-screen and exported framing match. */
export function computePaddedExtent(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  length: number,
): DataDomain {
  return padDomain(computeExtent(xs, ys, length));
}
