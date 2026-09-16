import {
  DENSITY_DEFAULT,
  DENSITY_STYLE_DEFAULT,
  type DensityLayerMode,
  type DensityLayerStyle,
} from '@protspace/utils';
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

/**
 * One param, five tokens. Mode and style stay separate fields everywhere else;
 * the `contour-` prefix exists only here and in the control bar's option values.
 * `off` has no style variant: off is off.
 */
const DENSITY_TOKENS: Record<string, { mode: DensityLayerMode; style: DensityLayerStyle }> = {
  off: { mode: 'off', style: DENSITY_STYLE_DEFAULT },
  auto: { mode: 'auto', style: 'heatmap' },
  on: { mode: 'on', style: 'heatmap' },
  'contour-auto': { mode: 'auto', style: 'contour' },
  'contour-on': { mode: 'on', style: 'contour' },
};

function parseDensityParam(searchParams: URLSearchParams): {
  mode: DensityLayerMode | undefined;
  style: DensityLayerStyle | undefined;
  present: boolean;
  normalize: boolean;
} {
  if (!searchParams.has('density')) {
    return { mode: undefined, style: undefined, present: false, normalize: false };
  }
  const all = searchParams.getAll('density');
  const parsed = DENSITY_TOKENS[(all[0] ?? '').trim()];
  return {
    mode: parsed?.mode,
    style: parsed?.style,
    present: true,
    normalize: !parsed || all.length > 1,
  };
}

export function parseExploreViewRequest(searchParams: URLSearchParams): ExploreViewRequestState {
  const tooltip = parseTooltipParam(searchParams);
  const density = parseDensityParam(searchParams);
  const requested = {
    annotation: getRequestedValue(searchParams, 'annotation'),
    projection: getRequestedValue(searchParams, 'projection'),
    tooltip: tooltip.value,
    density: density.mode,
    densityStyle: density.style,
  };

  return {
    requested,
    present: {
      annotation: searchParams.has('annotation'),
      projection: searchParams.has('projection'),
      tooltip: tooltip.present,
      density: density.present,
    },
    normalize: {
      annotation:
        (searchParams.has('annotation') && requested.annotation === undefined) ||
        searchParams.getAll('annotation').length > 1,
      projection:
        (searchParams.has('projection') && requested.projection === undefined) ||
        searchParams.getAll('projection').length > 1,
      tooltip: tooltip.normalize,
      density: density.normalize,
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
      density: false,
    },
    normalize: {
      annotation: false,
      projection: false,
      tooltip: false,
      density: false,
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
      density: requestState.requested.density,
      densityStyle: requestState.requested.densityStyle,
    },
    present: {
      annotation: requestState.present.annotation,
      projection: requestState.present.projection,
      tooltip: requestState.present.tooltip,
      density: requestState.present.density,
    },
    normalize: {
      annotation: requestState.normalize.annotation,
      projection: requestState.normalize.projection,
      tooltip: requestState.normalize.tooltip,
      density: requestState.normalize.density,
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
      density: requested.density ?? DENSITY_DEFAULT,
      densityStyle: requested.densityStyle ?? DENSITY_STYLE_DEFAULT,
    },
    matchesRequested: {
      annotation: annotationIsValid,
      projection: projectionIsValid,
      tooltip: tooltip.matches,
      density: requested.density !== undefined,
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
    density:
      requestState.normalize.density ||
      (requestState.present.density && !resolved.matchesRequested.density),
  };
}

/** The default stays out of the URL; every other mode is written explicitly. */
function setDensityParam(
  searchParams: URLSearchParams,
  density: DensityLayerMode,
  style: DensityLayerStyle,
) {
  const token = Object.keys(DENSITY_TOKENS).find(
    (key) => DENSITY_TOKENS[key].mode === density && DENSITY_TOKENS[key].style === style,
  );
  // No token means a pair the URL cannot express, which is only `off` with a
  // style: off is off, and the style is dropped with it.
  if (!token || (density === DENSITY_DEFAULT && style === DENSITY_STYLE_DEFAULT)) {
    searchParams.delete('density');
    return;
  }
  searchParams.set('density', token);
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
    setDensityParam(next, effective.density, effective.densityStyle);
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

  if (options.normalize.density) {
    setDensityParam(next, effective.density, effective.densityStyle);
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

  if (
    !change.normalize.annotation &&
    !change.normalize.projection &&
    !change.normalize.tooltip &&
    !change.normalize.density
  ) {
    return null;
  }

  const next = buildSearchParamsWithExploreView(searchParams, change.effective, {
    mode: 'normalize',
    normalize: change.normalize,
  });

  return next.toString() === searchParams.toString() ? null : { next, replace: true };
}
