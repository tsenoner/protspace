import type {
  ProtspaceControlBar,
  ProtspaceLegend,
  ProtspaceScatterplot,
  ProtspaceStructureViewer,
  DataLoader as ProtspaceDataLoader,
} from '@protspace/core';

interface ExploreElements {
  controlBar: ProtspaceControlBar;
  dataLoader: ProtspaceDataLoader;
  legendElement: ProtspaceLegend;
  plotElement: ProtspaceScatterplot;
  selectedProteinElement: HTMLElement | null;
  structureViewer: ProtspaceStructureViewer;
}

const REQUIRED_TAGS = [
  'protspace-scatterplot',
  'protspace-legend',
  'protspace-structure-viewer',
  'protspace-control-bar',
  'protspace-data-loader',
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

  if (!plotElement || !legendElement || !structureViewer || !controlBar || !dataLoader) {
    console.error('Could not find one or more required explore elements.', {
      plotElement,
      legendElement,
      structureViewer,
      controlBar,
      dataLoader,
    });
    return null;
  }

  return {
    controlBar,
    dataLoader,
    legendElement,
    plotElement,
    selectedProteinElement: doc.getElementById('selectedProtein') as HTMLElement | null,
    structureViewer,
  };
}
