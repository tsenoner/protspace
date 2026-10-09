import type {
  ProtspaceAnnotationSelect,
  ProtspaceContoursMenu,
  ProtspaceExportMenu,
  ProtspaceImportMenu,
  ProtspaceLegend,
  ProtspacePlotTools,
  ProtspaceProjectionMetadata,
  ProtspaceProjectionSelect,
  ProtspaceProteinSearch,
  ProtspaceQueryBuilder,
  ProtspaceScatterplot,
  ProtspaceStructureViewer,
  DataLoader as ProtspaceDataLoader,
  PsButton,
  PsDialog,
} from '@protspace/core';

interface ExploreElements {
  dataLoader: ProtspaceDataLoader;
  exportMenu: ProtspaceExportMenu;
  importMenu: ProtspaceImportMenu;
  legendElement: ProtspaceLegend;
  plotElement: ProtspaceScatterplot;
  structureViewer: ProtspaceStructureViewer;
  queryBuilder: ProtspaceQueryBuilder;
  filterDialog: PsDialog;
  filterButton: PsButton;
  projectionSelect: ProtspaceProjectionSelect;
  annotationSelect: ProtspaceAnnotationSelect;
  contoursMenu: ProtspaceContoursMenu;
  projectionMetadata: ProtspaceProjectionMetadata;
  plotTools: ProtspacePlotTools;
  proteinSearch: ProtspaceProteinSearch;
}

const REQUIRED_TAGS = [
  'protspace-scatterplot',
  'protspace-legend',
  'protspace-structure-viewer',
  'protspace-data-loader',
  'protspace-import-menu',
  'protspace-export-menu',
  'protspace-query-builder',
  'ps-dialog',
  'protspace-projection-select',
  'protspace-annotation-select',
  'protspace-contours-menu',
  'protspace-projection-metadata',
  'protspace-plot-tools',
  'protspace-protein-search',
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
  const dataLoader = doc.getElementById('myDataLoader') as ProtspaceDataLoader | null;
  const importMenu = doc.getElementById('myImportMenu') as ProtspaceImportMenu | null;
  const exportMenu = doc.getElementById('myExportMenu') as ProtspaceExportMenu | null;
  const queryBuilder = doc.getElementById('myQueryBuilder') as ProtspaceQueryBuilder | null;
  const filterDialog = doc.getElementById('myFilterDialog') as PsDialog | null;
  const filterButton = doc.getElementById('myFilterButton') as PsButton | null;
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
  const proteinSearch = doc.getElementById('myProteinSearch') as ProtspaceProteinSearch | null;

  if (
    !plotElement ||
    !legendElement ||
    !structureViewer ||
    !dataLoader ||
    !importMenu ||
    !exportMenu ||
    !queryBuilder ||
    !filterDialog ||
    !filterButton ||
    !projectionSelect ||
    !annotationSelect ||
    !contoursMenu ||
    !projectionMetadata ||
    !plotTools ||
    !proteinSearch
  ) {
    console.error('Could not find one or more required explore elements.', {
      plotElement,
      legendElement,
      structureViewer,
      dataLoader,
      importMenu,
      exportMenu,
      queryBuilder,
      filterDialog,
      filterButton,
      projectionSelect,
      annotationSelect,
      contoursMenu,
      projectionMetadata,
      plotTools,
      proteinSearch,
    });
    return null;
  }

  return {
    dataLoader,
    exportMenu,
    importMenu,
    legendElement,
    plotElement,
    structureViewer,
    queryBuilder,
    filterDialog,
    filterButton,
    projectionSelect,
    annotationSelect,
    contoursMenu,
    projectionMetadata,
    plotTools,
    proteinSearch,
  };
}
