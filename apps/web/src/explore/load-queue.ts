import type { LoadMeta, DatasetLoadKind, DataLoaderLoadOptions } from './types';

interface PendingLoadFinalization {
  promise: Promise<void>;
  resolve: () => void;
}

interface LoadQueueOptions {
  isDisposed: () => boolean;
}

export interface LoadQueue {
  enqueueLoadFromFile(
    file: File,
    options: DataLoaderLoadOptions | undefined,
    loadFromFile: (file: File, options?: DataLoaderLoadOptions) => Promise<void>,
  ): Promise<void>;
  registerFileLoad(file: File, kind: DatasetLoadKind): LoadMeta;
  getLoadMetaForFile(file: File): LoadMeta | undefined;
  getRunningLoadMeta(): LoadMeta | null;
  getLatestSequence(): number;
  resolvePendingLoadFinalization(sequence: number): void;
  dispose(): void;
}

export function createLoadQueue({ isDisposed }: LoadQueueOptions): LoadQueue {
  let nextLoadSequence = 0;
  let runningLoadMeta: LoadMeta | null = null;
  let queuedLoad: Promise<void> = Promise.resolve();
  const loadMetaByFile = new WeakMap<File, LoadMeta>();
  const pendingLoadFinalizationBySequence = new Map<number, PendingLoadFinalization>();

  const ensurePendingLoadFinalization = (sequence: number) => {
    const existing = pendingLoadFinalizationBySequence.get(sequence);
    if (existing) {
      return existing;
    }

    let resolve = () => {};
    const promise = new Promise<void>((resolvePromise) => {
      resolve = resolvePromise;
    });
    const pending = { promise, resolve };
    pendingLoadFinalizationBySequence.set(sequence, pending);
    return pending;
  };

  const registerFileLoad = (file: File, kind: DatasetLoadKind) => {
    const nextMeta = {
      sequence: nextLoadSequence + 1,
      kind,
    };
    nextLoadSequence = nextMeta.sequence;
    loadMetaByFile.set(file, nextMeta);
    return nextMeta;
  };

  const resolvePendingLoadFinalization = (sequence: number) => {
    const pending = pendingLoadFinalizationBySequence.get(sequence);
    if (!pending) {
      return;
    }

    pending.resolve();
    pendingLoadFinalizationBySequence.delete(sequence);
  };

  const enqueueLoadFromFile = async (
    file: File,
    options: DataLoaderLoadOptions | undefined,
    loadFromFile: (file: File, options?: DataLoaderLoadOptions) => Promise<void>,
  ) => {
    const loadMeta =
      loadMetaByFile.get(file) ??
      registerFileLoad(file, options?.source === 'auto' ? 'default' : 'user');
    const pendingFinalization = ensurePendingLoadFinalization(loadMeta.sequence);

    const nextLoad = queuedLoad.then(async () => {
      if (isDisposed()) {
        return;
      }

      runningLoadMeta = loadMeta;
      if (isDisposed()) {
        return;
      }

      await loadFromFile(file, options);
      await pendingFinalization.promise;
    });

    queuedLoad = nextLoad.catch(() => undefined);

    return nextLoad.finally(() => {
      if (runningLoadMeta?.sequence === loadMeta.sequence) {
        runningLoadMeta = null;
      }
    });
  };

  return {
    enqueueLoadFromFile,
    registerFileLoad,
    getLoadMetaForFile: (file) => loadMetaByFile.get(file),
    getRunningLoadMeta: () => runningLoadMeta,
    getLatestSequence: () => nextLoadSequence,
    resolvePendingLoadFinalization,
    dispose() {
      pendingLoadFinalizationBySequence.forEach((pending) => pending.resolve());
      pendingLoadFinalizationBySequence.clear();
      runningLoadMeta = null;
    },
  };
}
