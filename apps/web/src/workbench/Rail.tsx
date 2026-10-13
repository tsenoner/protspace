import type { Ref, RefObject } from 'react';
import type { SidebarPanel } from '../explore/layout-defaults';
import { openPanel, updateLayout } from '../explore/layout-state';

interface RailProps {
  sidebarOpen: boolean;
  /** The sidebar's panel: Legend or Filter. */
  panel: SidebarPanel;
  /** The protein the structure viewer shows or waits to show; null for none. */
  structureProteinId: string | null;
  /** Whether the structure sits in the sidebar column rather than floating over the plot. */
  structureDocked: boolean;
  /** A filter is applied: the Filter item gets a dot. */
  filterApplied: boolean;
  /** The collapse toggle, for a caller that moves focus to it. */
  toggleRef?: Ref<HTMLElement>;
  /** The structure section, which Structure focuses while it is on screen. */
  structureRef?: RefObject<HTMLElement | null>;
}

/**
 * The 44 px icon rail at the sidebar's right edge (design decision 2): Legend, Structure and
 * Filter. It stays when the sidebar collapses, so every panel stays one click away. A panel's item
 * opens the sidebar on that panel; the item of the panel on screen collapses the sidebar. Hidden
 * below 951 px.
 */
export function Rail({
  sidebarOpen,
  panel,
  structureProteinId,
  structureDocked,
  filterApplied,
  toggleRef,
  structureRef,
}: RailProps) {
  const toggleSidebar = () => updateLayout({ sidebarOpen: !sidebarOpen });
  const togglePanel = (target: SidebarPanel) => {
    if (sidebarOpen && panel === target) updateLayout({ sidebarOpen: false });
    else openPanel(target);
  };
  // A docked structure in a collapsed sidebar waits; opening the sidebar loads it. Docked in an
  // open sidebar, or floating over the plot, it is already on screen: Structure takes focus there.
  const showStructure = () => {
    if (structureDocked && !sidebarOpen) updateLayout({ sidebarOpen: true });
    else structureRef?.current?.focus();
  };
  return (
    <nav className="wb-rail" data-workbench="rail" aria-label="Panels">
      <ps-icon-button
        icon="list"
        label="Legend"
        tooltipPlacement="left"
        pressed={sidebarOpen && panel === 'legend'}
        onClick={() => togglePanel('legend')}
      ></ps-icon-button>
      <span className="wb-rail-item">
        <ps-icon-button
          icon="box"
          label={
            structureProteinId === null
              ? 'Structure: click a protein to view it'
              : `Structure: ${structureProteinId}`
          }
          tooltipPlacement="left"
          disabled={structureProteinId === null}
          onClick={showStructure}
        ></ps-icon-button>
        {structureProteinId !== null && (
          <span className="wb-rail-dot" data-workbench="structure-dot" aria-hidden="true"></span>
        )}
      </span>
      <span className="wb-rail-item">
        <ps-icon-button
          id="wb-rail-filter"
          icon="filter"
          label="Filter"
          tooltipPlacement="left"
          pressed={sidebarOpen && panel === 'filter'}
          onClick={() => togglePanel('filter')}
        ></ps-icon-button>
        {filterApplied && (
          <span className="wb-rail-dot" data-workbench="filter-dot" aria-hidden="true"></span>
        )}
      </span>
      <span className="wb-rail-spacer" aria-hidden="true"></span>
      <ps-icon-button
        ref={toggleRef}
        icon={sidebarOpen ? 'panel-right-close' : 'panel-right-open'}
        label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        tooltipPlacement="left"
        expanded={sidebarOpen ? 'true' : 'false'}
        onClick={toggleSidebar}
      ></ps-icon-button>
    </nav>
  );
}
