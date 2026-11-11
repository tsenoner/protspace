import { useCallback, useSyncExternalStore } from 'react';

/** One MediaQueryList per query, made on first use and shared by every subscriber and snapshot. */
const lists = new Map<string, MediaQueryList>();

function mediaQueryList(query: string): MediaQueryList {
  let list = lists.get(query);
  if (!list) {
    list = window.matchMedia(query);
    lists.set(query, list);
  }
  return list;
}

/** Whether the window matches `query` now, following it live. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = mediaQueryList(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => mediaQueryList(query).matches);
}
