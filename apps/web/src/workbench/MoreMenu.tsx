import type { ProtspaceContoursMenu, PsMenu } from '@protspace/core';
import { DENSITY_LAYER_MODES, DENSITY_MODE_LABELS, type DensityLayerMode } from '@protspace/utils';
import { Ellipsis } from 'lucide-react';
import { useEffect, useRef } from 'react';
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
 * The view bar's More menu (design decision 1): from stage 2 it offers the contour modes, at
 * stage 3 Filter too. A pick goes through the inline control, which stays mounted while hidden:
 * the contours menu's pick() (shown at once, applied after the paint; re-picking the mode on
 * screen applies nothing) or a click on the Filter button, which opens the sidebar's Filter panel. A dot marks an active item inside.
 */
export function MoreMenu({ stage }: { stage: ViewBarStage }) {
  const trigger = useRef<HTMLElement>(null);
  const menu = useRef<PsMenu>(null);
  const { densityLayer, appliedFilterConditions } = useWorkbenchStatus();
  const contoursInside = stage >= 2;
  const filterInside = stage === 3;
  const active =
    (contoursInside && densityLayer !== 'off' ? 1 : 0) +
    (filterInside && appliedFilterConditions > 0 ? 1 : 0);

  useEffect(() => {
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
      const mode = CONTOUR_MODES.find((entry) => `${CONTOURS_PREFIX}${entry.mode}` === value)?.mode;
      if (mode) {
        (document.getElementById('myContoursMenu') as ProtspaceContoursMenu | null)?.pick(mode);
      }
    };
    element.addEventListener('ps-select', onSelect);
    return () => element.removeEventListener('ps-select', onSelect);
  }, []);

  // Widened back below stage 2, the bar hides More: close its menu rather than leave it open on
  // a hidden anchor.
  useEffect(() => {
    if (stage < 2 && menu.current?.open) menu.current.open = false;
  }, [stage]);

  const toggle = () => {
    if (menu.current) menu.current.open = !menu.current.open;
  };

  return (
    <>
      <ps-button
        ref={trigger}
        className="wb-more"
        variant="ghost"
        data-view-item=""
        onClick={toggle}
      >
        <span slot="start" className="wb-icon" aria-hidden="true">
          <Ellipsis size={16} strokeWidth={1.75} />
        </span>
        {/* One name for the whole button, as FilterControl does: names pieced together around a
            screen-reader-only span gain a stray space. */}
        <span aria-hidden="true">More</span>
        <span className="sr-only">
          {active > 0 ? `More view options, ${active} active` : 'More view options'}
        </span>
        <span className="wb-more-dot" aria-hidden="true" hidden={active === 0}></span>
      </ps-button>
      <ps-menu ref={menu} id="wb-more-menu" label="More view options">
        {contoursInside && (
          <ps-menu-group label="Contours">
            {CONTOUR_MODES.map(({ mode, label }) => (
              <ps-menu-item
                key={mode}
                type="radio"
                value={`${CONTOURS_PREFIX}${mode}`}
                checked={mode === densityLayer}
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
    </>
  );
}
