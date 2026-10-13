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

function line(text: string): TemplateResult {
  return html`<div class="search-report" role="status">
    <p class="search-report-line">${text}</p>
  </div>`;
}

/**
 * The report in the search's popup. A pasted list's missing IDs are listed up to
 * `REPORT_MISSING_LIMIT`, so 10,000 unknown IDs draw 50 rows; Copy takes all of them.
 */
export function renderSearchReport(report: SearchReport, onCopy: () => void): TemplateResult {
  switch (report.kind) {
    case 'missing-one':
      return line(`No protein ${report.id} in this dataset`);
    case 'already-selected':
      return line(`${report.id} is already selected`);
    case 'not-in-view':
      return line(`${report.id} is selected but hidden in this view`);
    case 'bulk': {
      const shown = report.missing.slice(0, REPORT_MISSING_LIMIT);
      const more = report.missing.length - shown.length;
      return html`<div class="search-report" role="status">
        <p class="search-report-line">
          ${formatCount(report.found)} of ${formatCount(report.total)} found
        </p>
        ${report.missing.length > 0
          ? html`<p class="search-report-heading" id="search-report-missing">Not found</p>
              <ul class="search-report-missing" aria-labelledby="search-report-missing">
                ${shown.map((id) => html`<li>${id}</li>`)}
              </ul>
              ${more > 0
                ? html`<p class="search-report-more">and ${formatCount(more)} more</p>`
                : nothing}
              <ps-button class="search-report-copy" size="sm" variant="ghost" @click=${onCopy}
                ><span slot="start">${icon('copy', 14)}</span>Copy missing IDs</ps-button
              >`
          : nothing}
      </div>`;
    }
  }
}
