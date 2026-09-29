import type { DatasetChangeSource } from './types';
import type {
  EffectiveExploreView,
  ExploreViewChangeSource,
  ExploreViewDefaults,
  ExploreViewNormalization,
  ExploreViewRequestState,
  ResolvedExploreView,
} from './view-state';

/**
 * Reads the `dataset` query parameter naming the example to show (see the
 * "Dataset deep link" requirement in `openspec/specs/example-datasets/spec.md`).
 */
export function getDatasetParam(searchParams: URLSearchParams): string | null {
  return searchParams.get('dataset');
}

/**
 * Returns a new URLSearchParams with `dataset` set to `id`, or removed when
 * `id` is null. Never mutates `searchParams`.
 */
export function setDatasetParam(searchParams: URLSearchParams, id: string | null): URLSearchParams {
  const next = new URLSearchParams(searchParams);
  if (id === null) {
    next.delete('dataset');
  } else {
    next.set('dataset', id);
  }
  return next;
}

const EXPLORE_VIEW_PARAM_KEYS = ['annotation', 'projection', 'tooltip'] as const;

/**
 * Decides how a dataset-change should be written to the URL, mirroring
 * `getExploreViewSearchParamsUpdate`'s pure-decision shape: a menu choice
 * pushes `dataset=<id>` without the view parameters; a user import or a
 * startup/fallback load deletes the parameter with a replace (a no-op when it
 * is already absent); a load that happened because of the URL itself is never
 * written back.
 */
export function getDatasetSearchParamsUpdate(
  searchParams: URLSearchParams,
  exampleId: string | null,
  source: DatasetChangeSource,
): { next: URLSearchParams; replace: boolean } | null {
  if (source === 'url') {
    return null;
  }

  const nextId = source === 'menu' ? exampleId : null;
  const next = setDatasetParam(searchParams, nextId);
  if (source === 'menu') {
    // A menu choice opens the example on its curated view, so the previous
    // dataset's view parameters must not ride along into the new entry. The
    // previous entry keeps its own, so Back restores them.
    for (const key of EXPLORE_VIEW_PARAM_KEYS) {
      next.delete(key);
    }
  }

  return next.toString() === searchParams.toString() ? null : { next, replace: source !== 'menu' };
}

/**
 * How the URL sync hook handles a URL change it did not write itself
 * (Back/Forward):
 *
 * - `'switch-dataset'`: `dataset` names another dataset than the app reflects,
 *   so load it; the view parameters are recorded for that load to apply.
 * - `'record-view'`: the same dataset as a URL-driven switch still loading (a
 *   second quick Back onto another entry of the dataset being fetched). Only
 *   record the view; the pending load applies the latest one once its data is
 *   in. Resolving it now would run against the dataset still on screen and
 *   could write that dataset's fallback over the entry.
 * - `'apply-view'`: the same dataset, already on screen; apply the view.
 */
export function decideUrlChange({
  datasetParam,
  currentDatasetId,
  switchPending,
}: {
  datasetParam: string | null;
  currentDatasetId: string | null;
  switchPending: boolean;
}): 'switch-dataset' | 'record-view' | 'apply-view' {
  if (datasetParam !== currentDatasetId) {
    return 'switch-dataset';
  }
  return switchPending ? 'record-view' : 'apply-view';
}

function getRequestedValue(searchParams: URLSearchParams, key: 'annotation' | 'projection') {
  if (!searchParams.has(key)) {
    return undefined;
  }

  const value = searchParams.get(key);
  if (value === null || value.trim() === '') {
    return undefined;
  }

  return value;
}

interface ParsedTooltipParam {
  value: string[] | undefined;
  present: boolean;
  normalize: boolean;
}

function parseTooltipParam(searchParams: URLSearchParams): ParsedTooltipParam {
  if (!searchParams.has('tooltip')) {
    return { value: undefined, present: false, normalize: false };
  }

  const all = searchParams.getAll('tooltip');
  const duplicated = all.length > 1;
  const raw = all[0] ?? '';

  if (raw.trim() === '') {
    return { value: undefined, present: true, normalize: true };
  }

  const seen = new Set<string>();
  const parsed: string[] = [];
  let sawDuplicate = false;
  for (const part of raw.split(',')) {
    const token = part.trim();
    if (!token) {
      sawDuplicate = true;
      continue;
    }
    if (seen.has(token)) {
      sawDuplicate = true;
      continue;
    }
    seen.add(token);
    parsed.push(token);
  }

  if (parsed.length === 0) {
    return { value: undefined, present: true, normalize: true };
  }

  return {
    value: parsed,
    present: true,
    normalize: duplicated || sawDuplicate,
  };
}

