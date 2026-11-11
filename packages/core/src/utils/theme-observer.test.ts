/**
 * @vitest-environment jsdom
 *
 * The one place core hears that the page's theme may have changed. Its calls are raw: the
 * consumers compare token values before they redraw anything.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeTheme } from './theme-observer';

const root = document.documentElement;
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A `prefers-color-scheme` query whose change event the test fires. */
function stubScheme() {
  const listeners = new Set<() => void>();
  const media = {
    matches: false,
    addEventListener: (_type: string, fn: () => void) => listeners.add(fn),
    removeEventListener: vi.fn((_type: string, fn: () => void) => listeners.delete(fn)),
  };
  vi.stubGlobal('matchMedia', () => media);
  return { media, fire: () => listeners.forEach((fn) => fn()) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const name of ['data-theme', 'class', 'style', 'lang']) root.removeAttribute(name);
  document.body.removeAttribute('data-theme');
  document.body.removeAttribute('class');
});

describe('observeTheme', () => {
  it('a data-theme change notifies once', async () => {
    const onChange = vi.fn();
    const stop = observeTheme(onChange);
    root.dataset.theme = 'dark';
    root.dataset.theme = 'light';
    await tick();
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
  });

  it('class and style changes on <html> notify', async () => {
    const onChange = vi.fn();
    const stop = observeTheme(onChange);
    root.className = 'dark';
    await tick();
    expect(onChange).toHaveBeenCalledTimes(1);
    root.style.setProperty('--ps-plot-other', '#123456');
    await tick();
    expect(onChange).toHaveBeenCalledTimes(2);
    stop();
  });

  it('a prefers-color-scheme change notifies', () => {
    const scheme = stubScheme();
    const onChange = vi.fn();
    const stop = observeTheme(onChange);
    scheme.media.matches = true;
    scheme.fire();
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
  });

  it('attribute changes on <body> or deeper do not notify', async () => {
    const onChange = vi.fn();
    const stop = observeTheme(onChange);
    const panel = document.body.appendChild(document.createElement('div'));
    document.body.dataset.theme = 'dark';
    document.body.className = 'sliding';
    panel.style.width = '10px';
    // Nor an attribute of <html> that does not theme it.
    root.setAttribute('lang', 'en');
    await tick();
    expect(onChange).not.toHaveBeenCalled();
    panel.remove();
    stop();
  });

  it('the returned function stops both', async () => {
    const scheme = stubScheme();
    const onChange = vi.fn();
    const stop = observeTheme(onChange);
    stop();
    root.dataset.theme = 'dark';
    scheme.fire();
    await tick();
    expect(onChange).not.toHaveBeenCalled();
    expect(scheme.media.removeEventListener).toHaveBeenCalledTimes(1);
  });

  it('no MutationObserver or matchMedia: nothing throws', () => {
    vi.stubGlobal('MutationObserver', undefined);
    vi.stubGlobal('matchMedia', undefined);
    expect(() => observeTheme(vi.fn())()).not.toThrow();
  });
});
