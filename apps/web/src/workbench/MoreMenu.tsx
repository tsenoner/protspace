import type { ProtspaceContoursMenu, PsMenu } from '@protspace/core';
import { DENSITY_LAYER_MODES, DENSITY_MODE_LABELS, type DensityLayerMode } from '@protspace/utils';
import { Ellipsis } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LayoutMode } from '../explore/layout-defaults';
import { hasStructureSheet } from '../explore/layout-mode';
import { MoreSheet } from './MoreSheet';
import { useWorkbenchStatus } from './use-workbench-status';
import type { ViewBarStage } from './view-bar-overflow';

/**
 * The contour modes as the Contours menu names them. From @protspace/utils, which the shell
 * already loads at first paint; a value import of @protspace/core would load the whole core
 * before it (design decision 5).
 */
const CONTOUR_MODES: ReadonlyArray<{ mode: DensityLayerMode; label: string }> =
  DENSITY_LAYER_MODES.map((mode) => ({ mode, label: DENSITY_MODE_LABELS[mode].label }));

const CONTOURS_PREFIX = 'contours:';
const FILTER_VALUE = 'filter';

/**
 * The view bar's More (design decisions 1 and 17). On desktop and tablet a menu: from stage 2 it
 * offers the contour modes, at stage 3 (tablet only) Filter too. A pick goes through the inline control, which
 * stays mounted while hidden: the contours menu's pick() (shown at once, applied after the paint;
 * re-picking the mode on screen applies nothing) or a click on the Filter button, which opens the
 * sidebar's Filter panel. On a phone it opens the More sheet instead, and the menu is not rendered.
 * A dot marks an active item inside.
 */
export function MoreMenu({ stage, mode }: { stage: ViewBarStage; mode: LayoutMode }) {
  const trigger = useRef<HTMLElement>(null);
  const menu = useRef<PsMenu>(null);
  const { densityLayer, appliedFilterConditions } = useWorkbenchStatus();
  const sheet = hasStructureSheet(mode);
  const [sheetWanted, setSheetWanted] = useState(false);
  const sheetOpen = sheet && sheetWanted;
  // The sheet holds Contours and Filter at every width.
  const contoursInside = sheet || stage >= 2;
  // Desktop has no Filter in the view bar (the rail's Filter item replaces it).
  const filterInside = sheet || (stage === 3 && mode !== 'desktop');
  const active =
    (contoursInside && densityLayer !== 'off' ? 1 : 0) +
    (filterInside && appliedFilterConditions > 0 ? 1 : 0);

  useEffect(() => {
    if (sheet) return;
    const element = menu.current;
    if (!element) return;
    element.anchor = trigger.current;
    const onSelect = (event: Event) => {
      const { value } = (event as CustomEvent<{ value: string }>).detail;
      if (value === FILTER_VALUE) {
        // The menu has closed; the Filter button opens the panel and focuses its heading.
        document.getElementById('myFilterButton')?.click();
        return;
      }
      const picked = CONTOUR_MODES.find(
        (entry) => `${CONTOURS_PREFIX}${entry.mode}` === value,
      )?.mode;
      if (picked) {
        (document.getElementById('myContoursMenu') as ProtspaceContoursMenu | null)?.pick(picked);
      }
    };
    element.addEventListener('ps-select', onSelect);
    return () => element.removeEventListener('ps-select', onSelect);
  }, [sheet]);

  // Widened back below stage 2, the bar hides More: close its menu rather than leave it open on
  // a hidden anchor.
  useEffect(() => {
    if (stage < 2 && menu.current?.open) menu.current.open = false;
  }, [stage]);

  // Wider than a phone, the sheet goes; the next phone layout starts with it closed.
  useEffect(() => {
    if (!sheet) setSheetWanted(false);
  }, [sheet]);

  const closeSheet = useCallback(() => setSheetWanted(false), []);
  const toggle = () => {
    if (sheet) {
      // The open sheet is modal: More cannot be pressed again until it closes.
      setSheetWanted(true);
      return;
    }
    if (menu.current) menu.current.open = !menu.current.open;
  };

  return (
    <>
      <ps-button
        ref={trigger}
        className="wb-more"
        data-driver-id="more"
        variant="ghost"
        data-view-item=""
        // Attributes, not the hasPopup/expanded properties: the Export menu, opened from this
        // button by the sheet, marks it as its menu button and restores the attributes it found.
        // This relies on order: React commits the row's setSheetWanted(false) before ps-menu's
        // `updated` records the anchor in its microtask, so it records aria-expanded="false".
        // Moving the row's act into a setTimeout would break that (C4 pins the round trip).
        aria-haspopup={sheet ? 'dialog' : undefined}
        aria-expanded={sheet ? (sheetOpen ? 'true' : 'false') : undefined}
        onClick={toggle}
      >
        <span slot="start" className="wb-icon" aria-hidden="true">
          <Ellipsis size={16} strokeWidth={1.75} />
        </span>
        {/* One name for the whole button, as FilterControl does: names pieced together around a
            screen-reader-only span gain a stray space. */}
        <span className="wb-more-label" aria-hidden="true">
          More
        </span>
        <span className="sr-only">
          {active > 0 ? `More view options, ${active} active` : 'More view options'}
        </span>
        <span className="wb-more-dot" aria-hidden="true" hidden={active === 0}></span>
      </ps-button>
      {!sheet && (
        <ps-menu ref={menu} id="wb-more-menu" label="More view options">
          {contoursInside && (
            <ps-menu-group label="Contours">
              {CONTOUR_MODES.map(({ mode: contourMode, label }) => (
                <ps-menu-item
                  key={contourMode}
                  type="radio"
                  value={`${CONTOURS_PREFIX}${contourMode}`}
                  checked={contourMode === densityLayer}
                >
                  {label}
                </ps-menu-item>
              ))}
            </ps-menu-group>
          )}
          {/* Its own group, so Filter does not read as a fourth contour mode. */}
          {filterInside && (
            <ps-menu-group label="Filter">
              <ps-menu-item value={FILTER_VALUE}>Filter</ps-menu-item>
            </ps-menu-group>
          )}
        </ps-menu>
      )}
      {/* In body, not in the view bar's group: a modal belongs to no landmark. */}
      {sheet &&
        createPortal(
          <MoreSheet open={sheetOpen} onClose={closeSheet} moreButton={trigger} />,
          document.body,
        )}
    </>
  );
}
