import type {
  ProtspaceControlBar,
  ProtspaceExportMenu,
  ProtspaceImportMenu,
  ProtspaceLegend,
  ProtspaceScatterplot,
  ProtspaceStructureViewer,
  DataLoader as ProtspaceDataLoader,
} from '@protspace/core';

interface ExploreElements {
  controlBar: ProtspaceControlBar;
  dataLoader: ProtspaceDataLoader;
  exportMenu: ProtspaceExportMenu;
  importMenu: ProtspaceImportMenu;
  legendElement: ProtspaceLegend;
  plotElement: ProtspaceScatterplot;
  structureViewer: ProtspaceStructureViewer;
}

const REQUIRED_TAGS = [
  'protspace-scatterplot',
  'protspace-legend',
  'protspace-structure-viewer',
  'protspace-control-bar',
  'protspace-data-loader',
  'protspace-import-menu',
  'protspace-export-menu',
] as const;

export async function waitForElements(): Promise<void> {
  await Promise.all(REQUIRED_TAGS.map((tagName) => customElements.whenDefined(tagName)));
}

export function getElements(doc: Document = document): ExploreElements | null {
  const plotElement = doc.getElementById('myPlot') as ProtspaceScatterplot | null;
  const legendElement = doc.getElementById('myLegend') as ProtspaceLegend | null;
  const structureViewer = doc.getElementById(
    'myStructureViewer',
  ) as ProtspaceStructureViewer | null;
  const controlBar = doc.getElementById('myControlBar') as ProtspaceControlBar | null;
  const dataLoader = doc.getElementById('myDataLoader') as ProtspaceDataLoader | null;
  const importMenu = doc.getElementById('myImportMenu') as ProtspaceImportMenu | null;
  const exportMenu = doc.getElementById('myExportMenu') as ProtspaceExportMenu | null;

  if (
    !plotElement ||
    !legendElement ||
    !structureViewer ||
    !controlBar ||
    !dataLoader ||
    !importMenu ||
    !exportMenu
  ) {
    console.error('Could not find one or more required explore elements.', {
      plotElement,
      legendElement,
      structureViewer,
      controlBar,
      dataLoader,
      importMenu,
      exportMenu,
    });
    return null;
  }

  return {
    controlBar,
    dataLoader,
    exportMenu,
    importMenu,
    legendElement,
    plotElement,
    structureViewer,
  };
}
