import { memo } from 'react';

/**
 * How the plot is drawn (design decision 1). It hosts the control bar until Tasks 2.5–2.10 split it
 * into one-job pickers. Memoised and without props: a store-driven render never touches the bar.
 */
export const ViewBar = memo(function ViewBar() {
  return (
    <div role="toolbar" aria-label="View" data-workbench="view-bar">
      <protspace-control-bar
        id="myControlBar"
        data-driver-id="control-bar"
        selected-proteins-count="0"
        auto-sync="true"
        scatterplot-selector="#myPlot"
      ></protspace-control-bar>
    </div>
  );
});
