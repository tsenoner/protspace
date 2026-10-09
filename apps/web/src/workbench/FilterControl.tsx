import { Filter } from 'lucide-react';
import { useWorkbenchStatus } from './use-workbench-status';

/**
 * The view bar's Filter button and the dialog it opens (decision 14 moves the filter into the
 * sidebar in 4.4). Both are runtime elements: the runtime wires the button's click to the filter
 * controller, which opens and closes the dialog. They are siblings, so the view bar can hide the
 * button (stage 3, Filter in More) without hiding the dialog.
 */
export function FilterControl() {
  const { appliedFilterConditions: count } = useWorkbenchStatus();
  return (
    <>
      <ps-button id="myFilterButton" variant="ghost" data-view-item="">
        <span slot="start" className="wb-icon" aria-hidden="true">
          <Filter size={16} strokeWidth={1.75} />
        </span>
        {count > 0 ? (
          <>
            {/* One name for the whole button: a screen-reader-only span is a block, so names
                pieced together around it gain a stray space ("Filter , 1 …"). */}
            <span aria-hidden="true">Filter</span>
            <span className="wb-filter-count" aria-hidden="true">
              {count}
            </span>
            <span className="sr-only">
              Filter, {count} {count === 1 ? 'condition' : 'conditions'} applied
            </span>
          </>
        ) : (
          'Filter'
        )}
      </ps-button>
      <ps-dialog id="myFilterDialog" heading="Filter" size="lg">
        <protspace-query-builder id="myQueryBuilder" embedded></protspace-query-builder>
      </ps-dialog>
    </>
  );
}
