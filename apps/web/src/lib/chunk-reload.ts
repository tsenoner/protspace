/** When the last reload for a failed chunk happened (ms since epoch), per tab. */
const RELOADED_AT_KEY = 'protspace:chunk-reload-at';
/** A chunk that fails again this soon after a reload is broken, not stale: let it surface. */
const RETRY_WINDOW_MS = 10_000;

interface ReloadingWindow {
  addEventListener(type: 'vite:preloadError', listener: (event: Event) => void): void;
  sessionStorage: Pick<Storage, 'getItem' | 'setItem'>;
  location: Pick<Location, 'reload'>;
}

/**
 * Reload once when a lazily loaded chunk fails to load. A page left open across a deploy still
 * asks for the old hashed chunks, which the new deploy removed, so opening Explore from it would
 * end on the crash screen. A reload fetches the new index and its chunks. A second failure within
 * `RETRY_WINDOW_MS` is left to surface, so a chunk that is really broken cannot loop.
 */
export function reloadOnStaleChunk(win: ReloadingWindow, now: () => number = Date.now): void {
  win.addEventListener('vite:preloadError', (event) => {
    let last = 0;
    try {
      last = Number(win.sessionStorage.getItem(RELOADED_AT_KEY)) || 0;
    } catch {
      // No session storage (privacy mode): a reload is still the best answer, but only once.
    }
    if (now() - last < RETRY_WINDOW_MS) return;
    try {
      win.sessionStorage.setItem(RELOADED_AT_KEY, String(now()));
    } catch {
      return; // Cannot remember the reload, so cannot rule out a loop: let the error surface.
    }
    event.preventDefault();
    win.location.reload();
  });
}
