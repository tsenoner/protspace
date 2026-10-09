import { useSyncExternalStore } from 'react';
import { DESKTOP_MIN_WIDTH } from '../explore/layout-defaults';

const DESKTOP_QUERY = `(min-width: ${DESKTOP_MIN_WIDTH}px)`;

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

const getMode = (): 'desktop' | 'narrow' =>
  window.matchMedia(DESKTOP_QUERY).matches ? 'desktop' : 'narrow';

/** 'desktop' from 951 px wide and 'narrow' below, following the window live. */
export function useLayoutMode(): 'desktop' | 'narrow' {
  return useSyncExternalStore(subscribe, getMode);
}
