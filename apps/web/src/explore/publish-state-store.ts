/**
 * The figure editor's last state, kept in localStorage so the editor reopens where it was left
 * and a data bundle exported with its legend settings carries it. The JSON is not validated
 * here: the editor sanitises whatever it is given (`savedPublishState`).
 */
export const PUBLISH_STATE_KEY = 'protspace_publishState';

export function loadPublishState(): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(PUBLISH_STATE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    }
  } catch {
    /* corrupt or unavailable */
  }
  return null;
}

export function savePublishState(state: Record<string, unknown>): void {
  try {
    localStorage.setItem(PUBLISH_STATE_KEY, JSON.stringify(state));
  } catch {
    /* localStorage full or unavailable */
  }
}
