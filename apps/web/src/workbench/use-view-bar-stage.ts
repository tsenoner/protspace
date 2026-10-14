import { type RefObject, useEffect, useState } from 'react';
import type { LayoutMode } from '../explore/layout-defaults';
import { hasStructureSheet } from '../explore/layout-mode';
import { getWorkbenchStatus, subscribeWorkbenchStatus } from '../explore/workbench-status';
import { resolveStage, type ViewBarStage } from './view-bar-overflow';

/** The bar's children whose own width the stages depend on (workbench.css never shrinks them). */
const ITEM_SELECTOR = '[data-view-item]';
/** Sub-pixel layout noise is no change of width. */
const EPSILON = 0.5;

/**
 * The width the bar's content needs at the stage it shows now: from the bar's left edge to the
 * right margin edge of its last visible child, plus the right padding. The items never shrink, so
 * this is the stage's own width even while it overflows. Children without a box (display: none,
 * or display: contents such as ps-dialog and ps-menu) do not count.
 */
function contentWidth(bar: HTMLElement): number {
  const style = getComputedStyle(bar);
  const left = bar.getBoundingClientRect().left;
  let end = left + (parseFloat(style.paddingLeft) || 0);
  for (const child of Array.from(bar.children)) {
    if (child.getClientRects().length === 0) continue;
    const marginRight = parseFloat(getComputedStyle(child).marginRight) || 0;
    end = Math.max(end, child.getBoundingClientRect().right + marginRight);
  }
  return Math.ceil(end - left + (parseFloat(style.paddingRight) || 0));
}

/**
 * The view bar's stage (view-bar-overflow.ts) for the bar in `barRef`. One ResizeObserver watches
 * the bar and its items; their callbacks only take note, and the measuring runs once in the next
 * animation frame, where showing a candidate stage (data-stage) and reading its width is safe. A
 * stage's width is measured once and cached; a change in an item's own width (a new dataset's
 * names, another contour mode, a filter count) or the web font arriving clears the cache. On a
 * phone (`mode` a sheet mode) the bar is fixed (design decision 17): stage 3, nothing measured,
 * and workbench.css decides what shows; leaving the phone layouts measures again from stage 0.
 */
export function useViewBarStage(
  barRef: RefObject<HTMLElement | null>,
  mode: LayoutMode,
): ViewBarStage {
  const [stage, setStage] = useState<ViewBarStage>(0);
  const fixed = hasStructureSheet(mode);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    if (fixed) return;
    const cache = new Map<ViewBarStage, number>();
    const itemWidths = new WeakMap<Element, number>();
    let current: ViewBarStage = 0;
    let frame = 0;
    let stale = false;
    let disposed = false;

    const show = (next: ViewBarStage) => {
      if (bar.dataset.stage !== String(next)) bar.dataset.stage = String(next);
    };
    const measure = (candidate: ViewBarStage) => {
      show(candidate);
      return contentWidth(bar);
    };

    const resolve = () => {
      frame = 0;
      if (disposed) return;
      if (stale) {
        cache.clear();
        stale = false;
      }
      const next = resolveStage(current, bar.clientWidth, measure, cache);
      show(next);
      // The widths at the stage on screen, which the observer compares against.
      for (const item of Array.from(bar.querySelectorAll(ITEM_SELECTOR))) {
        itemWidths.set(item, item.getBoundingClientRect().width);
      }
      // Always handed to React (an equal value renders nothing): coming back from a phone layout
      // the state may still hold the stage from before it, while `current` starts at 0.
      current = next;
      setStage(next);
    };
    const schedule = () => {
      if (!frame && !disposed) frame = requestAnimationFrame(resolve);
    };

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === bar) continue;
        const width = entry.borderBoxSize[0]?.inlineSize ?? entry.contentRect.width;
        const known = itemWidths.get(entry.target);
        if (known === undefined || Math.abs(width - known) > EPSILON) stale = true;
      }
      schedule();
    });
    observer.observe(bar);
    for (const item of Array.from(bar.querySelectorAll(ITEM_SELECTOR))) {
      observer.observe(item, { box: 'border-box' });
    }

    // Inter replaces the fallback font after the first measure and changes every width.
    void document.fonts.ready.then(() => {
      stale = true;
      schedule();
    });

    // Contours or Filter hidden in More reports no width; its value (the contour mode, the filter's
    // count badge) still changes the lower stages' widths.
    let { densityLayer, appliedFilterConditions } = getWorkbenchStatus();
    const unsubscribe = subscribeWorkbenchStatus(() => {
      const next = getWorkbenchStatus();
      if (
        next.densityLayer === densityLayer &&
        next.appliedFilterConditions === appliedFilterConditions
      ) {
        return;
      }
      ({ densityLayer, appliedFilterConditions } = next);
      stale = true;
      schedule();
    });
    schedule();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      unsubscribe();
    };
  }, [barRef, fixed]);

  return fixed ? 3 : stage;
}