export function parseExploreViewRequest(searchParams: URLSearchParams): ExploreViewRequestState {
  const tooltip = parseTooltipParam(searchParams);
  const requested = {
    annotation: getRequestedValue(searchParams, 'annotation'),
    projection: getRequestedValue(searchParams, 'projection'),
    tooltip: tooltip.value,
  };

  return {
    requested,
    present: {
      annotation: searchParams.has('annotation'),
      projection: searchParams.has('projection'),
      tooltip: tooltip.present,
    },
    normalize: {
      annotation:
        (searchParams.has('annotation') && requested.annotation === undefined) ||
        searchParams.getAll('annotation').length > 1,
      projection:
        (searchParams.has('projection') && requested.projection === undefined) ||
        searchParams.getAll('projection').length > 1,
      tooltip: tooltip.normalize,
    },
  };
}

export function createEmptyExploreViewRequest(): ExploreViewRequestState {
  return {
    requested: {},
    present: {
      annotation: false,
      projection: false,
      tooltip: false,
    },
    normalize: {
      annotation: false,
      projection: false,
      tooltip: false,
    },
  };
}

export function cloneExploreViewRequest(
  requestState: ExploreViewRequestState,
): ExploreViewRequestState {
  return {
    requested: {
      annotation: requestState.requested.annotation,
      projection: requestState.requested.projection,
      tooltip: requestState.requested.tooltip
        ? [...requestState.requested.tooltip]
        : requestState.requested.tooltip,
    },
    present: {
      annotation: requestState.present.annotation,
      projection: requestState.present.projection,
      tooltip: requestState.present.tooltip,
    },
    normalize: {
      annotation: requestState.normalize.annotation,
      projection: requestState.normalize.projection,
      tooltip: requestState.normalize.tooltip,
    },
  };
}

function resolveTooltip(
  requested: readonly string[] | undefined,
  effectiveAnnotation: string,
  availableAnnotations: readonly string[],
): { value: string[]; matches: boolean } {
  if (requested === undefined) {
    return { value: [], matches: false };
  }

  const available = new Set(availableAnnotations);
  const filtered: string[] = [];
  const seen = new Set<string>();
  let dropped = false;
  for (const name of requested) {
    if (name === effectiveAnnotation) {
      dropped = true;
      continue;
    }
    if (!available.has(name)) {
      dropped = true;
      continue;
    }
    if (seen.has(name)) {
      dropped = true;
      continue;
    }
    seen.add(name);
    filtered.push(name);
  }

  return { value: filtered, matches: !dropped && filtered.length === requested.length };
}

function pickAvailable(preferred: string | undefined, available: readonly string[]): string {
  return preferred !== undefined && available.includes(preferred) ? preferred : available[0];
}

/**
 * Resolves a view request against the loaded dataset's annotations and
 * projections, filling what the request leaves unset from the dataset's own
 * `defaults` (an example's curated `defaultView`):
 *
 * - A landing request, one that names no annotation, projection or tooltip at
 *   all (a menu choice, a bare `?dataset=<id>`, the startup demo, Back to a
 *   bare entry), takes the whole default view, tooltip included. A parameter
 *   named with an empty value (`tooltip=`, `annotation=`) is named: that
 *   request is not a landing, so an empty `tooltip=` means no tooltip.
 * - Otherwise a valid requested value wins, and a missing or invalid
 *   annotation or projection falls back to the default. An absent tooltip
 *   means none: user-driven URL writes always set annotation and projection
 *   and drop an empty tooltip, so there its absence means the user cleared it.
 * - A default name the dataset lacks falls back to the first available
 *   annotation or projection, and a missing default tooltip name is dropped.
 *
 * With `defaults = {}` (user imports, OPFS restores) every fallback is the
 * first available annotation or projection.
 */
