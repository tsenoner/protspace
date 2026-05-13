import { buildStorageKey, getStorageItem, setStorageItem } from '@protspace/utils';

const COMPONENT_KEY = 'tooltip-annotations';

function keyForHash(datasetHash: string): string {
  return buildStorageKey(COMPONENT_KEY, datasetHash);
}

export function readTooltipAnnotations(datasetHash: string): string[] {
  const value = getStorageItem<unknown>(keyForHash(datasetHash), null);
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

export function writeTooltipAnnotations(datasetHash: string, annotations: readonly string[]): void {
  setStorageItem(keyForHash(datasetHash), [...annotations]);
}
