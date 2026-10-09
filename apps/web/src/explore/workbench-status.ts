/**
 * Transient facts the explore runtime publishes for the React shell, which never reads them off the
 * runtime's elements. Nothing here is persisted. Later tasks add fields.
 */
export interface WorkbenchStatus {
  /** The dataset on screen: an example's label or a file's name; null before a load. */
  datasetName: string | null;
  /** Its protein count; null before a load. */
  proteinCount: number | null;
  /** Top-level conditions of the applied filter; 0 while no filter is applied. */
  appliedFilterConditions: number;
}

const EMPTY: WorkbenchStatus = {
  datasetName: null,
  proteinCount: null,
  appliedFilterConditions: 0,
};

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

/**
 * Publishes the name of the dataset on screen with its protein count. A name can be set before its
 * load starts (an OPFS restore), while the previous dataset is still on screen: the count is
 * published only once the plot's data has changed since the last name, so the app bar never pairs
 * a new name with the old count.
 */
export function createDatasetNamePublisher(
  getData: () => { protein_ids: ArrayLike<unknown> } | null | undefined,
): (name: string) => void {
  let namedData = getData() ?? null;
  return (name) => {
    const data = getData() ?? null;
    if (data !== null && data !== namedData) {
      namedData = data;
      setWorkbenchStatus({ datasetName: name, proteinCount: data.protein_ids.length });
    } else if (name !== status.datasetName) {
      setWorkbenchStatus({ datasetName: name, proteinCount: null });
    }
  };
}

export function resetWorkbenchStatusForTests(): void {
  status = EMPTY;
  listeners.clear();
}
