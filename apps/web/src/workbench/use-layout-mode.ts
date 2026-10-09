import { useSyncExternalStore } from 'react';
import { DESKTOP_MIN_WIDTH } from '../explore/layout-defaults';

// Made on first use, not at import, and kept: React reads the snapshot on every render.
let query: MediaQueryList | undefined;
const desktopQuery = (): MediaQueryList =>
  (query ??= window.matchMedia(`(min-width: ${DESKTOP_MIN_WIDTH}px)`));

function subscribe(onChange: () => void): () => void {
  const list = desktopQuery();
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
}

const getMode = (): 'desktop' | 'narrow' => (desktopQuery().matches ? 'desktop' : 'narrow');

/** 'desktop' from 951 px wide and 'narrow' below, following the window live. */
export function useLayoutMode(): 'desktop' | 'narrow' {
  return useSyncExternalStore(subscribe, getMode);
}
