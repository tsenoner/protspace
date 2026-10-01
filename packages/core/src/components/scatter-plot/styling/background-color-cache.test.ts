/**
 * @vitest-environment jsdom
 *
 * The renderer reads the plot background on every draw; the cache keeps that off the
 * forced-style-recalculation path and must still follow anything that can restyle the host.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../webgl/color-utils', () => ({
  // Distinct, checkable output per input colour (jsdom has no canvas to parse with).
  resolveColor: vi.fn((css: string) => [css.length, 0, 0] as [number, number, number]),
}));

import { BackgroundColorCache } from './background-color-cache';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('BackgroundColorCache', () => {
  let host: HTMLElement;
  let reads: ReturnType<typeof vi.spyOn>;
  let cache: BackgroundColorCache;

  beforeEach(() => {
    host = document.createElement('div');
    host.style.backgroundColor = 'rgb(1, 2, 3)'; // 12 chars
    document.body.appendChild(host);
    reads = vi.spyOn(window, 'getComputedStyle');
    cache = new BackgroundColorCache(host);
    cache.connect();
  });

  afterEach(() => {
    cache.disconnect();
    reads.mockRestore();
    document.body.replaceChildren();
    document.head.replaceChildren();
  });

  it('reads computed style once however many times it is asked', () => {
    expect(cache.get()).toEqual([12, 0, 0]);
    cache.get();
    cache.get();
    expect(reads).toHaveBeenCalledTimes(1);
  });

  it('re-reads after invalidate()', () => {
    cache.get();
    host.style.backgroundColor = 'rgb(10, 20, 30)'; // 15 chars
    cache.invalidate();
    expect(cache.get()).toEqual([15, 0, 0]);
    expect(reads).toHaveBeenCalledTimes(2);
  });

  it('sees an attribute change on the host in the same task, before observers are delivered', () => {
    cache.get();
    host.style.backgroundColor = 'rgb(10, 20, 30)';
    expect(cache.get()).toEqual([15, 0, 0]);
  });

  it('drops the value when an ancestor is restyled', async () => {
    const wrapper = document.createElement('section');
    document.body.appendChild(wrapper);
    wrapper.appendChild(host);
    cache.connect();
    cache.get();

    wrapper.className = 'dark';
    await tick();
    cache.get();
    expect(reads).toHaveBeenCalledTimes(2);
  });

  it('follows the host through a shadow root to the element that contains it', async () => {
    const outer = document.createElement('div');
    document.body.appendChild(outer);
    const shadow = outer.attachShadow({ mode: 'open' });
    shadow.appendChild(host);
    cache.connect();
    cache.get();

    outer.setAttribute('data-theme', 'dark');
    await tick();
    cache.get();
    expect(reads).toHaveBeenCalledTimes(2);
  });

  it('drops the value when a stylesheet is added to <head>', async () => {
    cache.get();
    document.head.appendChild(document.createElement('style'));
    await tick();
    cache.get();
    expect(reads).toHaveBeenCalledTimes(2);
  });

  it('drops the value when prefers-color-scheme changes', () => {
    let fire: () => void = () => {};
    const media = {
      addEventListener: (_: string, fn: () => void) => (fire = fn),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('matchMedia', () => media);
    try {
      cache.connect();
      cache.get();
      fire();
      cache.get();
      expect(reads).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not keep a value read while detached', () => {
    host.remove();
    cache.get();
    cache.get();
    expect(reads).toHaveBeenCalledTimes(2);
  });

  it('forgets the value once disconnected', () => {
    cache.get();
    cache.disconnect();
    cache.get();
    expect(reads).toHaveBeenCalledTimes(2);
  });
});
