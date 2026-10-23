/**
 * @vitest-environment jsdom
 *
 * The renderer reads the plot background on every draw, and the style getters read the neutral
 * greys whenever they are built: both stay off the forced-style-recalculation path, and both
 * follow anything that can restyle them. A theme change that gives the greys new values asks for
 * one restyle; anything else asks for none.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../webgl/color-utils', () => ({
  // Distinct, checkable output per input colour (jsdom has no canvas to parse with).
  resolveColor: vi.fn((css: string) => [css.length, 0, 0] as [number, number, number]),
}));

import { PlotTheme } from './plot-theme';
import { LIGHT_NEUTRALS } from './plot-neutrals';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const root = document.documentElement;

describe('PlotTheme background', () => {
  let host: HTMLElement;
  let reads: ReturnType<typeof vi.spyOn>;
  let theme: PlotTheme;

  beforeEach(() => {
    host = document.createElement('div');
    host.style.backgroundColor = 'rgb(1, 2, 3)'; // 12 chars
    document.body.appendChild(host);
    reads = vi.spyOn(window, 'getComputedStyle');
    theme = new PlotTheme(host, vi.fn());
    theme.connect();
  });

  afterEach(() => {
    theme.disconnect();
    reads.mockRestore();
    document.body.replaceChildren();
    document.head.replaceChildren();
  });

  it('reads computed style once however many times it is asked', () => {
    expect(theme.background()).toEqual([12, 0, 0]);
    theme.background();
    theme.background();
    expect(reads).toHaveBeenCalledTimes(1);
  });

  it('re-reads after a reconnect', () => {
    theme.background();
    host.style.backgroundColor = 'rgb(10, 20, 30)'; // 15 chars
    theme.connect();
    expect(theme.background()).toEqual([15, 0, 0]);
    expect(reads).toHaveBeenCalledTimes(2);
  });

  it('sees an attribute change on the host in the same task, before observers are delivered', () => {
    theme.background();
    host.style.backgroundColor = 'rgb(10, 20, 30)';
    expect(theme.background()).toEqual([15, 0, 0]);
  });

  it('drops the value when an ancestor is restyled', async () => {
    const wrapper = document.createElement('section');
    document.body.appendChild(wrapper);
    wrapper.appendChild(host);
    theme.connect();
    theme.background();

    wrapper.className = 'dark';
    await tick();
    theme.background();
    expect(reads).toHaveBeenCalledTimes(2);
  });

  it('follows the host through a shadow root to the element that contains it', async () => {
    const outer = document.createElement('div');
    document.body.appendChild(outer);
    const shadow = outer.attachShadow({ mode: 'open' });
    shadow.appendChild(host);
    theme.connect();
    theme.background();

    outer.setAttribute('data-theme', 'dark');
    await tick();
    theme.background();
    expect(reads).toHaveBeenCalledTimes(2);
  });

  it('drops the value when a stylesheet is added to <head>', async () => {
    theme.background();
    document.head.appendChild(document.createElement('style'));
    await tick();
    theme.background();
    expect(reads).toHaveBeenCalledTimes(2);
  });

  describe('prefers-color-scheme', () => {
    let media: { matches: boolean; addEventListener: unknown; removeEventListener: unknown };
    let fire: () => void;

    beforeEach(() => {
      fire = () => {};
      media = {
        matches: false,
        addEventListener: vi.fn((_: string, fn: () => void) => (fire = fn)),
        removeEventListener: vi.fn(),
      };
      vi.stubGlobal('matchMedia', () => media);
      theme.connect();
    });

    afterEach(() => vi.unstubAllGlobals());

    it('listens to the scheme once per connect (the theme watcher covers the background)', () => {
      expect(media.addEventListener).toHaveBeenCalledTimes(1);
    });

    it('drops the value when the change event fires', () => {
      theme.background();
      fire();
      theme.background();
      expect(reads).toHaveBeenCalledTimes(2);
    });

    it('drops the value before the change event fires, which waits for the next frame', () => {
      theme.background();
      media.matches = true;
      theme.background();
      expect(reads).toHaveBeenCalledTimes(2);
      theme.background();
      expect(reads).toHaveBeenCalledTimes(2);
    });
  });

  it('does not keep a value read while detached', () => {
    host.remove();
    theme.background();
    theme.background();
    expect(reads).toHaveBeenCalledTimes(2);
  });

  it('forgets the value once disconnected', () => {
    theme.background();
    theme.disconnect();
    theme.background();
    expect(reads).toHaveBeenCalledTimes(2);
  });
});

describe('PlotTheme neutral greys', () => {
  const LIGHT = { '--ps-plot-other': '#888888', '--ps-plot-na': '#dddddd' };
  const DARK = { '--ps-plot-other': ' #64748b', '--ps-plot-na': '#2a3547 ' };
  const DARK_NEUTRALS = { other: '#64748b', na: '#2a3547' };

  let tokens: Record<string, string>;
  let reads: ReturnType<typeof vi.spyOn>;
  let host: HTMLElement;
  let onChange: ReturnType<typeof vi.fn>;
  let theme: PlotTheme;

  /** What `getComputedStyle` resolves the tokens to from now on (jsdom has no cascade for them). */
  const resolveTokens = (next: Record<string, string>) => {
    tokens = next;
  };

  /** A `prefers-color-scheme` query whose change event the test fires; reconnects to it. */
  function stubScheme() {
    const listeners = new Set<() => void>();
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: (_type: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_type: string, fn: () => void) => listeners.delete(fn),
    }));
    theme.connect();
    return () => listeners.forEach((fn) => fn());
  }

  beforeEach(() => {
    tokens = LIGHT;
    reads = vi.spyOn(window, 'getComputedStyle').mockImplementation(
      () =>
        ({
          backgroundColor: 'rgb(255, 255, 255)',
          getPropertyValue: (name: string) => tokens[name] ?? '',
        }) as unknown as CSSStyleDeclaration,
    );
    host = document.createElement('div');
    document.body.appendChild(host);
    onChange = vi.fn();
    theme = new PlotTheme(host, onChange);
    theme.connect();
  });

  afterEach(() => {
    theme.disconnect();
    reads.mockRestore();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
    document.body.removeAttribute('class');
    root.removeAttribute('data-theme');
  });

  it('reads both greys with one computed-style read, trimmed, and keeps them', () => {
    resolveTokens(DARK);
    expect(theme.neutrals()).toEqual(DARK_NEUTRALS);
    theme.neutrals();
    expect(reads).toHaveBeenCalledTimes(1);
  });

  it('neutrals fall back to the light values when the tokens are empty', () => {
    resolveTokens({});
    expect(theme.neutrals()).toEqual(LIGHT_NEUTRALS);
  });

  it('a data-theme flip that changes the greys calls onChange once', async () => {
    theme.neutrals();
    resolveTokens(DARK);
    root.dataset.theme = 'dark';
    await tick();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(theme.neutrals()).toEqual(DARK_NEUTRALS);
  });

  it('re-setting data-theme to its value does not call onChange', async () => {
    theme.neutrals();
    // Explore's layout effect sets the attribute the boot script already set.
    root.dataset.theme = 'light';
    await tick();
    root.dataset.theme = 'light';
    await tick();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('an OS flip with no change in the greys does not call onChange', () => {
    const fire = stubScheme();
    theme.neutrals();
    fire();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('an OS flip that changes the greys calls onChange once', () => {
    const fire = stubScheme();
    theme.neutrals();
    resolveTokens(DARK);
    fire();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('a class change on an ancestor below <html> does not call onChange', async () => {
    const wrapper = document.createElement('section');
    document.body.appendChild(wrapper);
    wrapper.appendChild(host);
    theme.connect();
    theme.neutrals();
    // Even with new token values: only <html> and the OS scheme theme the page.
    resolveTokens(DARK);
    wrapper.className = 'dark';
    document.body.className = 'sliding';
    await tick();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('nothing read yet: a flip does not call onChange', async () => {
    resolveTokens(DARK);
    root.dataset.theme = 'dark';
    await tick();
    expect(onChange).not.toHaveBeenCalled();
    // Nor does it force a style read.
    expect(reads).not.toHaveBeenCalled();
  });

  it('disconnect stops notifications', async () => {
    theme.neutrals();
    theme.disconnect();
    resolveTokens(DARK);
    root.dataset.theme = 'dark';
    await tick();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a change while disconnected is noticed on reconnect', () => {
    theme.neutrals();
    theme.disconnect();
    resolveTokens(DARK);
    theme.connect();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(theme.neutrals()).toEqual(DARK_NEUTRALS);
  });
});
