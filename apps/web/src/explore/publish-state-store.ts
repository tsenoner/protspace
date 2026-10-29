import { getStorageItem, setStorageItem } from '@protspace/utils';

/**
 * The figure editor's last state, kept in localStorage so the editor reopens where it was left
 * and a data bundle exported with its legend settings carries it. The JSON is not validated
 * here: the editor sanitises whatever it is given (`savedPublishState`).
 */
export const PUBLISH_STATE_KEY = 'protspace_publishState';

export function loadPublishState(): Record<string, unknown> | null {
  const parsed = getStorageItem<unknown>(PUBLISH_STATE_KEY, null);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

export function savePublishState(state: Record<string, unknown>): void {
  setStorageItem(PUBLISH_STATE_KEY, state);
}
