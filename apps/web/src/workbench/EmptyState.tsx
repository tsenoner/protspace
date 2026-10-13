import { memo, type MouseEvent } from 'react';
import type { ProtspaceImportMenu } from '@protspace/core';
import { IMPORT_FORMAT_NOTE } from '@protspace/utils';
import { useWorkbenchStatus } from './use-workbench-status';

const importMenu = () => document.getElementById('myImportMenu') as ProtspaceImportMenu | null;

/** Asks the Import menu's host for the file chooser, still inside the click (import-controller.ts). */
function openFile(): void {
  importMenu()?.dispatchEvent(
    new CustomEvent('open-file-dialog', { detail: {}, bubbles: true, composed: true }),
  );
}

/** Opens the Import panel, with its examples, under the pressed button. */
function pickExample(event: MouseEvent<HTMLElement>): void {
  importMenu()?.openFrom(event.currentTarget);
}

/**
 * What the plot shows when nothing is loaded (design decision 15). A sibling over the plot, never
 * a conditional around `#myPlot`; hidden until startup has ended with nothing on screen.
 */
export const EmptyState = memo(function EmptyState() {
  const { datasetPhase } = useWorkbenchStatus();
  return (
    <div className="wb-empty" data-workbench="empty" hidden={datasetPhase !== 'empty'}>
      <p className="wb-empty-title">Drop a file or pick an example</p>
      <p className="wb-empty-note">{IMPORT_FORMAT_NOTE}</p>
      <div className="wb-empty-actions">
        <ps-button variant="primary" onClick={openFile}>
          Open a file…
        </ps-button>
        <ps-button variant="secondary" aria-haspopup="dialog" onClick={pickExample}>
          Pick an example
        </ps-button>
      </div>
    </div>
  );
});
