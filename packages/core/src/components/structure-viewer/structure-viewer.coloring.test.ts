/** @vitest-environment jsdom */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ProtspaceUtils from '@protspace/utils';
import type { StructureData, TedDomain } from '@protspace/utils';

const mocks = vi.hoisted(() => ({
  loadStructure: vi.fn(),
  createViewer: vi.fn(),
  loadStructureFromUrl: vi.fn(),
  setColorTheme: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock('@protspace/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof ProtspaceUtils>()),
  StructureService: { loadStructure: mocks.loadStructure },
}));

vi.mock('./molstar-loader', () => ({
  createMolstarViewer: mocks.createViewer,
}));

import './structure-viewer';
import type { ProtspaceStructureViewer } from './structure-viewer';
import type { StructureColorMode } from './molstar-loader';
import type { PsSegmented } from '../kit/segmented';
import { stubPopoverApi } from '../legend/test-support/popover-stub';

// Pressing the disabled TED option opens its reason tooltip, which calls showPopover.
beforeAll(() => stubPopoverApi());

const domains: TedDomain[] = [
  { domainNumber: 1, segments: [{ start: 10, end: 50 }] },
  { domainNumber: 2, segments: [{ start: 80, end: 120 }] },
];

function structureData(tedDomains: TedDomain[]): StructureData {
  return {
    proteinId: 'A0A0B4U9L8',
    source: 'alphafold',
    url: 'blob:structure',
    format: 'mmcif',
    isBinary: false,
    tedDomains,
    metadata: { confidence: 'high', method: 'predicted', version: 'v6' },
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

/** The viewer's colour control (a ps-segmented), once the viewer and the control have rendered. */
async function colorControl(element: ProtspaceStructureViewer): Promise<PsSegmented | null> {
  await element.updateComplete;
  const control = element.shadowRoot?.querySelector('ps-segmented') ?? null;
  await control?.updateComplete;
  return control;
}

async function colorButton(element: ProtspaceStructureViewer, mode: StructureColorMode) {
  const control = await colorControl(element);
  return (
    control?.shadowRoot?.querySelector<HTMLButtonElement>(`[role="radio"][data-value="${mode}"]`) ??
    null
  );
}

/** A kit option is disabled by aria-disabled, never native disabled (its tooltip needs hover). */
function isDisabled(button: HTMLButtonElement | null): boolean {
  expect(button, 'the colour option is rendered').not.toBeNull();
  return button!.getAttribute('aria-disabled') === 'true';
}

async function expectActiveColorMode(element: ProtspaceStructureViewer, mode: StructureColorMode) {
  const inactiveMode: StructureColorMode = mode === 'plddt' ? 'ted-domains' : 'plddt';
  expect((await colorButton(element, mode))?.getAttribute('aria-checked')).toBe('true');
  expect((await colorButton(element, inactiveMode))?.getAttribute('aria-checked')).toBe('false');
  expect(element.shadowRoot?.querySelector('.color-description')?.textContent).toContain(
    mode === 'plddt' ? 'pLDDT confidence' : 'TED domains',
  );
}

/** Keeps TED theme changes pending until the returned deferred resolves. */
function holdTedThemeChange() {
  const tedChange = deferred<void>();
  mocks.setColorTheme.mockImplementation((mode: StructureColorMode) =>
    mode === 'ted-domains' ? tedChange.promise : Promise.resolve(),
  );
  return tedChange;
}

function mountViewer(tedDomains: TedDomain[]) {
  mocks.loadStructure.mockResolvedValue(structureData(tedDomains));
  const element = document.createElement('protspace-structure-viewer') as ProtspaceStructureViewer;
  element.autoSync = false;
  element.proteinId = 'A0A0B4U9L8';
  document.body.appendChild(element);
  return element;
}

async function renderViewer(tedDomains: TedDomain[]) {
  const element = mountViewer(tedDomains);
  await vi.waitFor(() => expect(mocks.loadStructureFromUrl).toHaveBeenCalledOnce());
  await element.updateComplete;
  return element;
}

describe('structure viewer color control', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      queueMicrotask(() => callback(0));
      return 1;
    });
    mocks.createViewer.mockImplementation(async () => ({
      loadStructureFromUrl: mocks.loadStructureFromUrl,
      setColorTheme: mocks.setColorTheme,
      dispose: mocks.dispose,
    }));
    mocks.loadStructureFromUrl.mockResolvedValue(undefined);
    mocks.setColorTheme.mockResolvedValue(undefined);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('defaults to pLDDT and enables TED coloring when domains exist', async () => {
    const element = await renderViewer(domains);

    await expectActiveColorMode(element, 'plddt');
    expect(isDisabled(await colorButton(element, 'ted-domains'))).toBe(false);
    expect(mocks.createViewer).toHaveBeenCalledWith(expect.any(HTMLElement), domains);
  });

  it('keeps the color toolbar mounted but disabled while a structure loads', async () => {
    const structureLoad = deferred<void>();
    mocks.loadStructureFromUrl.mockReturnValueOnce(structureLoad.promise);
    const element = await renderViewer(domains);
    // Rendering the toolbar up front keeps the Mol* canvas from resizing when loading ends
    expect(element.shadowRoot?.querySelector('.color-toolbar')).not.toBeNull();
    expect(isDisabled(await colorButton(element, 'plddt'))).toBe(true);
    expect(isDisabled(await colorButton(element, 'ted-domains'))).toBe(true);

    structureLoad.resolve();
    await vi.waitFor(async () =>
      expect(isDisabled(await colorButton(element, 'ted-domains'))).toBe(false),
    );
  });

  it('disables TED coloring when no assignments are available', async () => {
    const element = await renderViewer([]);
    const tedButton = await colorButton(element, 'ted-domains');

    expect(isDisabled(tedButton)).toBe(true);
    // The reason sits in the ps-tooltip after the button, not a native title.
    expect(tedButton?.hasAttribute('title')).toBe(false);
    expect((tedButton?.nextElementSibling as HTMLElement & { text: string }).text).toContain(
      'unavailable',
    );
  });

  it('TED without domains is aria-disabled and a change event for it applies nothing', async () => {
    const element = await renderViewer([]);
    const ted = await colorButton(element, 'ted-domains');
    expect(isDisabled(ted)).toBe(true);

    // Neither a stray change event nor a click on the disabled option recolours.
    const control = await colorControl(element);
    control!.dispatchEvent(
      new CustomEvent('change', { bubbles: true, detail: { value: 'ted-domains' } }),
    );
    ted!.click();
    await element.updateComplete;

    expect(mocks.setColorTheme).not.toHaveBeenCalled();
    await expectActiveColorMode(element, 'plddt');
  });

  it('switches the loaded representation to TED and back to pLDDT', async () => {
    const element = await renderViewer(domains);

    (await colorButton(element, 'ted-domains'))?.click();
    await vi.waitFor(() => expect(mocks.setColorTheme).toHaveBeenCalledWith('ted-domains'));
    await element.updateComplete;
    await expectActiveColorMode(element, 'ted-domains');

    (await colorButton(element, 'plddt'))?.click();
    await vi.waitFor(() => expect(mocks.setColorTheme).toHaveBeenLastCalledWith('plddt'));
    await element.updateComplete;
    await expectActiveColorMode(element, 'plddt');
  });

  it('honors a rapid return to pLDDT while TED coloring is still applying', async () => {
    const element = await renderViewer(domains);
    const tedChange = holdTedThemeChange();

    (await colorButton(element, 'ted-domains'))?.click();
    await vi.waitFor(() => expect(mocks.setColorTheme).toHaveBeenLastCalledWith('ted-domains'));
    (await colorButton(element, 'plddt'))?.click();
    tedChange.resolve();

    await vi.waitFor(() => expect(mocks.setColorTheme).toHaveBeenLastCalledWith('plddt'));
    await element.updateComplete;
    await expectActiveColorMode(element, 'plddt');
  });

  it('restores the previous mode when a theme change fails', async () => {
    const element = await renderViewer(domains);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.setColorTheme.mockRejectedValueOnce(new Error('theme failed'));

    (await colorButton(element, 'ted-domains'))?.click();
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalledOnce());
    await element.updateComplete;
    await expectActiveColorMode(element, 'plddt');
  });

  it('puts the control back when a change is refused within the same update (live binding)', async () => {
    const element = await renderViewer(domains);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // A synchronous throw rolls back before Lit renders, so the binding's last value is still
    // plddt and only live() writes it back over the control's own ted-domains.
    mocks.setColorTheme.mockImplementationOnce(() => {
      throw new Error('refused synchronously');
    });

    (await colorButton(element, 'ted-domains'))?.click();
    await element.updateComplete;

    await expectActiveColorMode(element, 'plddt');
    expect((await colorControl(element))!.value).toBe('plddt');
  });

  it('ignores a completed color change from a replaced viewer', async () => {
    const element = await renderViewer(domains);
    const tedChange = holdTedThemeChange();

    (await colorButton(element, 'ted-domains'))?.click();
    await vi.waitFor(() => expect(mocks.setColorTheme).toHaveBeenLastCalledWith('ted-domains'));

    mocks.loadStructure.mockResolvedValueOnce(structureData([]));
    element.proteinId = 'P12345';
    await vi.waitFor(() => expect(mocks.loadStructureFromUrl).toHaveBeenCalledTimes(2));
    await element.updateComplete;

    tedChange.resolve();
    await tedChange.promise;
    await Promise.resolve();
    await element.updateComplete;

    expect((await colorButton(element, 'plddt'))?.getAttribute('aria-checked')).toBe('true');
    expect((await colorButton(element, 'ted-domains'))?.getAttribute('aria-checked')).toBe('false');
    expect(isDisabled(await colorButton(element, 'ted-domains'))).toBe(true);
  });

  it('cancels the requests of a load that a new protein replaces', async () => {
    const element = await renderViewer(domains);
    const firstSignal = mocks.loadStructure.mock.calls[0]?.[1] as AbortSignal;
    expect(firstSignal.aborted).toBe(false);

    element.proteinId = 'P12345';
    await element.updateComplete;

    expect(firstSignal.aborted).toBe(true);
  });

  it('removes a viewer that finishes mounting after its load was replaced', async () => {
    const staleViewer = deferred<Awaited<ReturnType<typeof mocks.createViewer>>>();
    mocks.createViewer.mockImplementationOnce(() => staleViewer.promise);
    const element = mountViewer(domains);
    await vi.waitFor(() => expect(mocks.createViewer).toHaveBeenCalledOnce());
    const staleMount = mocks.createViewer.mock.calls[0]?.[0] as HTMLElement;

    element.proteinId = 'P12345';
    await vi.waitFor(() => expect(mocks.loadStructureFromUrl).toHaveBeenCalledOnce());
    staleViewer.resolve({ ...mocks, loadStructureFromUrl: vi.fn() });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.dispose).toHaveBeenCalledOnce();
    expect(staleMount.isConnected).toBe(false);
    expect(element.shadowRoot?.querySelectorAll('.molstar-mount')).toHaveLength(1);
  });

  it('does not report an error when a structure finishes after the viewer closes', async () => {
    const structureLoad = deferred<void>();
    mocks.loadStructureFromUrl.mockReturnValueOnce(structureLoad.promise);
    const element = await renderViewer(domains);
    const handleError = vi.fn();
    element.addEventListener('structure-error', handleError);

    element.close();
    structureLoad.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(handleError).not.toHaveBeenCalled();
  });

  it('ignores a load that settles in the frame before its replacement starts', async () => {
    const staleStructureLoad = deferred<void>();
    mocks.loadStructureFromUrl.mockReturnValueOnce(staleStructureLoad.promise);
    const element = await renderViewer(domains);
    const handleLoad = vi.fn();
    element.addEventListener('structure-load', handleLoad);

    // Hold the frame that would start the replacement load (and clean up the old one)
    const pendingFrames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      pendingFrames.push(callback);
      return pendingFrames.length;
    });
    element.proteinId = 'P12345';
    await element.updateComplete;
    staleStructureLoad.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(handleLoad.mock.calls.map(([event]) => event.detail.status)).not.toContain('loaded');
    pendingFrames.forEach((callback) => callback(0));
  });

  it('ignores a stale structure load that settles while its replacement is loading', async () => {
    const staleStructureLoad = deferred<void>();
    const replacementStructureLoad = deferred<void>();
    mocks.loadStructureFromUrl
      .mockReturnValueOnce(staleStructureLoad.promise)
      .mockReturnValueOnce(replacementStructureLoad.promise);
    const element = await renderViewer(domains);
    const handleError = vi.fn();
    const handleLoad = vi.fn();
    element.addEventListener('structure-error', handleError);
    element.addEventListener('structure-load', handleLoad);

    element.proteinId = 'P12345';
    await vi.waitFor(() => expect(mocks.loadStructureFromUrl).toHaveBeenCalledTimes(2));

    staleStructureLoad.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await element.updateComplete;

    expect(handleError).not.toHaveBeenCalled();
    expect(handleLoad.mock.calls.map(([event]) => event.detail.status)).not.toContain('loaded');
    expect(isDisabled(await colorButton(element, 'plddt'))).toBe(true);

    replacementStructureLoad.resolve();
    await vi.waitFor(async () =>
      expect(isDisabled(await colorButton(element, 'plddt'))).toBe(false),
    );
  });

  it('does not reset a replacement viewer theme when a stale structure load finishes', async () => {
    const staleStructureLoad = deferred<void>();
    mocks.loadStructureFromUrl.mockReturnValueOnce(staleStructureLoad.promise);
    const element = await renderViewer(domains);

    element.proteinId = 'P12345';
    await vi.waitFor(() => expect(mocks.loadStructureFromUrl).toHaveBeenCalledTimes(2));
    await vi.waitFor(async () =>
      expect(isDisabled(await colorButton(element, 'ted-domains'))).toBe(false),
    );

    (await colorButton(element, 'ted-domains'))?.click();
    await vi.waitFor(() => expect(mocks.setColorTheme).toHaveBeenLastCalledWith('ted-domains'));

    staleStructureLoad.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.setColorTheme).toHaveBeenLastCalledWith('ted-domains');
  });
});
