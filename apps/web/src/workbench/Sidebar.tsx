import { memo } from 'react';

/**
 * The flush right sidebar (design decision 2): the legend over the structure viewer, which still
 * shows and hides itself until Task 2.11. Memoised and without props, so neither runtime element
 * is ever re-created or moved.
 */
export const Sidebar = memo(function Sidebar() {
  return (
    <aside id="wb-sidebar" data-workbench="sidebar" aria-label="Sidebar">
      <protspace-legend
        id="myLegend"
        data-driver-id="legend"
        auto-sync="true"
        auto-hide="true"
        scatterplot-selector="#myPlot"
      ></protspace-legend>
      <protspace-structure-viewer
        id="myStructureViewer"
        title="AlphaFold2 Structure"
        height="340px"
        show-header="true"
        show-close-button="true"
        show-tips="true"
        auto-sync="true"
        auto-show="true"
        scatterplot-selector="#myPlot"
        style={{ display: 'none' }}
      ></protspace-structure-viewer>
    </aside>
  );
});
