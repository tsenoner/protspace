import { afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { adoptTheme } from '../kit/adopt-theme';
import { deepActiveElement } from '../kit/focus';
import { colourChannels } from '../../test-support/css-colour';
import { cdp, userEvent } from 'vitest/browser';
import { MAX_STRUCTURE_CHOICES, type ProtspaceStructureViewer } from './structure-viewer';
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
});

describe('protspace-structure-viewer color mode', () => {
  it('fills the selected segment with the accent under on-accent text', async () => {
    const viewer = await mount();
    const pressed = viewer.shadowRoot!.querySelector('.segmented-btn[aria-pressed="true"]')!;
    expect(getComputedStyle(pressed).backgroundColor).toBe('rgb(0, 122, 181)');
    expect(getComputedStyle(pressed).color).toBe('rgb(255, 255, 255)');
  });

  it('hovering the disabled TED button shows why it is disabled', async () => {
    // requestAnimationFrame is stubbed, so the structure never loads and TED stays disabled.
    const viewer = await mount();
    const ted = viewer.shadowRoot!.querySelector<HTMLButtonElement>(
      '[data-color-mode="ted-domains"]',
    )!;
    expect(ted.disabled).toBe(true);
    const tooltip = ted.nextElementSibling as HTMLElement & { text: string };
    expect(tooltip.localName).toBe('ps-tooltip');
    expect(tooltip.text).toBe('Available once the structure has loaded');

    await userEvent.hover(ted);
    await expect
      .poll(() => tooltip.shadowRoot?.querySelector('.tip')?.matches(':popover-open'))
      .toBe(true);
  });
});

describe('protspace-structure-viewer links row', () => {
  it('at 240 px wide every resource link is visible and inside the host box', async () => {
    const viewer = await mount('240px');
    const host = viewer.getBoundingClientRect();
    const links = Array.from(
      viewer.shadowRoot!.querySelectorAll<HTMLAnchorElement>('.header-link'),
    );
    expect(links).toHaveLength(4);
    for (const link of links) {
      const box = link.getBoundingClientRect();
      expect(box.width).toBeGreaterThan(0);
      expect(box.left).toBeGreaterThanOrEqual(host.left);
      expect(box.right).toBeLessThanOrEqual(host.right);
      expect(box.bottom).toBeLessThanOrEqual(host.bottom);
      // Nothing covers it: a press at its centre lands on the link.
      const hit = viewer.shadowRoot!.elementFromPoint(
        box.left + box.width / 2,
        box.top + box.height / 2,
      );
      expect(link.contains(hit)).toBe(true);
      // The new-tab hint is read, not seen.
      expect(
        link.querySelector('.resource-links-hint')!.getBoundingClientRect().width,
      ).toBeLessThanOrEqual(1);
    }
  });
});