export function resolveExploreView(
  { requested, present }: Pick<ExploreViewRequestState, 'requested' | 'present'>,
  availableAnnotations: string[],
  availableProjections: string[],
  defaults: ExploreViewDefaults = {},
): ResolvedExploreView | null {
  if (availableAnnotations.length === 0 || availableProjections.length === 0) {
    return null;
  }

  const requestedAnnotation = requested.annotation;
  const requestedProjection = requested.projection;
  const annotationIsValid =
    requestedAnnotation !== undefined && availableAnnotations.includes(requestedAnnotation);
  const projectionIsValid =
    requestedProjection !== undefined && availableProjections.includes(requestedProjection);
  const isLanding =
    !present.annotation &&
    !present.projection &&
    !present.tooltip &&
    requestedAnnotation === undefined &&
    requestedProjection === undefined &&
    requested.tooltip === undefined;

  const effectiveAnnotation = annotationIsValid
    ? requestedAnnotation
    : pickAvailable(defaults.annotation, availableAnnotations);
  const tooltip = resolveTooltip(
    isLanding ? defaults.tooltip : requested.tooltip,
    effectiveAnnotation,
    availableAnnotations,
  );

  return {
    effective: {
      annotation: effectiveAnnotation,
      projection: projectionIsValid
        ? requestedProjection
        : pickAvailable(defaults.projection, availableProjections),
      tooltip: tooltip.value,
    },
    matchesRequested: {
      annotation: annotationIsValid,
      projection: projectionIsValid,
      tooltip: tooltip.matches,
    },
  };
}

export function getResolvedExploreViewNormalization(
  requestState: ExploreViewRequestState,
  resolved: ResolvedExploreView,
): ExploreViewNormalization {
  return {
    annotation:
      requestState.normalize.annotation ||
      (requestState.present.annotation && !resolved.matchesRequested.annotation),
    projection:
      requestState.normalize.projection ||
      (requestState.present.projection && !resolved.matchesRequested.projection),
    tooltip:
      requestState.normalize.tooltip ||
      (requestState.present.tooltip && !resolved.matchesRequested.tooltip),
  };
}

function setTooltipParam(searchParams: URLSearchParams, tooltip: readonly string[]) {
  if (tooltip.length === 0) {
    searchParams.delete('tooltip');
    return;
  }
  searchParams.set('tooltip', tooltip.join(','));
}

export function buildSearchParamsWithExploreView(
  searchParams: URLSearchParams,
  effective: EffectiveExploreView,
  options:
    | {
        mode: 'user';
      }
    | {
        mode: 'normalize';
        normalize: ExploreViewNormalization;
      },
) {
  const next = new URLSearchParams(searchParams);

  if (options.mode === 'user') {
    next.set('annotation', effective.annotation);
    next.set('projection', effective.projection);
    setTooltipParam(next, effective.tooltip);
    return next;
  }

  if (options.normalize.annotation) {
    next.set('annotation', effective.annotation);
  }

  if (options.normalize.projection) {
    next.set('projection', effective.projection);
  }

  if (options.normalize.tooltip) {
    setTooltipParam(next, effective.tooltip);
  }

  return next;
}

/**
 * The request a URL naming `effective` would parse to: what the view
 * controller records as the view on screen after a failed Back/Forward, in
 * place of the failed entry's parameters.
 */
export function createExploreViewRequestFromView(
  effective: EffectiveExploreView,
): ExploreViewRequestState {
  return parseExploreViewRequest(
    buildSearchParamsWithExploreView(new URLSearchParams(), effective, { mode: 'user' }),
  );
}

export function getExploreViewSearchParamsUpdate(
  searchParams: URLSearchParams,
  change: {
    effective: EffectiveExploreView;
    source: ExploreViewChangeSource;
    normalize: ExploreViewNormalization;
  },
  options: {
    pendingUrlRequest: boolean;
    /**
     * The dataset on screen, as its `dataset` parameter (null for none). A
     * user change's new entry names it, so after a failed Back/Forward, whose
     * entry still names the example that failed, the next entry the app
     * writes is accurate again. Leave it out to keep `dataset` as it is.
     */
    displayedDatasetId?: string | null;
  },
): { next: URLSearchParams; replace: boolean } | null {
  if (change.source === 'user' && !options.pendingUrlRequest) {
    let next = buildSearchParamsWithExploreView(searchParams, change.effective, {
      mode: 'user',
    });
    if (options.displayedDatasetId !== undefined) {
      next = setDatasetParam(next, options.displayedDatasetId);
    }
    return next.toString() === searchParams.toString() ? null : { next, replace: false };
  }

  if (!change.normalize.annotation && !change.normalize.projection && !change.normalize.tooltip) {
    return null;
  }

  const next = buildSearchParamsWithExploreView(searchParams, change.effective, {
    mode: 'normalize',
    normalize: change.normalize,
  });

  return next.toString() === searchParams.toString() ? null : { next, replace: true };
}
