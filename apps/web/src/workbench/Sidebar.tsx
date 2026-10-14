import { memo, useRef, type KeyboardEvent, type PointerEvent, type Ref } from 'react';
import { SIDEBAR_WIDTH, type SidebarPanel } from '../explore/layout-defaults';
import { updateLayout } from '../explore/layout-state';
import { clampSidebarWidth, sidebarStep } from './layout-geometry';
import { FilterPanel } from './FilterPanel';
import { PanelTabs } from './PanelTabs';

interface SidebarProps {
  ref?: Ref<HTMLElement>;
  /** A collapsed or collapsing sidebar: out of the tab order and the accessibility tree. */
  inert?: boolean;
  /** The panel shown (the legend or Filter): both copies of the tabs mark it. */
  panel: SidebarPanel;
  /** Below 951 px the panel tabs switch the legend and Filter, so both are tab panels. */
  tabbed: boolean;
}

/**
 * The flush right sidebar (design decisions 2 and 14): the legend or the Filter panel, above the
 * structure section that StructurePanel renders as the aside's sibling, so placing the structure
 * never moves either element. Memoised: it re-renders only when the sidebar becomes inert or
 * interactive again or the panel changes, and the legend and the query builder are never re-created or moved. The ref
 * is the slide's target (use-sidebar-transition).
 */
export const Sidebar = memo(function Sidebar({ ref, inert, panel, tabbed }: SidebarProps) {
  return (
    <aside ref={ref} inert={inert} id="wb-sidebar" data-workbench="sidebar" aria-label="Sidebar">
      <protspace-legend
        id="myLegend"
        role={tabbed ? 'tabpanel' : undefined}
        aria-label={tabbed ? 'Legend' : undefined}
        data-driver-id="legend"
        auto-sync="true"
        auto-hide="true"
        scatterplot-selector="#myPlot"
      >
        <PanelTabs panel={panel} slot="header-start" />
      </protspace-legend>
      <FilterPanel panel={panel} tabbed={tabbed} />
    </aside>
  );
});

interface SidebarEdgeProps {
  /** The width shown: the drag or key preview, else the committed width. */
  width: number;
  /** The widest this window allows (the plot keeps 480 px), at most 480. */
  maxWidth: number;
  onPreview(width: number | null): void;
  onCollapse(): void;
}

const EDGE_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End']);

/**
 * The sidebar's draggable left edge (design decisions 2 and 4; the WAI-ARIA window splitter). A
 * drag or an arrow key previews the width through --wb-sidebar-live-width, which moves the sidebar
 * over the plot without resizing it; the width is written once, on release or keyup, and the plot
 * resizes once. Enter collapses the sidebar. Rendered by the workbench before the aside, as its
 * sibling: it is the sidebar's first Tab stop and paints above the structure section too.
 */
export function SidebarEdge({ width, maxWidth, onPreview, onCollapse }: SidebarEdgeProps) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const pending = useRef<number | null>(null);

  const preview = (next: number) => {
    pending.current = next;
    onPreview(next);
  };
  const commit = () => {
    const next = pending.current;
    pending.current = null;
    if (next !== null) updateLayout({ sidebarWidth: next });
    onPreview(null);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startWidth: width };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start) return;
    // The sidebar is on the right: moving its edge left widens it.
    preview(clampSidebarWidth(start.startWidth + start.startX - event.clientX, maxWidth));
  };
  const onPointerEnd = () => {
    if (!drag.current) return;
    drag.current = null;
    commit();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onCollapse();
      return;
    }
    if (!EDGE_KEYS.has(event.key)) return;
    event.preventDefault();
    preview(
      clampSidebarWidth(sidebarStep(event.key, event.shiftKey, pending.current ?? width), maxWidth),
    );
  };
  const onKeyUp = () => {
    if (!drag.current && pending.current !== null) commit();
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-controls="wb-sidebar"
      aria-valuemin={SIDEBAR_WIDTH.min}
      aria-valuemax={maxWidth}
      aria-valuenow={width}
      tabIndex={0}
      className="wb-sidebar-edge"
      data-workbench="sidebar-edge"
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
