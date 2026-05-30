import type { StructureData } from '@protspace/utils';
import type { HostMessageEventDetail } from '../../events';

export interface StructureLoadDetail {
  proteinId: string;
  status: 'loading' | 'loaded';
  data?: StructureData | null;
}

export interface StructureLoadEvent extends CustomEvent {
  detail: StructureLoadDetail;
}

export interface StructureErrorContext {
  proteinId: string;
}

export interface StructureErrorEventDetail extends HostMessageEventDetail<
  'structure-viewer',
  'error',
  StructureErrorContext
> {}

export function createStructureLoadDetail(
  proteinId: string,
  status: StructureLoadDetail['status'],
  data?: StructureData | null,
): StructureLoadDetail {
  return {
    proteinId,
    status,
    data,
  };
}

export function createStructureErrorEventDetail(
  proteinId: string,
  message: string,
  originalError?: Error,
): StructureErrorEventDetail {
  return {
    message,
    severity: 'error',
    source: 'structure-viewer',
    context: {
      proteinId,
    },
    originalError,
  };
}
