import { useSyncExternalStore } from 'react';
import type { LayoutState } from '../explore/layout-defaults';
import { getLayout, subscribeLayout } from '../explore/layout-state';

/** The persisted layout; re-renders on every committed change. */
export function useLayout(): LayoutState {
  return useSyncExternalStore(subscribeLayout, getLayout);
}
