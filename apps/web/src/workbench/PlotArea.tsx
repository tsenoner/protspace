import { memo, type Ref } from 'react';
import { EmptyState } from './EmptyState';

/**
 * The plot, its tool strip, its selection bar and status corner, and the empty state over it. The
 * tool strip sits in the top-left corner, the status corner at the bottom-left and the selection
 * bar at the bottom-centre, in that order so Tab reads left to right. Memoised, with a
 * stable ref as its only prop, so the scatterplot renders once and is never re-created.
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
      <protspace-plot-status id="myPlotStatus"></protspace-plot-status>
      <protspace-selection-bar id="mySelectionBar"></protspace-selection-bar>
      <EmptyState />
    </main>
  );
});
