import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { adoptTheme } from '../components/kit/adopt-theme';

const root = document.documentElement;
const token = (el: Element, name: string) => getComputedStyle(el).getPropertyValue(name).trim();

describe('theme tokens in a real cascade', () => {
  beforeAll(() => adoptTheme());
  afterEach(() => root.removeAttribute('data-theme'));

  it('uses the light values by default', () => {
    expect(token(root, '--ps-surface')).toBe('#ffffff');
    expect(token(root, '--ps-accent')).toBe('#007ab5');
    expect(getComputedStyle(root).colorScheme).toBe('light');
  });

  it('switches to the dark values with data-theme="dark"', () => {
    root.dataset.theme = 'dark';
    expect(token(root, '--ps-surface')).toBe('#0f172a');
    expect(getComputedStyle(root).colorScheme).toBe('dark');
  });

  it('reaches inside shadow roots without the component declaring anything', () => {
    const host = document.createElement('div');
    const inner = host.attachShadow({ mode: 'open' }).appendChild(document.createElement('span'));
    document.body.append(host);
    root.dataset.theme = 'dark';
    expect(token(inner, '--ps-text')).toBe('#f1f5f9');
    host.remove();
  });

  it('lets a plain, unlayered page rule override a token in light and in dark', () => {
    const style = document.head.appendChild(document.createElement('style'));
    style.textContent = ':root { --ps-accent: #123456; }';
    expect(token(root, '--ps-accent')).toBe('#123456');
    root.dataset.theme = 'dark';
    expect(token(root, '--ps-accent')).toBe('#123456');
    style.remove();
    expect(token(root, '--ps-accent')).toBe('#38bdf8');
  });

  it('adds the tokens to another document, such as an iframe, with its own sheet', () => {
    const frame = document.body.appendChild(document.createElement('iframe'));
    const doc = frame.contentDocument!;
    expect(() => adoptTheme(doc)).not.toThrow();
    expect(doc.adoptedStyleSheets).toHaveLength(1);
    const style = frame.contentWindow!.getComputedStyle(doc.documentElement);
    expect(style.getPropertyValue('--ps-surface').trim()).toBe('#ffffff');
    frame.remove();
  });
});