describe('protspace-structure-viewer protein choices', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `Q${String(i).padStart(5, '0')}`);
  const pickButton = (viewer: ProtspaceStructureViewer) =>
    viewer.shadowRoot!.querySelector<HTMLButtonElement>('button.protein-pick')!;
  const items = (viewer: ProtspaceStructureViewer) =>
    Array.from(viewer.shadowRoot!.querySelectorAll('ps-menu-item'));

  async function open(viewer: ProtspaceStructureViewer): Promise<void> {
    pickButton(viewer).click();
    await viewer.updateComplete;
    await vi.waitFor(() => expect(pickButton(viewer).getAttribute('aria-expanded')).toBe('true'));
  }

  it('with several choices the id opens a menu, the shown one checked; a pick loads it and dispatches structure-protein-change', async () => {
    const viewer = await mount();
    viewer.proteinChoices = ['P11111', 'P12345', 'P22222'];
    await viewer.updateComplete;
    const pick = pickButton(viewer);
    expect(pick.getAttribute('aria-label')).toBe(
      'Structure protein: P12345, choose from 3 selected',
    );
    // The menu marks its anchor once it has updated with it.
    await vi.waitFor(() => expect(pick.getAttribute('aria-haspopup')).toBe('menu'));
    // Items render only while the menu is open.
    expect(items(viewer)).toHaveLength(0);
    const changed = vi.fn();
    viewer.addEventListener('structure-protein-change', changed);
    // It leaves the viewer: bubbles and composed, so the shell hears it.
    const onDocument = vi.fn();
    document.addEventListener('structure-protein-change', onDocument);
    onTestFinished(() => document.removeEventListener('structure-protein-change', onDocument));

    await open(viewer);
    expect(items(viewer).map((item) => item.textContent!.trim())).toEqual([
      'P11111',
      'P12345',
      'P22222',
    ]);
    expect(items(viewer).map((item) => item.checked)).toEqual([false, true, false]);

    items(viewer)[2].click();
    await viewer.updateComplete;
    expect(viewer.proteinId).toBe('P22222');
    expect(changed).toHaveBeenCalledOnce();
    expect((changed.mock.calls[0][0] as CustomEvent).detail).toEqual({ proteinId: 'P22222' });
    expect(onDocument).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(pickButton(viewer).getAttribute('aria-expanded')).toBe('false'));
    expect(items(viewer)).toHaveLength(0);

    // Re-picking the shown one changes nothing and dispatches nothing.
    await open(viewer);
    items(viewer)
      .find((item) => item.checked)!
      .click();
    await viewer.updateComplete;
    expect(viewer.proteinId).toBe('P22222');
    expect(changed).toHaveBeenCalledOnce();
  });

  it('from the keyboard, focus lands on the checked item and Escape returns it to the id', async () => {
    const viewer = await mount();
    viewer.proteinChoices = ['P11111', 'P12345', 'P22222'];
    await viewer.updateComplete;
    await vi.waitFor(() => expect(pickButton(viewer).getAttribute('aria-haspopup')).toBe('menu'));

    await open(viewer);
    const checked = items(viewer).find((item) => item.checked)!;
    await vi.waitFor(() => {
      const focused = deepActiveElement();
      expect(focused === checked || checked.shadowRoot!.contains(focused)).toBe(true);
    });

    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() => expect(deepActiveElement()).toBe(pickButton(viewer)));
    expect(pickButton(viewer).getAttribute('aria-expanded')).toBe('false');
  });

  it('the menu renders at most 50 items and says how many were left out', async () => {
    const viewer = await mount();
    const choices = ids(120);
    viewer.proteinChoices = choices;
    viewer.proteinId = choices[100];
    await viewer.updateComplete;
    expect(pickButton(viewer).getAttribute('aria-label')).toBe(
      `Structure protein: ${choices[100]}, choose from 120 selected`,
    );

    await open(viewer);
    const shown = items(viewer);
    expect(shown).toHaveLength(MAX_STRUCTURE_CHOICES + 1);
    expect(shown.slice(0, MAX_STRUCTURE_CHOICES).map((item) => item.textContent!.trim())).toEqual(
      choices.slice(0, MAX_STRUCTURE_CHOICES),
    );
    // The shown protein is always offered, checked, after the first 50.
    expect(shown[MAX_STRUCTURE_CHOICES].textContent!.trim()).toBe(choices[100]);
    expect(shown[MAX_STRUCTURE_CHOICES].checked).toBe(true);
    expect(viewer.shadowRoot!.querySelector('ps-menu-label')!.textContent!.trim()).toBe(
      'First 50 of 120 selected',
    );
  });

  it('the menu is searchable above 8 choices', async () => {
    const viewer = await mount();
    viewer.proteinChoices = ids(8);
    viewer.proteinId = ids(8)[0];
    await viewer.updateComplete;
    const menu = viewer.shadowRoot!.querySelector('ps-menu')!;
    expect(menu.searchable).toBe(false);

    viewer.proteinChoices = ids(9);
    await viewer.updateComplete;
    expect(menu.searchable).toBe(true);
    expect(menu.getAttribute('search-placeholder')).toBe('Search proteins');
    await open(viewer);
    expect(menu.shadowRoot!.querySelector('input[type="search"]')).not.toBeNull();
  });

  it('above 50 choices the search says it searches the first 50', async () => {
    const viewer = await mount();
    viewer.proteinChoices = ids(60);
    viewer.proteinId = ids(60)[0];
    await viewer.updateComplete;
    expect(viewer.shadowRoot!.querySelector('ps-menu')!.getAttribute('search-placeholder')).toBe(
      `Search the first ${MAX_STRUCTURE_CHOICES}`,
    );
  });
});

describe('protspace-structure-viewer under a coarse pointer', () => {
  it('the resource links and the colour-mode buttons are 40 px tall', async () => {
    const session = cdp();
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    try {
      const viewer = await mount();
      const targets = viewer.shadowRoot!.querySelectorAll('.header-link, .segmented-btn');
      expect(targets.length).toBeGreaterThanOrEqual(6);
      for (const target of targets) {
        const box = target.getBoundingClientRect();
        expect(box.height, target.textContent!.trim()).toBeGreaterThanOrEqual(40 - 0.5);
        expect(box.width, target.textContent!.trim()).toBeGreaterThanOrEqual(40 - 0.5);
      }
    } finally {
      await session.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    }
  });

  it('the close button and the protein pick are 40 px targets', async () => {
    const session = cdp();
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    try {
      expect(matchMedia('(pointer: coarse)').matches).toBe(true);
      const viewer = await mount();
      viewer.proteinChoices = ['P11111', 'P12345', 'P22222'];
      await viewer.updateComplete;
      for (const selector of ['.close-button', 'button.protein-pick']) {
        const box = viewer.shadowRoot!.querySelector(selector)!.getBoundingClientRect();
        expect(box.width, selector).toBeGreaterThanOrEqual(40 - 0.5);
        expect(box.height, selector).toBeGreaterThanOrEqual(40 - 0.5);
      }
    } finally {
      await session.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    }
  });
});

