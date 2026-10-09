import { Database, Github, MessageSquare } from 'lucide-react';
import { Link } from 'react-router';
import { buildMailto, GITHUB_REPO_URL } from '@/lib/support';
import { HelpMenu } from './HelpMenu';
import { useWorkbenchStatus } from './use-workbench-status';

const FEEDBACK_HREF = buildMailto({ subject: 'ProtSpace feedback' });

/** An example's label reads "name · proteins · size"; the bar shows the name and its own count. */
function shownName(datasetName: string): string {
  return datasetName.split(' · ')[0];
}

function proteinCountText(count: number): string {
  return `· ${count.toLocaleString()} ${count === 1 ? 'protein' : 'proteins'}`;
}

/**
 * The 48 px app bar (design decision 1): the wordmark, the dataset on screen, a centre that search
 * takes in Task 2.9, and the actions. The site's navigation stays on the other pages.
 */
export function AppBar() {
  const { datasetName, proteinCount } = useWorkbenchStatus();
  return (
    <header className="wb-app-bar" data-workbench="app-bar">
      <Link to="/" data-workbench="home" aria-label="ProtSpace home">
        <img src="/wordmark.svg" alt="" />
      </Link>
      <span className="wb-separator" aria-hidden="true" />
      <div data-workbench="dataset" data-dataset-name={datasetName ?? ''}>
        {datasetName !== null && (
          <>
            <Database className="wb-dataset-icon" size={16} strokeWidth={1.75} aria-hidden="true" />
            <span className="wb-dataset-name">{shownName(datasetName)}</span>
          </>
        )}
        {proteinCount !== null && (
          <span className="wb-dataset-count">{proteinCountText(proteinCount)}</span>
        )}
      </div>
      <div data-workbench="app-bar-center" />
      <div data-workbench="app-bar-actions">
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
