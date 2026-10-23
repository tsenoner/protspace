import { flushSync } from 'react-dom';
import type { KeyboardEvent } from 'react';
import type { SidebarPanel } from '../explore/layout-defaults';
import { updateLayout } from '../explore/layout-state';
import { eatUnavailableReason } from '../explore/workbench-status';
import { notify } from '../lib/notify';
import { useWorkbenchStatus } from './use-workbench-status';

const TABS: ReadonlyArray<{ panel: SidebarPanel; label: string; controls: string }> = [
  { panel: 'legend', label: 'Legend', controls: 'myLegend' },
  { panel: 'filter', label: 'Filter', controls: 'wb-filter-panel' },
  { panel: 'eat', label: 'EAT', controls: 'wb-eat-panel' },
];

const hostOf = (panel: SidebarPanel): string =>
  TABS.find((tab) => tab.panel === panel)?.controls ?? 'myLegend';

/**
 * Shows `panel`, unfolding a folded phone panel so the tab shows something, then focuses its tab
 * in the copy of the tabs that is now on screen: each panel's header holds its own copy, and the
 * one just used is now hidden.
 */
function choose(panel: SidebarPanel): void {
  flushSync(() => updateLayout({ panel, panelFolded: false }));
  const host = document.getElementById(hostOf(panel));
  host?.querySelector<HTMLElement>(`.wb-panel-tabs [data-tab="${panel}"]`)?.focus();
}

interface PanelTabsProps {
  /** The panel shown: its tab is selected and the Tab stop. */
  panel: SidebarPanel;
  /** The legend's copy goes in its `header-start` slot. */
  slot?: string;
}

/**
 * The Legend, Filter and EAT tabs below 951 px (design decision 17), where the desktop rail is
 * hidden. A copy renders at the start of each panel's header, so the tabs stay in the shown
 * panel's header row; CSS hides them on desktop. Arrow keys, Home and End switch panels at once
 * (automatic activation). EAT without predictions to show is `aria-disabled`: the arrow keys skip
 * it, and a tap says why.
 */
export function PanelTabs({ panel, slot }: PanelTabsProps) {
  const { eatAvailability, eatAdjusted } = useWorkbenchStatus();
  const eatReason = eatUnavailableReason(eatAvailability);
  const enabled = TABS.filter((tab) => tab.panel !== 'eat' || eatReason === null);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = enabled.findIndex((tab) => tab.panel === panel);
    let next: SidebarPanel | null = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const step = event.key === 'ArrowRight' ? 1 : -1;
      // From the disabled EAT tab, which an annotation without EAT keeps open, as from the end.
      const from = at === -1 ? enabled.length - (step > 0 ? 1 : 0) : at;
      next = enabled[(from + step + enabled.length) % enabled.length].panel;
    } else if (event.key === 'Home') {
      next = enabled[0].panel;
    } else if (event.key === 'End') {
      next = enabled[enabled.length - 1].panel;
    }
    if (next === null) return;
    event.preventDefault();
    choose(next);
  };

  const onClick = (target: SidebarPanel) => {
    if (target === 'eat' && eatReason !== null) {
      notify.info({ title: eatReason });
      return;
    }
    choose(target);
  };

  return (
    <div
      role="tablist"
      aria-label="Sidebar panels"
      className="wb-panel-tabs"
      slot={slot}
      onKeyDown={onKeyDown}
    >
      {TABS.map((tab) => {
        const disabled = tab.panel === 'eat' && eatReason !== null;
        return (
          <button
            key={tab.panel}
            type="button"
            role="tab"
            data-tab={tab.panel}
            aria-selected={tab.panel === panel}
            aria-controls={tab.controls}
            aria-disabled={disabled ? 'true' : undefined}
            // The dot is visual only: the name says the settings changed.
            aria-label={tab.panel === 'eat' && eatAdjusted ? 'EAT, settings changed' : undefined}
            title={disabled ? eatReason : undefined}
            tabIndex={tab.panel === panel ? 0 : -1}
            onClick={() => onClick(tab.panel)}
          >
            {tab.label}
            {tab.panel === 'eat' && eatAdjusted && (
              <span className="wb-tab-dot" data-workbench="eat-tab-dot" aria-hidden="true"></span>
            )}
          </button>
        );
      })}
    </div>
  );
}
