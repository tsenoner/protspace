import type {
  EffectiveExploreView,
  ExploreViewChangeSource,
  ExploreViewNormalization,
  ExploreViewRequestState,
  RequestedExploreView,
  ResolvedExploreView,
} from './view-state';

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

export function resolveExploreView(
  requested: RequestedExploreView,
  availableAnnotations: string[],
  availableProjections: string[],
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

  const effectiveAnnotation = annotationIsValid ? requestedAnnotation : availableAnnotations[0];
  const tooltip = resolveTooltip(requested.tooltip, effectiveAnnotation, availableAnnotations);

  return {
    effective: {
      annotation: effectiveAnnotation,
      projection: projectionIsValid ? requestedProjection : availableProjections[0],
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

export function getExploreViewSearchParamsUpdate(
  searchParams: URLSearchParams,
  change: {
    effective: EffectiveExploreView;
    source: ExploreViewChangeSource;
    normalize: ExploreViewNormalization;
  },
  options: {
    pendingUrlRequest: boolean;
  },
): { next: URLSearchParams; replace: boolean } | null {
  if (change.source === 'user' && !options.pendingUrlRequest) {
    const next = buildSearchParamsWithExploreView(searchParams, change.effective, {
      mode: 'user',
    });
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
