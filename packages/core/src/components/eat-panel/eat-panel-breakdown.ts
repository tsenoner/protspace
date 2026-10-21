import { html, nothing, type TemplateResult } from 'lit';
import {
  annotationLabel,
  formatCount,
  getEatNeighborBaseKey,
  hasEatPredictionsForAnnotation,
  LEGEND_VALUES,
  type VisualizationData,
} from '@protspace/utils';
import type { PsSelect, SelectOption } from '../kit/select';
import '../kit/select';
import { formatPercent } from '../query-builder/eat-reliability';
import { getEatIndex, type EatIndex, type EatLabelRow } from './eat-summary';

export type EatLabelSort = 'most-predicted' | 'least-reliable' | 'name';

const SORT_OPTIONS: SelectOption[] = [
  { value: 'most-predicted', label: 'Most predicted' },
  { value: 'least-reliable', label: 'Least reliable' },
  { value: 'name', label: 'Name' },
];

/** A label's swatch colour; a label folded into the legend's Other bucket takes Other's. */
export function swatchColor(
  colors: ReadonlyMap<string, string>,
  label: string,
): string | undefined {
  return colors.get(label) ?? colors.get(LEGEND_VALUES.OTHER);
}

/** A label row's hint when every member in view is curated. */
const NO_PREDICTIONS = 'No predictions in view';

/** Rows shown before "Show all". */
const COLLAPSED_ROWS = 8;
/** Above this share of predicted members a label is mostly borrowed, and its share turns amber. */
const AMBER_SHARE = 0.8;

const byName = (a: EatLabelRow, b: EatLabelRow) => a.label.localeCompare(b.label);

/** The rows in `sort` order, ties by name. A label with no prediction sorts last by reliability. */
function sortLabelRows(rows: readonly EatLabelRow[], sort: EatLabelSort): EatLabelRow[] {
  const sorted = [...rows];
  if (sort === 'name') return sorted.sort(byName);
  if (sort === 'least-reliable') {
    return sorted.sort((a, b) => {
      const am = a.medianReliability ?? Infinity;
      const bm = b.medianReliability ?? Infinity;
      return am !== bm ? am - bm : byName(a, b);
    });
  }
  return sorted.sort((a, b) => b.kept + b.below - (a.kept + a.below) || byName(a, b));
}

interface EatBreakdownView {
  rows: readonly EatLabelRow[];
  sort: EatLabelSort;
  showAll: boolean;
  labelColors: ReadonlyMap<string, string>;
  /** Show off: the section is greyed; its rows and lists keep working. */
  off: boolean;
  /** The label whose drill-down list is open, and that list, rendered under its row. */
  openLabel: string | null;
  list: TemplateResult | typeof nothing;
  onSort(sort: EatLabelSort): void;
  onShowAll(): void;
  /** A row was clicked: open its list, or close it when it is the open one. */
  onRow(label: string): void;
}

function labelBar(row: EatLabelRow, widest: number): TemplateResult {
  const part = (name: string, count: number) =>
    count > 0
      ? html`<span class="eat-segment" data-part=${name} style=${`flex-grow:${count}`}></span>`
      : nothing;
  return html`<span class="eat-label-track" aria-hidden="true">
    <span
      class="eat-label-bar"
      style=${`width:${Number(((row.total / widest) * 100).toFixed(2))}%`}
    >
      ${part('curated', row.curated)} ${part('kept', row.kept)} ${part('below', row.below)}
    </span>
  </span>`;
}

/**
 * `By label` (proposal B §4.6): one row per label in the view, with its swatch, a bar of curated,
 * kept and below-threshold members relative to the largest label, the total and the predicted
 * share. A row click opens the label's drill-down list under it.
 */
export function renderBreakdown(view: EatBreakdownView): TemplateResult | typeof nothing {
  if (view.rows.length === 0) return nothing;
  const sorted = sortLabelRows(view.rows, view.sort);
  const shown = view.showAll ? sorted : sorted.slice(0, COLLAPSED_ROWS);
  const widest = Math.max(...view.rows.map((row) => row.total));
  // Show off greys the section, but its rows, Sort and lists keep working: not aria-disabled.
  return html`<section
    class=${view.off ? 'eat-breakdown is-off' : 'eat-breakdown'}
    aria-label="By label"
  >
    <div class="eat-breakdown-head">
      <h4 class="eat-heading">By label</h4>
      <ps-select
        size="sm"
        label="Sort labels"
        .options=${SORT_OPTIONS}
        .value=${view.sort}
        @change=${(event: Event) =>
          view.onSort((event.currentTarget as PsSelect).value as EatLabelSort)}
      ></ps-select>
    </div>
    <ul class="eat-label-list">
      ${shown.map((row) => {
        const share = formatPercent(row.predictedShare);
        const color = swatchColor(view.labelColors, row.label);
        const open = view.openLabel === row.label;
        // Only curated members in view: nothing to list, so the row opens nothing.
        const noPredictions = row.kept + row.below === 0;
        return html`<li>
          <button
            type="button"
            class="eat-label-row"
            data-label=${row.label}
            ?disabled=${noPredictions}
            title=${noPredictions ? NO_PREDICTIONS : nothing}
            aria-expanded=${noPredictions ? nothing : String(open)}
            aria-controls=${open ? 'eat-drill' : nothing}
            @click=${() => view.onRow(row.label)}
            aria-label=${`${row.label}: ${formatCount(row.total)}, ${share} predicted${noPredictions ? `, ${NO_PREDICTIONS.toLowerCase()}` : ''}`}
          >
            <span
              class="eat-swatch"
              style=${color ? `background:${color}` : nothing}
              aria-hidden="true"
            ></span>
            <span class="eat-label-name" title=${row.label}>${row.label}</span>
            ${labelBar(row, widest)}
            <span class="eat-label-total">${formatCount(row.total)}</span>
            <span
              class=${row.predictedShare > AMBER_SHARE
                ? 'eat-label-share is-mostly-predicted'
                : 'eat-label-share'}
              >${share}</span
            >
          </button>
          ${open ? view.list : nothing}
        </li>`;
      })}
    </ul>
    ${!view.showAll && sorted.length > COLLAPSED_ROWS
      ? html`<button type="button" class="eat-show-all" @click=${view.onShowAll}>
          Show all ${formatCount(sorted.length)} labels
        </button>`
      : nothing}
  </section>`;
}

