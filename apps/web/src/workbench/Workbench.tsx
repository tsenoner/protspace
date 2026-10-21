import { createRef, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { RAIL_WIDTH, SIDEBAR_WIDTH } from '../explore/layout-defaults';
import { updateLayout } from '../explore/layout-state';
import { hasStructureSheet } from '../explore/layout-mode';
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
import { useFileDrop } from './use-file-drop';
import { useFloatingCard } from './use-floating-card';
import { useLayout } from './use-layout';
import { useLayoutMode } from './use-layout-mode';
import { useSidebarTransition } from './use-sidebar-transition';
import { useWorkbenchStatus } from './use-workbench-status';
import { ViewBar } from './ViewBar';
import { WorkbenchToaster } from './WorkbenchToaster';
import './workbench.css';

/** A slide target that is never there: the structure while it floats over the plot. */
const NO_SLIDE_TARGET = createRef<HTMLElement>();

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
  const { structureProteinId, appliedFilterConditions, datasetPhase, structureSheet } =
    useWorkbenchStatus();
  // The divider's drag or key preview; null while the stored fraction shows.
  const [legendFractionPreview, setLegendFractionPreview] = useState<number | null>(null);
  const legendFraction = legendFractionPreview ?? layout.legendFraction;
  const desktop = mode === 'desktop';
  // Floating is desktop-only: below 951 px a stored floating card shows docked (storage keeps it).
  const placement = desktop ? layout.structurePlacement : 'docked';
  // The empty footer under the legend, the docked viewer, or the floating card over the plot.
  const structure = structureProteinId === null ? 'none' : placement;
  // The rail's Structure button hid the viewer: desktop only, and only once there is a protein.
  const structureHidden = desktop && structure !== 'none' && layout.structureHidden;
  // Phones show the structure as a sheet at the bottom edge, folded or expanded (decision 17).
  const sheet = hasStructureSheet(mode);
  const sidebarCap = useSyncExternalStore(subscribeWindowWidth, getSidebarCap);
  const asideRef = useRef<HTMLElement>(null);
  const structureRef = useRef<HTMLElement>(null);
  const railToggleRef = useRef<HTMLElement>(null);
  // The edge's drag or key preview; null while the committed width shows.
  const [sidebarWidthPreview, setSidebarWidthPreview] = useState<number | null>(null);
  // The committed width this window can give the sidebar, so the plot keeps 480 px (render only).
  const sidebarWidth = clampSidebarWidth(layout.sidebarWidth, sidebarCap);
  const phase = useSidebarTransition(
    layout.sidebarOpen,
    {
      aside: asideRef,
      // A floating card stays over the plot: it does not slide with the sidebar.
      structure: structure === 'floating' ? NO_SLIDE_TARGET : structureRef,
    },
    // Below 951 px the sidebar is the panel under the plot: it never slides.
    desktop,
  );
  // The plot area the floating card stays inside.
  const plotAreaRef = useRef<HTMLElement>(null);
  useFloatingCard(structureRef, plotAreaRef);
  // On desktop a collapsed or collapsing sidebar is inert; below 951 px it always shows.
  const sidebarHidden = desktop && (phase === 'collapsed' || phase === 'closing');
  // A file dragged anywhere over the workbench shows the drop area; a drop loads it.
  const rootRef = useRef<HTMLDivElement>(null);
  const dragging = useFileDrop(rootRef);
  return (
    <div
      className="workbench"
      data-layout={mode}
      data-structure={structure}
      data-structure-hidden={structureHidden ? '' : undefined}
      data-sidebar={phase}
      data-panel={layout.panel}
      // The phone's bottom panel shows only its header (only phones fold it).
      data-panel-folded={mode === 'phone' && layout.panelFolded ? '' : undefined}
      data-sheet={sheet && structure !== 'none' ? structureSheet : undefined}
      data-sidebar-resizing={sidebarWidthPreview !== null ? '' : undefined}
      ref={rootRef}
      data-dragging={dragging ? '' : undefined}
      // The loading overlay blocks the pointer; inert keeps Tab from reaching the bars behind it.
      inert={datasetPhase === 'loading'}
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
        <PlotArea ref={plotAreaRef} />
        {/* Outside the plot area, whose isolation would trap the toasts under the sidebar. */}
        <WorkbenchToaster />
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
        <Sidebar
          ref={asideRef}
          inert={sidebarHidden}
          panel={layout.panel}
          panelFolded={layout.panelFolded}
          tabbed={!desktop}
        />
        <StructurePanel
          ref={structureRef}
          inert={structureHidden || (sidebarHidden && structure !== 'floating')}
          // With no protein the section is the docked footer: no card, no grip.
          placement={structure === 'floating' ? 'floating' : 'docked'}
          canFloat={desktop}
          sheet={sheet}
          sheetExpanded={structureSheet === 'expanded'}
          legendFraction={legendFraction}
          onLegendFractionPreview={setLegendFractionPreview}
        />
        <Rail
          sidebarOpen={layout.sidebarOpen}
          panel={layout.panel}
          structureProteinId={structureProteinId}
          structureDocked={placement === 'docked'}
          structureHidden={layout.structureHidden}
          filterConditions={appliedFilterConditions}
          toggleRef={railToggleRef}
        />
        <div className="wb-drop-area" aria-hidden="true">
          Drop to open this file
        </div>
      </div>
      <protspace-data-loader id="myDataLoader"></protspace-data-loader>
    </div>
  );
}
