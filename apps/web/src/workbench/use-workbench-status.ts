import { useSyncExternalStore } from 'react';
import {
  getWorkbenchStatus,
  subscribeWorkbenchStatus,
  type WorkbenchStatus,
} from '../explore/workbench-status';

/** What the runtime last published about the dataset on screen. */
export function useWorkbenchStatus(): WorkbenchStatus {
  return useSyncExternalStore(subscribeWorkbenchStatus, getWorkbenchStatus);
}
