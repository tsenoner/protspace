import type { CSSProperties } from 'react';
import { AppBar } from './AppBar';
import { PlotArea } from './PlotArea';
import { Sidebar } from './Sidebar';
import { useLayout } from './use-layout';
import { useLayoutMode } from './use-layout-mode';
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
  return (
    <div className="workbench" data-layout={mode}>
      <AppBar />
      <ViewBar />
      <div
        className="wb-body"
        data-workbench="body"
        style={{ '--wb-sidebar-width': `${layout.sidebarWidth}px` } as CSSProperties}
      >
        <PlotArea />
        <Sidebar />
      </div>
      <protspace-data-loader id="myDataLoader"></protspace-data-loader>
    </div>
  );
}
