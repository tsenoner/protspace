import {
  memo,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { flushSync } from 'react-dom';
import { ChevronDown, Database, Github, Image as ImageIcon } from 'lucide-react';
import { Link } from 'react-router';
import type {
  ProtspaceExportMenu,
  ProtspaceImportMenu,
  ProtspaceProteinSearch,
} from '@protspace/core';
import { countNoun } from '@protspace/utils';
import { GITHUB_REPO_URL } from '@/lib/support';
import { hasStructureSheet } from '../explore/layout-mode';
import { openFigureEditor } from './figure-editor-action';
import { FeedbackMenu } from './FeedbackMenu';
import { HelpMenu } from './HelpMenu';
import { SearchToggle } from './SearchToggle';
import { ThemeToggle } from './ThemeToggle';
import { useAppBarSides } from './use-app-bar-sides';
import { useLayoutMode } from './use-layout-mode';
import { useWorkbenchStatus } from './use-workbench-status';

/** A tablet's bar leaves search about 160 px, too little for "Search proteins or paste IDs". */
const TABLET_SEARCH_PLACEHOLDER = 'Search or paste IDs';

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
 * The runtime's Import and Export panels, without buttons of their own: the dataset name opens the
 * Import panel, and its "Export…" opens the Export panel under the same name (the More sheet opens
 * both on a phone). Memoised and without props, so a status change never re-renders them; the
 * runtime finds them by id.
 */
const DataActions = memo(function DataActions() {
  const importMenu = useRef<ProtspaceImportMenu>(null);
  useEffect(() => {
    const panel = importMenu.current;
    if (!panel) return;
    const openExport = (event: Event) => {
      const { anchor } = (event as CustomEvent<{ anchor: HTMLElement }>).detail;
      (document.getElementById('myExportMenu') as ProtspaceExportMenu | null)?.openFrom(
        anchor,
        'bottom-start',
      );
    };
    panel.addEventListener('open-export-menu', openExport);
    return () => panel.removeEventListener('open-export-menu', openExport);
  }, []);
  return (
    <div className="wb-data-actions" data-driver-id="data-actions">
      <protspace-import-menu
        ref={importMenu}
        id="myImportMenu"
        data-driver-id="import"
        exportable=""
      ></protspace-import-menu>
      <protspace-export-menu id="myExportMenu"></protspace-export-menu>
    </div>
  );
});

/**
 * The figure editor, one of ProtSpace's main tools, has a button of its own rather than a place
 * in the Export panel: labelled on a desktop, an icon whose tooltip names it on a tablet, where
 * the bar has less room. On a phone the actions leave the bar and More's Figure editor row takes
 * over.
 */
function FigureEditorButton({ iconOnly }: { iconOnly: boolean }) {
  return iconOnly ? (
    <ps-icon-button
      data-driver-id="figure-editor"
      icon="image"
      label="Figure editor"
      onClick={openFigureEditor}
    ></ps-icon-button>
  ) : (
    <ps-button data-driver-id="figure-editor" variant="secondary" onClick={openFigureEditor}>
      <span slot="start" className="wb-icon" aria-hidden="true">
        <ImageIcon size={16} strokeWidth={1.75} />
      </span>
      Figure editor
    </ps-button>
  );
}

/**
 * The 48 px app bar (design decision 1): the wordmark and the dataset on screen, search in the
 * centre, and the actions. The site's navigation stays on the other pages. On a phone (decision
 * 17) it keeps the wordmark, the dataset and a search button that shows search over the bar; the
 * actions move into the view bar's More sheet, and their menus stay mounted here, unseen.
 */
export function AppBar() {
  const { datasetName, proteinCount } = useWorkbenchStatus();
  const layoutMode = useLayoutMode();
  const compact = hasStructureSheet(layoutMode);
  const [searchWanted, setSearchWanted] = useState(false);
  const searchOpen = compact && searchWanted;
  const barRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLElement>(null);
  const centerRef = useRef<HTMLDivElement>(null);
  useAppBarSides(barRef);

  // Wider, search sits in the bar again; the next phone layout starts with it closed.
  useEffect(() => {
    if (!compact) setSearchWanted(false);
  }, [compact]);

  const openSearch = () => {
    // Commit first: the field is display: none until the bar shows it.
    flushSync(() => setSearchWanted(true));
    (document.getElementById('myProteinSearch') as ProtspaceProteinSearch | null)?.focusInput();
  };
  const closeSearch = (returnFocus: boolean) => {
    setSearchWanted(false);
    if (returnFocus) toggleRef.current?.focus();
  };
  // Ctrl/⌘K on a phone. Closed, the field is display: none, so the search's own shortcut focuses
  // nothing: open search as the search button does, which shows the field and focuses it. Wider,
  // or with search open, the search's own handler is enough and this listener is gone. A modal
  // dialog or the loading overlay leaves the bar inert: the field takes no focus, and search
  // closes again rather than stay open behind it with nothing to close it.
  useEffect(() => {
    if (!compact || searchOpen) return;
    const onShortcut = (event: globalThis.KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== 'k' || event.isComposing) return;
      event.preventDefault();
      openSearch();
      if (!centerRef.current?.matches(':focus-within')) setSearchWanted(false);
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, [compact, searchOpen]);
  // An Escape nothing else took: the suggestion list and the report are layers, which take theirs
  // first. Default-prevented here, so the selection's Escape fallback does not run as well.
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!searchOpen || event.key !== 'Escape') return;
    if (event.nativeEvent.defaultPrevented || event.nativeEvent.isComposing) return;
    event.preventDefault();
    closeSearch(true);
  };
  // Search stays open while focus is inside the overlay (the search's shadow root, Close search) or
  // the window is blurred (switching apps leaves focus on the field). Focus anywhere else closes it,
  // including the bar's own controls, which sit under the overlay.
  const onBlur = (event: FocusEvent<HTMLElement>) => {
    if (!searchOpen || !document.hasFocus()) return;
    const next = event.relatedTarget as Node | null;
    if (next && centerRef.current?.contains(next)) return;
    closeSearch(false);
  };

  return (
    <header
      ref={barRef}
      className="wb-app-bar"
      data-workbench="app-bar"
      data-search-open={searchOpen ? '' : undefined}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    >
      <div className="wb-app-bar-start" data-workbench="app-bar-start">
        <Link to="/" data-workbench="home" aria-label="ProtSpace home">
          <img src="/wordmark.svg" alt="" />
        </Link>
        <span className="wb-separator" aria-hidden="true" />
        <button
          type="button"
          className="wb-dataset"
          data-workbench="dataset"
          data-driver-id="dataset"
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
      <div ref={centerRef} data-workbench="app-bar-center">
        <protspace-protein-search
          id="myProteinSearch"
          data-driver-id="search"
          placeholder={layoutMode === 'tablet' ? TABLET_SEARCH_PLACEHOLDER : undefined}
        ></protspace-protein-search>
        {/* Phones only (workbench.css): search shows over the bar until this closes it. */}
        <ps-icon-button
          className="wb-search-close"
          icon="x"
          label="Close search"
          onClick={() => closeSearch(true)}
        ></ps-icon-button>
      </div>
      <div data-workbench="app-bar-actions">
        <DataActions />
        {/* The figure editor, the theme switch, Help, Feedback, GitHub; Import and Export live in
            the dataset menu. */}
        <FigureEditorButton iconOnly={layoutMode === 'tablet'} />
        <ThemeToggle />
        <HelpMenu />
        <FeedbackMenu />
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
      <SearchToggle ref={toggleRef} open={searchOpen} onOpen={openSearch} />
    </header>
  );
}
