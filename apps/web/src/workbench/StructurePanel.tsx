import { useRef, type KeyboardEvent, type MouseEvent, type PointerEvent, type Ref } from 'react';
import { Box } from 'lucide-react';
import { LEGEND_FRACTION, type StructurePlacement } from '../explore/layout-defaults';
import { updateLayout } from '../explore/layout-state';
import { setStructureSheet } from '../explore/workbench-status';
import { clampLegendFraction, DIVIDER_HEIGHT, fractionStep } from './layout-geometry';

/** The sidebar column, the workbench body the section and the aside are placed in. */
const columnOf = (element: Element) => element.closest<HTMLElement>('[data-workbench="body"]');

interface LegendDividerProps {
  /** The legend's share of the column: the preview while one runs, else the stored value. */
  fraction: number;
  onPreview(fraction: number | null): void;
}

/**
 * The separator between the legend and the docked structure (design decision 2). A drag, an
 * arrow key, Home or End previews through `--wb-legend-fraction`; the layout is written once, on
 * pointerup or keyup. Neither changes the plot's box (decision 4).
 */
function LegendDivider({ fraction, onPreview }: LegendDividerProps) {
  const dragging = useRef(false);
  const pending = useRef<number | null>(null);

  const preview = (next: number) => {
    pending.current = next;
    onPreview(next);
  };
  const commit = () => {
    const next = pending.current;
    pending.current = null;
    if (next !== null) updateLayout({ legendFraction: next });
    onPreview(null);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const column = columnOf(event.currentTarget);
    if (!dragging.current || !column) return;
    const legendHeight = event.clientY - column.getBoundingClientRect().top - DIVIDER_HEIGHT / 2;
    preview(
      clampLegendFraction(
        legendHeight / (column.clientHeight - DIVIDER_HEIGHT),
        column.clientHeight,
      ),
    );
  };
  const onPointerEnd = () => {
    if (!dragging.current) return;
    dragging.current = false;
    commit();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const column = columnOf(event.currentTarget);
    if (!column) return;
    // Home and End go to the ends of the range (the WAI-ARIA window splitter), as on the sidebar edge.
    let requested: number;
    if (event.key === 'Home') requested = LEGEND_FRACTION.min;
    else if (event.key === 'End') requested = LEGEND_FRACTION.max;
    else {
      const step = fractionStep(event.key, event.shiftKey);
      if (step === 0) return;
      requested = (pending.current ?? fraction) + step;
    }
    event.preventDefault();
    preview(clampLegendFraction(requested, column.clientHeight));
  };
  const onKeyUp = () => {
    if (!dragging.current && pending.current !== null) commit();
  };

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize legend and structure"
      aria-valuemin={Math.round(LEGEND_FRACTION.min * 100)}
      aria-valuemax={Math.round(LEGEND_FRACTION.max * 100)}
      aria-valuenow={Math.round(fraction * 100)}
      tabIndex={0}
      className="wb-divider"
      data-workbench="divider"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
    />
  );
}

/** The viewer's controls and the resource links: a click there is theirs, never a sheet toggle. */
const SHEET_CONTROLS = 'button, a, input, [role="button"], [role^="menuitem"], ps-menu';

/**
 * Whether a click on the section toggles the sheet: one on the grip or on the viewer's header row
 * (its `header` part), not on one of the header's controls.
 */
function togglesSheet(event: MouseEvent<HTMLElement>): boolean {
  let onHandle = false;
  for (const node of event.nativeEvent.composedPath()) {
    if (node === event.currentTarget) break;
    if (!(node instanceof Element)) continue;
    if (node.matches(SHEET_CONTROLS)) return false;
    if (node.classList.contains('wb-sheet-grip') || node.getAttribute('part') === 'header') {
      onHandle = true;
    }
  }
  return onHandle;
}

interface StructurePanelProps {
  ref?: Ref<HTMLElement>;
  /** Out of the tab order while the sidebar is collapsed or collapsing (and the card docked). */
  inert?: boolean;
  /** Where the structure shows: in the sidebar column, or floating over the plot. */
  placement: StructurePlacement;
  /** Whether it may float here: desktop widths only (below 951 px it always docks). */
  canFloat: boolean;
  /** Phones (portrait and landscape): the section is the structure sheet (design decision 17). */
  sheet: boolean;
  /** The sheet is expanded (the workbench status's structureSheet). */
  sheetExpanded: boolean;
  legendFraction: number;
  onLegendFractionPreview(fraction: number | null): void;
}

