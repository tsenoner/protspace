import { useRef, type KeyboardEvent, type PointerEvent, type Ref } from 'react';
import { Box } from 'lucide-react';
import { LEGEND_FRACTION } from '../explore/layout-defaults';
import { updateLayout } from '../explore/layout-state';
import { clampLegendFraction, DIVIDER_HEIGHT, fractionStep } from './layout-geometry';

/** The sidebar column, the workbench body the section and the aside are placed in. */
const columnOf = (element: Element) => element.closest<HTMLElement>('[data-workbench="body"]');

interface LegendDividerProps {
  /** The legend's share of the column: the preview while one runs, else the stored value. */
  fraction: number;
  onPreview(fraction: number | null): void;
}

/**
 * The separator between the legend and the docked structure (design decision 2). A drag, an
 * arrow key, Home or End previews through `--wb-legend-fraction`; the layout is written once, on
 * pointerup or keyup. Neither changes the plot's box (decision 4).
 */
function LegendDivider({ fraction, onPreview }: LegendDividerProps) {
  const dragging = useRef(false);
  const pending = useRef<number | null>(null);

  const preview = (next: number) => {
    pending.current = next;
    onPreview(next);
  };
  const commit = () => {
    const next = pending.current;
    pending.current = null;
    if (next !== null) updateLayout({ legendFraction: next });
    onPreview(null);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const column = columnOf(event.currentTarget);
    if (!dragging.current || !column) return;
    const legendHeight = event.clientY - column.getBoundingClientRect().top - DIVIDER_HEIGHT / 2;
    preview(
      clampLegendFraction(
        legendHeight / (column.clientHeight - DIVIDER_HEIGHT),
        column.clientHeight,
      ),
    );
  };
  const onPointerEnd = () => {
    if (!dragging.current) return;
    dragging.current = false;
    commit();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const column = columnOf(event.currentTarget);
    if (!column) return;
    // Home and End go to the ends of the range (the WAI-ARIA window splitter), as on the sidebar edge.
    let requested: number;
    if (event.key === 'Home') requested = LEGEND_FRACTION.min;
    else if (event.key === 'End') requested = LEGEND_FRACTION.max;
    else {
      const step = fractionStep(event.key, event.shiftKey);
      if (step === 0) return;
      requested = (pending.current ?? fraction) + step;
    }
    event.preventDefault();
    preview(clampLegendFraction(requested, column.clientHeight));
  };
  const onKeyUp = () => {
    if (!dragging.current && pending.current !== null) commit();
  };

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize legend and structure"
      aria-valuemin={Math.round(LEGEND_FRACTION.min * 100)}
      aria-valuemax={Math.round(LEGEND_FRACTION.max * 100)}
      aria-valuenow={Math.round(fraction * 100)}
      tabIndex={0}
      className="wb-divider"
      data-workbench="divider"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
    />
  );
}

interface StructurePanelProps {
  ref?: Ref<HTMLElement>;
  /** Out of the tab order while the sidebar is collapsed or collapsing. */
  inert?: boolean;
  legendFraction: number;
  onLegendFractionPreview(fraction: number | null): void;
}

/**
 * The structure section: a sibling of the sidebar's aside, never inside it, so placing it never
 * moves #myStructureViewer to another parent (its disconnect would dispose Mol*). It holds the
 * divider, the 44 px empty footer and the viewer, which the structure controller drives. Where it
 * sits, and which part shows, is CSS from the workbench root's data-structure.
 */
export function StructurePanel({
  ref,
  inert,
  legendFraction,
  onLegendFractionPreview,
}: StructurePanelProps) {
  return (
    <section
      ref={ref}
      inert={inert}
      // The rail's Structure button focuses the section; it is no Tab stop of its own.
      tabIndex={-1}
      className="wb-structure"
      data-workbench="structure"
      aria-label="Structure"
    >
      <LegendDivider fraction={legendFraction} onPreview={onLegendFractionPreview} />
      <div className="wb-structure-empty" data-workbench="structure-empty">
        <Box size={16} strokeWidth={1.75} aria-hidden="true" />
        <span className="wb-structure-empty-title">Structure</span>
        <span className="wb-structure-empty-hint">Click a protein to view it</span>
      </div>
      <protspace-structure-viewer
        id="myStructureViewer"
        height="100%"
        show-header="true"
        show-close-button="true"
        auto-sync="true"
        scatterplot-selector="#myPlot"
      ></protspace-structure-viewer>
    </section>
  );
}
