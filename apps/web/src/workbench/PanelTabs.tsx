import { flushSync } from 'react-dom';
import type { KeyboardEvent } from 'react';
import type { SidebarPanel } from '../explore/layout-defaults';
import { updateLayout } from '../explore/layout-state';

const TABS: ReadonlyArray<{ panel: SidebarPanel; label: string; controls: string }> = [
  { panel: 'legend', label: 'Legend', controls: 'myLegend' },
  { panel: 'filter', label: 'Filter', controls: 'wb-filter-panel' },
];

/**
 * Shows `panel`, then focuses its tab in the copy of the tabs that is now on screen: the legend's
 * copy lives in its header, the Filter panel's in its own, and the one just used is now hidden.
 */
function choose(panel: SidebarPanel): void {
  flushSync(() => updateLayout({ panel }));
  const host = document.getElementById(panel === 'legend' ? 'myLegend' : 'wb-filter-panel');
  host?.querySelector<HTMLElement>(`.wb-panel-tabs [data-tab="${panel}"]`)?.focus();
}

interface PanelTabsProps {
  /** The panel shown: its tab is selected and the Tab stop. */
  panel: SidebarPanel;
  /** The legend's copy goes in its `header-start` slot. */
  slot?: string;
}

/**
 * The Legend and Filter tabs below 951 px (design decision 17), where the desktop rail is hidden.
 * Two copies render, one at the start of the legend's header and one in the Filter panel's, so
 * the tabs stay in the shown panel's header row; CSS hides both on desktop. Arrow keys, Home and
 * End switch panels at once (automatic activation).
 */
export function PanelTabs({ panel, slot }: PanelTabsProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let next: SidebarPanel | null = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      next = panel === 'legend' ? 'filter' : 'legend';
    } else if (event.key === 'Home') {
      next = 'legend';
    } else if (event.key === 'End') {
      next = 'filter';
    }
    if (next === null) return;
    event.preventDefault();
    choose(next);
  };

  return (
    <div
      role="tablist"
      aria-label="Sidebar panels"
      className="wb-panel-tabs"
      slot={slot}
      onKeyDown={onKeyDown}
    >
      {TABS.map((tab) => (
        <button
          key={tab.panel}
          type="button"
          role="tab"
          data-tab={tab.panel}
          aria-selected={tab.panel === panel}
          aria-controls={tab.controls}
          tabIndex={tab.panel === panel ? 0 : -1}
          onClick={() => choose(tab.panel)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