const curatedCounts = new WeakMap<EatIndex, number>();

/** Predicted proteins among those with a value (curated or predicted), over the whole dataset. */
function predictedShareOf(index: EatIndex): number {
  let curated = curatedCounts.get(index);
  if (curated === undefined) {
    curated = 0;
    for (let p = 0; p < index.total; p++) curated += index.curated[p];
    curatedCounts.set(index, curated);
  }
  const predicted = index.order.length;
  return predicted / (predicted + curated);
}

/**
 * The categorical annotations other than `annotation` that carry predictions. Stops at each
 * column's first predicted cell, so listing them builds no index.
 */
function otherEatAnnotations(data: VisualizationData, annotation: string): string[] {
  return Object.keys(data.annotation_predicted ?? {}).filter(
    (key) =>
      key !== annotation &&
      data.annotations[key]?.kind === 'categorical' &&
      hasEatPredictionsForAnnotation(data, key),
  );
}

/** The `<annotation>__neighbor` column describing `annotation`, if the dataset has one. */
function neighbourColumn(data: VisualizationData, annotation: string): string | null {
  return (
    Object.keys(data.annotations).find((key) => getEatNeighborBaseKey(key) === annotation) ?? null
  );
}

/**
 * One row that switches Color by to `key`, with its predicted share: `Toxin family · 58 %
 * predicted` in the disclosure, `Color by Toxin family  58 %` in the empty state.
 */
function colorByRow(
  data: VisualizationData,
  key: string,
  onColorBy: (annotation: string) => void,
  inEmptyState: boolean,
): TemplateResult {
  const label = annotationLabel(key, data.annotations[key]);
  const index = getEatIndex(data, key);
  const share = index ? formatPercent(predictedShareOf(index)) : null;
  return html`<li>
    <button
      type="button"
      class="eat-color-by"
      data-annotation=${key}
      aria-label=${`Color by ${label}${share ? `, ${share} predicted` : ''}`}
      @click=${() => onColorBy(key)}
    >
      <span class="eat-color-by-name">${inEmptyState ? `Color by ${label}` : label}</span>
      ${share
        ? html`<span class="eat-color-by-share"
            >${inEmptyState ? share : `· ${share} predicted`}</span
          >`
        : nothing}
      <span class="eat-chevron" aria-hidden="true">›</span>
    </button>
  </li>`;
}

interface EatOthersView {
  data: VisualizationData;
  annotation: string;
  open: boolean;
  onToggle(open: boolean): void;
  onColorBy(annotation: string): void;
}

/**
 * `Other annotations with predictions (2)` (proposal B §4.7), collapsed; its rows build their
 * annotations' indices only once it opens. The `<annotation> — EAT neighbourhood` link sits under
 * it whenever that column exists, even with no other annotation to list.
 */
export function renderOtherAnnotations(view: EatOthersView): TemplateResult | typeof nothing {
  const { data, annotation, onColorBy } = view;
  const others = otherEatAnnotations(data, annotation);
  const neighbour = neighbourColumn(data, annotation);
  if (others.length === 0 && !neighbour) return nothing;
  const neighbourLabel = neighbour ? annotationLabel(neighbour, data.annotations[neighbour]) : '';
  return html`${others.length > 0
    ? html`<details
        class="eat-others"
        ?open=${view.open}
        @toggle=${(event: Event) => view.onToggle((event.currentTarget as HTMLDetailsElement).open)}
      >
        <summary>Other annotations with predictions (${others.length})</summary>
        ${view.open
          ? html`<ul class="eat-color-by-list">
              ${others.map((key) => colorByRow(data, key, onColorBy, false))}
            </ul>`
          : nothing}
      </details>`
    : nothing}
  ${neighbour
    ? html`<button
        type="button"
        class="eat-color-by eat-neighbour"
        data-annotation=${neighbour}
        aria-label=${`Color by ${neighbourLabel}`}
        @click=${() => onColorBy(neighbour)}
      >
        <span class="eat-color-by-name">Color by ${neighbourLabel}</span>
        <span class="eat-chevron" aria-hidden="true">›</span>
      </button>`
    : nothing}`;
}

/** The empty state's list: every annotation with predictions, as `Color by <label>  61 % ›`. */
export function renderEmptyColorBy(
  data: VisualizationData,
  annotation: string,
  onColorBy: (annotation: string) => void,
): TemplateResult | typeof nothing {
  const others = otherEatAnnotations(data, annotation);
  if (others.length === 0) return nothing;
  return html`<ul class="eat-color-by-list">
    ${others.map((key) => colorByRow(data, key, onColorBy, true))}
  </ul>`;
}
