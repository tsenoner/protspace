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

/** The viewer's colour control and its options, once the viewer and the control have rendered. */
async function colorControl(viewer: ProtspaceStructureViewer) {
  await viewer.updateComplete;
  const control = viewer.shadowRoot!.querySelector('ps-segmented')!;
  await control.updateComplete;
  const option = (mode: string) =>
    control.shadowRoot!.querySelector<HTMLElement>(`[role="radio"][data-value="${mode}"]`)!;
  return { control, option };
}

/**
 * Stands in for a loaded structure with TED domains (requestAnimationFrame is stubbed, so nothing
 * loads), which enables both colour options.
 */
async function enableColorModes(viewer: ProtspaceStructureViewer): Promise<void> {
  const internals = viewer as unknown as { _viewer: unknown; _structureData: unknown };
  internals._viewer = { setBackground: () => true, dispose() {} };
  internals._structureData = {
    tedDomains: [{ domainNumber: 1, segments: [{ start: 1, end: 10 }] }],
  };
  viewer.requestUpdate();
  await viewer.updateComplete;
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
  it("the checked colour option is the kit's chip", async () => {
    const viewer = await mount();
    const { option } = await colorControl(viewer);
    const checked = option('plddt');
    expect(checked.getAttribute('aria-checked')).toBe('true');
    // The kit's look: a surface chip ringed in the accent (#007ab5), not an accent fill.
    expect(getComputedStyle(checked).boxShadow).toContain('rgb(0, 122, 181)');
    expect(getComputedStyle(checked).backgroundColor).toBe('rgb(255, 255, 255)');
  });

  it('hovering the disabled TED option shows why it is disabled', async () => {
    // requestAnimationFrame is stubbed, so the structure never loads and TED stays disabled.
    const viewer = await mount();
    const { option } = await colorControl(viewer);
    const ted = option('ted-domains');
    expect(ted.getAttribute('aria-disabled')).toBe('true');
    const tooltip = ted.nextElementSibling as HTMLElement & { text: string };
    expect(tooltip.localName).toBe('ps-tooltip');
    expect(tooltip.text).toBe('Available once the structure has loaded');

    await userEvent.hover(ted);
    await expect
      .poll(() => tooltip.shadowRoot?.querySelector('.tip')?.matches(':popover-open'))
      .toBe(true);
  });

  it('the loading veil and the error box sit above the viewer at z-index 10', async () => {
    const viewer = await mount();
    const internals = viewer as unknown as { _isLoading: boolean; _error: string | null };
    internals._isLoading = true;
    internals._error = 'Structure not available';
    await viewer.updateComplete;
    const root = viewer.shadowRoot!;
    expect(getComputedStyle(root.querySelector('.loading-overlay')!).zIndex).toBe('10');
    expect(getComputedStyle(root.querySelector('.error-container')!).zIndex).toBe('10');
    const spinner = getComputedStyle(root.querySelector('.loading-spinner')!);
    expect(spinner.animationName).toBe('spin');
    // #007ab5, the light --ps-accent, on the spinner's moving edge.
    expect(spinner.borderTopColor).toBe('rgb(0, 122, 181)');
  });

  it('the viewer host renders in Inter', async () => {
    const viewer = await mount();
    expect(getComputedStyle(viewer).fontFamily).toMatch(/^"Inter Variable"/);
    // The size properties nothing read are gone.
    expect(getComputedStyle(viewer).getPropertyValue('--protspace-viewer-height').trim()).toBe('');
  });

  it('at 240 px the colour row fits on one line inside the host', async () => {
    const viewer = await mount('240px');
    await enableColorModes(viewer);
    const { control, option } = await colorControl(viewer);
    const toolbar = viewer.shadowRoot!.querySelector<HTMLElement>('.color-toolbar')!;
    // Nothing is pushed past the toolbar's edge…
    expect(toolbar.scrollWidth).toBeLessThanOrEqual(toolbar.clientWidth);
    const host = viewer.getBoundingClientRect();
    const group = control.shadowRoot!.querySelector('[role="radiogroup"]')!.getBoundingClientRect();
    expect(group.right).toBeLessThanOrEqual(host.right + 0.5);
    // …and each label stays inside its chip (Task 8.3 made chips one line).
    for (const mode of ['plddt', 'ted-domains']) {
      const chip = option(mode);
      expect(chip.scrollWidth, mode).toBeLessThanOrEqual(chip.clientWidth);
    }
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
  it('the resource links are 40 px targets and the colour control is a 40 px group', async () => {
    const session = cdp();
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    try {
      const viewer = await mount();
      const links = viewer.shadowRoot!.querySelectorAll('.header-link');
      expect(links.length).toBe(4);
      for (const link of links) {
        const box = link.getBoundingClientRect();
        expect(box.height, link.textContent!.trim()).toBeGreaterThanOrEqual(40 - 0.5);
        expect(box.width, link.textContent!.trim()).toBeGreaterThanOrEqual(40 - 0.5);
      }
      // The kit's touch sizes: 34 px options inside a 40 px group.
      const { control, option } = await colorControl(viewer);
      const group = control.shadowRoot!.querySelector('[role="radiogroup"]')!;
      expect(group.getBoundingClientRect().height).toBeGreaterThanOrEqual(40 - 0.5);
      for (const mode of ['plddt', 'ted-domains']) {
        const box = option(mode).getBoundingClientRect();
        expect(box.height, mode).toBeGreaterThanOrEqual(34 - 0.5);
        expect(box.width, mode).toBeGreaterThanOrEqual(34 - 0.5);
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
    // The colour control, enabled as after a load: #334155 --ps-border-strong around the track,
    // the unchecked option in --ps-text-muted.
    await enableColorModes(viewer);
    const { control, option } = await colorControl(viewer);
    const track = control.shadowRoot!.querySelector('[role="radiogroup"]')!;
    expect(getComputedStyle(track).borderTopColor).toBe('rgb(51, 65, 85)');
    expect(getComputedStyle(option('ted-domains')).color).toBe('rgb(148, 163, 184)');
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

  it('the focused checked colour option shows the library ring', async () => {
    document.documentElement.dataset.theme = 'dark';
    const viewer = await mount();
    await enableColorModes(viewer);
    const { option } = await colorControl(viewer);
    const checked = option('plddt');
    // The checked option is the control's one tab stop, inside ps-segmented's shadow root.
    for (let step = 0; step < 20 && deepActiveElement() !== checked; step++) await userEvent.tab();
    expect(deepActiveElement()).toBe(checked);
    const style = getComputedStyle(checked);
    // sky-400, the dark --ps-focus, 2 px out from the chip.
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
