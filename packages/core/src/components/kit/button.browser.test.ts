import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cdp, page, userEvent } from 'vitest/browser';
import { adoptTheme } from './adopt-theme';
import type { PsButton, PsIconButton } from './button';
import type { PsTooltip } from './tooltip';
import './button';

beforeAll(() => adoptTheme());
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

async function mount<T extends HTMLElement & { updateComplete: Promise<unknown> }>(
  markup: string,
): Promise<T> {
  document.body.innerHTML = markup;
  const el = document.body.firstElementChild as T;
  await el.updateComplete;
  return el;
}
const inner = (host: Element) => host.shadowRoot!.querySelector('button')!;
const tip = (host: Element) =>
  host.shadowRoot!.querySelector('ps-tooltip')!.shadowRoot!.querySelector('.tip')!;
const tipOf = (tooltip: PsTooltip) => tooltip.shadowRoot!.querySelector('.tip')!;
const transitions = (el: Element) => Promise.allSettled(el.getAnimations().map((a) => a.finished));
function escapeOn(target: EventTarget): void {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }),
  );
}

interface AXNode {
  role?: { value: string };
  name?: { value: string };
  description?: { value: string };
}
/** The accessible description Chromium gives each button, as assistive technology reads it. */
async function buttonDescriptions(): Promise<Record<string, string>> {
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
  const out: Record<string, string> = {};
  for (const frameId of frames) {
    const { nodes } = (await session.send('Accessibility.getFullAXTree', { frameId })) as {
      nodes: AXNode[];
    };
    for (const n of nodes)
      if (n.role?.value === 'button') out[n.name?.value ?? ''] = n.description?.value ?? '';
  }
  return out;
}

