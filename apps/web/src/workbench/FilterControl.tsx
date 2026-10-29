import { Filter } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { countNoun } from '@protspace/utils';
import { focusFilterTitle, openPanel } from '../explore/layout-state';
import { useLayout } from './use-layout';
import { useWorkbenchStatus } from './use-workbench-status';

/**
 * The view bar's Filter button (design decision 14), on tablets and phones: it opens the sidebar's
 * Filter panel, never closes it, and moves focus to the panel's heading. The view bar hides it at
 * stage 3, where More clicks it. Desktop has none: the rail's Filter item takes its place.
 */
export function FilterControl() {
  const { appliedFilterConditions: count } = useWorkbenchStatus();
  const layout = useLayout();
  // Below desktop the Filter panel is on screen whenever it is the panel.
  const shown = layout.panel === 'filter';
  const button = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = button.current;
    if (!element) return;
    const onClick = () => {
      // Commit the layout now, so the heading is on screen when focus moves to it; a sidebar
      // that is still sliding in shows it a frame later.
      flushSync(() => openPanel('filter'));
      focusFilterTitle();
    };
    element.addEventListener('click', onClick);
    return () => element.removeEventListener('click', onClick);
  }, []);

  return (
    <ps-button
      ref={button}
      id="myFilterButton"
      variant="ghost"
      data-view-item=""
      expanded={shown ? 'true' : 'false'}
    >
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
            {`Filter, ${countNoun(count, 'condition', 'conditions')} applied`}
          </span>
        </>
      ) : (
        'Filter'
      )}
    </ps-button>
  );
}
