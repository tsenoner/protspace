interface Lifecycle {
  isDisposed(): boolean;
  addCleanup(cleanup: () => void): void;
  scheduleTimeout(callback: () => void, delayMs: number): number;
  dispose(): void;
}

export function createLifecycle(): Lifecycle {
  let disposed = false;
  const cleanupFns: Array<() => void> = [];
  const timeoutIds = new Set<number>();

  return {
    isDisposed() {
      return disposed;
    },
    addCleanup(cleanup) {
      cleanupFns.push(cleanup);
    },
    scheduleTimeout(callback, delayMs) {
      const timeoutId = window.setTimeout(() => {
        timeoutIds.delete(timeoutId);
        callback();
      }, delayMs);
      timeoutIds.add(timeoutId);
      return timeoutId;
    },
    dispose() {
      if (disposed) {
        return;
      }

      disposed = true;
      timeoutIds.forEach((timeoutId) => clearTimeout(timeoutId));
      timeoutIds.clear();
      cleanupFns.splice(0).forEach((cleanup) => cleanup());
    },
  };
}
