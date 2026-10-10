import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { adoptTheme } from '../kit/adopt-theme';
import type { ProtspaceStructureViewer } from './structure-viewer';
import './structure-viewer';

beforeAll(() => adoptTheme());

beforeEach(() => {
  // A viewer starts loading a frame after proteinId changes; no load is under test here.
  vi.stubGlobal('requestAnimationFrame', () => 1);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

async function mount(width = ''): Promise<ProtspaceStructureViewer> {
  document.body.innerHTML = `
    <protspace-structure-viewer style="${width && `width: ${width}`}">
      <button slot="header-actions" id="pop-out" type="button">Pop out</button>
    </protspace-structure-viewer>`;
  const viewer = document.querySelector('protspace-structure-viewer')!;
  viewer.proteinId = 'P12345';
  await viewer.updateComplete;
  return viewer;
}

describe('protspace-structure-viewer header', () => {
  it('slotted header actions render before the close button', async () => {
    const viewer = await mount();
    const actions = viewer.shadowRoot!.querySelector('.header-actions')!;
    const slot = actions.querySelector<HTMLSlotElement>('slot[name="header-actions"]')!;
    const action = document.getElementById('pop-out')!;
    expect(slot.assignedElements()).toEqual([action]);
    const close = actions.querySelector('.close-button')!.getBoundingClientRect();
    expect(close.width).toBeGreaterThan(0);
    expect(action.getBoundingClientRect().right).toBeLessThanOrEqual(close.left);
  });

  it('the header is exposed as part header', async () => {
    const viewer = await mount();
    expect(viewer.shadowRoot!.querySelector('.header')!.part.contains('header')).toBe(true);
  });

  it('the title is 13 px semibold with an icon, and the links take the accent text colour', async () => {
    const viewer = await mount();
    const title = viewer.shadowRoot!.querySelector('.title')!;
    expect(getComputedStyle(title).fontSize).toBe('13px');
    expect(getComputedStyle(title).fontWeight).toBe('600');
    expect(title.querySelector('svg.ps-icon')).not.toBeNull();
    const link = viewer.shadowRoot!.querySelector('.header-link')!;
    expect(getComputedStyle(link).color).toBe('rgb(3, 105, 161)');
  });

  it('a clipped link scrolled into view by focus scrolls back when focus leaves', async () => {
    const viewer = await mount('240px');
    const list = viewer.shadowRoot!.querySelector<HTMLElement>('.header-links')!;
    const links = list.querySelectorAll<HTMLAnchorElement>('.header-link');
    links[0].focus();
    links[links.length - 1].focus();
    expect(list.scrollTop).toBeGreaterThan(0);
    links[links.length - 1].blur();
    expect(list.scrollTop).toBe(0);
  });
});

describe('protspace-structure-viewer color mode', () => {
  it('fills the selected segment with the accent under on-accent text', async () => {
    const viewer = await mount();
    const pressed = viewer.shadowRoot!.querySelector('.segmented-btn[aria-pressed="true"]')!;
    expect(getComputedStyle(pressed).backgroundColor).toBe('rgb(0, 122, 181)');
    expect(getComputedStyle(pressed).color).toBe('rgb(255, 255, 255)');
  });
});
