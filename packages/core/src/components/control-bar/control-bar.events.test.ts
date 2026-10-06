/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSelectionDisabledNotificationDetail } from './control-bar.events';
import './control-bar';

describe('control-bar events', () => {
  it('builds normalized selection-disabled notifications', () => {
    expect(createSelectionDisabledNotificationDetail('insufficient-data', 1)).toEqual({
      message: 'Selection mode disabled: Only 1 point remaining',
      severity: 'warning',
      source: 'control-bar',
      context: {
        reason: 'insufficient-data',
        dataSize: 1,
      },
    });
  });
});

type ControlBar = HTMLElement & {
  autoSync?: boolean;
  allProteinIds: string[];
  selectedIdsChips: string[];
  updateComplete: Promise<unknown>;
};

// Teardown, not setup: the control bar registers document-level click/keydown
// listeners in `connectedCallback`, so leaving it mounted would leak them into
// whatever runs next in this file.
afterEach(() => {
  document.body.innerHTML = '';
});

/**
 * Mount a control bar over P00595–P00597 with `selected` already chosen, next to a stub
 * structure viewer, and return its mounted `<protspace-protein-search>`.
 */
async function mount(selected: string[]) {
  const controlBar = document.createElement('protspace-control-bar') as ControlBar;
  controlBar.autoSync = false;
  controlBar.allProteinIds = ['P00595', 'P00596', 'P00597'];
  controlBar.selectedIdsChips = selected;
  document.body.appendChild(controlBar);
  await controlBar.updateComplete;

  // The control bar finds viewers with a document-wide query, so a stub element is enough.
  const viewer = document.createElement('protspace-structure-viewer') as HTMLElement & {
    loadProtein: ReturnType<typeof vi.fn>;
  };
  viewer.loadProtein = vi.fn();
  document.body.appendChild(viewer);

  const changeHandler = vi.fn();
  controlBar.addEventListener('protein-selection-change', changeHandler as EventListener);
  const search = controlBar.shadowRoot!.querySelector('protspace-protein-search')!;
  return { controlBar, viewer, changeHandler, search };
}

/**
 * Wiring coverage for `remove-selection`: `search.component.test.ts` covers the emitter
 * side (the search element dispatches the event); this covers the other half — that
 * `control-bar.ts` actually listens for it on the mounted `<protspace-protein-search>`
 * and reacts correctly. A typo in either the binding name or the handler would be silent
 * without this, since neither half alone exercises the connection between them.
 */
describe('control-bar remove-selection wiring', () => {
  it('drops the protein from the selection and emits protein-selection-change with the remaining IDs', async () => {
    const { controlBar, changeHandler, search } = await mount(['P00595', 'P00596']);

    search.dispatchEvent(
      new CustomEvent('remove-selection', {
        detail: { proteinId: 'P00595' },
        bubbles: true,
        composed: true,
      }),
    );
    await controlBar.updateComplete;

    expect(controlBar.selectedIdsChips).toEqual(['P00596']);
    expect(changeHandler).toHaveBeenCalledTimes(1);
    expect((changeHandler.mock.calls[0][0] as CustomEvent).detail).toEqual({
      proteinIds: ['P00596'],
    });
  });
});

/**
 * Wiring coverage for `add-selection-multiple`, the event a multi-ID paste into the search
 * box emits. The emitter side is covered in `search.component.test.ts`; this pins that the
 * control bar merges the batch into its selection and points the structure viewer at it.
 */
describe('control-bar add-selection-multiple wiring', () => {
  const changedIds = (handler: ReturnType<typeof vi.fn>): string[][] =>
    handler.mock.calls.map(([event]) => (event as CustomEvent).detail.proteinIds);

  const addMultiple = (search: Element, proteinIds: string[]) =>
    search.dispatchEvent(
      new CustomEvent('add-selection-multiple', {
        detail: { proteinIds },
        bubbles: true,
        composed: true,
      }),
    );

  it('adds a pasted list of IDs to the selection', async () => {
    const { controlBar, viewer, changeHandler, search } = await mount(['P00595']);

    const event = new Event('paste', { bubbles: true, cancelable: true, composed: true });
    Object.defineProperty(event, 'clipboardData', {
      value: { getData: () => 'p00596\nP00597' },
    });
    search.shadowRoot!.querySelector('#protein-search-input')!.dispatchEvent(event);
    await controlBar.updateComplete;

    expect(controlBar.selectedIdsChips).toEqual(['P00595', 'P00596', 'P00597']);
    expect(changedIds(changeHandler)).toEqual([['P00595', 'P00596', 'P00597']]);
    expect(viewer.loadProtein).toHaveBeenCalledExactlyOnceWith('P00597');
  });

  it('appends only the IDs not yet selected and shows the last of those', async () => {
    const { controlBar, viewer, changeHandler, search } = await mount(['P00595', 'P00597']);

    addMultiple(search, ['P00596', 'P00597']);
    await controlBar.updateComplete;

    expect(controlBar.selectedIdsChips).toEqual(['P00595', 'P00597', 'P00596']);
    expect(changedIds(changeHandler)).toEqual([['P00595', 'P00597', 'P00596']]);
    // P00597 was already selected, so the newly added P00596 is the one to show.
    expect(viewer.loadProtein).toHaveBeenCalledExactlyOnceWith('P00596');
  });

  it.each([
    ['an empty batch', []],
    ['a batch of already-selected IDs', ['P00595']],
  ])('ignores %s', async (_label, proteinIds) => {
    const { controlBar, viewer, changeHandler, search } = await mount(['P00595']);

    addMultiple(search, proteinIds);
    await controlBar.updateComplete;

    expect(controlBar.selectedIdsChips).toEqual(['P00595']);
    expect(changeHandler).not.toHaveBeenCalled();
    expect(viewer.loadProtein).not.toHaveBeenCalled();
  });
});
