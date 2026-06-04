import type { HostMessageEventDetail } from '../../events';

export type LegendErrorSource =
  | 'data-processing'
  | 'persistence'
  | 'scatterplot-sync'
  | 'rendering';

export interface LegendErrorContext {
  annotation?: string;
}

export interface LegendErrorEventDetail extends HostMessageEventDetail<
  LegendErrorSource,
  'error',
  LegendErrorContext
> {}

export function createLegendErrorEventDetail(
  message: string,
  source: LegendErrorSource,
  options: {
    annotation?: string;
    originalError?: Error;
  } = {},
): LegendErrorEventDetail {
  const detail: LegendErrorEventDetail = {
    message,
    severity: 'error',
    source,
  };

  if (options.annotation) {
    detail.context = {
      annotation: options.annotation,
    };
  }

  if (options.originalError) {
    detail.originalError = options.originalError;
  }

  return detail;
}
