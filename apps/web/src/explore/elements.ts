import type {
  ProtspaceAnnotationSelect,
  ProtspaceContoursMenu,
  ProtspaceEatPanel,
  ProtspaceExportMenu,
  ProtspaceImportMenu,
  ProtspaceLegend,
  ProtspacePlotTools,
  ProtspaceProjectionMetadata,
  ProtspaceProjectionSelect,
  ProtspaceProteinSearch,
  ProtspaceQueryBuilder,
  ProtspaceScatterplot,
  ProtspaceSelectionBar,
  ProtspacePlotStatus,
  ProtspaceStructureViewer,
  DataLoader as ProtspaceDataLoader,
} from '@protspace/core';

interface ExploreElements {
  dataLoader: ProtspaceDataLoader;
  exportMenu: ProtspaceExportMenu;
  importMenu: ProtspaceImportMenu;
  legendElement: ProtspaceLegend;
  eatPanel: ProtspaceEatPanel;
  plotElement: ProtspaceScatterplot;
  structureViewer: ProtspaceStructureViewer;
  queryBuilder: ProtspaceQueryBuilder;
  projectionSelect: ProtspaceProjectionSelect;
  annotationSelect: ProtspaceAnnotationSelect;
  contoursMenu: ProtspaceContoursMenu;
  projectionMetadata: ProtspaceProjectionMetadata;
  plotTools: ProtspacePlotTools;
  selectionBar: ProtspaceSelectionBar;
  plotStatus: ProtspacePlotStatus;
  proteinSearch: ProtspaceProteinSearch;
}

const REQUIRED_TAGS = [
  'protspace-scatterplot',
  'protspace-legend',
  'protspace-eat-panel',
  'protspace-structure-viewer',
  'protspace-data-loader',
  'protspace-import-menu',
  'protspace-export-menu',
  'protspace-query-builder',
  'protspace-projection-select',
  'protspace-annotation-select',
  'protspace-contours-menu',
  'protspace-projection-metadata',
  'protspace-plot-tools',
  'protspace-selection-bar',
  'protspace-plot-status',
  'protspace-protein-search',
] as const;

export async function waitForElements(): Promise<void> {
  await Promise.all(REQUIRED_TAGS.map((tagName) => customElements.whenDefined(tagName)));
}

export function getElements(doc: Document = document): ExploreElements | null {
  const plotElement = doc.getElementById('myPlot') as ProtspaceScatterplot | null;
  const legendElement = doc.getElementById('myLegend') as ProtspaceLegend | null;
  const eatPanel = doc.getElementById('myEatPanel') as ProtspaceEatPanel | null;
  const structureViewer = doc.getElementById(
    'myStructureViewer',
  ) as ProtspaceStructureViewer | null;
  const dataLoader = doc.getElementById('myDataLoader') as ProtspaceDataLoader | null;
  const importMenu = doc.getElementById('myImportMenu') as ProtspaceImportMenu | null;
  const exportMenu = doc.getElementById('myExportMenu') as ProtspaceExportMenu | null;
  const queryBuilder = doc.getElementById('myQueryBuilder') as ProtspaceQueryBuilder | null;
  const projectionSelect = doc.getElementById(
    'myProjectionSelect',
  ) as ProtspaceProjectionSelect | null;
  const annotationSelect = doc.getElementById(
    'myAnnotationSelect',
  ) as ProtspaceAnnotationSelect | null;
  const contoursMenu = doc.getElementById('myContoursMenu') as ProtspaceContoursMenu | null;
  const projectionMetadata = doc.getElementById(
    'myProjectionMetadata',
  ) as ProtspaceProjectionMetadata | null;
  const plotTools = doc.getElementById('myPlotTools') as ProtspacePlotTools | null;
  const selectionBar = doc.getElementById('mySelectionBar') as ProtspaceSelectionBar | null;
  const plotStatus = doc.getElementById('myPlotStatus') as ProtspacePlotStatus | null;
  const proteinSearch = doc.getElementById('myProteinSearch') as ProtspaceProteinSearch | null;

  if (
    !plotElement ||
    !legendElement ||
    !eatPanel ||
    !structureViewer ||
    !dataLoader ||
    !importMenu ||
    !exportMenu ||
    !queryBuilder ||
    !projectionSelect ||
    !annotationSelect ||
    !contoursMenu ||
    !projectionMetadata ||
    !plotTools ||
    !selectionBar ||
    !plotStatus ||
    !proteinSearch
  ) {
    console.error('Could not find one or more required explore elements.', {
      plotElement,
      legendElement,
      eatPanel,
      structureViewer,
      dataLoader,
      importMenu,
      exportMenu,
      queryBuilder,
      projectionSelect,
      annotationSelect,
      contoursMenu,
      projectionMetadata,
      plotTools,
      selectionBar,
      plotStatus,
      proteinSearch,
    });
    return null;
  }

  return {
    dataLoader,
    exportMenu,
    importMenu,
    legendElement,
    eatPanel,
    plotElement,
    structureViewer,
    queryBuilder,
    projectionSelect,
    annotationSelect,
    contoursMenu,
    projectionMetadata,
    plotTools,
    selectionBar,
    plotStatus,
    proteinSearch,
  };
}
