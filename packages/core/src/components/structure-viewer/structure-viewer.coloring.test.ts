/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

function colorButton(element: ProtspaceStructureViewer, mode: StructureColorMode) {
  return element.shadowRoot?.querySelector<HTMLButtonElement>(`[data-color-mode="${mode}"]`);
}

function expectActiveColorMode(element: ProtspaceStructureViewer, mode: StructureColorMode) {
  const inactiveMode: StructureColorMode = mode === 'plddt' ? 'ted-domains' : 'plddt';
  expect(colorButton(element, mode)?.getAttribute('aria-pressed')).toBe('true');
  expect(colorButton(element, inactiveMode)?.getAttribute('aria-pressed')).toBe('false');
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

async function renderViewer(tedDomains: TedDomain[]) {
  mocks.loadStructure.mockResolvedValue(structureData(tedDomains));
  const element = document.createElement('protspace-structure-viewer') as ProtspaceStructureViewer;
  element.autoSync = false;
  element.proteinId = 'A0A0B4U9L8';
  document.body.appendChild(element);

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

    expectActiveColorMode(element, 'plddt');
    expect(colorButton(element, 'ted-domains')?.disabled).toBe(false);
    expect(mocks.createViewer).toHaveBeenCalledWith(expect.any(HTMLElement), domains);
  });

  it('keeps the color toolbar mounted but disabled while a structure loads', async () => {
    const structureLoad = deferred<void>();
    mocks.loadStructureFromUrl.mockReturnValueOnce(structureLoad.promise);
    const element = await renderViewer(domains);
    // Rendering the toolbar up front keeps the Mol* canvas from resizing when loading ends
    expect(element.shadowRoot?.querySelector('.color-toolbar')).not.toBeNull();
    expect(colorButton(element, 'plddt')?.disabled).toBe(true);
    expect(colorButton(element, 'ted-domains')?.disabled).toBe(true);

    structureLoad.resolve();
    await vi.waitFor(() => expect(colorButton(element, 'ted-domains')?.disabled).toBe(false));
  });

  it('disables TED coloring when no assignments are available', async () => {
    const element = await renderViewer([]);
    const tedButton = colorButton(element, 'ted-domains');

    expect(tedButton?.disabled).toBe(true);
    expect(tedButton?.title).toContain('unavailable');
  });

  it('switches the loaded representation to TED and back to pLDDT', async () => {
    const element = await renderViewer(domains);

    colorButton(element, 'ted-domains')?.click();
    await vi.waitFor(() => expect(mocks.setColorTheme).toHaveBeenCalledWith('ted-domains'));
    await element.updateComplete;
    expectActiveColorMode(element, 'ted-domains');

    colorButton(element, 'plddt')?.click();
    await vi.waitFor(() => expect(mocks.setColorTheme).toHaveBeenLastCalledWith('plddt'));
    await element.updateComplete;
    expectActiveColorMode(element, 'plddt');
  });

  it('honors a rapid return to pLDDT while TED coloring is still applying', async () => {
    const element = await renderViewer(domains);
    const tedChange = holdTedThemeChange();

    colorButton(element, 'ted-domains')?.click();
    await vi.waitFor(() => expect(mocks.setColorTheme).toHaveBeenLastCalledWith('ted-domains'));
    colorButton(element, 'plddt')?.click();
    tedChange.resolve();

    await vi.waitFor(() => expect(mocks.setColorTheme).toHaveBeenLastCalledWith('plddt'));
    await element.updateComplete;
    expectActiveColorMode(element, 'plddt');
  });

  it('restores the previous mode when a theme change fails', async () => {
    const element = await renderViewer(domains);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.setColorTheme.mockRejectedValueOnce(new Error('theme failed'));

    colorButton(element, 'ted-domains')?.click();
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalledOnce());
    await element.updateComplete;
    expectActiveColorMode(element, 'plddt');
  });

  it('ignores a completed color change from a replaced viewer', async () => {
    const element = await renderViewer(domains);
    const tedChange = holdTedThemeChange();

    colorButton(element, 'ted-domains')?.click();
    await vi.waitFor(() => expect(mocks.setColorTheme).toHaveBeenLastCalledWith('ted-domains'));

    mocks.loadStructure.mockResolvedValueOnce(structureData([]));
    element.proteinId = 'P12345';
    await vi.waitFor(() => expect(mocks.loadStructureFromUrl).toHaveBeenCalledTimes(2));
    await element.updateComplete;

    tedChange.resolve();
    await tedChange.promise;
    await Promise.resolve();
    await element.updateComplete;

    expect(colorButton(element, 'plddt')?.getAttribute('aria-pressed')).toBe('true');
    expect(colorButton(element, 'ted-domains')?.getAttribute('aria-pressed')).toBe('false');
    expect(colorButton(element, 'ted-domains')?.disabled).toBe(true);
  });

  it('cancels the requests of a load that a new protein replaces', async () => {
    const element = await renderViewer(domains);
    const firstSignal = mocks.loadStructure.mock.calls[0]?.[1] as AbortSignal;
    expect(firstSignal.aborted).toBe(false);

    element.proteinId = 'P12345';
    await element.updateComplete;

    expect(firstSignal.aborted).toBe(true);
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
    expect(colorButton(element, 'plddt')?.disabled).toBe(true);

    replacementStructureLoad.resolve();
    await vi.waitFor(() => expect(colorButton(element, 'plddt')?.disabled).toBe(false));
  });

  it('does not reset a replacement viewer theme when a stale structure load finishes', async () => {
    const staleStructureLoad = deferred<void>();
    mocks.loadStructureFromUrl.mockReturnValueOnce(staleStructureLoad.promise);
    const element = await renderViewer(domains);

    element.proteinId = 'P12345';
    await vi.waitFor(() => expect(mocks.loadStructureFromUrl).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(colorButton(element, 'ted-domains')).not.toBeNull());

    colorButton(element, 'ted-domains')?.click();
    await vi.waitFor(() => expect(mocks.setColorTheme).toHaveBeenLastCalledWith('ted-domains'));

    staleStructureLoad.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.setColorTheme).toHaveBeenLastCalledWith('ted-domains');
  });
});
