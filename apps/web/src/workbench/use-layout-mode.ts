import { useSyncExternalStore } from 'react';
import type { LayoutMode } from '../explore/layout-defaults';
import { getLayoutMode, subscribeLayoutMode } from '../explore/layout-mode';

/**
 * The workbench's layout mode (design decision 17), following the window live: desktop from
 * 951 px, tablet from 641 px, phone below, and landscape for a phone on its side. The runtime
 * reads the same source (explore/layout-mode.ts).
 */
export function useLayoutMode(): LayoutMode {
  return useSyncExternalStore(subscribeLayoutMode, getLayoutMode);
}
