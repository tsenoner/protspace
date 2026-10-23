import { expect, it } from 'vitest';
import { NA_DEFAULT_COLOR } from '@protspace/utils';
import { NEUTRAL_VALUE_COLOR } from '../components/scatter-plot/config';
import { contrast, declaredIn, tokensOf, toHex } from '../test-support/contrast';

const THEMES = [':root', ":root[data-theme='dark']"] as const;
const SURFACES = [
  '--ps-surface',
  '--ps-surface-muted',
  '--ps-surface-raised',
  '--ps-surface-hover',
] as const;

/** A token's raw value in one theme; a token missing from theme.ts fails by name. */
function token(t: Map<string, string>, name: string): string {
  const value = t.get(name);
  if (value === undefined) throw new Error(`${name} is not declared`);
  return value;
}

/** Contrast of `fg` on `bg` in one theme, both tokens; `bg` may be translucent over `under`. */
function ratio(t: Map<string, string>, fg: string, bg: string, under?: string): number {
  const back = toHex(token(t, bg), under === undefined ? undefined : toHex(token(t, under)));
  return contrast(toHex(token(t, fg), back), back);
}

it('toHex composites a translucent token over its backdrop, and refuses one without', () => {
  expect(toHex('#0F172A')).toBe('#0f172a');
  expect(toHex('#fff')).toBe('#ffffff');
  expect(toHex('rgb(56 189 248 / 0.16)', '#0f172a')).toBe('#16324b');
  expect(toHex('rgba(0, 0, 0, 0.5)', '#ffffff')).toBe('#808080');
  expect(() => toHex('rgb(56 189 248 / 0.16)')).toThrow(/translucent/);
  expect(() => toHex('transparent')).toThrow();
  expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 5);
});

