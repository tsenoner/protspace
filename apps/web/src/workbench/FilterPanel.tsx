import { useEffect, useRef } from 'react';
import { updateLayout } from '../explore/layout-state';
import { useLayoutMode } from './use-layout-mode';

/** The view bar's Filter button, or More once the bar has moved Filter into it (stage 3). */
function narrowReturnTarget(): HTMLElement | null {
  const button = document.getElementById('myFilterButton');
  if (button?.checkVisibility()) return button;
  return document.querySelector<HTMLElement>('[data-workbench="view-bar"] .wb-more');
}

/**
 * The sidebar's Filter panel (design decision 14): in place of the legend, above the structure.
 * It hosts the query builder, a runtime element the filter controller wires by id, so the section
 * renders once and only CSS (`data-panel` on the workbench) shows or hides it. Close returns to
 * the legend and hands focus to the control that opened the panel's kind: the rail's Filter item
 * on desktop, the view bar's Filter (or More) below 951 px.
 */
export function FilterPanel() {
  const close = useRef<HTMLElement>(null);
  const desktop = useLayoutMode() === 'desktop';

  useEffect(() => {
    const button = close.current;
    if (!button) return;
    const onClick = () => {
      updateLayout({ panel: 'legend' });
      const target = desktop ? document.getElementById('wb-rail-filter') : narrowReturnTarget();
      target?.focus();
    };
    button.addEventListener('click', onClick);
    return () => button.removeEventListener('click', onClick);
  }, [desktop]);

  return (
    <section
      id="wb-filter-panel"
      data-workbench="filter-panel"
      role="region"
      aria-labelledby="wb-filter-title"
    >
      <header className="wb-panel-header">
        <h2 id="wb-filter-title" className="wb-panel-title" tabIndex={-1}>
          Filter
        </h2>
        <ps-icon-button ref={close} icon="x" label="Close filter"></ps-icon-button>
      </header>
      <div className="wb-filter-body">
        <protspace-query-builder id="myQueryBuilder" embedded></protspace-query-builder>
      </div>
    </section>
  );
}
