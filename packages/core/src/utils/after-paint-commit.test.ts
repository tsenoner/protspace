/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AfterPaintCommit } from './after-paint-commit';

describe('AfterPaintCommit', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('runs after every callback of the next frame, not inside the input task', () => {
    const log: string[] = [];
    const commit = new AfterPaintCommit();

    commit.schedule(() => log.push('commit'));
    // A render requested after the pick still runs in the frame before the commit.
    requestAnimationFrame(() => log.push('frame'));
    expect(log).toEqual([]);

    vi.advanceTimersToNextFrame();
    expect(log).toEqual(['frame']);

    vi.runAllTimers();
    expect(log).toEqual(['frame', 'commit']);
  });

  it('applies only the latest of several picks made before the paint', () => {
    const applied: string[] = [];
    const commit = new AfterPaintCommit();

    commit.schedule(() => applied.push('a'));
    commit.schedule(() => applied.push('b'));
    commit.schedule(() => applied.push('c'));
    vi.runAllTimers();

    expect(applied).toEqual(['c']);
  });

  it('applies a pick made after the frame but before the commit only after another frame', () => {
    const log: string[] = [];
    const commit = new AfterPaintCommit();

    commit.schedule(() => log.push('a'));
    vi.advanceTimersToNextFrame();
    commit.schedule(() => log.push('b'));
    requestAnimationFrame(() => log.push('frame'));
    vi.runAllTimers();

    expect(log).toEqual(['frame', 'b']);
  });

  it('cancel drops the waiting commit', () => {
    const run = vi.fn();
    const commit = new AfterPaintCommit();

    commit.schedule(run);
    commit.cancel();
    vi.runAllTimers();

    expect(run).not.toHaveBeenCalled();
  });

  it('flush applies the waiting commit at once, and only once', () => {
    const run = vi.fn();
    const commit = new AfterPaintCommit();

    commit.schedule(run);
    commit.flush();
    expect(run).toHaveBeenCalledTimes(1);

    vi.runAllTimers();
    commit.flush();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does not wait for a frame on a hidden page', () => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame');
    const run = vi.fn();

    new AfterPaintCommit().schedule(run);
    vi.advanceTimersByTime(0);

    expect(raf).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
