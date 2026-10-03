/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import './control-bar';
import '../data-loader/data-loader';
import type { ExampleDatasetSummary } from './types';

const EXAMPLE_DATASETS: ExampleDatasetSummary[] = [
  {
    id: 'demo',
    label: 'Demo',
    description: 'The startup demo dataset.',
    insight: 'Toxin families form their own clusters.',
    docsUrl: '/docs/explore/example-datasets#demo',
  },
  { id: '5K', label: 'Swiss-Prot 5K', description: 'A small Swiss-Prot subset.' },
  {
    id: 'swissprot',
    label: 'Swiss-Prot',
    description: 'All of Swiss-Prot. Large: a 45 MB download.',
    docsUrl: '/docs/explore/example-datasets#swissprot',
    large: true,
  },
];

type ControlBarElement = HTMLElement & {
  autoSync?: boolean;
  currentDatasetName?: string;
  currentExampleId?: string | null;
  exampleDatasets?: ExampleDatasetSummary[];
  examplesDocsUrl?: string;
  updateComplete?: Promise<unknown>;
};

type InfoPopoverElement = HTMLElement & {
  description: string;
  detail: string;
  docsUrl: string;
  label: string;
  updateComplete: Promise<unknown>;
};

describe('control-bar import menu', () => {
  let controlBar: ControlBarElement;

  beforeEach(async () => {
    document.body.innerHTML = '';
    controlBar = document.createElement('protspace-control-bar') as ControlBarElement;
    controlBar.autoSync = false;
    controlBar.exampleDatasets = EXAMPLE_DATASETS;
    document.body.appendChild(controlBar);
    await controlBar.updateComplete;
  });

  async function openImportMenu(): Promise<void> {
    const trigger = controlBar.shadowRoot?.querySelector(
      '[data-driver-id="import"] .dropdown-trigger',
    ) as HTMLButtonElement | null;
    trigger?.click();
    await controlBar.updateComplete;
  }

  function exampleInfo(id: string): InfoPopoverElement | null {
    return controlBar.shadowRoot?.querySelector(
      `.import-examples [data-example-info="${id}"]`,
    ) as InfoPopoverElement | null;
  }

  it('opens the import flyout from the import trigger', async () => {
    await openImportMenu();

    const importMenu = controlBar.shadowRoot?.querySelector('.import-menu');
    expect(importMenu).not.toBeNull();
  });

  it('omits the Examples section when the host sets no catalog', async () => {
    controlBar.exampleDatasets = [];
    await controlBar.updateComplete;
    await openImportMenu();

    expect(controlBar.shadowRoot?.querySelector('.import-menu')).not.toBeNull();
    expect(controlBar.shadowRoot?.querySelector('.import-examples')).toBeNull();
    expect(controlBar.shadowRoot?.querySelector('.import-examples-hint')).toBeNull();
  });

  it('says under the Examples heading that examples open curated and changes are not kept', async () => {
    await openImportMenu();

    const hint = controlBar.shadowRoot?.querySelector('.import-examples .import-examples-hint');
    expect(hint?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      "Examples open in a curated view; your changes aren't kept.",
    );
  });

  it('lists every catalog entry under the Examples heading', async () => {
    await openImportMenu();

    const exampleButtons = controlBar.shadowRoot?.querySelectorAll(
      '[data-driver-id="import-example-dataset"]',
    );
    expect(exampleButtons).toHaveLength(EXAMPLE_DATASETS.length);
    expect(exampleButtons?.[0]?.textContent?.trim()).toBe('Demo');
    // The info popover carries the description; a native tooltip would duplicate it.
    expect(exampleButtons?.[0]?.hasAttribute('title')).toBe(false);
  });

  it('links the Examples heading to the examples page only when the host sets its URL', async () => {
    await openImportMenu();
    expect(controlBar.shadowRoot?.querySelector('.import-examples-docs')).toBeNull();

    controlBar.examplesDocsUrl = '/docs/explore/example-datasets';
    await controlBar.updateComplete;

    const link = controlBar.shadowRoot?.querySelector(
      '.import-examples-header .import-examples-docs',
    ) as HTMLAnchorElement | null;
    expect(link?.textContent?.trim()).toBe('About these examples ↗');
    expect(link?.getAttribute('href')).toBe('/docs/explore/example-datasets');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('reads the examples page URL from the examples-docs-url attribute', async () => {
    controlBar.setAttribute('examples-docs-url', '/docs/explore/example-datasets');
    await controlBar.updateComplete;
    await openImportMenu();

    expect(
      controlBar.shadowRoot?.querySelector('.import-examples-docs')?.getAttribute('href'),
    ).toBe('/docs/explore/example-datasets');
  });

  it('gives every example one info control beside its button, not inside it', async () => {
    await openImportMenu();

    const rows = controlBar.shadowRoot?.querySelectorAll('.import-examples .import-example-row');
    expect(rows).toHaveLength(EXAMPLE_DATASETS.length);
    rows?.forEach((row, index) => {
      const example = EXAMPLE_DATASETS[index];
      const infos = row.querySelectorAll('protspace-info-popover');
      expect(infos).toHaveLength(1);
      expect(infos[0]?.getAttribute('data-example-info')).toBe(example.id);
      expect(row.querySelector('button protspace-info-popover')).toBeNull();
    });

    const demoInfo = exampleInfo('demo');
    expect(demoInfo?.description).toBe('The startup demo dataset.');
    expect(demoInfo?.detail).toBe('Toxin families form their own clusters.');
    expect(demoInfo?.docsUrl).toBe('/docs/explore/example-datasets#demo');
    expect(demoInfo?.label).toBe('Demo');
    // An entry without insight or docs still explains itself.
    expect(exampleInfo('5K')?.description).toBe('A small Swiss-Prot subset.');
    expect(exampleInfo('5K')?.detail).toBe('');
    expect(exampleInfo('5K')?.docsUrl).toBe('');
  });

  it('opening an info control shows the entry and its docs link without loading it', async () => {
    const eventHandler = vi.fn();
    controlBar.addEventListener('load-example-dataset', eventHandler);
    await openImportMenu();

    const info = exampleInfo('demo')!;
    const infoButton = info.shadowRoot?.querySelector('.info-button') as HTMLButtonElement;
    infoButton.click();
    await info.updateComplete;
    await controlBar.updateComplete;

    const popover = info.shadowRoot?.querySelector('.popover');
    expect(popover?.querySelector('.popover-description')?.textContent?.trim()).toBe(
      'The startup demo dataset.',
    );
    expect(popover?.querySelector('.popover-detail')?.textContent?.trim()).toBe(
      'Toxin families form their own clusters.',
    );
    expect(popover?.querySelector('.popover-link')?.getAttribute('href')).toBe(
      '/docs/explore/example-datasets#demo',
    );
    expect(eventHandler).not.toHaveBeenCalled();
    expect(controlBar.shadowRoot?.querySelector('.import-menu')).not.toBeNull();
  });

  it('marks large examples with a "Large" badge', async () => {
    await openImportMenu();

    const badges = controlBar.shadowRoot?.querySelectorAll('.import-example-badge');
    expect(badges).toHaveLength(1);
    const largeButton = controlBar.shadowRoot?.querySelector('[data-example-id="swissprot"]');
    expect(largeButton?.querySelector('.import-example-badge')?.textContent?.trim()).toBe('Large');
    expect(
      controlBar.shadowRoot?.querySelector('[data-example-id="5K"] .import-example-badge'),
    ).toBeNull();
  });

  it("offers the loaded example's info control next to the current dataset name", async () => {
    controlBar.currentDatasetName = 'Demo';
    controlBar.currentExampleId = 'demo';
    await controlBar.updateComplete;
    await openImportMenu();

    const currentInfo = controlBar.shadowRoot?.querySelector(
      '.import-current-dataset-row protspace-info-popover',
    ) as InfoPopoverElement | null;
    expect(currentInfo?.getAttribute('data-example-info')).toBe('demo');
    expect(currentInfo?.description).toBe('The startup demo dataset.');
    expect(currentInfo?.docsUrl).toBe('/docs/explore/example-datasets#demo');
  });

  it('shows no info control next to the current dataset name for a user import', async () => {
    controlBar.currentDatasetName = 'mine.parquetbundle';
    controlBar.currentExampleId = null;
    await controlBar.updateComplete;
    await openImportMenu();

    expect(
      controlBar.shadowRoot?.querySelector('.import-current-dataset-row protspace-info-popover'),
    ).toBeNull();
  });

  it('dispatches load-example-dataset with the chosen id when an example is clicked', async () => {
    const eventHandler = vi.fn();
    controlBar.addEventListener('load-example-dataset', eventHandler);

    await openImportMenu();

    const demoButton = controlBar.shadowRoot?.querySelector(
      '[data-example-id="demo"]',
    ) as HTMLButtonElement | null;
    demoButton?.click();
    await controlBar.updateComplete;

    expect(eventHandler).toHaveBeenCalledTimes(1);
    const detail = (eventHandler.mock.calls[0]?.[0] as CustomEvent<{ id: string }>).detail;
    expect(detail).toEqual({ id: 'demo' });
    expect(controlBar.shadowRoot?.querySelector('.import-menu')).toBeNull();
  });

  it('shows the current dataset name in the import flyout', async () => {
    controlBar.currentDatasetName = '5K.parquetbundle';
    await controlBar.updateComplete;

    await openImportMenu();

    const datasetName = controlBar.shadowRoot?.querySelector('.import-current-dataset-name');
    expect(datasetName?.textContent?.trim()).toBe('5K.parquetbundle');
  });

  it('disables the currently loaded example', async () => {
    const eventHandler = vi.fn();
    controlBar.addEventListener('load-example-dataset', eventHandler);
    controlBar.currentExampleId = 'demo';
    await controlBar.updateComplete;

    await openImportMenu();

    const demoButton = controlBar.shadowRoot?.querySelector(
      '[data-example-id="demo"]',
    ) as HTMLButtonElement | null;
    expect(demoButton?.disabled).toBe(true);

    const otherButton = controlBar.shadowRoot?.querySelector(
      '[data-example-id="5K"]',
    ) as HTMLButtonElement | null;
    expect(otherButton?.disabled).toBe(false);

    demoButton?.click();
    await controlBar.updateComplete;

    expect(eventHandler).not.toHaveBeenCalled();
  });

  it('does not disable any example when a user file is loaded', async () => {
    controlBar.currentExampleId = null;
    await controlBar.updateComplete;

    await openImportMenu();

    const exampleButtons = controlBar.shadowRoot?.querySelectorAll(
      '[data-driver-id="import-example-dataset"]',
    );
    exampleButtons?.forEach((button) => {
      expect((button as HTMLButtonElement).disabled).toBe(false);
    });
  });

  it('uses the data-loader file input for the custom dataset action', async () => {
    const dataLoader = document.createElement('protspace-data-loader');
    document.body.appendChild(dataLoader);
    await (dataLoader as HTMLElement & { updateComplete?: Promise<unknown> }).updateComplete;

    const fileInput = dataLoader.shadowRoot?.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement | null;
    const clickSpy = vi.spyOn(fileInput!, 'click');

    await openImportMenu();

    const ownDatasetButton = controlBar.shadowRoot?.querySelector(
      '[data-driver-id="import-own-dataset"]',
    ) as HTMLButtonElement | null;
    ownDatasetButton?.click();
    await controlBar.updateComplete;

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(controlBar.shadowRoot?.querySelector('.import-menu')).toBeNull();
  });
});
