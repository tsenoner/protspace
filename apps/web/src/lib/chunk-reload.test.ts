import { describe, expect, it, vi } from 'vitest';
import { reloadOnStaleChunk } from './chunk-reload';

function fakeWindow(storage: Map<string, string> | null = new Map()) {
  const target = new EventTarget();
  const reload = vi.fn();
  const sessionStorage = {
    getItem: (key: string) => {
      if (!storage) throw new Error('blocked');
      return storage.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (!storage) throw new Error('blocked');
      storage.set(key, value);
    },
  };
  const win = {
    addEventListener: target.addEventListener.bind(target),
    sessionStorage,
    location: { reload },
  };
  const fail = () => {
    const event = new Event('vite:preloadError', { cancelable: true });
    target.dispatchEvent(event);
    return event;
  };
  return { win, reload, fail };
}

describe('reloadOnStaleChunk', () => {
  it('reloads once on a failed chunk and swallows the error', () => {
    const { win, reload, fail } = fakeWindow();
    reloadOnStaleChunk(win, () => 100_000);
    const event = fail();
    expect(reload).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it('lets a failure right after its reload surface instead of looping', () => {
    const storage = new Map<string, string>();
    let time = 100_000;
    const first = fakeWindow(storage);
    reloadOnStaleChunk(first.win, () => time);
    first.fail();

    // The reloaded page fails again within the window.
    time += 2_000;
    const second = fakeWindow(storage);
    reloadOnStaleChunk(second.win, () => time);
    const event = second.fail();
    expect(second.reload).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);

    // A later deploy in the same tab reloads again.
    time += 60_000;
    second.fail();
    expect(second.reload).toHaveBeenCalledOnce();
  });

  it('does not reload when it cannot remember having reloaded', () => {
    const { win, reload, fail } = fakeWindow(null);
    reloadOnStaleChunk(win, () => 100_000);
    expect(fail().defaultPrevented).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
