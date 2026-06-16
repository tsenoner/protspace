import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { SetURLSearchParams } from 'react-router';
import type { ExploreController, ExploreViewChange } from './types';
import { getExploreViewSearchParamsUpdate, parseExploreViewRequest } from './url-state';

export function useExploreUrlStateSync(
  searchParams: URLSearchParams,
  setSearchParams: SetURLSearchParams,
) {
  const controllerRef = useRef<ExploreController | null>(null);
  const setSearchParamsRef = useRef(setSearchParams);
  const searchParamsRef = useRef(new URLSearchParams(searchParams));
  const pendingUrlRequestRef = useRef(false);
  const requestState = useMemo(() => parseExploreViewRequest(searchParams), [searchParams]);
  const requestStateRef = useRef(requestState);

  useEffect(() => {
    setSearchParamsRef.current = setSearchParams;
    searchParamsRef.current = new URLSearchParams(searchParams);
    requestStateRef.current = requestState;
  }, [requestState, searchParams, setSearchParams]);

  const handleViewChange = useCallback((change: ExploreViewChange) => {
    const update = getExploreViewSearchParamsUpdate(searchParamsRef.current, change, {
      pendingUrlRequest: pendingUrlRequestRef.current,
    });
    pendingUrlRequestRef.current = false;

    if (!update) {
      return;
    }

    searchParamsRef.current = new URLSearchParams(update.next);
    setSearchParamsRef.current(update.next, { replace: update.replace });
  }, []);

  const attachController = useCallback(
    (controller: ExploreController) => {
      controllerRef.current = controller;
      const unsubscribe = controller.subscribeToViewChanges(handleViewChange);
      controller.setRequestedView(requestStateRef.current);

      return () => {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
        }
        unsubscribe();
        controller.dispose();
      };
    },
    [handleViewChange],
  );

  useEffect(() => {
    if (!controllerRef.current) {
      return;
    }

    pendingUrlRequestRef.current = true;
    controllerRef.current.setRequestedView(requestState);
  }, [requestState]);

  return { attachController };
}
