import { describe, expect, it, vi } from 'vitest';
import { createUndoController, undoEntrySize, type UndoEntry } from './undo-controller';
import { createUndoHistory } from './undo-history';

interface KeyInit {
  key?: string;
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  composing?: boolean;
  path?: unknown[];
}

/** A keydown as the document hears it in the bubble phase, with its composed path. */
function keydown(init: KeyInit): Event {
  return Object.assign(new Event('keydown', { cancelable: true }), {
    key: init.key ?? 'z',
    metaKey: init.meta ?? false,
    ctrlKey: init.ctrl ?? false,
    shiftKey: init.shift ?? false,
    altKey: init.alt ?? false,
    isComposing: init.composing ?? false,
    composedPath: () => init.path ?? [],
  });
}

const step = (id: string): UndoEntry => ({ kind: 'selection', before: [], after: [id] });

function setup({ mac = false, modal = false } = {}) {
  const history = createUndoHistory<UndoEntry>({ size: undoEntrySize });
  const root = new EventTarget();
  const apply = vi.fn();
  const controller = createUndoController({
    history,
    root: root as unknown as Document,
    isMac: () => mac,
    isModalOpen: () => modal,
    apply,
  });
  const press = (init: KeyInit) => {
    const event = keydown(init);
    root.dispatchEvent(event);
    return event;
  };
  return { history, apply, controller, press };
}

describe('undo controller', () => {
  it('Mod is ⌘ on Mac and Ctrl elsewhere', () => {
    const mac = setup({ mac: true });
    const a = step('a');
    mac.history.record(a);
    expect(mac.press({ ctrl: true }).defaultPrevented).toBe(false);
    expect(mac.apply).not.toHaveBeenCalled();
    expect(mac.press({ meta: true }).defaultPrevented).toBe(true);
    expect(mac.apply).toHaveBeenCalledExactlyOnceWith(a, 'undo');

    const other = setup();
    other.history.record(a);
    expect(other.press({ meta: true }).defaultPrevented).toBe(false);
    expect(other.press({ ctrl: true }).defaultPrevented).toBe(true);
    expect(other.apply).toHaveBeenCalledExactlyOnceWith(a, 'undo');
  });

  it('Shift redoes', () => {
    const m = setup();
    const a = step('a');
    m.history.record(a);
    m.press({ ctrl: true });
    expect(m.press({ ctrl: true, shift: true, key: 'Z' }).defaultPrevented).toBe(true);
    expect(m.apply).toHaveBeenLastCalledWith(a, 'redo');
  });

  it('Alt and composing are ignored', () => {
    const m = setup();
    m.history.record(step('a'));
    expect(m.press({ ctrl: true, alt: true }).defaultPrevented).toBe(false);
    expect(m.press({ ctrl: true, composing: true }).defaultPrevented).toBe(false);
    expect(m.apply).not.toHaveBeenCalled();
  });

  it('an input inside a shadow-root path is ignored', () => {
    const m = setup();
    m.history.record(step('a'));
    // A filter value field: an input in a kit field in the query builder, two shadow roots deep.
    const path = [
      { tagName: 'INPUT' },
      { host: {} },
      { tagName: 'PS-INPUT' },
      { host: {} },
      { tagName: 'PROTSPACE-QUERY-BUILDER' },
      { tagName: 'BODY' },
    ];
    expect(m.press({ ctrl: true, path }).defaultPrevented).toBe(false);
    expect(m.apply).not.toHaveBeenCalled();
    expect(m.history.canUndo()).toBe(true);
  });

  it('an open dialog blocks it', () => {
    const inPath = setup();
    inPath.history.record(step('a'));
    expect(
      inPath.press({ ctrl: true, path: [{ tagName: 'BUTTON' }, { tagName: 'DIALOG', open: true }] })
        .defaultPrevented,
    ).toBe(false);
    const ariaModal = {
      tagName: 'DIV',
      getAttribute: (name: string) => (name === 'aria-modal' ? 'true' : null),
    };
    expect(inPath.press({ ctrl: true, path: [ariaModal] }).defaultPrevented).toBe(false);
    expect(inPath.apply).not.toHaveBeenCalled();

    const openOnPage = setup({ modal: true });
    openOnPage.history.record(step('a'));
    expect(openOnPage.press({ ctrl: true }).defaultPrevented).toBe(false);
    expect(openOnPage.apply).not.toHaveBeenCalled();
  });

  it('preventDefault only when something was undone', () => {
    const m = setup();
    expect(m.press({ ctrl: true }).defaultPrevented).toBe(false);
    expect(m.press({ ctrl: true, shift: true }).defaultPrevented).toBe(false);
    expect(m.press({ ctrl: true, key: 'y' }).defaultPrevented).toBe(false);
    expect(m.apply).not.toHaveBeenCalled();
  });

  it('undoEntry undoes only the top entry', () => {
    const m = setup();
    const [a, b] = [step('a'), step('b')];
    m.history.record(a);
    m.history.record(b);
    expect(m.controller.undoEntry(a)).toBe(false);
    expect(m.apply).not.toHaveBeenCalled();
    expect(m.controller.undoEntry(b)).toBe(true);
    expect(m.apply).toHaveBeenLastCalledWith(b, 'undo');
    expect(m.controller.undoEntry(a)).toBe(true);
    expect(m.apply).toHaveBeenLastCalledWith(a, 'undo');
  });

  it('apply receives the entry and direction', () => {
    const m = setup();
    const a = step('a');
    m.history.record(a);
    expect(m.controller.undo()).toBe(true);
    expect(m.controller.redo()).toBe(true);
    expect(m.controller.redo()).toBe(false);
    expect(m.apply.mock.calls).toEqual([
      [a, 'undo'],
      [a, 'redo'],
    ]);
  });

  it('undoEntrySize counts every id an entry holds', () => {
    expect(undoEntrySize({ kind: 'selection', before: ['a'], after: ['a', 'b'] })).toBe(3);
    expect(undoEntrySize({ kind: 'isolate', layer: ['a', 'b'], selectionBefore: ['a'] })).toBe(3);
    expect(
      undoEntrySize({ kind: 'reset-isolation', layers: [['a', 'b'], ['a']], selectionBefore: [] }),
    ).toBe(3);
    expect(
      undoEntrySize({
        kind: 'filter',
        cause: 'apply',
        before: { query: [], matchedIds: null },
        after: { query: [], matchedIds: ['a', 'b'] },
      }),
    ).toBe(2);
  });

  it('dispose removes the listener', () => {
    const m = setup();
    m.history.record(step('a'));
    m.controller.dispose();
    expect(m.press({ ctrl: true }).defaultPrevented).toBe(false);
    expect(m.apply).not.toHaveBeenCalled();
  });
});
