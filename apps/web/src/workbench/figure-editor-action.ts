import type { ProtspaceExportMenu } from '@protspace/core';

/**
 * What the app bar's Figure editor button and the More sheet's Figure editor row both do: ask for
 * the figure editor through the Export panel, where the runtime's export handler hears every
 * export request (explore/export-handler.ts). The editor's code loads on first use.
 */
export function openFigureEditor(): void {
  (document.getElementById('myExportMenu') as ProtspaceExportMenu | null)?.openFigureEditor();
}
