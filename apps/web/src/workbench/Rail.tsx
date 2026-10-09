import type { Ref, RefObject } from 'react';
import { updateLayout } from '../explore/layout-state';

interface RailProps {
  sidebarOpen: boolean;
  /** The protein the structure viewer shows or waits to show; null for none. */
  structureProteinId: string | null;
  /** Whether the structure sits in the sidebar column rather than floating over the plot. */
  structureDocked: boolean;
  /** The collapse toggle, for a caller that moves focus to it. */
  toggleRef?: Ref<HTMLElement>;
  /** The docked structure section, which Structure focuses while the sidebar is open. */
  structureRef?: RefObject<HTMLElement | null>;
}

/**
 * The 44 px icon rail at the sidebar's right edge (design decision 2). It stays when the sidebar
 * collapses, so the legend and a waiting structure stay one click away. Hidden below 951 px.
 */
export function Rail({
  sidebarOpen,
  structureProteinId,
  structureDocked,
  toggleRef,
  structureRef,
}: RailProps) {
  const toggleSidebar = () => updateLayout({ sidebarOpen: !sidebarOpen });
  // A docked structure in a collapsed sidebar waits; opening the sidebar loads it. In an open
  // sidebar it is already on screen: Structure takes focus there.
  const showStructure = () => {
    if (!structureDocked) return;
    if (!sidebarOpen) updateLayout({ sidebarOpen: true });
    else structureRef?.current?.focus();
  };
  return (
    <nav className="wb-rail" data-workbench="rail" aria-label="Panels">
      <ps-icon-button
        icon="list"
        label="Legend"
        tooltipPlacement="left"
        pressed={sidebarOpen}
        onClick={toggleSidebar}
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
