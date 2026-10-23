import { describe, expect, it, vi } from 'vitest';
import { createUndoHistory } from './undo-history';

/** An entry that says how many ids it holds, without holding them. */
interface Step {
  id: string;
  n: number;
}
const step = (id: string, n = 1): Step => ({ id, n });
const make = (options: { limit?: number; maxIds?: number } = {}) =>
  createUndoHistory<Step>({ size: (entry) => entry.n, ...options });

describe('undo history', () => {
  it('undo and redo order', () => {
    const history = make();
    const [a, b] = [step('a'), step('b')];
    history.record(a);
    history.record(b);
    expect(history.undo()).toBe(b);
    expect(history.undo()).toBe(a);
    expect(history.undo()).toBeNull();
    expect(history.redo()).toBe(a);
    expect(history.redo()).toBe(b);
    expect(history.redo()).toBeNull();
  });

  it('record clears redo', () => {
    const history = make();
    history.record(step('a'));
    history.record(step('b'));
    history.undo();
    expect(history.canRedo()).toBe(true);
    history.record(step('c'));
    expect(history.canRedo()).toBe(false);
    expect(history.undo()?.id).toBe('c');
    expect(history.undo()?.id).toBe('a');
  });

  it('the 101st entry drops the oldest', () => {
    const history = make();
    for (let i = 0; i <= 100; i++) history.record(step(`s${i}`));
    const undone: string[] = [];
    for (let entry = history.undo(); entry; entry = history.undo()) undone.push(entry.id);
    expect(undone).toHaveLength(100);
    expect(undone[0]).toBe('s100');
    expect(undone[undone.length - 1]).toBe('s1');
  });

  it('entries past 2M ids drop the oldest', () => {
    const history = make();
    history.record(step('a', 1_000_000));
    history.record(step('b', 1_000_000));
    history.record(step('c', 1));
    expect(history.undo()?.id).toBe('c');
    expect(history.undo()?.id).toBe('b');
    expect(history.undo()).toBeNull();
  });

  it('the newest step is kept even when it alone passes the id cap', () => {
    const history = make({ maxIds: 10 });
    history.record(step('a', 4));
    history.record(step('huge', 50));
    expect(history.undo()?.id).toBe('huge');
    expect(history.canUndo()).toBe(false);
  });

  it('entries are stored by reference', () => {
    const ids = Array.from({ length: 1000 }, (_, i) => `P${i}`);
    const history = createUndoHistory<{ ids: string[] }>({ size: (entry) => entry.ids.length });
    const entry = { ids };
    history.record(entry);
    const undone = history.undo()!;
    expect(undone).toBe(entry);
    expect(undone.ids).toBe(ids);
    expect(history.redo()).toBe(entry);
  });

  it('clear empties both stacks', () => {
    const history = make();
    history.record(step('a'));
    history.record(step('b'));
    history.undo();
    history.clear();
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
    expect(history.peekUndo()).toBeNull();
  });

  it('subscribe fires on record, undo, redo, clear', () => {
    const history = make();
    const listener = vi.fn();
    const unsubscribe = history.subscribe(listener);
    history.record(step('a'));
    history.undo();
    history.redo();
    history.clear();
    expect(listener).toHaveBeenCalledTimes(4);
    // Nothing to undo: nothing changed, nothing heard.
    history.undo();
    expect(listener).toHaveBeenCalledTimes(4);
    unsubscribe();
    history.record(step('b'));
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it('peekUndo returns the top', () => {
    const history = make();
    expect(history.peekUndo()).toBeNull();
    const [a, b] = [step('a'), step('b')];
    history.record(a);
    history.record(b);
    expect(history.peekUndo()).toBe(b);
    history.undo();
    expect(history.peekUndo()).toBe(a);
  });
});
