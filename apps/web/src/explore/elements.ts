import type {
  ProtspaceControlBar,
  ProtspaceExportMenu,
  ProtspaceImportMenu,
  ProtspaceLegend,
  ProtspaceQueryBuilder,
  ProtspaceScatterplot,
  ProtspaceStructureViewer,
  DataLoader as ProtspaceDataLoader,
  PsButton,
  PsDialog,
} from '@protspace/core';

interface ExploreElements {
  controlBar: ProtspaceControlBar;
  dataLoader: ProtspaceDataLoader;
  exportMenu: ProtspaceExportMenu;
  importMenu: ProtspaceImportMenu;
  legendElement: ProtspaceLegend;
  plotElement: ProtspaceScatterplot;
  structureViewer: ProtspaceStructureViewer;
  queryBuilder: ProtspaceQueryBuilder;
  filterDialog: PsDialog;
  filterButton: PsButton;
}

const REQUIRED_TAGS = [
  'protspace-scatterplot',
  'protspace-legend',
  'protspace-structure-viewer',
  'protspace-control-bar',
  'protspace-data-loader',
  'protspace-import-menu',
  'protspace-export-menu',
  'protspace-query-builder',
  'ps-dialog',
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
  const queryBuilder = doc.getElementById('myQueryBuilder') as ProtspaceQueryBuilder | null;
  const filterDialog = doc.getElementById('myFilterDialog') as PsDialog | null;
  const filterButton = doc.getElementById('myFilterButton') as PsButton | null;

  if (
    !plotElement ||
    !legendElement ||
    !structureViewer ||
    !controlBar ||
    !dataLoader ||
    !importMenu ||
    !exportMenu ||
    !queryBuilder ||
    !filterDialog ||
    !filterButton
  ) {
    console.error('Could not find one or more required explore elements.', {
      plotElement,
      legendElement,
      structureViewer,
      controlBar,
      dataLoader,
      importMenu,
      exportMenu,
      queryBuilder,
      filterDialog,
      filterButton,
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
    queryBuilder,
    filterDialog,
    filterButton,
  };
}