describe('ps-button', () => {
  it('renders a native button that reports clicks', async () => {
    const el = await mount<PsButton>('<ps-button variant="primary">Export</ps-button>');
    const onClick = vi.fn();
    el.addEventListener('click', onClick);
    inner(el).click();
    expect(onClick).toHaveBeenCalledOnce();
    expect(inner(el).type).toBe('button');
  });

  it('reports no clicks while disabled', async () => {
    const el = await mount<PsButton>('<ps-button disabled>Export</ps-button>');
    const onClick = vi.fn();
    el.addEventListener('click', onClick);
    inner(el).click();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('forwards aria-haspopup and aria-expanded to its inner button', async () => {
    const el = await mount<PsButton>('<ps-button>Color by</ps-button>');
    expect(inner(el).hasAttribute('aria-haspopup')).toBe(false);
    el.setAttribute('aria-haspopup', 'menu');
    el.setAttribute('aria-expanded', 'true');
    await el.updateComplete;
    await expect
      .element(page.getByRole('button', { name: 'Color by', expanded: true }))
      .toBeInTheDocument();
    expect(inner(el).getAttribute('aria-haspopup')).toBe('menu');
  });

  it('takes the primary fill from the tokens', async () => {
    const el = await mount<PsButton>('<ps-button variant="primary">Export</ps-button>');
    expect(getComputedStyle(inner(el)).backgroundColor).toBe('rgb(0, 122, 181)');
  });
});

describe('ps-icon-button', () => {
  it('uses its label as the accessible name', async () => {
    const el = await mount<PsIconButton>(
      '<ps-icon-button icon="x" label="Close"></ps-icon-button>',
    );
    await expect.element(page.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(inner(el).querySelector('svg')).not.toBeNull();
  });

  it('does not repeat its label as a description', async () => {
    await mount<PsIconButton>('<ps-icon-button icon="x" label="Close"></ps-icon-button>');
    expect((await buttonDescriptions()).Close).toBe('');
  });

  it('shows a ghost menu button as open while its menu is expanded', async () => {
    const el = await mount<PsButton>('<ps-button variant="ghost">Projection</ps-button>');
    el.expanded = 'true';
    await el.updateComplete;
    await transitions(inner(el));
    const style = getComputedStyle(inner(el));
    expect(style.backgroundColor).toBe('rgb(241, 245, 249)');
    expect(style.boxShadow).toContain('inset');
    // The focus ring stays an outline, apart from the open ring.
    expect(style.outlineStyle).toBe('none');
  });

  it('keeps the accent colour and tint when a pressed ghost toggle is hovered', async () => {
    const el = await mount<PsIconButton>(
      '<ps-icon-button icon="search" label="Search" variant="ghost"></ps-icon-button>',
    );
    el.pressed = true;
    await el.updateComplete;
    await userEvent.hover(inner(el));
    await transitions(inner(el));
    const style = getComputedStyle(inner(el));
    expect(style.color).toBe('rgb(3, 105, 161)');
    expect(style.backgroundColor).toBe('rgb(224, 242, 254)');
  });

  it('forwards aria-haspopup and aria-expanded to its inner button', async () => {
    const el = await mount<PsIconButton>(
      '<ps-icon-button icon="x" label="More" aria-haspopup="menu" aria-expanded="false"></ps-icon-button>',
    );
    expect(inner(el).getAttribute('aria-haspopup')).toBe('menu');
    el.setAttribute('aria-expanded', 'true');
    await el.updateComplete;
    expect(inner(el).getAttribute('aria-expanded')).toBe('true');
    el.removeAttribute('aria-expanded');
    await el.updateComplete;
    expect(inner(el).hasAttribute('aria-expanded')).toBe(false);
  });

  it('reports a toggle state through aria-pressed only when pressed is set', async () => {
    const el = await mount<PsIconButton>(
      '<ps-icon-button icon="search" label="Search"></ps-icon-button>',
    );
    expect(inner(el).hasAttribute('aria-pressed')).toBe(false);
    el.pressed = true;
    await el.updateComplete;
    expect(inner(el).getAttribute('aria-pressed')).toBe('true');
  });

  it('shows its label as a tooltip on keyboard focus and hides it on Escape', async () => {
    const el = await mount<PsIconButton>(
      '<ps-icon-button icon="x" label="Close"></ps-icon-button>',
    );
    await userEvent.tab();
    expect(tip(el).matches(':popover-open')).toBe(true);
    expect(tip(el).textContent).toBe('Close');
    await userEvent.keyboard('{Escape}');
    expect(tip(el).matches(':popover-open')).toBe(false);
  });

  it('shows the tooltip after 500ms of hover and hides it when the pointer leaves', async () => {
    const el = await mount<PsIconButton>(
      '<ps-icon-button icon="x" label="Close"></ps-icon-button>',
    );
    vi.useFakeTimers();
    inner(el).dispatchEvent(new PointerEvent('pointerenter'));
    vi.advanceTimersByTime(499);
    expect(tip(el).matches(':popover-open')).toBe(false);
    vi.advanceTimersByTime(1);
    expect(tip(el).matches(':popover-open')).toBe(true);
    inner(el).dispatchEvent(new PointerEvent('pointerleave'));
    expect(tip(el).matches(':popover-open')).toBe(false);
  });

  it('cancels the hover tooltip when the pointer leaves before 500ms', async () => {
    const el = await mount<PsIconButton>(
      '<ps-icon-button icon="x" label="Close"></ps-icon-button>',
    );
    vi.useFakeTimers();
    inner(el).dispatchEvent(new PointerEvent('pointerenter'));
    vi.advanceTimersByTime(300);
    inner(el).dispatchEvent(new PointerEvent('pointerleave'));
    vi.advanceTimersByTime(500);
    expect(tip(el).matches(':popover-open')).toBe(false);
  });

  it('a press hides the tooltip and cancels a pending one', async () => {
    const el = await mount<PsIconButton>(
      '<ps-icon-button icon="x" label="Close"></ps-icon-button>',
    );
    vi.useFakeTimers();
    // A press can move the button out from under the pointer, so no pointerleave follows.
    inner(el).dispatchEvent(new PointerEvent('pointerenter'));
    vi.advanceTimersByTime(300);
    inner(el).dispatchEvent(new PointerEvent('pointerdown'));
    vi.advanceTimersByTime(500);
    expect(tip(el).matches(':popover-open')).toBe(false);

    inner(el).dispatchEvent(new PointerEvent('pointerenter'));
    vi.advanceTimersByTime(500);
    expect(tip(el).matches(':popover-open')).toBe(true);
    inner(el).dispatchEvent(new PointerEvent('pointerdown'));
    expect(tip(el).matches(':popover-open')).toBe(false);
  });

  it('hides the tooltip when focus leaves', async () => {
    const el = await mount<PsIconButton>(
      '<ps-icon-button icon="x" label="Close"></ps-icon-button>',
    );
    await userEvent.tab();
    expect(tip(el).matches(':popover-open')).toBe(true);
    await userEvent.tab();
    expect(tip(el).matches(':popover-open')).toBe(false);
  });
});

describe('ps-tooltip', () => {
  it('shows on keyboard focus of the ps-button it follows', async () => {
    document.body.innerHTML =
      '<ps-button>Export</ps-button><ps-tooltip text="Export the figure"></ps-tooltip>';
    const tooltip = document.querySelector('ps-tooltip')!;
    await tooltip.updateComplete;
    await userEvent.tab();
    expect(tipOf(tooltip).matches(':popover-open')).toBe(true);
  });

  it('hides a hover-shown tooltip on Escape while its target is not focused', async () => {
    const el = await mount<PsIconButton>(
      '<ps-icon-button icon="x" label="Close"></ps-icon-button>',
    );
    vi.useFakeTimers();
    inner(el).dispatchEvent(new PointerEvent('pointerenter'));
    vi.advanceTimersByTime(500);
    expect(tip(el).matches(':popover-open')).toBe(true);
    escapeOn(document.body);
    expect(tip(el).matches(':popover-open')).toBe(false);
  });

  it('Escape that hides a shown tooltip is default-prevented; Escape with the tooltip hidden is not', async () => {
    const el = await mount<PsIconButton>(
      '<ps-icon-button icon="x" label="Close"></ps-icon-button>',
    );
    vi.useFakeTimers();
    inner(el).dispatchEvent(new PointerEvent('pointerenter'));
    vi.advanceTimersByTime(500);
    expect(tip(el).matches(':popover-open')).toBe(true);
    const escape = () =>
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        composed: true,
        cancelable: true,
      });

    const hiding = escape();
    document.body.dispatchEvent(hiding);
    expect(hiding.defaultPrevented).toBe(true);
    expect(tip(el).matches(':popover-open')).toBe(false);

    const nothingShown = escape();
    document.body.dispatchEvent(nothingShown);
    expect(nothingShown.defaultPrevented).toBe(false);
  });

  it('describes its target, through a kit button to the inner button that takes focus', async () => {
    document.body.innerHTML = `
      <ps-button>Export</ps-button><ps-tooltip text="Export the figure"></ps-tooltip>
      <button>Reset</button><ps-tooltip text="Restores defaults"></ps-tooltip>`;
    const [first, second] = document.querySelectorAll('ps-tooltip');
    await first.updateComplete;
    await second.updateComplete;
    await document.querySelector('ps-button')!.updateComplete;
    expect(await buttonDescriptions()).toMatchObject({
      Export: 'Export the figure',
      Reset: 'Restores defaults',
    });
    first.remove();
    second.remove();
    await document.querySelector('ps-button')!.updateComplete;
    expect(await buttonDescriptions()).toMatchObject({ Export: '', Reset: '' });
  });

  it('is a named tooltip only while it has text (axe aria-tooltip-name)', async () => {
    document.body.innerHTML = '<button>Name</button><ps-tooltip></ps-tooltip>';
    const tooltip = document.querySelector('ps-tooltip')!;
    await tooltip.updateComplete;
    expect(tooltip.hasAttribute('role')).toBe(false);
    tooltip.text = 'Full name';
    await tooltip.updateComplete;
    expect(tooltip.getAttribute('role')).toBe('tooltip');
    expect(tooltip.getAttribute('aria-label')).toBe('Full name');
    tooltip.text = '';
    await tooltip.updateComplete;
    expect(tooltip.hasAttribute('role')).toBe(false);
    expect(tooltip.hasAttribute('aria-label')).toBe(false);
  });

  it('leaves no listeners on an external anchor when removed in the task it was added', async () => {
    const anchor = document.createElement('button');
    document.body.append(anchor);
    const spy = vi.spyOn(anchor, 'addEventListener');
    const t = document.createElement('ps-tooltip');
    t.text = 'Hint';
    t.anchor = anchor;
    document.body.append(t);
    t.remove();
    await t.updateComplete;
    await Promise.resolve();
    expect(spy).not.toHaveBeenCalled();
    expect(anchor.ariaDescribedByElements ?? []).toEqual([]);
  });

  it('a touch pointerenter does not show the tooltip; a mouse pointerenter does after 500 ms', async () => {
    const el = await mount<PsIconButton>(
      '<ps-icon-button icon="x" label="Close"></ps-icon-button>',
    );
    vi.useFakeTimers();
    // A tap: a label shown now would stay until the next tap elsewhere.
    inner(el).dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'touch' }));
    vi.advanceTimersByTime(1000);
    expect(tip(el).matches(':popover-open')).toBe(false);

    inner(el).dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    vi.advanceTimersByTime(500);
    expect(tip(el).matches(':popover-open')).toBe(true);
  });
});

describe('ps-icon-button tooltip placement', () => {
  const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  it("tooltip-placement sets the tooltip's side", async () => {
    document.body.innerHTML =
      '<ps-icon-button icon="x" label="Close" tooltip-placement="right" style="position: fixed; left: 40px; top: 40px"></ps-icon-button>';
    const el = document.body.firstElementChild as PsIconButton;
    await el.updateComplete;
    const tooltip = el.shadowRoot!.querySelector('ps-tooltip') as PsTooltip;
    await tooltip.updateComplete;
    expect(tooltip.placement).toBe('right');

    tooltip.show();
    await nextFrame();
    await nextFrame();

    const tip = tooltip.shadowRoot!.querySelector('.tip')!.getBoundingClientRect();
    const button = el.shadowRoot!.querySelector('button')!.getBoundingClientRect();
    expect(tip.left).toBeGreaterThanOrEqual(button.right);
    tooltip.hide();
  });
});
