import type { ProtspaceQueryBuilder, PsMenu } from '@protspace/core';
import { countNoun } from '@protspace/utils';
import { useEffect, useRef } from 'react';
import type { SidebarPanel } from '../explore/layout-defaults';
import { updateLayout } from '../explore/layout-state';
import { PanelFold } from './PanelFold';
import { PanelTabs } from './PanelTabs';
import { useWorkbenchStatus } from './use-workbench-status';

/** The builder the filter controller wires; the header's ⋯ menu edits its draft. */
const builder = () => document.getElementById('myQueryBuilder') as ProtspaceQueryBuilder | null;

/**
 * The sidebar's Filter panel (design decision 14): in place of the legend, above the structure.
 * It hosts the query builder, a runtime element the filter controller wires by id, so the section
 * renders once and only CSS (`data-panel` on the workbench) shows or hides it. Below 951 px its
 * header starts with the Legend/Filter tabs, which switch panels; on desktop Close returns to the
 * legend and hands focus to the rail's Filter item (CSS hides Close below 951 px).
 *
 * Beside the heading, a label says whether the panel shows the plot's filter ("Applied") or a
 * draft ("2 unapplied changes"); the ⋯ menu adds a group or clears the draft.
 */
export function FilterPanel({
  panel,
  panelFolded,
  tabbed,
}: {
  panel: SidebarPanel;
  panelFolded: boolean;
  tabbed: boolean;
}) {
  const close = useRef<HTMLElement>(null);
  const more = useRef<HTMLElement>(null);
  const menu = useRef<PsMenu>(null);
  const { appliedFilterConditions: applied, unappliedFilterChanges: unapplied } =
    useWorkbenchStatus();

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

  useEffect(() => {
    const element = menu.current;
    if (!element) return;
    element.anchor = more.current;
    const onSelect = (event: Event) => {
      const value = (event as CustomEvent<{ value: string }>).detail.value;
      if (value === 'add-group') builder()?.addGroup();
      if (value === 'clear-all') builder()?.clearAll();
    };
    element.addEventListener('ps-select', onSelect);
    return () => element.removeEventListener('ps-select', onSelect);
  }, []);

  const toggleMenu = () => {
    const element = menu.current;
    if (!element) return;
    // Clear all is off for a draft that is one empty card; read when the menu opens.
    const clear = element.querySelector<HTMLElement & { disabled: boolean }>('[value="clear-all"]');
    if (clear) clear.disabled = !(builder()?.canClearAll ?? false);
    element.open = !element.open;
  };

  const state =
    unapplied > 0
      ? countNoun(unapplied, 'unapplied change', 'unapplied changes')
      : applied > 0
        ? 'Applied'
        : null;

  return (
    <section
      id="wb-filter-panel"
      data-workbench="filter-panel"
      role={tabbed ? 'tabpanel' : 'region'}
      aria-labelledby="wb-filter-title"
    >
      <header className="wb-panel-header">
        <PanelTabs panel={panel} />
        <h2 id="wb-filter-title" className="wb-panel-title" tabIndex={-1}>
          Filter
        </h2>
        {state && (
          <span
            className="wb-filter-state"
            data-state={unapplied > 0 ? 'draft' : 'applied'}
            title={state}
          >
            {state}
          </span>
        )}
        <ps-icon-button
          ref={more}
          className="wb-filter-more"
          icon="ellipsis"
          label="Filter actions"
          onClick={toggleMenu}
        ></ps-icon-button>
        <ps-menu ref={menu} label="Filter actions" placement="bottom-end">
          <ps-menu-item value="add-group">Add group</ps-menu-item>
          <ps-menu-item value="clear-all">Clear all</ps-menu-item>
        </ps-menu>
        <ps-icon-button
          ref={close}
          className="wb-panel-close"
          icon="x"
          label="Close filter"
        ></ps-icon-button>
        <PanelFold folded={panelFolded} />
      </header>
      <div className="wb-filter-body">
        <protspace-query-builder id="myQueryBuilder" embedded></protspace-query-builder>
      </div>
    </section>
  );
}
