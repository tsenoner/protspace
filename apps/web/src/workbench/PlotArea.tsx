import { memo, type Ref } from 'react';

/**
 * The plot and its tool strip, laid over the plot's top-left corner; the status corner (4.2) joins
 * them here. Memoised, with a stable ref as its only prop, so the scatterplot renders once and is
 * never re-created.
 */
export const PlotArea = memo(function PlotArea({ ref }: { ref?: Ref<HTMLElement> }) {
  return (
    <main ref={ref} className="wb-plot" data-workbench="plot">
      <protspace-scatterplot id="myPlot" data-driver-id="scatterplot"></protspace-scatterplot>
      <protspace-plot-tools id="myPlotTools" data-driver-id="selection"></protspace-plot-tools>
    </main>
  );
});
