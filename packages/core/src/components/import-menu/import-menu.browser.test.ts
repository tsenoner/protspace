import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { adoptTheme } from '../kit/adopt-theme';
import type { PsPopover } from '../kit/popover';
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

type InfoPopoverElement = HTMLElement & { updateComplete: Promise<boolean> };

let menu: ProtspaceImportMenu;

beforeAll(async () => {
  adoptTheme();
  await page.viewport(1280, 720);
});
beforeEach(async () => {
  document.body.innerHTML = `
    <button id="dataset" style="margin: 8px 0 0 40px">Demo · 7,831 proteins</button>
    <div style="display: flex; justify-content: flex-end; padding: 8px 24px">
      <protspace-import-menu></protspace-import-menu>
    </div>
    <button id="outside" style="margin: 400px 0 0 40px">Outside</button>`;
  menu = document.querySelector('protspace-import-menu')!;
  menu.exampleDatasets = EXAMPLE_DATASETS;
  menu.examplesDocsUrl = '/docs/explore/example-datasets';
  await menu.updateComplete;
});
afterEach(() => {
  // Removing an open menu releases its layer, so the next test starts with none.
  document.body.replaceChildren();
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const root = () => menu.shadowRoot!;
const trigger = () => root().querySelector<HTMLButtonElement>('.trigger')!;
const popover = () => root().querySelector('ps-popover') as PsPopover;
const panel = () => popover().shadowRoot!.querySelector('.panel') as HTMLElement;
const isOpen = () => panel().matches(':popover-open');
const ownFile = () => root().querySelector<HTMLElement>('[data-driver-id="import-own-dataset"]');
const example = (id: string) =>
  root().querySelector<HTMLButtonElement>(`[data-example-id="${id}"]`)!;
const exampleInfo = (id: string) =>
  root().querySelector(`.import-examples [data-example-info="${id}"]`) as InfoPopoverElement | null;
const datasetButton = () => document.getElementById('dataset') as HTMLButtonElement;
const outside = () => document.getElementById('outside') as HTMLButtonElement;

async function settle(): Promise<void> {
  await menu.updateComplete;
  await popover().updateComplete;
  await frame();
  await frame();
}

async function open(): Promise<void> {
  if (!isOpen()) trigger().click();
  await settle();
}

function escape(): void {
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      composed: true,
      cancelable: true,
    }),
  );
}

function press(target: Element): void {
  target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
  target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
}

/** The deepest element at a point, looking through every shadow root on the way. */
function deepestAt(x: number, y: number): Element | null {
  let hit: Element | null = document.elementFromPoint(x, y);
  while (hit?.shadowRoot) {
    const inner = hit.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === hit) break;
    hit = inner;
  }
  return hit;
}

async function openInfo(id: string): Promise<{ info: InfoPopoverElement; bubble: HTMLElement }> {
  const info = exampleInfo(id)!;
  (info.shadowRoot!.querySelector('.info-button') as HTMLButtonElement).click();
  await info.updateComplete;
  await (info.shadowRoot!.querySelector('ps-popover') as PsPopover).updateComplete;
  await frame();
  await frame();
  return { info, bubble: info.shadowRoot!.querySelector('.popover') as HTMLElement };
}

