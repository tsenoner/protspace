/**
 * Transient facts the explore runtime publishes for the React shell, which never reads them off the
 * runtime's elements. Nothing here is persisted. Later tasks add fields.
 */
export interface WorkbenchStatus {
  /** The dataset on screen: an example's label or a file's name; null before a load. */
  datasetName: string | null;
  /** Its protein count; null before a load. */
  proteinCount: number | null;
}

const EMPTY: WorkbenchStatus = { datasetName: null, proteinCount: null };

let status: WorkbenchStatus = EMPTY;
const listeners = new Set<() => void>();

/** The current status: the same object until a field changes, as useSyncExternalStore needs. */
export function getWorkbenchStatus(): WorkbenchStatus {
  return status;
}

export function subscribeWorkbenchStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Merges `patch` and notifies, unless no field changes. */
export function setWorkbenchStatus(patch: Partial<WorkbenchStatus>): void {
  const next = { ...status, ...patch };
  const keys = Object.keys(next) as Array<keyof WorkbenchStatus>;
  if (keys.every((key) => Object.is(next[key], status[key]))) return;
  status = next;
  for (const listener of [...listeners]) listener();
}

export function resetWorkbenchStatusForTests(): void {
  status = EMPTY;
  listeners.clear();
}
