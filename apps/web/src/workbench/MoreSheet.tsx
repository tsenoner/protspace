import type {
  ProtspaceContoursMenu,
  ProtspaceExportMenu,
  ProtspaceImportMenu,
  PsDialog,
} from '@protspace/core';
import {
  countNoun,
  DENSITY_LAYER_MODES,
  DENSITY_MODE_LABELS,
  type DensityLayerMode,
} from '@protspace/utils';
import {
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Download,
  Filter,
  Layers,
  MessageSquare,
  Sun,
  Upload,
} from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { FEEDBACK_HREF } from '@/lib/support';
import { focusFilterTitle, openPanel } from '../explore/layout-state';
import { THEME_CHOICES, THEME_LABELS, type ThemeChoice } from '../explore/theme-defaults';
import { setTheme } from '../explore/theme-state';
import { openDocumentation, startTour } from './help-actions';
import { ShortcutsDialog } from './ShortcutsDialog';
import { useTheme } from './use-theme';
import { useWorkbenchStatus } from './use-workbench-status';

/** The contour modes as the segmented control offers them, named as the Contours menu names them. */
const CONTOUR_OPTIONS = DENSITY_LAYER_MODES.map((mode) => ({
  value: mode,
  label: DENSITY_MODE_LABELS[mode].label,
}));

/** The theme choices as the segmented control offers them, named as the app bar's menu names them. */
const THEME_OPTIONS = THEME_CHOICES.map((value) => ({ value, label: THEME_LABELS[value] }));

/** A row's Lucide icon: 16 px at the kit's stroke, decorative. */
const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const;

interface MoreSheetProps {
  open: boolean;
  onClose(): void;
  /** The view bar's More button: the Export menu opens under it. */
  moreButton: RefObject<HTMLElement | null>;
}

/**
 * The More sheet (design decision 17): on a phone, everything the two bars leave out, in a bottom
 * sheet (ps-dialog size="sheet": top layer, scrim, focus kept inside; Escape and a backdrop press
 * close it and focus returns to More). Contours and Theme apply in place and keep the sheet open. Every
 * other row closes the sheet first and then acts, so what it opens (a menu, a dialog, the Filter
 * panel) is never a second layer under a closing one. The Export and Import menus open from More
 * and the dataset name, since their own buttons are hidden on a phone; Help & shortcuts unfolds
 * its three entries in place rather than open a menu from a hidden button.
 */
