import { SELECTION_BAR } from './layout-defaults';

const EDGE = SELECTION_BAR.offset;
const GAP = 8;

interface SelectionBarPlacement {
  /** The bar's left edge and its offset from the plot's bottom, in px. */
  left: number;
  bottom: number;
  /** Icon buttons and a short count, as on a phone. */
  compact: boolean;
  /** The status corner's width while the bar sits beside it; its chips wrap upwards. */
  statusMaxWidth: number | null;
}

/**
 * Where the selection bar goes so the status corner's count never moves: centred along the
 * bottom edge, pushed right of the count when the centre would cover it, compact when only that
 * fits, and only on a plot too narrow for either, above the status corner.
 */
function placeSelectionBar(input: {
  plotWidth: number;
  countRight: number;
  statusHeight: number;
  fullWidth: number;
  compactWidth: number;
}): SelectionBarPlacement {
  const { plotWidth, countRight, statusHeight, fullWidth, compactWidth } = input;
  for (const [width, compact] of [
    [fullWidth, false],
    [compactWidth, true],
  ] as const) {
    const left = Math.max((plotWidth - width) / 2, countRight + GAP);
    if (left + width <= plotWidth - EDGE) {
      return { left, bottom: EDGE, compact, statusMaxWidth: left - GAP - EDGE };
    }
  }
  const compact = fullWidth > plotWidth - 2 * EDGE;
  const width = compact ? compactWidth : fullWidth;
  return {
    left: Math.max(EDGE, (plotWidth - width) / 2),
    bottom: EDGE + statusHeight + GAP,
    compact,
    statusMaxWidth: null,
  };
}

/**
 * Keeps the selection bar beside the status corner's count (or above it), re-placed when the
 * plot, the status corner or the bar changes size. Updates wait for the next frame, so writing
 * the status corner's width never re-enters the observer in the same frame.
 */
export function bindSelectionBarPlacement(
  plotArea: HTMLElement,
  plotStatus: HTMLElement,
  selectionBar: HTMLElement,
): () => void {
  const reset = () => {
    selectionBar.removeAttribute('compact');
    selectionBar.style.removeProperty('left');
    selectionBar.style.removeProperty('bottom');
    selectionBar.style.removeProperty('translate');
    plotStatus.style.removeProperty('max-width');
  };
  const update = () => {
    if (selectionBar.hidden || !plotArea.isConnected) return reset();
    const plotBox = plotArea.getBoundingClientRect();
    selectionBar.removeAttribute('compact');
    const fullWidth = selectionBar.offsetWidth;
    selectionBar.setAttribute('compact', '');
    const compactWidth = selectionBar.offsetWidth;
    plotStatus.style.removeProperty('max-width');
    // The chips wrap above the count, each on its own row, but they still reach into the bar's
    // height: the bar clears the widest of the count and the chips, not the count alone.
    const parts = Array.from(
      plotStatus.shadowRoot?.querySelectorAll('.status-count, .status-chip') ?? [],
    );
    const widest = Math.max(0, ...parts.map((part) => part.getBoundingClientRect().width));
    const countRight =
      parts.length > 0
        ? plotStatus.getBoundingClientRect().left - plotBox.left + widest
        : EDGE - GAP;
    const place = placeSelectionBar({
      plotWidth: plotArea.clientWidth,
      countRight,
      statusHeight: plotStatus.offsetHeight,
      fullWidth,
      compactWidth,
    });
    selectionBar.toggleAttribute('compact', place.compact);
    selectionBar.style.left = `${place.left}px`;
    selectionBar.style.bottom = `${place.bottom}px`;
    selectionBar.style.translate = 'none';
    if (place.statusMaxWidth !== null) plotStatus.style.maxWidth = `${place.statusMaxWidth}px`;
  };
  let frame = 0;
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(update);
  };
  const observer = new ResizeObserver(schedule);
  observer.observe(plotArea);
  observer.observe(plotStatus);
  observer.observe(selectionBar);
  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    reset();
  };
}
