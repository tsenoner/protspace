import { DENSITY_DEFAULT, type DensityLayerMode, type EatReliabilityState } from '@protspace/utils';

/**
 * Transient facts the explore runtime publishes for the React shell, which never reads them off the
 * runtime's elements; the shell writes only the structure sheet. Nothing here is persisted.
 */
type DatasetPhase = 'starting' | 'loading' | 'ready' | 'empty';

/** The phone structure sheet: folded to its header, or expanded over the lower half. */
type StructureSheet = 'folded' | 'expanded';

/** Whether the EAT panel can open: why not, for the rail tooltip and the phone tab's hint. */
export type EatAvailability =
  | { kind: 'available' }
  /** The Color by annotation has no predictions; another one may. */
  | { kind: 'annotation'; annotationLabel: string }
  /** No annotation of the dataset has any. */
  | { kind: 'dataset' };

export interface WorkbenchStatus {
  /** The dataset on screen: an example's label or a file's name; null before a load. */
  datasetName: string | null;
  /** Its protein count; null before a load. */
  proteinCount: number | null;
  /** Configured leaf conditions of the applied filter; 0 while no filter is applied. */
  appliedFilterConditions: number;
  /** Conditions the Filter panel's draft adds, removes or changes against the applied filter. */
  unappliedFilterChanges: number;
  /** The plot's contour mode, which the view bar's More menu shows once Contours moves there. */
  densityLayer: DensityLayerMode;
  /** The protein the structure viewer shows or waits to show (the rail's dot); null for none. */
  structureProteinId: string | null;
  /**
   * What the plot area shows: nothing yet before startup ends (`starting`), the loading overlay
   * (`loading`, the workbench is inert), a dataset (`ready`), or the empty state (`empty`).
   */
  datasetPhase: DatasetPhase;
  /**
   * The structure sheet on phones (design decision 17). The structure controller folds it when a
   * structure appears and when it closes; the shell expands and folds it (setStructureSheet).
   */
  structureSheet: StructureSheet;
  /** Whether the EAT panel can open (the rail item, the phone tab and the restored panel). */
  eatAvailability: EatAvailability;
  /** The EAT panel's settings differ from their defaults: the rail item's and the tab's dot. */
  eatAdjusted: boolean;
  /** The Color by annotation's display name, for the EAT panel's header (`EAT · EC number`). */
  eatAnnotationLabel: string;
  /** EAT Dim's reliability filter while it fades predictions (the plot's chip); else null. */
  eatDim: EatReliabilityState | null;
}

const EMPTY: WorkbenchStatus = {
  datasetName: null,
  proteinCount: null,
  appliedFilterConditions: 0,
  unappliedFilterChanges: 0,
  densityLayer: DENSITY_DEFAULT,
  structureProteinId: null,
  datasetPhase: 'starting',
  structureSheet: 'folded',
  eatAvailability: { kind: 'dataset' },
  eatAdjusted: false,
  eatAnnotationLabel: '',
  eatDim: null,
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

const sameAvailability = (a: EatAvailability, b: EatAvailability): boolean =>
  a.kind === b.kind &&
  (a.kind !== 'annotation' || a.annotationLabel === (b as typeof a).annotationLabel);

/** Merges `patch` and notifies, unless no field changes. An equal availability keeps its object. */
export function setWorkbenchStatus(patch: Partial<WorkbenchStatus>): void {
  if (patch.eatAvailability && sameAvailability(patch.eatAvailability, status.eatAvailability)) {
    patch = { ...patch, eatAvailability: status.eatAvailability };
  }
  const next = { ...status, ...patch };
  const keys = Object.keys(next) as Array<keyof WorkbenchStatus>;
  if (keys.every((key) => Object.is(next[key], status[key]))) return;
  status = next;
  for (const listener of [...listeners]) listener();
}

/** Why the EAT panel cannot open (the rail's tooltip, the phone tab's hint); null when it can. */
export function eatUnavailableReason(availability: EatAvailability): string | null {
  if (availability.kind === 'annotation') {
    return `${availability.annotationLabel} has no EAT predictions. Color by an annotation marked EAT.`;
  }
  if (availability.kind === 'dataset') return 'This dataset has no transferred annotations (EAT).';
  return null;
}

/** The shell's one write to the status: the sheet's chevron, grip and header fold and expand it. */
export function setStructureSheet(state: StructureSheet): void {
  setWorkbenchStatus({ structureSheet: state });
}

/**
 * The plot area's phase from three runtime facts. Startup must have ended before the empty state
 * shows, so "Drop a file…" never flashes before the startup load has even begun.
 */
export function datasetPhaseFor({
  overlayShown,
  displayed,
  startupSettled,
}: {
  overlayShown: boolean;
  displayed: boolean;
  startupSettled: boolean;
}): DatasetPhase {
  if (overlayShown) return 'loading';
  if (displayed) return 'ready';
  return startupSettled ? 'empty' : 'starting';
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

/** Back to the empty status, notifying listeners: a page leaving /explore leaves nothing behind. */
export function resetWorkbenchStatus(): void {
  setWorkbenchStatus(EMPTY);
}

export function resetWorkbenchStatusForTests(): void {
  status = EMPTY;
  listeners.clear();
}
