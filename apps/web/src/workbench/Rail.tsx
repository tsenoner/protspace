import type { Ref } from 'react';
import { countNoun } from '@protspace/utils';
import type { SidebarPanel } from '../explore/layout-defaults';
import { focusFilterTitle, openPanel, updateLayout } from '../explore/layout-state';
import { eatUnavailableReason, type EatAvailability } from '../explore/workbench-status';

interface RailProps {
  sidebarOpen: boolean;
  /** The sidebar's panel: Legend, Filter or EAT. */
  panel: SidebarPanel;
  /** The protein the structure viewer shows or waits to show; null for none. */
  structureProteinId: string | null;
  /** Whether the structure sits in the sidebar column rather than floating over the plot. */
  structureDocked: boolean;
  /** The Structure button hid the viewer (layout state, kept across reloads). */
  structureHidden: boolean;
  /** The applied filter's conditions: above 0 the Filter item gets a dot and says the count. */
  filterConditions: number;
  /** Whether the EAT item is enabled, and why not. */
  eatAvailability: EatAvailability;
  /** The EAT panel's settings differ from their defaults: the EAT item gets a dot. */
  eatAdjusted: boolean;
  /** The collapse toggle, for a caller that moves focus to it. */
  toggleRef?: Ref<HTMLElement>;
}

/**
 * The 44 px icon rail at the sidebar's right edge (design decision 2): the collapse toggle on top,
 * then Legend, Structure, Filter and EAT. It stays when the sidebar collapses, so every panel stays one click away. A panel's item
 * opens the sidebar on that panel; the item of the panel on screen collapses the sidebar. Structure
 * shows and hides the viewer the same way, docked or floating. Hidden below 951 px. On desktop the
 * view bar has no Filter button: this item is the way to the Filter panel.
 */
export function Rail({
  sidebarOpen,
  panel,
  structureProteinId,
  structureDocked,
  structureHidden,
  filterConditions,
  eatAvailability,
  eatAdjusted,
  toggleRef,
}: RailProps) {
  const eatReason = eatUnavailableReason(eatAvailability);
  const toggleSidebar = () => updateLayout({ sidebarOpen: !sidebarOpen });
  const togglePanel = (target: SidebarPanel) => {
    if (sidebarOpen && panel === target) {
      updateLayout({ sidebarOpen: false });
      return;
    }
    openPanel(target);
    // As the view bar's Filter does below desktop: focus moves to the panel's heading.
    if (target === 'filter') focusFilterTitle();
  };
  // On screen: docked in an open sidebar, or floating over the plot, and not hidden. Structure
  // hides it (a docked section leaves its room to the legend), or shows it again where it was: a
  // docked one opens a collapsed sidebar, which loads a waiting protein.
  const structureVisible = !structureHidden && (!structureDocked || sidebarOpen);
  const toggleStructure = () => {
    if (structureVisible) updateLayout({ structureHidden: true });
    else if (structureDocked) updateLayout({ structureHidden: false, sidebarOpen: true });
    else updateLayout({ structureHidden: false });
  };
  return (
    <nav className="wb-rail" data-workbench="rail" data-driver-id="rail" aria-label="Panels">
      <ps-icon-button
        ref={toggleRef}
        icon={sidebarOpen ? 'panel-right-close' : 'panel-right-open'}
        label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        tooltipPlacement="left"
        expanded={sidebarOpen ? 'true' : 'false'}
        onClick={toggleSidebar}
      ></ps-icon-button>
      <span className="wb-rail-divider" aria-hidden="true"></span>
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
          pressed={structureProteinId !== null && structureVisible}
          onClick={toggleStructure}
        ></ps-icon-button>
        {structureProteinId !== null && (
          <span className="wb-rail-dot" data-workbench="structure-dot" aria-hidden="true"></span>
        )}
      </span>
      <span className="wb-rail-item">
        <ps-icon-button
          id="wb-rail-filter"
          icon="filter"
          label={
            filterConditions > 0
              ? `Filter, ${countNoun(filterConditions, 'condition', 'conditions')} applied`
              : 'Filter'
          }
          tooltipPlacement="left"
          pressed={sidebarOpen && panel === 'filter'}
          onClick={() => togglePanel('filter')}
        ></ps-icon-button>
        {filterConditions > 0 && (
          <span className="wb-rail-dot" data-workbench="filter-dot" aria-hidden="true"></span>
        )}
      </span>
      <span className="wb-rail-item">
        <ps-icon-button
          id="wb-rail-eat"
          icon="waypoints"
          label={eatReason ?? 'EAT — transferred annotations'}
          tooltipPlacement="left"
          disabled={eatReason !== null}
          pressed={sidebarOpen && panel === 'eat'}
          onClick={() => togglePanel('eat')}
        ></ps-icon-button>
        {eatAdjusted && (
          <span className="wb-rail-dot" data-workbench="eat-dot" aria-hidden="true"></span>
        )}
      </span>
    </nav>
  );
}
