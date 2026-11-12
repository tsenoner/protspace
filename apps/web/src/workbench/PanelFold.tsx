import { updateLayout } from '../explore/layout-state';

interface PanelFoldProps {
  /** The panel shows only its header. */
  folded: boolean;
  /** `header-end` for the legend's copy, which the legend places after its settings button. */
  slot?: string;
}

/**
 * The phone's bottom-panel fold (design decision 17): folds the Legend or Filter panel to its
 * 44 px header, which gives the plot the room, and unfolds it. One copy ends the legend's header,
 * one the Filter panel's; workbench.css shows them only in the phone layout. The fold is stored
 * (protspace:layout:v1) and is one plot resize, never animated. The button stays where it is, so
 * focus stays on it across the fold.
 */
export function PanelFold({ folded, slot }: PanelFoldProps) {
  return (
    <ps-icon-button
      className="wb-panel-fold"
      slot={slot}
      icon={folded ? 'chevron-up' : 'chevron-down'}
      label={folded ? 'Unfold panel' : 'Fold panel'}
      expanded={folded ? 'false' : 'true'}
      onClick={() => updateLayout({ panelFolded: !folded })}
    ></ps-icon-button>
  );
}