describe('protspace-import-menu', () => {
  it('lists the examples with the Large badge; the current one is disabled with a check and keeps its ⓘ', async () => {
    menu.currentExampleId = 'demo';
    await open();

    expect(
      [...root().querySelectorAll('[data-example-id]')].map((b) =>
        b.getAttribute('data-example-id'),
      ),
    ).toEqual(['demo', '5K', 'swissprot']);
    expect(example('demo').disabled).toBe(true);
    expect(example('demo').getAttribute('aria-current')).toBe('true');
    expect(example('demo').querySelector('svg')).not.toBeNull();
    expect(example('5K').disabled).toBe(false);
    expect(example('5K').querySelector('svg')).toBeNull();
    expect(example('swissprot').querySelector('.import-example-badge')?.textContent).toBe('Large');
    expect(root().querySelectorAll('.import-example-badge')).toHaveLength(1);
    // Every example keeps its ⓘ, the current one included, as a sibling of its button.
    for (const id of ['demo', '5K', 'swissprot']) {
      expect(exampleInfo(id)).not.toBeNull();
      expect(example(id).querySelector('protspace-info-popover')).toBeNull();
    }
    expect(root().querySelector('.import-current-dataset')).toBeNull();
  });

  it('omits the Examples section when the host sets no catalog', async () => {
    menu.exampleDatasets = [];
    await open();
    expect(ownFile()).not.toBeNull();
    expect(root().querySelector('.import-examples')).toBeNull();
  });

  it('a click on an example closes the panel, then dispatches load-example-dataset with its id', async () => {
    const seen: string[] = [];
    menu.addEventListener('load-example-dataset', (event) =>
      seen.push((event as CustomEvent<{ id: string }>).detail.id),
    );
    await open();
    example('5K').click();
    await settle();

    expect(seen).toEqual(['5K']);
    expect(isOpen()).toBe(false);
    expect(root().querySelector('.import-menu')).toBeNull();
    expect(root().activeElement).toBe(trigger());
  });

  it('Open a file… closes the panel, then dispatches open-file-dialog', async () => {
    const opened = vi.fn();
    menu.addEventListener('open-file-dialog', opened);
    await open();
    ownFile()!.click();
    await settle();

    expect(opened).toHaveBeenCalledOnce();
    expect((opened.mock.calls[0][0] as CustomEvent).detail).toEqual({});
    expect(isOpen()).toBe(false);
  });

  it('the panel is a dialog named Import with the FASTA note, and opening focuses Open a file…', async () => {
    trigger().focus();
    await open();

    expect(trigger().getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(panel().getAttribute('role')).toBe('dialog');
    expect(panel().getAttribute('aria-label')).toBe('Import');
    expect(ownFile()!.textContent!.trim()).toBe('Open a file…');
    expect(root().querySelector('.import-note')!.textContent!.trim()).toBe(
      '.parquetbundle files are read in your browser. FASTA files (.fasta, .fa, .fna) are sent to the server for embedding.',
    );
    expect(root().activeElement).toBe(ownFile());
  });

  it('Escape and a press outside close it, and focus returns to Import', async () => {
    trigger().focus();
    await open();
    escape();
    await settle();
    expect(isOpen()).toBe(false);
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(root().activeElement).toBe(trigger());

    await open();
    press(outside());
    await settle();
    expect(isOpen()).toBe(false);
  });

  it('Tab out of the panel closes it', async () => {
    await open();
    outside().focus();
    await settle();
    expect(isOpen()).toBe(false);
  });

  it('the examples docs link opens in a new tab', async () => {
    await open();
    const link = root().querySelector<HTMLAnchorElement>('.import-examples-docs')!;
    expect(link.getAttribute('href')).toBe('/docs/explore/example-datasets');
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
    // A Lucide icon (Task 4.9's `external-link`), not a text glyph.
    expect(link.textContent!.replace(/\s+/g, ' ').trim()).toBe(
      'About these examples (opens in a new tab)',
    );
    expect(link.querySelector('svg')).not.toBeNull();
  });

  it('toggleFrom(datasetButton) anchors the panel to it, sets aria-expanded on it only and returns focus to it on Escape', async () => {
    datasetButton().focus();
    menu.toggleFrom(datasetButton());
    await settle();

    expect(isOpen()).toBe(true);
    expect(datasetButton().getAttribute('aria-haspopup')).toBe('dialog');
    expect(datasetButton().getAttribute('aria-expanded')).toBe('true');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    const anchor = datasetButton().getBoundingClientRect();
    const box = panel().getBoundingClientRect();
    expect(Math.abs(box.left - anchor.left)).toBeLessThan(2);
    expect(box.top).toBeGreaterThanOrEqual(anchor.bottom);

    escape();
    await settle();
    expect(isOpen()).toBe(false);
    expect(datasetButton().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(datasetButton());

    menu.toggleFrom(datasetButton());
    await settle();
    expect(isOpen()).toBe(true);
    menu.toggleFrom(datasetButton());
    await settle();
    expect(isOpen()).toBe(false);
  });

  it('the Last file row shows only with lastFile and fires open-last-file', async () => {
    await open();
    expect(root().querySelector('.import-last-file')).toBeNull();
    escape();
    await settle();

    menu.lastFile = { name: 'mine.parquetbundle', sizeLabel: '12.3 MB' };
    const reopened = vi.fn();
    menu.addEventListener('open-last-file', reopened);
    await open();
    const row = root().querySelector<HTMLButtonElement>('.import-last-file button')!;
    expect(root().querySelector('.import-last-file .import-section-label')!.textContent).toBe(
      'Last file',
    );
    expect(row.getAttribute('aria-label')).toBe('Reopen mine.parquetbundle');
    expect(row.textContent!.replace(/\s+/g, ' ').trim()).toBe('mine.parquetbundle 12.3 MB');
    // Between "Open a file…" and the examples.
    const sections = [...root().querySelectorAll('.import-section')];
    expect(sections.indexOf(root().querySelector('.import-last-file')!)).toBe(1);

    row.click();
    await settle();
    expect(reopened).toHaveBeenCalledOnce();
    expect(isOpen()).toBe(false);
  });

  it('ArrowDown and ArrowUp move between the actions and skip the disabled example', async () => {
    menu.currentExampleId = 'demo';
    trigger().focus();
    await open();
    expect(root().activeElement).toBe(ownFile());

    await userEvent.keyboard('{ArrowDown}');
    expect(root().activeElement).toBe(example('5K'));
    await userEvent.keyboard('{ArrowDown}');
    expect(root().activeElement).toBe(example('swissprot'));
    await userEvent.keyboard('{ArrowDown}');
    expect(root().activeElement).toBe(ownFile());
    await userEvent.keyboard('{ArrowUp}');
    expect(root().activeElement).toBe(example('swissprot'));
  });

  it("an example's ⓘ bubble is topmost", async () => {
    await open();
    const { bubble } = await openInfo('5K');
    const box = bubble.getBoundingClientRect();
    expect(box.width).toBeGreaterThan(0);
    expect(box.right).toBeLessThanOrEqual(window.innerWidth);
    expect(box.bottom).toBeLessThanOrEqual(window.innerHeight);
    const hit = deepestAt(box.left + box.width / 2, box.top + box.height / 2);
    expect(hit !== null && bubble.contains(hit)).toBe(true);
    // Reading an example's info loads nothing.
    expect(isOpen()).toBe(true);
  });

  it('Escape closes the ⓘ bubble before the panel', async () => {
    await open();
    const { info } = await openInfo('5K');
    const infoPanel = (
      info.shadowRoot!.querySelector('ps-popover') as PsPopover
    ).shadowRoot!.querySelector('.panel') as HTMLElement;
    expect(infoPanel.matches(':popover-open')).toBe(true);

    escape();
    await settle();
    expect(infoPanel.matches(':popover-open')).toBe(false);
    expect(isOpen()).toBe(true);

    escape();
    await settle();
    expect(isOpen()).toBe(false);
  });

  it("an example's info control explains it without loading it", async () => {
    const onLoad = vi.fn();
    menu.addEventListener('load-example-dataset', onLoad);
    await open();

    const { bubble } = await openInfo('demo');
    expect(bubble.querySelector('.popover-description')?.textContent?.trim()).toBe(
      'The startup demo dataset.',
    );
    expect(bubble.querySelector('.popover-link')?.getAttribute('href')).toBe(
      '/docs/explore/example-datasets#demo',
    );
    expect(onLoad).not.toHaveBeenCalled();
    expect(root().querySelector('.import-menu')).not.toBeNull();
  });
});
