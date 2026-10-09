import { memo } from 'react';

/**
 * The plot. The tool strip (Task 2.9) and the status corner (4.2) join it here. Memoised and
 * without props, so the scatterplot renders once and is never re-created.
 */
export const PlotArea = memo(function PlotArea() {
  return (
    <main className="wb-plot" data-workbench="plot">
      <protspace-scatterplot
        id="myPlot"
        data-driver-id="scatterplot"
        show-tour-button="true"
      ></protspace-scatterplot>
    </main>
  );
});
