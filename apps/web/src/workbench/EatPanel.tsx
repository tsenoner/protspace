import type { ProtspaceEatPanel } from '@protspace/core';
import { useEffect, useRef } from 'react';
import type { SidebarPanel } from '../explore/layout-defaults';
import { hasStructureSheet } from '../explore/layout-mode';
import { updateLayout } from '../explore/layout-state';
import { getWorkbenchStatus } from '../explore/workbench-status';
import { PanelFold } from './PanelFold';
import { PanelTabs } from './PanelTabs';
import { useLayoutMode } from './use-layout-mode';
import { useWorkbenchStatus } from './use-workbench-status';

const INFO =
  'Labels copied from the nearest curated protein in embedding space. A reliability score ranks predictions; it is not a probability.';

/** The panel element the EAT panel controller feeds; the header's Reset resets it. */
const eatPanel = () => document.getElementById('myEatPanel') as ProtspaceEatPanel | null;

/**
 * The sidebar's EAT panel (proposal B §5): in place of the legend, above the structure, as Filter
 * is. It hosts `#myEatPanel`, a runtime element the EAT panel controller feeds by id, so the
 * section renders once and only CSS (`data-panel` on the workbench) shows or hides it. Below
 * 951 px its header starts with the panel tabs; on desktop Close returns to the legend and hands
 * focus to the rail's EAT item, or to Legend when the EAT item is off.
 *
 * One header row, as Filter's: the heading `EAT · <annotation>`, the info popover, Reset (off at
 * the defaults) and Close. The element itself draws no header. On a phone the element is
 * `compact`.
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
  const { eatAdjusted, eatAnnotationLabel } = useWorkbenchStatus();
  // A phone, upright or on its side, gets the compact panel; a tablet's half is wide enough.
  const compact = hasStructureSheet(useLayoutMode());

  useEffect(() => {
    const button = close.current;
    if (!button) return;
    const onClick = () => {
      updateLayout({ panel: 'legend' });
      // On its empty state the EAT item turns disabled as the panel closes: Legend takes focus.
      const target =
        getWorkbenchStatus().eatAvailability.kind === 'available'
          ? document.getElementById('wb-rail-eat')
          : document.getElementById('wb-rail-legend');
      target?.focus();
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
          {eatAnnotationLabel && (
            // The tooltip shows a name the ellipsis cut, without repeating the heading's name.
            <span className="wb-eat-annotation" title={eatAnnotationLabel}>
              {' '}
              · {eatAnnotationLabel}
            </span>
          )}
        </h2>
        <protspace-info-popover
          className="wb-eat-info"
          label="EAT"
          description={INFO}
          align="right"
        ></protspace-info-popover>
        <ps-button
          className="wb-eat-reset"
          variant="ghost"
          size="sm"
          disabled={!eatAdjusted}
          // Off at the defaults, yet focusable: a press that resets keeps focus on it.
          focusableWhenDisabled
          onClick={() => eatPanel()?.reset()}
        >
          Reset
        </ps-button>
        <ps-icon-button
          ref={close}
          className="wb-panel-close"
          icon="x"
          label="Close EAT"
        ></ps-icon-button>
        <PanelFold folded={panelFolded} />
      </header>
      <div className="wb-eat-body">
        <protspace-eat-panel id="myEatPanel" compact={compact}></protspace-eat-panel>
      </div>
    </section>
  );
}
