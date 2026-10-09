import { useState, type CSSProperties } from 'react';
import { AppBar } from './AppBar';
import { PlotArea } from './PlotArea';
import { Sidebar } from './Sidebar';
import { StructurePanel } from './StructurePanel';
import { useLayout } from './use-layout';
import { useLayoutMode } from './use-layout-mode';
import { useWorkbenchStatus } from './use-workbench-status';
import { ViewBar } from './ViewBar';
import './workbench.css';

/**
 * The explore workbench (design decision 1): the app bar, the view bar, then the plot beside a
 * flush right sidebar. The runtime finds its elements by id, so they render once in this fixed tree;
 * every layout state is a data attribute or a --wb-* property that workbench.css reads.
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
  return (
    <div className="workbench" data-layout={mode} data-structure={structure}>
      <AppBar />
      <ViewBar />
      <div
        className="wb-body"
        data-workbench="body"
        style={
          {
            '--wb-sidebar-width': `${layout.sidebarWidth}px`,
            '--wb-legend-fraction': String(legendFraction),
          } as CSSProperties
        }
      >
        <PlotArea />
        <Sidebar />
        <StructurePanel
          legendFraction={legendFraction}
          onLegendFractionPreview={setLegendFractionPreview}
        />
      </div>
      <protspace-data-loader id="myDataLoader"></protspace-data-loader>
    </div>
  );
}
