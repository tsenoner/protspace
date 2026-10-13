import { memo, type Ref } from 'react';

/**
 * The plot, its tool strip in the top-left corner, the selection bar at the bottom-centre and the
 * status corner at the bottom-left. Memoised, with a stable ref as its only prop, so the
 * scatterplot renders once and is never re-created.
 */
export const PlotArea = memo(function PlotArea({ ref }: { ref?: Ref<HTMLElement> }) {
  return (
    <main ref={ref} className="wb-plot" data-workbench="plot">
      <protspace-scatterplot
        id="myPlot"
        data-driver-id="scatterplot"
        hide-status=""
      ></protspace-scatterplot>
      <protspace-plot-tools id="myPlotTools" data-driver-id="selection"></protspace-plot-tools>
      <protspace-selection-bar id="mySelectionBar"></protspace-selection-bar>
      <protspace-plot-status id="myPlotStatus"></protspace-plot-status>
    </main>
  );
});
