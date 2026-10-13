import { html, nothing, type TemplateResult } from 'lit';
import { live } from 'lit/directives/live.js';
import '../kit/button';
import '../kit/menu';
import '../kit/tooltip';
import { icon, type IconName } from '../kit/icon';
import type { LegendSortMode } from './types';

/** What the legend header shows (design decision 12). */
export interface LegendHeaderModel {
  /** The annotation's display name, never its key. */
  title: string;
  predicted: boolean;
  /** The annotation's info popover, when it has docs. */
  info?: TemplateResult;
  sortMode: LegendSortMode;
  isNumeric: boolean;
  hasScores: boolean;
  /** More than one row. With one there is nothing to order, and the sort button hides. */
  canSort: boolean;
}

export interface LegendHeaderHandlers {
  onSortMenu(anchor: HTMLElement): void;
  onSettings(anchor: HTMLElement): void;
  onTitlePointerEnter(e: PointerEvent): void;
}

export interface SortMenuModel {
  open: boolean;
  anchor: HTMLElement | null;
  sortMode: LegendSortMode;
  isNumeric: boolean;
  hasScores: boolean;
}

const SORT_LABELS: Record<LegendSortMode, string> = {
  'size-desc': 'By count, largest first',
  'size-asc': 'By count, smallest first',
  'alpha-asc': 'By name, A to Z',
  'alpha-desc': 'By name, Z to A',
  manual: 'Your order',
  'manual-reverse': 'Your order, reversed',
  'silhouette-desc': 'By separation, best first',
  'silhouette-asc': 'By separation, worst first',
};

const SORT_ICONS: Record<LegendSortMode, IconName> = {
  'size-desc': 'arrow-down-wide-narrow',
  'size-asc': 'arrow-down-narrow-wide',
  'alpha-asc': 'arrow-down-a-z',
  'alpha-desc': 'arrow-down-z-a',
  manual: 'arrow-up-down',
  'manual-reverse': 'arrow-up-down',
  'silhouette-desc': 'arrow-down-wide-narrow',
  'silhouette-asc': 'arrow-down-narrow-wide',
};

const PREDICTED_NOTE = 'Predicted: computational, not experimentally curated';

/** The active order in words: the sort button's name and tooltip ("Sort: By count, largest first"). */
export function sortLabel(mode: LegendSortMode, isNumeric: boolean): string {
  if (isNumeric && mode === 'alpha-asc') return 'By value, low to high';
  if (isNumeric && mode === 'alpha-desc') return 'By value, high to low';
  return SORT_LABELS[mode];
}

/** The sort button's icon: it shows the active order, largest or best first pointing down-wide. */
export function sortIcon(mode: LegendSortMode, isNumeric: boolean): IconName {
  if (isNumeric && mode === 'alpha-asc') return 'arrow-down-0-1';
  if (isNumeric && mode === 'alpha-desc') return 'arrow-down-1-0';
  return SORT_ICONS[mode];
}

/** The radio a mode checks: the mode with its direction dropped. */
function sortBase(mode: LegendSortMode): LegendSortMode {
  if (mode.startsWith('size')) return 'size-desc';
  if (mode.startsWith('alpha')) return 'alpha-asc';
  if (mode.startsWith('silhouette')) return 'silhouette-desc';
  return 'manual';
}

/** "Reverse order" is checked when the mode runs against its base's direction. */
function isReversed(mode: LegendSortMode): boolean {
  return (
    mode === 'size-asc' ||
    mode === 'alpha-desc' ||
    mode === 'manual-reverse' ||
    mode === 'silhouette-asc'
  );
}

/**
 * The 44 px legend header: title, predicted mark, info, then sort and settings. The title is
 * one line ending in an ellipsis; the legend's shared name tooltip shows it in full.
 */
export function renderLegendHeader(
  model: LegendHeaderModel,
  handlers: LegendHeaderHandlers,
): TemplateResult {
  const sortName = `Sort: ${sortLabel(model.sortMode, model.isNumeric)}`;
  // aria-haspopup and aria-expanded are static: the sort menu exists only while open, and
  // ps-menu records these closed-state values when it mounts and restores them when it goes.
  return html`<div class="legend-header" part="header">
    <h3 class="legend-title" @pointerenter=${handlers.onTitlePointerEnter}>${model.title}</h3>
    ${model.predicted
      ? html`<span class="legend-predicted" role="img" aria-label="Predicted annotation"
            >${icon('sparkles', 14)}</span
          ><ps-tooltip text=${PREDICTED_NOTE}></ps-tooltip>`
      : nothing}
    ${model.info ?? nothing}
    <span class="legend-header-spacer"></span>
    <ps-icon-button
      class="sort-button"
      icon=${sortIcon(model.sortMode, model.isNumeric)}
      label=${sortName}
      size="sm"
      aria-haspopup="menu"
      aria-expanded="false"
      ?hidden=${!model.canSort}
      @click=${(e: Event) => handlers.onSortMenu(e.currentTarget as HTMLElement)}
    ></ps-icon-button>
    <ps-icon-button
      class="settings-button"
      icon="sliders-horizontal"
      label="Legend settings"
      size="sm"
      @click=${(e: Event) => handlers.onSettings(e.currentTarget as HTMLElement)}
    ></ps-icon-button>
  </div>`;
}

/**
 * The sort menu, rendered only while open. A radio pick applies its order; "Reverse order" is a
 * checkbox, so the menu stays open and shows the new direction.
 */
export function renderSortMenu(
  model: SortMenuModel,
  handlers: { onPick(mode: LegendSortMode): void; onReverse(): void; onClose(): void },
): TemplateResult {
  if (!model.open || !model.anchor) return html``;
  const base = sortBase(model.sortMode);
  const showSeparation = !model.isNumeric && (model.hasScores || base === 'silhouette-desc');
  const radio = (value: LegendSortMode, label: string) =>
    html`<ps-menu-item type="radio" value=${value} .checked=${live(base === value)}
      >${label}</ps-menu-item
    >`;
  const onSelect = (e: Event) => {
    const { value } = (e as CustomEvent<{ value: string }>).detail;
    if (value === 'reverse') handlers.onReverse();
    // A re-pick of the checked radio keeps the order, direction included (phase 2 ruling M1).
    else if (value !== base) handlers.onPick(value as LegendSortMode);
  };
  return html`<ps-menu
    class="sort-menu"
    label="Sort legend"
    placement="bottom-end"
    .anchor=${model.anchor}
    .open=${true}
    @ps-select=${onSelect}
    @ps-close=${handlers.onClose}
  >
    <ps-menu-group label="Sort by">
      ${model.isNumeric ? nothing : radio('size-desc', 'By count')}
      ${radio('alpha-asc', model.isNumeric ? 'By value' : 'By name')}
      ${showSeparation ? radio('silhouette-desc', 'By separation') : nothing}
      ${radio('manual', 'Your order')}
    </ps-menu-group>
    <ps-menu-item type="checkbox" value="reverse" .checked=${live(isReversed(model.sortMode))}
      >Reverse order</ps-menu-item
    >
  </ps-menu>`;
}
