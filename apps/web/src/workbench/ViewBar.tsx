import { memo, useRef } from 'react';
import { updateLayout } from '../explore/layout-state';
import { FilterControl } from './FilterControl';
import { MoreMenu } from './MoreMenu';
import { usePlotFill } from './use-layout';
import { useLayoutMode } from './use-layout-mode';
import { useViewBarStage } from './use-view-bar-stage';

/**
 * How the plot is drawn (design decision 1): Projection with its details and Color by, Contours,
 * Fill, then Filter, in one 44 px row. Near its width limit the bar gives up room in stages
 * (view-bar-overflow.ts): the keys hide, then Contours and then Filter move into More. On a phone
 * the bar is fixed at stage 3 and workbench.css shows Projection, its details, Color by and More;
 * Fill stays in the bar at every desktop stage and is in the More sheet on a phone.
 * A stage is only data-stage and CSS: every runtime element stays mounted where it is. Memoised
 * and without props: only its own stage and the layout mode render it again. A group, not a toolbar: its controls keep their own
 * Tab stops, with no arrow-key model across them.
 */
export const ViewBar = memo(function ViewBar() {
  const bar = useRef<HTMLDivElement>(null);
  const mode = useLayoutMode();
  const stage = useViewBarStage(bar, mode);
  return (
    <div
      ref={bar}
      role="group"
      aria-label="View"
      data-workbench="view-bar"
      data-driver-id="view-bar"
      data-stage={stage}
    >
      <div className="wb-view-group" data-driver-id="projections" data-view-item="">
        <protspace-projection-select id="myProjectionSelect"></protspace-projection-select>
        <protspace-projection-metadata id="myProjectionMetadata"></protspace-projection-metadata>
        <protspace-annotation-select id="myAnnotationSelect"></protspace-annotation-select>
      </div>
      <protspace-contours-menu id="myContoursMenu" data-view-item=""></protspace-contours-menu>
      <FillToggle />
      <span className="wb-view-sep" aria-hidden="true"></span>
      <FilterControl />
      <MoreMenu stage={stage} mode={mode} />
    </div>
  );
});

/**
 * Fill (design decision 3): off, one scale for both axes keeps the data's true shape; on, each
 * axis stretches to fill the plot area. Stored with the layout; the runtime hands it to the plot,
 * and exports follow it.
 */
function FillToggle() {
  const fill = usePlotFill();
  return (
    <ps-icon-button
      className="wb-fill"
      data-workbench="fill"
      data-view-item=""
      icon="expand"
      label="Fill the plot area: stretch each axis to fill the plot. Off keeps the data's true shape."
      pressed={fill}
      onClick={() => updateLayout({ plotFill: !fill })}
    ></ps-icon-button>
  );
}
