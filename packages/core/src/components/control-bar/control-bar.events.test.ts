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

/**
 * Wiring coverage for `remove-selection`: `search.component.test.ts` covers the emitter
 * side (the search element dispatches the event); this covers the other half — that
 * `control-bar.ts` actually listens for it on the mounted `<protspace-protein-search>`
 * and reacts correctly. A typo in either the binding name or the handler would be silent
 * without this, since neither half alone exercises the connection between them.
 */
describe('control-bar remove-selection wiring', () => {
  // Teardown, not setup: the control bar registers document-level click/keydown
  // listeners in `connectedCallback`, so leaving it mounted would leak them into
  // whatever runs next in this file.
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('drops the protein from the selection and emits protein-selection-change with the remaining IDs', async () => {
    const controlBar = document.createElement('protspace-control-bar') as HTMLElement & {
      autoSync?: boolean;
      allProteinIds: string[];
      selectedIdsChips: string[];
      updateComplete: Promise<unknown>;
    };
    controlBar.autoSync = false;
    controlBar.allProteinIds = ['P00595', 'P00596', 'P00597'];
    controlBar.selectedIdsChips = ['P00595', 'P00596'];
    document.body.appendChild(controlBar);
    await controlBar.updateComplete;

    const changeHandler = vi.fn();
    controlBar.addEventListener('protein-selection-change', changeHandler as EventListener);

    const searchElement = controlBar.shadowRoot?.querySelector('protspace-protein-search');
    expect(searchElement).not.toBeNull();

    searchElement!.dispatchEvent(
      new CustomEvent('remove-selection', {
        detail: { proteinId: 'P00595' },
        bubbles: true,
        composed: true,
      }),
    );
    await controlBar.updateComplete;

    expect(controlBar.selectedIdsChips).toEqual(['P00596']);
    // The selection goes out after the paint (control-bar.after-paint.test.ts).
    await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
    expect(changeHandler).toHaveBeenCalledTimes(1);
    expect((changeHandler.mock.calls[0][0] as CustomEvent).detail).toEqual({
      proteinIds: ['P00596'],
    });
  });
});

/**
 * `modifierKeys` is part of the documented `protein-click` detail, but an embedder can
 * dispatch the event without it. That must read as a plain click, not throw.
 */
describe('control-bar protein-click without modifierKeys', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('replaces the selection as an unmodified click would', async () => {
    const controlBar = document.createElement('protspace-control-bar') as HTMLElement & {
      autoSync?: boolean;
      selectedIdsChips: string[];
      updateComplete: Promise<unknown>;
      _handleProteinSelection(event: Event): void;
    };
    controlBar.autoSync = false;
    document.body.appendChild(controlBar);
    await controlBar.updateComplete;

    const click = (proteinId: string) =>
      controlBar._handleProteinSelection(
        new CustomEvent('protein-click', { detail: { proteinId } }),
      );

    click('P00595');
    expect(controlBar.selectedIdsChips).toEqual(['P00595']);
    click('P00596');
    expect(controlBar.selectedIdsChips).toEqual(['P00596']);
  });
});