describe('protspace-structure-viewer in dark', () => {
  afterEach(() => document.documentElement.removeAttribute('data-theme'));

  it('in dark the frame, header and footer read the dark surfaces and text', async () => {
    document.documentElement.dataset.theme = 'dark';
    const viewer = await mount();
    const root = viewer.shadowRoot!;
    const style = (selector: string) => getComputedStyle(root.querySelector(selector)!);
    // #0f172a --ps-surface (the colour Mol*'s canvas takes) and #1e293b --ps-border.
    expect(getComputedStyle(viewer).backgroundColor).toBe('rgb(15, 23, 42)');
    expect(getComputedStyle(viewer).borderTopColor).toBe('rgb(30, 41, 59)');
    expect(style('.viewer-container').backgroundColor).toBe('rgb(15, 23, 42)');
    // #131d33 --ps-surface-muted for the header band and the footer.
    expect(style('.header').backgroundColor).toBe('rgb(19, 29, 51)');
    expect(style('.color-toolbar').backgroundColor).toBe('rgb(19, 29, 51)');
    // #94a3b8 --ps-text-muted.
    expect(style('.color-toolbar').color).toBe('rgb(148, 163, 184)');
    expect(style('.close-button').color).toBe('rgb(148, 163, 184)');
    // The segmented control: #334155 --ps-border-strong, unpressed text muted.
    expect(style('.segmented').borderTopColor).toBe('rgb(51, 65, 85)');
    expect(style('.segmented-btn[aria-pressed="false"]').color).toBe('rgb(148, 163, 184)');
  });

  it('the loading veil is a translucent dark surface in dark', async () => {
    document.documentElement.dataset.theme = 'dark';
    const viewer = await mount();
    // requestAnimationFrame is stubbed, so nothing loads: show the veil as a load does.
    (viewer as unknown as { _isLoading: boolean })._isLoading = true;
    await viewer.updateComplete;
    const veil = viewer.shadowRoot!.querySelector('.loading-overlay')!;
    const [r, g, b, alpha] = colourChannels(getComputedStyle(veil).backgroundColor);
    expect([r, g, b]).toEqual([15, 23, 42]);
    expect(alpha).toBeCloseTo(0.9, 2);
  });

  it('the focused selected colour segment shows the library ring, offset from its fill', async () => {
    document.documentElement.dataset.theme = 'dark';
    const viewer = await mount();
    // requestAnimationFrame is stubbed, so nothing loads: a stand-in viewer enables the segments.
    (viewer as unknown as { _viewer: unknown })._viewer = {
      setBackground: () => true,
      dispose() {},
    };
    viewer.requestUpdate();
    await viewer.updateComplete;
    const root = viewer.shadowRoot!;
    const pressed = root.querySelector<HTMLElement>('.segmented-btn[aria-pressed="true"]')!;
    for (let step = 0; step < 20 && root.activeElement !== pressed; step++) await userEvent.tab();
    expect(root.activeElement).toBe(pressed);
    const style = getComputedStyle(pressed);
    // sky-400, the dark --ps-focus: the same colour as the fill, so the 2 px offset gap shows it.
    expect(style.outlineStyle).toBe('solid');
    expect(style.outlineColor).toBe('rgb(56, 189, 248)');
    expect(style.outlineOffset).toBe('2px');
  });
});

describe('protspace-structure-viewer Mol* canvas box', () => {
  it('puts the Mol* box on whole pixels inside its container at any fractional offset', async () => {
    const viewer = await mount();
    const root = viewer.shadowRoot!;
    // A stand-in for Mol*: its layout is absolutely positioned in the mount.
    const mountEl = document.createElement('div');
    mountEl.className = 'molstar-mount';
    const plugin = document.createElement('div');
    plugin.style.cssText = 'position: absolute; inset: 0';
    mountEl.append(plugin);
    root.querySelector('.viewer-content')!.append(mountEl);
    const container = root.querySelector('.viewer-container')!;
    const snap = () => (viewer as unknown as { _snapMount(): void })._snapMount();
    for (const [offset, height] of [
      [0, 360],
      [0.4, 360.4],
      [0.5, 361.9],
      [0.6, 360.6],
    ]) {
      viewer.style.marginTop = `${offset}px`;
      viewer.style.height = `${height}px`;
      snap();
      const box = container.getBoundingClientRect();
      const canvas = plugin.getBoundingClientRect();
      const label = `${offset}px / ${height}px`;
      expect(Number.isInteger(canvas.top * devicePixelRatio), label).toBe(true);
      expect(Number.isInteger(canvas.height), label).toBe(true);
      expect(canvas.top, label).toBeGreaterThanOrEqual(box.top);
      expect(canvas.bottom, label).toBeLessThanOrEqual(box.bottom);
      expect(box.bottom - canvas.bottom, label).toBeLessThan(2);
    }
  });
});
