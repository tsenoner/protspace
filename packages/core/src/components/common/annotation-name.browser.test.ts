import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { adoptStyles, html, render, type TemplateResult } from 'lit';
import { cdp, userEvent } from 'vitest/browser';
import { contrast, toHex } from '../../test-support/contrast';
import { adoptTheme } from '../kit/adopt-theme';
import type { PsTooltip } from '../kit/tooltip';
import { PREDICTED_NOTE, renderAnnotationName } from './annotation-name';
import { predictedBadgeStyles } from './annotation-name.styles';

beforeAll(() => adoptTheme());
afterEach(() => {
  delete document.documentElement.dataset.theme;
  document.body.replaceChildren();
});

/** `template` in a shadow root with the badge's sheet, on the theme's surface. */
function mount(template: TemplateResult): ShadowRoot {
  const host = document.createElement('div');
  host.style.background = 'var(--ps-surface)';
  document.body.append(host);
  const root = host.attachShadow({ mode: 'open' });
  adoptStyles(root, [predictedBadgeStyles]);
  render(template, root);
  return root;
}

interface AXNode {
  role?: { value: string };
  name?: { value: string };
}
/** The accessible name Chromium gives each button in the test frame. */
async function buttonNames(): Promise<string[]> {
  const session = cdp();
  const { frameTree } = (await session.send('Page.getFrameTree')) as {
    frameTree: { frame: { id: string }; childFrames?: unknown[] };
  };
  // The tests run in a child frame of the runner page.
  const frames: string[] = [];
  const walk = (f: { frame: { id: string }; childFrames?: unknown[] }) => {
    frames.push(f.frame.id);
    for (const child of f.childFrames ?? []) walk(child as typeof f);
  };
  walk(frameTree);
  const names: string[] = [];
  for (const frameId of frames.slice(1)) {
    const { nodes } = (await session.send('Accessibility.getFullAXTree', { frameId })) as {
      nodes: AXNode[];
    };
    for (const n of nodes) if (n.role?.value === 'button') names.push(n.name?.value ?? '');
  }
  return names;
}

const trigger = (column: string) =>
  html`<button type="button">
    ${renderAnnotationName(column, undefined, 'dropdown-trigger-text')}
  </button>`;

describe('the PRED badge', () => {
  it('names its holder "… Predicted annotation", without its tooltip text', async () => {
    mount(trigger('predicted_subcellular_location'));
    // Chromium's own accessibility tree, as assistive technology reads it.
    expect(await buttonNames()).toEqual(['Subcellular location Predicted annotation']);
  });

  it('shows its note in the kit tooltip after a hover', async () => {
    const root = mount(trigger('predicted_subcellular_location'));
    const badge = root.querySelector<HTMLElement>('.predicted-mark')!;
    expect(badge.textContent!.trim()).toBe('PRED');
    const tooltip = badge.nextElementSibling as PsTooltip;
    await userEvent.hover(badge);
    await expect
      .poll(() => tooltip.shadowRoot!.querySelector('.tip')!.matches(':popover-open'))
      .toBe(true);
    expect(tooltip.text).toBe(PREDICTED_NOTE);
  });

  it('marks nothing for a curated annotation', () => {
    const root = mount(trigger('cc_subcellular_location'));
    expect(root.querySelector('.predicted-mark')).toBeNull();
    expect(root.querySelector('ps-tooltip')).toBeNull();
  });

  it.each(['light', 'dark'])('keeps 4.5:1 on its own tint in %s', (theme) => {
    if (theme === 'dark') document.documentElement.dataset.theme = 'dark';
    const root = mount(trigger('predicted_membrane'));
    const badge = root.querySelector<HTMLElement>('.predicted-mark')!;
    const surface = getComputedStyle(root.host).backgroundColor;
    const { color, backgroundColor } = getComputedStyle(badge);
    expect(contrast(color, toHex(backgroundColor, surface))).toBeGreaterThanOrEqual(4.5);
  });
});
