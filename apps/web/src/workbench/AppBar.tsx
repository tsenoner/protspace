import { memo, type MouseEvent } from 'react';
import { ChevronDown, Database, Github, MessageSquare } from 'lucide-react';
import { Link } from 'react-router';
import type { ProtspaceImportMenu } from '@protspace/core';
import { countNoun } from '@protspace/utils';
import { buildMailto, GITHUB_REPO_URL } from '@/lib/support';
import { HelpMenu } from './HelpMenu';
import { useWorkbenchStatus } from './use-workbench-status';

const FEEDBACK_HREF = buildMailto({ subject: 'ProtSpace feedback' });

/** An example's label reads "name · proteins · size"; the bar shows the name and its own count. */
function shownName(datasetName: string): string {
  return datasetName.split(' · ')[0];
}

function proteinsText(count: number): string {
  return countNoun(count, 'protein', 'proteins');
}

/**
 * The dataset button's name starts with what it shows, the name and the count (WCAG 2.5.3, so a
 * spoken "click {name}" finds it), then says what it does.
 */
function datasetButtonLabel(datasetName: string, count: number | null): string {
  return [shownName(datasetName), count === null ? null : proteinsText(count), 'switch dataset']
    .filter(Boolean)
    .join(', ');
}

/**
 * The dataset name opens the shared Import panel under itself (design decision 1): the import menu
 * marks it as the panel's disclosure button and returns focus to it on close.
 */
function toggleImportMenu(event: MouseEvent<HTMLButtonElement>): void {
  (document.getElementById('myImportMenu') as ProtspaceImportMenu | null)?.toggleFrom(
    event.currentTarget,
  );
}

/**
 * The runtime's Import and Export menus. Memoised and without props, so a status change never
 * re-renders them; the runtime finds them by id.
 */
const DataActions = memo(function DataActions() {
  return (
    <div className="wb-data-actions" data-driver-id="data-actions">
      <protspace-import-menu id="myImportMenu" data-driver-id="import"></protspace-import-menu>
      <protspace-export-menu id="myExportMenu"></protspace-export-menu>
    </div>
  );
});

/**
 * The 48 px app bar (design decision 1): the wordmark and the dataset on screen, search in the
 * centre, and the actions. The site's navigation stays on the other pages.
 */
export function AppBar() {
  const { datasetName, proteinCount } = useWorkbenchStatus();
  return (
    <header className="wb-app-bar" data-workbench="app-bar">
      <div className="wb-app-bar-start" data-workbench="app-bar-start">
        <Link to="/" data-workbench="home" aria-label="ProtSpace home">
          <img src="/wordmark.svg" alt="" />
        </Link>
        <span className="wb-separator" aria-hidden="true" />
        <button
          type="button"
          className="wb-dataset"
          data-workbench="dataset"
          data-dataset-name={datasetName ?? ''}
          aria-haspopup="dialog"
          aria-label={
            datasetName === null ? undefined : datasetButtonLabel(datasetName, proteinCount)
          }
          hidden={datasetName === null}
          onClick={toggleImportMenu}
        >
          <Database className="wb-dataset-icon" size={16} strokeWidth={1.75} aria-hidden="true" />
          {datasetName !== null && (
            <span className="wb-dataset-name">{shownName(datasetName)}</span>
          )}
          {proteinCount !== null && (
            <span className="wb-dataset-count">· {proteinsText(proteinCount)}</span>
          )}
          <ChevronDown
            className="wb-dataset-chevron"
            size={14}
            strokeWidth={1.75}
            aria-hidden="true"
          />
        </button>
        {/* The full label over the name, which truncates at 200 px; anchored to the button. */}
        {datasetName !== null && <ps-tooltip text={datasetName}></ps-tooltip>}
      </div>
      <div data-workbench="app-bar-center">
        <protspace-protein-search
          id="myProteinSearch"
          data-driver-id="search"
        ></protspace-protein-search>
      </div>
      <div data-workbench="app-bar-actions">
        <DataActions />
        <span className="wb-separator" aria-hidden="true" />
        <HelpMenu />
        <a className="wb-icon-link" href={FEEDBACK_HREF} aria-label="Feedback">
          <MessageSquare size={16} strokeWidth={1.75} aria-hidden="true" />
        </a>
        <ps-tooltip text="Feedback" namesTarget></ps-tooltip>
        <a
          className="wb-icon-link"
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub"
        >
          <Github size={16} strokeWidth={1.75} aria-hidden="true" />
        </a>
        <ps-tooltip text="GitHub" namesTarget></ps-tooltip>
      </div>
    </header>
  );
}
