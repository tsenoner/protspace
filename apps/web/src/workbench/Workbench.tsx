import { useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { RAIL_WIDTH, SIDEBAR_WIDTH } from '../explore/layout-defaults';
import { updateLayout } from '../explore/layout-state';
import { AppBar } from './AppBar';
import {
  clampSidebarToWindow,
  clampSidebarWidth,
  DIVIDER_HEIGHT,
  LEGEND_MIN_HEIGHT,
  plotRightInset,
  STRUCTURE_MIN_HEIGHT,
} from './layout-geometry';
import { PlotArea } from './PlotArea';
import { Rail } from './Rail';
import { Sidebar, SidebarEdge } from './Sidebar';
import { StructurePanel } from './StructurePanel';
import { useLayout } from './use-layout';
import { useLayoutMode } from './use-layout-mode';
import { useSidebarTransition } from './use-sidebar-transition';
import { useWorkbenchStatus } from './use-workbench-status';
import { ViewBar } from './ViewBar';
import './workbench.css';

function subscribeWindowWidth(onChange: () => void): () => void {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
}

/** The widest sidebar this window allows. A resize re-renders the workbench only when it changes. */
const getSidebarCap = () => clampSidebarToWindow(SIDEBAR_WIDTH.max, window.innerWidth);

/**
 * The explore workbench (design decision 1): the app bar, the view bar, then the plot beside a
 * flush right sidebar and its icon rail. The runtime finds its elements by id, so they render once
 * in this fixed tree; every layout state is a data attribute or a --wb-* property that
 * workbench.css reads.
 */
export function Workbench() {
  const layout = useLayout();
  const mode = useLayoutMode();
  const { structureProteinId } = useWorkbenchStatus();
  // The divider's drag or key preview; null while the stored fraction shows.
  const [legendFractionPreview, setLegendFractionPreview] = useState<number | null>(null);
  const legendFraction = legendFractionPreview ?? layout.legendFraction;
  // What the sidebar column holds under the legend: the empty footer, or the docked viewer.
  const structure = structureProteinId === null ? 'none' : 'docked';
  const desktop = mode === 'desktop';
  const sidebarCap = useSyncExternalStore(subscribeWindowWidth, getSidebarCap);
  const asideRef = useRef<HTMLElement>(null);
  const structureRef = useRef<HTMLElement>(null);
  const railToggleRef = useRef<HTMLElement>(null);
  // The edge's drag or key preview; null while the committed width shows.
  const [sidebarWidthPreview, setSidebarWidthPreview] = useState<number | null>(null);
  // The committed width this window can give the sidebar, so the plot keeps 480 px (render only).
  const sidebarWidth = clampSidebarWidth(layout.sidebarWidth, sidebarCap);
  const phase = useSidebarTransition(layout.sidebarOpen, {
    aside: asideRef,
    structure: structureRef,
  });
  // On desktop a collapsed or collapsing sidebar is inert; below 951 px it always shows.
  const sidebarHidden = desktop && (phase === 'collapsed' || phase === 'closing');
  return (
    <div
      className="workbench"
      data-layout={mode}
      data-structure={structure}
      data-sidebar={phase}
      data-sidebar-resizing={sidebarWidthPreview !== null ? '' : undefined}
    >
      <AppBar />
      <ViewBar />
      <div
        className="wb-body"
        data-workbench="body"
        style={
          {
            '--wb-sidebar-width': `${sidebarWidth}px`,
            '--wb-sidebar-live-width': `${sidebarWidthPreview ?? sidebarWidth}px`,
            '--wb-plot-right': `${plotRightInset(phase, sidebarWidth)}px`,
            '--wb-legend-fraction': String(legendFraction),
            // The column's geometry, from layout-geometry.ts so the CSS clamp and splitSidebar agree.
            '--wb-divider-height': `${DIVIDER_HEIGHT}px`,
            '--wb-legend-min': `${LEGEND_MIN_HEIGHT}px`,
            '--wb-structure-min': `${STRUCTURE_MIN_HEIGHT}px`,
            // Only the desktop has the rail; below 951 px the sidebar sits at the right edge.
            '--wb-rail-width': desktop ? `${RAIL_WIDTH}px` : undefined,
          } as CSSProperties
        }
      >
        <PlotArea />
        {/* Before the aside: the edge sits at the sidebar's left, so it is the sidebar's first Tab
            stop. Its z-index keeps it painted over the aside and the structure. */}
        <SidebarEdge
          width={sidebarWidthPreview ?? sidebarWidth}
          maxWidth={sidebarCap}
          onPreview={setSidebarWidthPreview}
          onCollapse={() => {
            updateLayout({ sidebarOpen: false });
            // The edge hides with the sidebar: keep focus on the control that brings it back.
            railToggleRef.current?.focus();
          }}
        />
        <Sidebar ref={asideRef} inert={sidebarHidden} />
        <StructurePanel
          ref={structureRef}
          inert={sidebarHidden}
          legendFraction={legendFraction}
          onLegendFractionPreview={setLegendFractionPreview}
        />
        <Rail
          sidebarOpen={layout.sidebarOpen}
          structureProteinId={structureProteinId}
          structureDocked={layout.structurePlacement === 'docked'}
          toggleRef={railToggleRef}
          structureRef={structureRef}
        />
      </div>
      <protspace-data-loader id="myDataLoader"></protspace-data-loader>
    </div>
  );
}
