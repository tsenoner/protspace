/**
 * The view bar's stages (design decision 1). The bar keeps one 44 px row by giving up width in
 * steps instead of wrapping: 0 shows everything; 1 hides the keys "Projection", "Color by" and
 * "Contours" (they stay in the accessible names); 2 moves Contours into the More menu; 3 moves
 * Filter there too. Projection, its details and Color by never move.
 */
export type ViewBarStage = 0 | 1 | 2 | 3;

const LAST_STAGE: ViewBarStage = 3;
/** The walk from stage 0 to 3 (or back) plus the check that ends it. */
const MAX_STEPS = 4;

/**
 * The stage for a bar `available` px wide, starting from `current`. It steps down while the
 * current stage's width exceeds `available`, and steps up only when the next lower stage's width
 * plus `hysteresis` fits, so a window resized around a threshold keeps its stage. `measure(stage)`
 * returns the width a stage needs; each width is kept in `cache` until the caller clears it (an
 * item's own width changed), so a window resize measures nothing again. A stage the cache lacks is
 * measured once, which lets the bar step up again after a clear.
 */
export function resolveStage(
  current: ViewBarStage,
  available: number,
  measure: (stage: ViewBarStage) => number,
  cache: Map<ViewBarStage, number>,
  hysteresis = 24,
): ViewBarStage {
  const widthOf = (stage: ViewBarStage): number => {
    let width = cache.get(stage);
    if (width === undefined) {
      width = measure(stage);
      cache.set(stage, width);
    }
    return width;
  };

  let stage = current;
  for (let step = 0; step < MAX_STEPS; step++) {
    if (widthOf(stage) > available) {
      if (stage === LAST_STAGE) break;
      stage = (stage + 1) as ViewBarStage;
    } else if (stage > 0 && widthOf((stage - 1) as ViewBarStage) + hysteresis <= available) {
      stage = (stage - 1) as ViewBarStage;
    } else {
      break;
    }
  }
  return stage;
}
