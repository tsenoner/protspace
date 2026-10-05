import type { HostMessageEventDetail } from '../../events';

export interface DataErrorContext {
  operation: 'load';
}

export interface DataErrorEventDetail extends HostMessageEventDetail<
  'data-loader',
  'error',
  DataErrorContext
> {
  /** Always an `Error`: the loader wraps any non-Error it catches before dispatching. */
  originalError?: Error;
}

export function createDataErrorEventDetail(
  message: string,
  originalError?: Error,
): DataErrorEventDetail {
  return {
    message,
    severity: 'error',
    source: 'data-loader',
    context: {
      operation: 'load',
    },
    originalError,
  };
}
