import { memo, type Ref } from 'react';
import { EmptyState } from './EmptyState';
import { PlotShortcutsButton } from './PlotShortcutsButton';

/**
 * The plot, its top-left corner, its selection bar and status corner, and the empty state over
 * it. The corner holds the tool strip and, beside it, the projection details over the keyboard
 * shortcuts. The status corner sits at the bottom-left and the selection bar at the
 * bottom-centre, in that order so Tab reads left to right. Memoised, with a stable ref as its only
 * prop, so the scatterplot renders once and is never re-created.
 */
export const PlotArea = memo(function PlotArea({ ref }: { ref?: Ref<HTMLElement> }) {
  return (
    <main ref={ref} className="wb-plot" data-workbench="plot">
      <protspace-scatterplot
        id="myPlot"
        data-driver-id="scatterplot"
        hide-status=""
      ></protspace-scatterplot>
      <div className="wb-plot-corner" data-workbench="plot-corner" data-driver-id="selection">
        <protspace-plot-tools id="myPlotTools"></protspace-plot-tools>
        <div className="wb-plot-aside" data-workbench="plot-aside">
          <protspace-projection-metadata id="myProjectionMetadata"></protspace-projection-metadata>
          <PlotShortcutsButton />
        </div>
      </div>
      <protspace-plot-status id="myPlotStatus"></protspace-plot-status>
      <protspace-selection-bar id="mySelectionBar"></protspace-selection-bar>
      <EmptyState />
    </main>
  );
});
