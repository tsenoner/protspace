/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StructureData, TedDomain } from '@protspace/utils';

const mocks = vi.hoisted(() => ({
  loadStructure: vi.fn(),
  createViewer: vi.fn(),
  loadStructureFromUrl: vi.fn(),
  setColorTheme: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock('@protspace/utils', () => ({
  StructureService: { loadStructure: mocks.loadStructure },
}));

vi.mock('./molstar-loader', () => ({
  createMolstarViewer: mocks.createViewer,
}));

import './structure-viewer';
import type { ProtspaceStructureViewer } from './structure-viewer';

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
    const plddtButton = element.shadowRoot?.querySelector<HTMLButtonElement>(
      '[data-color-mode="plddt"]',
    );
    const tedButton = element.shadowRoot?.querySelector<HTMLButtonElement>(
      '[data-color-mode="ted-domains"]',
    );

    expect(plddtButton?.getAttribute('aria-pressed')).toBe('true');
    expect(tedButton?.getAttribute('aria-pressed')).toBe('false');
    expect(tedButton?.disabled).toBe(false);
    expect(element.shadowRoot?.querySelector('.color-description')?.textContent).toContain(
      'pLDDT confidence',
    );
  });

  it('disables TED coloring when no assignments are available', async () => {
    const element = await renderViewer([]);
    const tedButton = element.shadowRoot?.querySelector<HTMLButtonElement>(
      '[data-color-mode="ted-domains"]',
    );

    expect(tedButton?.disabled).toBe(true);
    expect(tedButton?.title).toContain('unavailable');
  });

  it('switches the loaded representation to TED and back to pLDDT', async () => {
    const element = await renderViewer(domains);
    const plddtButton = element.shadowRoot?.querySelector<HTMLButtonElement>(
      '[data-color-mode="plddt"]',
    );
    const tedButton = element.shadowRoot?.querySelector<HTMLButtonElement>(
      '[data-color-mode="ted-domains"]',
    );

    tedButton?.click();
    await vi.waitFor(() =>
      expect(mocks.setColorTheme).toHaveBeenCalledWith('ted-domains', domains),
    );
    await element.updateComplete;
    expect(tedButton?.getAttribute('aria-pressed')).toBe('true');
    expect(element.shadowRoot?.querySelector('.color-description')?.textContent).toContain(
      'TED domains',
    );

    plddtButton?.click();
    await vi.waitFor(() => expect(mocks.setColorTheme).toHaveBeenLastCalledWith('plddt'));
    await element.updateComplete;
    expect(plddtButton?.getAttribute('aria-pressed')).toBe('true');
    expect(tedButton?.getAttribute('aria-pressed')).toBe('false');
    expect(element.shadowRoot?.querySelector('.color-description')?.textContent).toContain(
      'pLDDT confidence',
    );
  });

  it('honors a rapid return to pLDDT while TED coloring is still applying', async () => {
    const element = await renderViewer(domains);
    const tedChange = deferred<void>();
    mocks.setColorTheme.mockImplementation((mode) =>
      mode === 'ted-domains' ? tedChange.promise : Promise.resolve(),
    );
    const plddtButton = element.shadowRoot?.querySelector<HTMLButtonElement>(
      '[data-color-mode="plddt"]',
    );
    const tedButton = element.shadowRoot?.querySelector<HTMLButtonElement>(
      '[data-color-mode="ted-domains"]',
    );

    tedButton?.click();
    await vi.waitFor(() =>
      expect(mocks.setColorTheme).toHaveBeenLastCalledWith('ted-domains', domains),
    );
    plddtButton?.click();
    tedChange.resolve();

    await vi.waitFor(() => expect(mocks.setColorTheme).toHaveBeenLastCalledWith('plddt'));
    await element.updateComplete;
    expect(plddtButton?.getAttribute('aria-pressed')).toBe('true');
    expect(tedButton?.getAttribute('aria-pressed')).toBe('false');
    expect(element.shadowRoot?.querySelector('.color-description')?.textContent).toContain(
      'pLDDT confidence',
    );
  });

  it('ignores a completed color change from a replaced viewer', async () => {
    const element = await renderViewer(domains);
    const tedChange = deferred<void>();
    mocks.setColorTheme.mockImplementation((mode) =>
      mode === 'ted-domains' ? tedChange.promise : Promise.resolve(),
    );
    const tedButton = element.shadowRoot?.querySelector<HTMLButtonElement>(
      '[data-color-mode="ted-domains"]',
    );

    tedButton?.click();
    await vi.waitFor(() =>
      expect(mocks.setColorTheme).toHaveBeenLastCalledWith('ted-domains', domains),
    );

    mocks.loadStructure.mockResolvedValueOnce(structureData([]));
    element.proteinId = 'P12345';
    await vi.waitFor(() => expect(mocks.loadStructureFromUrl).toHaveBeenCalledTimes(2));
    await element.updateComplete;

    tedChange.resolve();
    await tedChange.promise;
    await Promise.resolve();
    await element.updateComplete;

    const replacementPlddtButton = element.shadowRoot?.querySelector<HTMLButtonElement>(
      '[data-color-mode="plddt"]',
    );
    const replacementTedButton = element.shadowRoot?.querySelector<HTMLButtonElement>(
      '[data-color-mode="ted-domains"]',
    );
    expect(replacementPlddtButton?.getAttribute('aria-pressed')).toBe('true');
    expect(replacementTedButton?.getAttribute('aria-pressed')).toBe('false');
    expect(replacementTedButton?.disabled).toBe(true);
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

  it('does not reset a replacement viewer theme when a stale structure load finishes', async () => {
    const staleStructureLoad = deferred<void>();
    mocks.loadStructureFromUrl.mockReturnValueOnce(staleStructureLoad.promise);
    const element = await renderViewer(domains);

    element.proteinId = 'P12345';
    await vi.waitFor(() => expect(mocks.loadStructureFromUrl).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(
        element.shadowRoot?.querySelector<HTMLButtonElement>('[data-color-mode="ted-domains"]'),
      ).not.toBeNull(),
    );

    element.shadowRoot
      ?.querySelector<HTMLButtonElement>('[data-color-mode="ted-domains"]')
      ?.click();
    await vi.waitFor(() =>
      expect(mocks.setColorTheme).toHaveBeenLastCalledWith('ted-domains', domains),
    );

    staleStructureLoad.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.setColorTheme).toHaveBeenLastCalledWith('ted-domains', domains);
  });
});
