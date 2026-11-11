import { html, nothing, type TemplateResult } from 'lit';
import { formatCount } from '@protspace/utils';
import { icon } from '../kit/icon';
import { REPORT_MISSING_LIMIT } from './resolve-ids';

/** What the search says under its field after an Enter, a paste or a hidden hit (decision 15). */
export type SearchReport =
  | { kind: 'missing-one'; id: string }
  | { kind: 'already-selected'; id: string }
  | { kind: 'not-in-view'; id: string }
  | { kind: 'bulk'; found: number; total: number; missing: readonly string[] };

/** What the Copy button says: its label, or the outcome of the last copy for a moment. */
export type CopyState = 'idle' | 'copied' | 'failed';

const COPY_LABEL: Record<CopyState, string> = {
  idle: 'Copy missing IDs',
  copied: 'Copied',
  failed: 'Could not copy',
};

/** The copy outcome a screen reader hears; nothing while the button shows its own label. */
export function copyAnnouncement(state: CopyState): string {
  return state === 'idle' ? '' : COPY_LABEL[state];
}

/** The report's first line, which the visible report shows. */
function headline(report: SearchReport): string {
  switch (report.kind) {
    case 'missing-one':
      return `No protein ${report.id} in this dataset`;
    case 'already-selected':
      return `${report.id} is already selected`;
    case 'not-in-view':
      return `${report.id} is selected but hidden in this view`;
    case 'bulk':
      return `${formatCount(report.found)} of ${formatCount(report.total)} found`;
  }
}

/**
 * The one sentence the search's live region announces for a report: the headline, plus the
 * missing count for a pasted list, never the list itself.
 */
export function reportSummary(report: SearchReport): string {
  const text = headline(report);
  if (report.kind !== 'bulk' || report.missing.length === 0) return text;
  return `${text}, ${formatCount(report.missing.length)} not found`;
}

/**
 * The report in the search's popup. A pasted list's missing IDs are listed up to
 * `REPORT_MISSING_LIMIT`, so 10,000 unknown IDs draw 50 rows; Copy takes all of them. It is not
 * a live region: the search announces `reportSummary` from one that is always rendered.
 */
export function renderSearchReport(
  report: SearchReport,
  onCopy: () => void,
  copyState: CopyState = 'idle',
): TemplateResult {
  const line = html`<p class="search-report-line">${headline(report)}</p>`;
  if (report.kind !== 'bulk') return html`<div class="search-report">${line}</div>`;
  const shown = report.missing.slice(0, REPORT_MISSING_LIMIT);
  const more = report.missing.length - shown.length;
  return html`<div class="search-report">
    ${line}
    ${report.missing.length > 0
      ? html`<p class="search-report-heading" id="search-report-missing">Not found</p>
          <ul class="search-report-missing" aria-labelledby="search-report-missing">
            ${shown.map((id) => html`<li>${id}</li>`)}
          </ul>
          ${more > 0
            ? html`<p class="search-report-more">and ${formatCount(more)} more</p>`
            : nothing}
          <ps-button class="search-report-copy" size="sm" variant="ghost" @click=${onCopy}
            ><span slot="start">${icon('copy', 14)}</span>${COPY_LABEL[copyState]}</ps-button
          >`
      : nothing}
  </div>`;
}
