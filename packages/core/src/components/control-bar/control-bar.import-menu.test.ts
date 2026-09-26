/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import './control-bar';
import '../data-loader/data-loader';
import type { ExampleDatasetSummary } from './types';

const EXAMPLE_DATASETS: ExampleDatasetSummary[] = [
  { id: 'demo', label: 'Demo', description: 'The startup demo dataset.' },
  { id: '5K', label: 'Swiss-Prot 5K', description: 'A small Swiss-Prot subset.' },
];

describe('control-bar import menu', () => {
  let controlBar: HTMLElement & {
    autoSync?: boolean;
    currentDatasetName?: string;
    currentExampleId?: string | null;
    exampleDatasets?: ExampleDatasetSummary[];
    updateComplete?: Promise<unknown>;
  };

  beforeEach(async () => {
    document.body.innerHTML = '';
    controlBar = document.createElement('protspace-control-bar') as HTMLElement & {
      autoSync?: boolean;
      currentDatasetName?: string;
      currentExampleId?: string | null;
      exampleDatasets?: ExampleDatasetSummary[];
      updateComplete?: Promise<unknown>;
    };
    controlBar.autoSync = false;
    controlBar.exampleDatasets = EXAMPLE_DATASETS;
    document.body.appendChild(controlBar);
    await controlBar.updateComplete;
  });

  it('opens the import flyout from the import trigger', async () => {
    const trigger = controlBar.shadowRoot?.querySelector(
      '[data-driver-id="import"] .dropdown-trigger',
    ) as HTMLButtonElement | null;

    trigger?.click();
    await controlBar.updateComplete;

    const importMenu = controlBar.shadowRoot?.querySelector('.import-menu');
    expect(importMenu).not.toBeNull();
  });

  it('lists every catalog entry under the Examples heading', async () => {
    const trigger = controlBar.shadowRoot?.querySelector(
      '[data-driver-id="import"] .dropdown-trigger',
    ) as HTMLButtonElement | null;
    trigger?.click();
    await controlBar.updateComplete;

    const exampleButtons = controlBar.shadowRoot?.querySelectorAll(
      '[data-driver-id="import-example-dataset"]',
    );
    expect(exampleButtons).toHaveLength(EXAMPLE_DATASETS.length);
    expect(exampleButtons?.[0]?.textContent?.trim()).toBe('Demo');
    expect(exampleButtons?.[0]?.getAttribute('title')).toBe('The startup demo dataset.');
  });

  it('dispatches load-example-dataset with the chosen id when an example is clicked', async () => {
    const eventHandler = vi.fn();
    controlBar.addEventListener('load-example-dataset', eventHandler);

    const trigger = controlBar.shadowRoot?.querySelector(
      '[data-driver-id="import"] .dropdown-trigger',
    ) as HTMLButtonElement | null;
    trigger?.click();
    await controlBar.updateComplete;

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

    const trigger = controlBar.shadowRoot?.querySelector(
      '[data-driver-id="import"] .dropdown-trigger',
    ) as HTMLButtonElement | null;
    trigger?.click();
    await controlBar.updateComplete;

    const datasetName = controlBar.shadowRoot?.querySelector('.import-current-dataset-name');
    expect(datasetName?.textContent?.trim()).toBe('5K.parquetbundle');
  });

  it('disables the currently loaded example', async () => {
    const eventHandler = vi.fn();
    controlBar.addEventListener('load-example-dataset', eventHandler);
    controlBar.currentExampleId = 'demo';
    await controlBar.updateComplete;

    const trigger = controlBar.shadowRoot?.querySelector(
      '[data-driver-id="import"] .dropdown-trigger',
    ) as HTMLButtonElement | null;
    trigger?.click();
    await controlBar.updateComplete;

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

    const trigger = controlBar.shadowRoot?.querySelector(
      '[data-driver-id="import"] .dropdown-trigger',
    ) as HTMLButtonElement | null;
    trigger?.click();
    await controlBar.updateComplete;

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

    const trigger = controlBar.shadowRoot?.querySelector(
      '[data-driver-id="import"] .dropdown-trigger',
    ) as HTMLButtonElement | null;
    trigger?.click();
    await controlBar.updateComplete;

    const ownDatasetButton = controlBar.shadowRoot?.querySelector(
      '[data-driver-id="import-own-dataset"]',
    ) as HTMLButtonElement | null;
    ownDatasetButton?.click();
    await controlBar.updateComplete;

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(controlBar.shadowRoot?.querySelector('.import-menu')).toBeNull();
  });
});
