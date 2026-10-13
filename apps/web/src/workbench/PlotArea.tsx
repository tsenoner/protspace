import { memo, type Ref } from 'react';

/**
 * The plot, its tool strip in the top-left corner and the selection bar at the bottom-centre; the
 * status corner (4.3) joins them here. Memoised, with a stable ref as its only prop, so the
 * scatterplot renders once and is never re-created.
 */
export const PlotArea = memo(function PlotArea({ ref }: { ref?: Ref<HTMLElement> }) {
  return (
    <main ref={ref} className="wb-plot" data-workbench="plot">
      <protspace-scatterplot id="myPlot" data-driver-id="scatterplot"></protspace-scatterplot>
      <protspace-plot-tools id="myPlotTools" data-driver-id="selection"></protspace-plot-tools>
      <protspace-selection-bar id="mySelectionBar"></protspace-selection-bar>
    </main>
  );
});
