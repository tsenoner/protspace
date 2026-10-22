/**
 * The zoom transform that frames some points (design decision 15: "Zoom to them" and a single
 * search hit). Points are in the plot's screen pixels at k = 1, as its scales place them. One
 * point, or a box of no size, lands at the centre at `max(currentK, singleK)`, so a hit is never
 * shown smaller than the user had zoomed; several are fitted inside `margin` on every side. `k` is
 * clamped to `extent`, the plot's zoom limits. `insets` are edge strips the plot's chrome covers:
 * the framing centres in what they leave, and a fit keeps `margin` inside them. Null when there is
 * nothing to frame.
 */
export function zoomTransformFor(
  points: ReadonlyArray<readonly [number, number]>,
  view: {
    width: number;
    height: number;
    margin: number;
    currentK: number;
    extent: readonly [number, number];
    singleK: number;
    insets?: { top: number; right: number; bottom: number; left: number };
  },
): { k: number; x: number; y: number } | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const inset = view.insets ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const boxWidth = maxX - minX;
  const boxHeight = maxY - minY;
  let k: number;
  if (boxWidth === 0 && boxHeight === 0) {
    k = Math.max(view.currentK, view.singleK);
  } else {
    const roomWidth = Math.max(1, view.width - inset.left - inset.right - 2 * view.margin);
    const roomHeight = Math.max(1, view.height - inset.top - inset.bottom - 2 * view.margin);
    k = Math.min(
      boxWidth > 0 ? roomWidth / boxWidth : Infinity,
      boxHeight > 0 ? roomHeight / boxHeight : Infinity,
    );
  }
  const [low, high] = view.extent;
  k = Math.min(high, Math.max(low, k));
  return {
    k,
    x: (inset.left + view.width - inset.right) / 2 - k * ((minX + maxX) / 2),
    y: (inset.top + view.height - inset.bottom) / 2 - k * ((minY + maxY) / 2),
  };
}
