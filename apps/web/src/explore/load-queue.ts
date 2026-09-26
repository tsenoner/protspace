import type { LoadMeta, DatasetLoadKind, DataLoaderLoadOptions, ExampleLoadContext } from './types';

interface PendingLoadFinalization {
  /** Resolves to whether the load reached `data-loaded` (true) or `data-error` (false). */
  promise: Promise<boolean>;
  resolve: (success: boolean) => void;
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
  registerFileLoad(file: File, kind: DatasetLoadKind, example?: ExampleLoadContext): LoadMeta;
  getLoadMetaForFile(file: File): LoadMeta | undefined;
  getRunningLoadMeta(): LoadMeta | null;
  getLatestSequence(): number;
  /** Resolves once `resolvePendingLoadFinalization` is called for this sequence. */
  awaitLoadOutcome(sequence: number): Promise<boolean>;
  resolvePendingLoadFinalization(sequence: number, success?: boolean): void;
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

    let resolve: (success: boolean) => void = () => {};
    const promise = new Promise<boolean>((resolvePromise) => {
      resolve = resolvePromise;
    });
    const pending = { promise, resolve };
    pendingLoadFinalizationBySequence.set(sequence, pending);
    return pending;
  };

  const registerFileLoad = (file: File, kind: DatasetLoadKind, example?: ExampleLoadContext) => {
    const nextMeta: LoadMeta = {
      sequence: nextLoadSequence + 1,
      kind,
      example,
    };
    nextLoadSequence = nextMeta.sequence;
    loadMetaByFile.set(file, nextMeta);
    return nextMeta;
  };

  const awaitLoadOutcome = (sequence: number): Promise<boolean> =>
    ensurePendingLoadFinalization(sequence).promise;

  const resolvePendingLoadFinalization = (sequence: number, success = true) => {
    const pending = pendingLoadFinalizationBySequence.get(sequence);
    if (!pending) {
      return;
    }

    pending.resolve(success);
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
    awaitLoadOutcome,
    resolvePendingLoadFinalization,
    dispose() {
      pendingLoadFinalizationBySequence.forEach((pending) => pending.resolve(false));
      pendingLoadFinalizationBySequence.clear();
      runningLoadMeta = null;
    },
  };
}
