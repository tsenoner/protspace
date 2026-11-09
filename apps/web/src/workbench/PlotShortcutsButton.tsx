import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { ShortcutsDialog } from './ShortcutsDialog';

/**
 * The plot corner's keyboard button: opens the same shortcuts dialog as Help → Keyboard shortcuts,
 * one click from the plot they act on. Hidden on touch screens (workbench.css), where More →
 * Help & shortcuts keeps the list.
 */
export function PlotShortcutsButton() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <ps-icon-button
        id="myPlotShortcuts"
        icon="keyboard"
        label="Keyboard shortcuts"
        size="sm"
        tooltipPlacement="right"
        onClick={() => setOpen(true)}
      ></ps-icon-button>
      {/* In body, not in the plot's main landmark: a modal belongs to no landmark. */}
      {createPortal(<ShortcutsDialog open={open} onClose={close} />, document.body)}
    </>
  );
}
