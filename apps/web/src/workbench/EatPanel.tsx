import { useEffect, useRef } from 'react';
import type { SidebarPanel } from '../explore/layout-defaults';
import { updateLayout } from '../explore/layout-state';
import { PanelFold } from './PanelFold';
import { PanelTabs } from './PanelTabs';

/**
 * The sidebar's EAT panel (proposal B §5): in place of the legend, above the structure, as Filter
 * is. It hosts `#myEatPanel`, a runtime element the EAT panel controller feeds by id, so the
 * section renders once and only CSS (`data-panel` on the workbench) shows or hides it. Below
 * 951 px its header starts with the panel tabs; on desktop Close returns to the legend and hands
 * focus to the rail's EAT item.
 */
export function EatPanel({
  panel,
  panelFolded,
  tabbed,
}: {
  panel: SidebarPanel;
  panelFolded: boolean;
  tabbed: boolean;
}) {
  const close = useRef<HTMLElement>(null);

  useEffect(() => {
    const button = close.current;
    if (!button) return;
    const onClick = () => {
      updateLayout({ panel: 'legend' });
      document.getElementById('wb-rail-eat')?.focus();
    };
    button.addEventListener('click', onClick);
    return () => button.removeEventListener('click', onClick);
  }, []);

  return (
    <section
      id="wb-eat-panel"
      data-workbench="eat-panel"
      role={tabbed ? 'tabpanel' : 'region'}
      aria-labelledby="wb-eat-title"
    >
      <header className="wb-panel-header">
        <PanelTabs panel={panel} />
        <h2 id="wb-eat-title" className="wb-panel-title" tabIndex={-1}>
          EAT
        </h2>
        <ps-icon-button
          ref={close}
          className="wb-panel-close"
          icon="x"
          label="Close EAT"
        ></ps-icon-button>
        <PanelFold folded={panelFolded} />
      </header>
      <div className="wb-eat-body">
        <protspace-eat-panel id="myEatPanel"></protspace-eat-panel>
      </div>
    </section>
  );
}
