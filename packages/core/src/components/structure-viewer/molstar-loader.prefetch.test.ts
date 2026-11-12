/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The loader remembers that it already prefetched; each test needs a fresh module.
async function loadFresh(): Promise<{ prefetchMolstar: () => void }> {
  vi.resetModules();
  return import('./molstar-loader');
}

const prefetchLinks = () =>
  Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[rel="prefetch"]'));

describe('prefetchMolstar', () => {
  beforeEach(() => {
    document.head.replaceChildren();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.head.replaceChildren();
  });

  it('hints the script and the stylesheet from the same CDN version the loader uses', async () => {
    const { prefetchMolstar } = await loadFresh();
    prefetchMolstar();

    expect(prefetchLinks().map((link) => [link.as, link.href])).toEqual([
      ['script', expect.stringMatching(/\/npm\/molstar@[\d.]+\/build\/viewer\/molstar\.js$/)],
      ['style', expect.stringMatching(/\/npm\/molstar@[\d.]+\/build\/viewer\/molstar\.css$/)],
    ]);
  });

  it('adds nothing on a second call', async () => {
    const { prefetchMolstar } = await loadFresh();
    prefetchMolstar();
    prefetchMolstar();
    expect(prefetchLinks()).toHaveLength(2);
  });

  it('does not run the script: a hint is not a <script> element', async () => {
    const { prefetchMolstar } = await loadFresh();
    prefetchMolstar();
    expect(document.getElementById('molstar-script')).toBeNull();
    expect(document.head.querySelector('script')).toBeNull();
  });

  it('stays out of the way when Mol* is already loading', async () => {
    const script = document.createElement('script');
    script.id = 'molstar-script';
    document.head.appendChild(script);

    const { prefetchMolstar } = await loadFresh();
    prefetchMolstar();
    expect(prefetchLinks()).toHaveLength(0);
  });

  it('respects the data-saver preference', async () => {
    vi.stubGlobal('navigator', { connection: { saveData: true } });
    const { prefetchMolstar } = await loadFresh();
    prefetchMolstar();
    expect(prefetchLinks()).toHaveLength(0);
  });
});
