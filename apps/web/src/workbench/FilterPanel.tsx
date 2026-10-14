import { useEffect, useRef } from 'react';
import type { SidebarPanel } from '../explore/layout-defaults';
import { updateLayout } from '../explore/layout-state';
import { PanelTabs } from './PanelTabs';

/**
 * The sidebar's Filter panel (design decision 14): in place of the legend, above the structure.
 * It hosts the query builder, a runtime element the filter controller wires by id, so the section
 * renders once and only CSS (`data-panel` on the workbench) shows or hides it. Below 951 px its
 * header starts with the Legend/Filter tabs, which switch panels; on desktop Close returns to the
 * legend and hands focus to the rail's Filter item (CSS hides Close below 951 px).
 */
export function FilterPanel({ panel }: { panel: SidebarPanel }) {
  const close = useRef<HTMLElement>(null);

  useEffect(() => {
    const button = close.current;
    if (!button) return;
    const onClick = () => {
      updateLayout({ panel: 'legend' });
      document.getElementById('wb-rail-filter')?.focus();
    };
    button.addEventListener('click', onClick);
    return () => button.removeEventListener('click', onClick);
  }, []);

  return (
    <section
      id="wb-filter-panel"
      data-workbench="filter-panel"
      role="region"
      aria-labelledby="wb-filter-title"
    >
      <header className="wb-panel-header">
        <PanelTabs panel={panel} />
        <h2 id="wb-filter-title" className="wb-panel-title" tabIndex={-1}>
          Filter
        </h2>
        <ps-icon-button
          ref={close}
          className="wb-panel-close"
          icon="x"
          label="Close filter"
        ></ps-icon-button>
      </header>
      <div className="wb-filter-body">
        <protspace-query-builder id="myQueryBuilder" embedded></protspace-query-builder>
      </div>
    </section>
  );
}
