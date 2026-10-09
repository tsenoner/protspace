/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './import-menu';
import type { ProtspaceImportMenu } from './import-menu';
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

type InfoPopoverElement = HTMLElement & {
  description: string;
  detail: string;
  docsUrl: string;
  label: string;
  updateComplete: Promise<unknown>;
};

let menu: ProtspaceImportMenu;

beforeEach(async () => {
  document.body.innerHTML = '';
  menu = document.createElement('protspace-import-menu');
  menu.exampleDatasets = EXAMPLE_DATASETS;
  document.body.append(menu);
  await menu.updateComplete;
});

afterEach(() => {
  // Removing an open menu releases its layer, so the next test starts with none.
  menu.remove();
});

const root = () => menu.shadowRoot!;
const panel = () => root().querySelector('.import-menu');
const trigger = () => root().querySelector<HTMLButtonElement>('.trigger')!;
const example = (id: string) =>
  root().querySelector<HTMLButtonElement>(`[data-example-id="${id}"]`)!;
const exampleInfo = (id: string) =>
  root().querySelector(`.import-examples [data-example-info="${id}"]`) as InfoPopoverElement | null;

async function open(): Promise<void> {
  if (!panel()) trigger().click();
  await menu.updateComplete;
}

function press(target: EventTarget): void {
  target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }));
  target.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, composed: true }));
}