/**
 * The structure section: a sibling of the sidebar's aside, never inside it, so placing it never
 * moves #myStructureViewer to another parent (its disconnect would dispose Mol*). It holds the
 * divider, the 44 px empty footer and the viewer, which the structure controller drives. Where it
 * sits, docked under the legend or floating over the plot, and which part shows, is CSS from the
 * workbench root's data-structure; the pop-out button and the floating card's grip are the only
 * children that come and go, and never the viewer. On phones the section is the structure sheet:
 * its chevron, grip and header row fold and expand it (the workbench status), and CSS moves it by
 * transform.
 */
export function StructurePanel({
  ref,
  inert,
  placement,
  canFloat,
  sheet,
  sheetExpanded,
  legendFraction,
  onLegendFractionPreview,
}: StructurePanelProps) {
  const floating = placement === 'floating';
  const toggleSheet = () => setStructureSheet(sheetExpanded ? 'folded' : 'expanded');
  return (
    <section
      ref={ref}
      inert={inert}
      // View structure from the keyboard focuses the section. Docked it is no Tab stop of its own; a
      // floating card is one, so the arrow keys can move it.
      tabIndex={floating ? 0 : -1}
      className="wb-structure"
      data-workbench="structure"
      aria-label="Structure"
      aria-describedby={floating ? 'wb-float-move-hint' : undefined}
      // The grip and the header row fold and expand the sheet, as its chevron does.
      onClick={
        sheet
          ? (event) => {
              if (togglesSheet(event)) toggleSheet();
            }
          : undefined
      }
    >
      <LegendDivider fraction={legendFraction} onPreview={onLegendFractionPreview} />
      <div className="wb-structure-empty" data-workbench="structure-empty">
        <Box size={16} strokeWidth={1.75} aria-hidden="true" />
        <span className="wb-structure-empty-title">Structure</span>
        <span className="wb-structure-empty-hint">Click a protein to view it</span>
      </div>
      {/* The sheet's handle. Always rendered, shown by CSS in sheet modes only, so nothing is
          inserted beside the viewer when the mode changes. */}
      <div className="wb-sheet-grip" aria-hidden="true" />
      <protspace-structure-viewer
        id="myStructureViewer"
        height="100%"
        show-header="true"
        show-close-button="true"
        auto-sync="true"
        scatterplot-selector="#myPlot"
      >
        {sheet && (
          <ps-icon-button
            slot="header-actions"
            size="sm"
            icon={sheetExpanded ? 'chevron-down' : 'chevron-up'}
            label={sheetExpanded ? 'Hide the structure' : 'Show the structure'}
            expanded={sheetExpanded ? 'true' : 'false'}
            onClick={toggleSheet}
          ></ps-icon-button>
        )}
        {canFloat && (
          <ps-icon-button
            slot="header-actions"
            size="sm"
            icon={floating ? 'panel-right' : 'picture-in-picture-2'}
            label={floating ? 'Dock structure' : 'Pop out structure'}
            // Docking puts the structure back in the sidebar, so a collapsed sidebar opens: the
            // structure stays in view and this button, now "Pop out structure", keeps focus.
            onClick={() =>
              updateLayout(
                floating
                  ? { structurePlacement: 'docked', sidebarOpen: true }
                  : { structurePlacement: 'floating' },
              )
            }
          ></ps-icon-button>
        )}
      </protspace-structure-viewer>
      {floating && (
        <>
          <span id="wb-float-move-hint" hidden>
            Arrow keys move the card; Shift moves it farther.
          </span>
          <span id="wb-float-resize-hint" hidden>
            Arrow keys resize the card; Shift resizes it faster.
          </span>
          <button
            type="button"
            className="wb-float-grip"
            data-workbench="float-grip"
            aria-label="Resize structure"
            aria-describedby="wb-float-resize-hint"
            aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
          ></button>
        </>
      )}
    </section>
  );
}
