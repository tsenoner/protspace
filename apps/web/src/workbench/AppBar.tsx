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
import { ChevronDown, Database, Download, Github, Image as ImageIcon, Upload } from 'lucide-react';
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
import { useMediaQuery } from './use-media-query';
import { useWorkbenchStatus } from './use-workbench-status';

/** A tablet's bar leaves search about 160 px, too little for "Search proteins or paste IDs". */
const TABLET_SEARCH_PLACEHOLDER = 'Search or paste IDs';

/**
 * Below 800 px a tablet's bar leaves search too little room for even that placeholder beside the
 * dataset name and the actions: search folds into the phone's search button, which opens it over
 * the bar. At 800 px a touch tablet's search still shows the placeholder whole.
 */
const NARROW_TABLET_QUERY = '(max-width: 799px)';

/**
 * Below 1200 px Export and the figure editor are icons, as on a tablet: their labels and the
 * dataset's count would leave search less than its 200 px on a narrow desktop window.
 */
const ICON_TASKS_QUERY = '(max-width: 1199px)';

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
 * marks it as the panel's disclosure button and returns focus to it on close. With nothing loaded
 * the same button reads "Import".
 */
function toggleImportMenu(event: MouseEvent<HTMLButtonElement>): void {
  (document.getElementById('myImportMenu') as ProtspaceImportMenu | null)?.toggleFrom(
    event.currentTarget,
  );
}

/** The app bar's Export button opens the Export panel under itself, or closes it again. */
function toggleExportMenu(event: MouseEvent<HTMLElement>): void {
  (document.getElementById('myExportMenu') as ProtspaceExportMenu | null)?.toggleFrom(
    event.currentTarget,
    'bottom-end',
  );
}

/**
 * The runtime's Import and Export panels, without buttons of their own: the dataset name opens the
 * Import panel and the Export button the Export panel (the More sheet opens both on a phone).
 * Memoised and without props, so a status change never re-renders them; the runtime finds them
 * by id.
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
 * Export, the bar's other task beside the figure editor (the dataset name imports): labelled with
 * a chevron on a wide desktop, a download icon with a small chevron below 1200 px, whose tooltip
 * names it. The chevron says it opens a panel rather than downloading at once. With nothing
 * loaded it stays in the bar and in the Tab order, greyed through aria-disabled, and its tooltip
 * says why. On a phone More's Export row takes over.
 */
function ExportButton({ iconOnly, disabled }: { iconOnly: boolean; disabled: boolean }) {
  const tooltip = disabled ? 'Load a dataset to export' : iconOnly ? 'Export' : null;
  return (
    <>
      <ps-button
        className="wb-export"
        data-driver-id="export"
        data-icon-only={iconOnly ? '' : undefined}
        variant={iconOnly ? 'ghost' : 'secondary'}
        // Attributes, not the hasPopup/expanded properties: the Export panel marks this button as
        // its disclosure button while open and restores the attributes it found.
        aria-haspopup="dialog"
        aria-expanded="false"
        disabled={disabled}
        focusableWhenDisabled
        onClick={toggleExportMenu}
      >
        <span slot="start" className="wb-icon" aria-hidden="true">
          <Download size={16} strokeWidth={1.75} />
        </span>
        <span className={iconOnly ? 'sr-only' : undefined}>Export</span>
        <span slot="end" className="wb-icon wb-export-chevron" aria-hidden="true">
          <ChevronDown size={iconOnly ? 12 : 14} strokeWidth={1.75} />
        </span>
      </ps-button>
      {/* The icon shows no label, so the tooltip names it; off, the tooltip says why. */}
      {tooltip !== null && <ps-tooltip text={tooltip} namesTarget={!disabled}></ps-tooltip>}
    </>
  );
}

/**
 * The figure editor, one of ProtSpace's main tools, has a button of its own rather than a place
 * in the Export panel: labelled on a wide desktop, an icon whose tooltip names it below 1200 px,
 * where the bar has less room. On a phone the actions leave the bar and More's Figure editor row
 * takes over.
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
 * actions move into the view bar's More sheet, and their menus stay mounted here, unseen. A tablet
 * narrower than 800 px keeps its actions and takes the phone's search button instead of the field.
 */
export function AppBar() {
  const { datasetName, proteinCount, datasetPhase } = useWorkbenchStatus();
  const layoutMode = useLayoutMode();
  const narrowTablet = useMediaQuery(NARROW_TABLET_QUERY) && layoutMode === 'tablet';
  const iconTasks = useMediaQuery(ICON_TASKS_QUERY);
  // A phone, either way up, and a narrow tablet show a search button rather than the field.
  const compact = hasStructureSheet(layoutMode) || narrowTablet;
  const [searchWanted, setSearchWanted] = useState(false);
  const searchOpen = compact && searchWanted;
  const noDataset = datasetName === null;
  // Once startup has ended with nothing on screen, the dataset's place reads Import, also while a
  // load started from there runs (the startup load itself shows nothing there).
  const [importOffered, setImportOffered] = useState(false);
  if (datasetPhase === 'empty' && !importOffered) setImportOffered(true);
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
      data-search-folded={compact ? '' : undefined}
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
          aria-label={noDataset ? undefined : datasetButtonLabel(datasetName, proteinCount)}
          hidden={noDataset && !importOffered}
          onClick={toggleImportMenu}
        >
          {noDataset ? (
            <Upload className="wb-dataset-icon" size={16} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <Database className="wb-dataset-icon" size={16} strokeWidth={1.75} aria-hidden="true" />
          )}
          <span className="wb-dataset-name">{noDataset ? 'Import' : shownName(datasetName)}</span>
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
      {/* Before the actions: where it shows (a phone, a narrow tablet) it sits where search was. */}
      <SearchToggle ref={toggleRef} open={searchOpen} onOpen={openSearch} />
      <div data-workbench="app-bar-actions">
        <DataActions />
        {/* The two tasks, Export and the figure editor, then past a divider the theme switch, Help,
            Feedback and GitHub, where Home and the docs have them; the dataset name imports. */}
        <ExportButton iconOnly={iconTasks} disabled={noDataset} />
        <FigureEditorButton iconOnly={iconTasks} />
        <span className="wb-actions-sep" aria-hidden="true" />
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
    </header>
  );
}
