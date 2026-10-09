import { memo } from 'react';

/**
 * The flush right sidebar (design decision 2): the legend, above the structure section that
 * StructurePanel renders as the aside's sibling, so placing the structure never moves either
 * element. Memoised and without props, so the legend is never re-created or moved.
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
    </aside>
  );
});