// Design decision 20's role-token check. --ps-text-faint is left out on purpose: it is for
// disabled text and decorative icons only.
it.each(THEMES)('text roles reach 4.5:1 on every surface (%s)', (sel) => {
  const t = tokensOf(sel);
  for (const fg of ['--ps-text', '--ps-text-muted', '--ps-accent-text'])
    for (const bg of SURFACES)
      expect(ratio(t, fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  expect(ratio(t, '--ps-text-on-accent', '--ps-accent')).toBeGreaterThanOrEqual(4.5);
});

// WCAG 1.4.11: a control's boundary and the selected-segment ring need 3:1 on what they sit on.
it.each(THEMES)('control boundaries reach 3:1 on every surface (%s)', (sel) => {
  const t = tokensOf(sel);
  for (const fg of ['--ps-border-control', '--ps-accent'])
    for (const bg of ['--ps-surface', '--ps-surface-muted', '--ps-surface-raised'])
      expect(ratio(t, fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(3);
});

it.each(THEMES)('focus reaches 3:1 on every surface (%s)', (sel) => {
  const t = tokensOf(sel);
  for (const bg of SURFACES)
    expect(ratio(t, '--ps-focus', bg), `--ps-focus on ${bg}`).toBeGreaterThanOrEqual(3);
});

it.each(THEMES)('tooltip text reaches 4.5:1 on the tooltip background (%s)', (sel) => {
  expect(ratio(tokensOf(sel), '--ps-tooltip-text', '--ps-tooltip-bg')).toBeGreaterThanOrEqual(4.5);
});

// A selected row or item: the tint is translucent in dark, so it is composited over the surface.
it.each(THEMES)(
  'text and accent text reach 4.5:1 on the accent tint over the surface (%s)',
  (sel) => {
    const t = tokensOf(sel);
    for (const fg of ['--ps-text', '--ps-text-muted', '--ps-accent-text'])
      expect(
        ratio(t, fg, '--ps-accent-tint', '--ps-surface'),
        `${fg} on the tint`,
      ).toBeGreaterThanOrEqual(4.5);
  },
);

// A hovered danger button keeps its red text on the hover surface (kit button.styles.ts).
it.each(THEMES)(
  'danger reaches 4.5:1 on the surface, the raised surface and the hover surface (%s)',
  (sel) => {
    const t = tokensOf(sel);
    for (const bg of ['--ps-surface', '--ps-surface-raised', '--ps-surface-hover'])
      expect(ratio(t, '--ps-danger', bg), `--ps-danger on ${bg}`).toBeGreaterThanOrEqual(4.5);
  },
);

// Marks on the plot. --ps-plot-na is exempt: N/A points are de-emphasised by design.
it.each(THEMES)(
  'plot Other, connector and EAT endpoint reach 3:1 on the plot background (%s)',
  (sel) => {
    const t = tokensOf(sel);
    for (const fg of ['--ps-plot-other', '--ps-plot-connector', '--ps-eat-endpoint'])
      expect(ratio(t, fg, '--ps-plot-bg'), `${fg} on --ps-plot-bg`).toBeGreaterThanOrEqual(3);
  },
);

it.each(THEMES)('the EAT colour reaches 3:1 on the raised surface (%s)', (sel) => {
  expect(ratio(tokensOf(sel), '--ps-eat', '--ps-surface-raised')).toBeGreaterThanOrEqual(3);
});

it.each(THEMES)('the swatch outline reaches 3:1 on the surface (%s)', (sel) => {
  expect(ratio(tokensOf(sel), '--ps-swatch-stroke', '--ps-surface')).toBeGreaterThanOrEqual(3);
});

// Light faint text is 2.6:1 by design (disabled text only); dark keeps decorative icons visible.
it('faint text reaches 3:1 on the surface in dark', () => {
  expect(
    ratio(tokensOf(":root[data-theme='dark']"), '--ps-text-faint', '--ps-surface'),
  ).toBeGreaterThanOrEqual(3);
});

// The light plot greys are the data's own colours, which exports always draw with: a light
// theme must draw exactly what an export does.
it('light --ps-plot-other equals NEUTRAL_VALUE_COLOR and light --ps-plot-na equals NA_DEFAULT_COLOR (case-insensitive)', () => {
  const light = tokensOf(':root');
  expect(light.get('--ps-plot-other')?.toLowerCase()).toBe(NEUTRAL_VALUE_COLOR.toLowerCase());
  expect(light.get('--ps-plot-na')?.toLowerCase()).toBe(NA_DEFAULT_COLOR.toLowerCase());
});

it('both role blocks define --ps-plot-bg, --ps-plot-other and --ps-plot-na', () => {
  for (const sel of [':root', ":root[data-theme='dark']", ":root[data-theme='system']"] as const) {
    const t = declaredIn(sel);
    for (const name of ['--ps-plot-bg', '--ps-plot-other', '--ps-plot-na']) {
      expect(t.get(name), `${name} in ${sel}`).toMatch(/^#[0-9a-f]{6}$/);
    }
  }
  expect(declaredIn(":root[data-theme='dark']").get('--ps-plot-bg')).toBe('#0b1120');
});

// The dark gates read the dark block with a :root fallback; a role the dark block forgot would be
// measured at its light value. Sizes and the fixed paper roles are the only light-only tokens.
it('the dark and system blocks redeclare every light colour role', () => {
  const light = declaredIn(':root');
  const fixed = new Set(['--ps-paper', '--ps-paper-check']);
  const roles = [...light]
    .filter(([name, value]) => !fixed.has(name) && /#|rgb\(|^none$|invert\(/.test(value))
    .map(([name]) => name)
    .sort();
  for (const sel of [":root[data-theme='dark']", ":root[data-theme='system']"] as const)
    expect([...declaredIn(sel).keys()].sort(), sel).toEqual(roles);
});

it('the system block carries the dark values', () => {
  expect(tokensOf(":root[data-theme='system']").get('--ps-surface')).toBe(
    tokensOf(":root[data-theme='dark']").get('--ps-surface'),
  );
  expect(tokensOf(":root[data-theme='system']").get('--ps-surface')).not.toBe(
    tokensOf(':root').get('--ps-surface'),
  );
});