export function MoreSheet({ open, onClose, moreButton }: MoreSheetProps) {
  const dialog = useRef<PsDialog>(null);
  const contours = useRef<HTMLElement>(null);
  const themeControl = useRef<HTMLElement>(null);
  const { densityLayer, appliedFilterConditions } = useWorkbenchStatus();
  // Not part of the More dot, which marks only what changes the view (Contours, a filter).
  const theme = useTheme();
  const [helpOpen, setHelpOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const closeShortcuts = useCallback(() => setShortcutsOpen(false), []);
  const helpRowsId = useId();

  // Escape, the close button and a backdrop press close the sheet itself; follow it.
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.addEventListener('ps-close', onClose);
    return () => element.removeEventListener('ps-close', onClose);
  }, [onClose]);

  // Each opening starts with Help & shortcuts folded.
  useEffect(() => {
    if (!open) setHelpOpen(false);
  }, [open]);

  // A contour mode goes through the view bar's Contours menu, which stays mounted while hidden:
  // shown at once, applied after the paint.
  useEffect(() => {
    const element = contours.current;
    if (!element) return;
    const onChange = (event: Event) => {
      const mode = (event as CustomEvent<{ value: DensityLayerMode }>).detail.value;
      (document.getElementById('myContoursMenu') as ProtspaceContoursMenu | null)?.pick(mode);
    };
    element.addEventListener('change', onChange);
    return () => element.removeEventListener('change', onChange);
  }, []);

  // A theme applies at once, like Contours: the sheet stays open.
  useEffect(() => {
    const element = themeControl.current;
    if (!element) return;
    const onChange = (event: Event) => {
      setTheme((event as CustomEvent<{ value: ThemeChoice }>).detail.value);
    };
    element.addEventListener('change', onChange);
    return () => element.removeEventListener('change', onChange);
  }, []);

  /** A row's press: close the sheet now (its layer goes, focus returns to More), then `act`. */
  const closeThen = (act: () => void) => () => {
    dialog.current?.dismiss();
    act();
  };

  const showFilter = closeThen(() => {
    // Commit the layout now, so the heading is on screen when focus moves to it.
    flushSync(() => openPanel('filter'));
    focusFilterTitle();
  });
  const openImport = closeThen(() => {
    const dataset = document.querySelector<HTMLElement>('[data-workbench="dataset"]');
    if (!dataset) return;
    (document.getElementById('myImportMenu') as ProtspaceImportMenu | null)?.openFrom(dataset);
  });
  const openExport = closeThen(() => {
    const anchor = moreButton.current;
    if (!anchor) return;
    (document.getElementById('myExportMenu') as ProtspaceExportMenu | null)?.openFrom(anchor);
  });

  return (
    <>
      <ps-dialog ref={dialog} heading="More" size="sheet" open={open}>
        <div className="wb-sheet-rows">
          <div className="wb-sheet-row wb-sheet-row-static">
            <Layers className="wb-sheet-icon" {...ICON} />
            {/* The radio group carries the name; the word is for the eye. */}
            <span className="wb-sheet-label" aria-hidden="true">
              Contours
            </span>
            <ps-segmented
              ref={contours}
              label="Contours"
              options={CONTOUR_OPTIONS}
              value={densityLayer}
            ></ps-segmented>
          </div>
          <button type="button" className="wb-sheet-row" onClick={showFilter}>
            <Filter className="wb-sheet-icon" {...ICON} />
            <span className="wb-sheet-label">Filter</span>
            <span className="wb-sheet-value">
              {appliedFilterConditions > 0
                ? countNoun(appliedFilterConditions, 'condition', 'conditions')
                : 'None'}
            </span>
            <ChevronRight className="wb-sheet-chevron" {...ICON} />
          </button>
          <button type="button" className="wb-sheet-row" onClick={openImport}>
            <Upload className="wb-sheet-icon" {...ICON} />
            <span className="wb-sheet-label">Import data</span>
            <ChevronRight className="wb-sheet-chevron" {...ICON} />
          </button>
          <button type="button" className="wb-sheet-row" onClick={openExport}>
            <Download className="wb-sheet-icon" {...ICON} />
            <span className="wb-sheet-label">Export</span>
            <ChevronRight className="wb-sheet-chevron" {...ICON} />
          </button>
          <div className="wb-sheet-row wb-sheet-row-static">
            <Sun className="wb-sheet-icon" {...ICON} />
            {/* The radio group carries the name; the word is for the eye. */}
            <span className="wb-sheet-label" aria-hidden="true">
              Theme
            </span>
            <ps-segmented
              ref={themeControl}
              label="Theme"
              options={THEME_OPTIONS}
              value={theme}
            ></ps-segmented>
          </div>
          <button
            type="button"
            className="wb-sheet-row"
            aria-expanded={helpOpen}
            aria-controls={helpRowsId}
            onClick={() => setHelpOpen((value) => !value)}
          >
            <CircleHelp className="wb-sheet-icon" {...ICON} />
            <span className="wb-sheet-label">Help &amp; shortcuts</span>
            {helpOpen ? (
              <ChevronDown className="wb-sheet-chevron" {...ICON} />
            ) : (
              <ChevronRight className="wb-sheet-chevron" {...ICON} />
            )}
          </button>
          <div id={helpRowsId} className="wb-sheet-sub" hidden={!helpOpen}>
            <button
              type="button"
              className="wb-sheet-row wb-sheet-subrow"
              onClick={closeThen(openDocumentation)}
            >
              <span className="wb-sheet-label">Documentation</span>
            </button>
            <button
              type="button"
              className="wb-sheet-row wb-sheet-subrow"
              onClick={closeThen(() => setShortcutsOpen(true))}
            >
              <span className="wb-sheet-label">Keyboard shortcuts</span>
            </button>
            <button
              type="button"
              className="wb-sheet-row wb-sheet-subrow"
              onClick={closeThen(startTour)}
            >
              <span className="wb-sheet-label">Take the tour</span>
            </button>
          </div>
          {/* The link navigates itself; the sheet still closes, as after any other row. */}
          <a
            className="wb-sheet-row"
            href={FEEDBACK_HREF}
            onClick={() => dialog.current?.dismiss()}
          >
            <MessageSquare className="wb-sheet-icon" {...ICON} />
            <span className="wb-sheet-label">Feedback</span>
            <ChevronRight className="wb-sheet-chevron" {...ICON} />
          </a>
        </div>
      </ps-dialog>
      {/* Opened after the sheet closed, so it returns focus to More. */}
      <ShortcutsDialog open={shortcutsOpen} onClose={closeShortcuts} />
    </>
  );
}
