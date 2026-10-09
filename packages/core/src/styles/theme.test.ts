import { expect, it } from 'vitest';
import { theme } from './theme';

const hexes = (selector: string) => {
  const start = theme.cssText.indexOf(`${selector} {`);
  const body = theme.cssText.slice(start, theme.cssText.indexOf('}', start));
  return new Map(
    [...body.matchAll(/(--ps-[\w-]+):\s*(#[0-9a-f]{6})\b/g)].map(([, k, v]) => [k, v]),
  );
};
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) =>
  (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

// Design decision 20's role-token check. --ps-text-faint is left out on purpose: it is for
// disabled text and decorative icons only.
it.each([':root', ":root[data-theme='dark']"])(
  'text roles reach 4.5:1 on every surface (%s)',
  (sel) => {
    const t = hexes(sel);
    for (const fg of ['--ps-text', '--ps-text-muted', '--ps-accent-text'])
      for (const bg of [
        '--ps-surface',
        '--ps-surface-muted',
        '--ps-surface-raised',
        '--ps-surface-hover',
      ])
        expect(ratio(t.get(fg)!, t.get(bg)!), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    expect(ratio(t.get('--ps-text-on-accent')!, t.get('--ps-accent')!)).toBeGreaterThanOrEqual(4.5);
  },
);

// WCAG 1.4.11: a control's boundary and the selected-segment ring need 3:1 on what they sit on.
it.each([':root', ":root[data-theme='dark']"])(
  'control boundaries reach 3:1 on every surface (%s)',
  (sel) => {
    const t = hexes(sel);
    for (const fg of ['--ps-border-control', '--ps-accent'])
      for (const bg of ['--ps-surface', '--ps-surface-muted', '--ps-surface-raised'])
        expect(ratio(t.get(fg)!, t.get(bg)!), `${fg} on ${bg}`).toBeGreaterThanOrEqual(3);
  },
);
