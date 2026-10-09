import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProtspaceStructureViewer } from './structure-viewer';
import './structure-viewer';

beforeEach(() => {
  // A viewer starts loading a frame after proteinId changes; no load is under test here.
  vi.stubGlobal('requestAnimationFrame', () => 1);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

async function mount(): Promise<ProtspaceStructureViewer> {
  document.body.innerHTML = `
    <protspace-structure-viewer>
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
});