describe('protspace-import-menu', () => {
  it('lists the examples with the Large badge and disables the current one', async () => {
    menu.currentExampleId = 'demo';
    await menu.updateComplete;
    await open();

    const buttons = root().querySelectorAll('[data-driver-id="import-example-dataset"]');
    expect(buttons).toHaveLength(EXAMPLE_DATASETS.length);
    expect(buttons[0].querySelector('.import-example-label')?.textContent?.trim()).toBe('Demo');
    // The info popover carries the description; a native tooltip would duplicate it.
    expect(buttons[0].hasAttribute('title')).toBe(false);
    expect(
      root().querySelector('.import-examples-hint')?.textContent?.replace(/\s+/g, ' ').trim(),
    ).toBe("Examples open in a curated view; your changes aren't kept.");

    expect(root().querySelectorAll('.import-example-badge')).toHaveLength(1);
    expect(example('swissprot').querySelector('.import-example-badge')?.textContent?.trim()).toBe(
      'Large',
    );
    expect(example('5K').querySelector('.import-example-badge')).toBeNull();

    expect(example('demo').disabled).toBe(true);
    expect(example('5K').disabled).toBe(false);

    // Every example has one info control beside its button, never inside it.
    const rows = root().querySelectorAll('.import-examples .import-example-row');
    expect(rows).toHaveLength(EXAMPLE_DATASETS.length);
    rows.forEach((row, index) => {
      const infos = row.querySelectorAll('protspace-info-popover');
      expect(infos).toHaveLength(1);
      expect(infos[0]?.getAttribute('data-example-info')).toBe(EXAMPLE_DATASETS[index].id);
      expect(row.querySelector('button protspace-info-popover')).toBeNull();
    });
    expect(exampleInfo('demo')?.description).toBe('The startup demo dataset.');
    expect(exampleInfo('demo')?.detail).toBe('Toxin families form their own clusters.');
    expect(exampleInfo('5K')?.detail).toBe('');
    expect(exampleInfo('5K')?.docsUrl).toBe('');
  });

  it('omits the Examples section when the host sets no catalog', async () => {
    menu.exampleDatasets = [];
    await menu.updateComplete;
    await open();

    expect(panel()).not.toBeNull();
    expect(root().querySelector('.import-examples')).toBeNull();
    expect(root().querySelector('.import-examples-hint')).toBeNull();
  });

  it('a click on an example dispatches load-example-dataset with its id and closes', async () => {
    const onLoad = vi.fn();
    document.addEventListener('load-example-dataset', onLoad);
    menu.currentExampleId = 'demo';
    await menu.updateComplete;
    await open();

    // The current example is disabled and loads nothing.
    example('demo').click();
    expect(onLoad).not.toHaveBeenCalled();

    example('5K').click();
    document.removeEventListener('load-example-dataset', onLoad);
    expect(onLoad).toHaveBeenCalledOnce();
    expect((onLoad.mock.calls[0][0] as CustomEvent<{ id: string }>).detail).toEqual({ id: '5K' });
    await menu.updateComplete;
    expect(panel()).toBeNull();
  });

  it('Load your dataset dispatches open-file-dialog', async () => {
    const onOpen = vi.fn();
    document.addEventListener('open-file-dialog', onOpen);
    await open();

    root().querySelector<HTMLButtonElement>('[data-driver-id="import-own-dataset"]')!.click();
    // Synchronously, inside the click, so the host's file picker keeps the user's activation.
    expect(onOpen).toHaveBeenCalledOnce();
    document.removeEventListener('open-file-dialog', onOpen);
    await menu.updateComplete;
    expect(panel()).toBeNull();
  });

  it('shows the current dataset name with its info', async () => {
    await open();
    const name = () => root().querySelector('.import-current-dataset-name')?.textContent?.trim();
    const currentInfo = () =>
      root().querySelector(
        '.import-current-dataset-row protspace-info-popover',
      ) as InfoPopoverElement | null;
    expect(name()).toBe('No dataset loaded');

    menu.currentDatasetName = 'Demo';
    menu.currentExampleId = 'demo';
    await menu.updateComplete;
    expect(name()).toBe('Demo');
    expect(currentInfo()?.getAttribute('data-example-info')).toBe('demo');
    expect(currentInfo()?.description).toBe('The startup demo dataset.');
    expect(currentInfo()?.docsUrl).toBe('/docs/explore/example-datasets#demo');

    // A user import has no info control.
    menu.currentDatasetName = 'mine.parquetbundle';
    menu.currentExampleId = null;
    await menu.updateComplete;
    expect(name()).toBe('mine.parquetbundle');
    expect(currentInfo()).toBeNull();
  });

  it("an example's info control explains it without loading it", async () => {
    const onLoad = vi.fn();
    menu.addEventListener('load-example-dataset', onLoad);
    await open();

    const info = exampleInfo('demo')!;
    (info.shadowRoot!.querySelector('.info-button') as HTMLButtonElement).click();
    await info.updateComplete;
    const popover = info.shadowRoot!.querySelector('.popover');
    expect(popover?.querySelector('.popover-description')?.textContent?.trim()).toBe(
      'The startup demo dataset.',
    );
    expect(popover?.querySelector('.popover-link')?.getAttribute('href')).toBe(
      '/docs/explore/example-datasets#demo',
    );
    expect(onLoad).not.toHaveBeenCalled();
    expect(panel()).not.toBeNull();
  });

  it('Escape and a press outside close the panel and return focus to Import', async () => {
    await open();
    expect(root().activeElement).toBe(
      root().querySelector('[data-driver-id="import-own-dataset"]'),
    );
    expect(trigger().getAttribute('aria-expanded')).toBe('true');

    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    await menu.updateComplete;
    expect(panel()).toBeNull();
    expect(root().activeElement).toBe(trigger());
    expect(trigger().getAttribute('aria-expanded')).toBe('false');

    await open();
    // A press inside the panel keeps it open; one outside closes it.
    press(panel()!);
    await menu.updateComplete;
    expect(panel()).not.toBeNull();
    press(document.body.appendChild(document.createElement('div')));
    await menu.updateComplete;
    expect(panel()).toBeNull();
    expect(root().activeElement).toBe(trigger());
  });

  it('the examples docs link opens in a new tab', async () => {
    await open();
    expect(root().querySelector('.import-examples-docs')).toBeNull();

    menu.setAttribute('examples-docs-url', '/docs/explore/example-datasets');
    await menu.updateComplete;
    const link = root().querySelector<HTMLAnchorElement>(
      '.import-examples-header .import-examples-docs',
    )!;
    expect(link.textContent?.trim()).toBe('About these examples ↗');
    expect(link.getAttribute('href')).toBe('/docs/explore/example-datasets');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
