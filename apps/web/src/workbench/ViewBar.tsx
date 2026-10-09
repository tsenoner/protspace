import { memo } from 'react';
import { FilterControl } from './FilterControl';

/**
 * How the plot is drawn (design decision 1): Projection with its details, Color by and Contours,
 * then what is left of the control bar (search and selection until Tasks 2.9 and 2.10) and Filter.
 * Memoised and without props: a store-driven render never touches the bar.
 */
export const ViewBar = memo(function ViewBar() {
  return (
    <div role="toolbar" aria-label="View" data-workbench="view-bar">
      <div className="wb-view-group" data-driver-id="projections">
        <protspace-projection-select id="myProjectionSelect"></protspace-projection-select>
        <protspace-projection-metadata id="myProjectionMetadata"></protspace-projection-metadata>
        <protspace-annotation-select id="myAnnotationSelect"></protspace-annotation-select>
      </div>
      <protspace-contours-menu id="myContoursMenu"></protspace-contours-menu>
      <span className="wb-view-sep" aria-hidden="true"></span>
      <protspace-control-bar
        id="myControlBar"
        data-driver-id="control-bar"
        selected-proteins-count="0"
        auto-sync="true"
        scatterplot-selector="#myPlot"
      ></protspace-control-bar>
      <FilterControl />
    </div>
  );
});
