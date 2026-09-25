import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { SetURLSearchParams } from 'react-router';
import type { DatasetChangeSource, ExploreController, ExploreViewChange } from './types';
import {
  getDatasetParam,
  getDatasetSearchParamsUpdate,
  getExploreViewSearchParamsUpdate,
  parseExploreViewRequest,
} from './url-state';

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
  const datasetParam = useMemo(() => getDatasetParam(searchParams), [searchParams]);
  const datasetParamRef = useRef(datasetParam);
  // The dataset id the app currently reflects (last value written by this
  // hook, or last value the controller reported). Lets the effect below tell
  // Back/Forward (or a hand-edited URL) apart from a param change this hook's
  // own write produced, which must not re-trigger a load.
  const currentDatasetIdRef = useRef(datasetParam);

  useEffect(() => {
    setSearchParamsRef.current = setSearchParams;
    searchParamsRef.current = new URLSearchParams(searchParams);
    requestStateRef.current = requestState;
    datasetParamRef.current = datasetParam;
  }, [datasetParam, requestState, searchParams, setSearchParams]);

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

  const handleDatasetChange = useCallback(
    (exampleId: string | null, source: DatasetChangeSource) => {
      if (source === 'url') {
        // The URL already names this example (deep link or Back/Forward);
        // nothing to write, just record it as the current state.
        currentDatasetIdRef.current = exampleId;
        return;
      }

      currentDatasetIdRef.current = source === 'menu' ? exampleId : null;

      const update = getDatasetSearchParamsUpdate(searchParamsRef.current, exampleId, source);
      if (!update) {
        return;
      }

      searchParamsRef.current = update.next;
      setSearchParamsRef.current(update.next, { replace: update.replace });
    },
    [],
  );

  const attachController = useCallback(
    (controller: ExploreController) => {
      controllerRef.current = controller;
      const unsubscribeView = controller.subscribeToViewChanges(handleViewChange);
      const unsubscribeDataset = controller.subscribeToDatasetChanges(handleDatasetChange);
      controller.setRequestedView(requestStateRef.current);
      // Kicks off the very first dataset load, so it already knows the
      // requested example instead of loading the demo/stored import first.
      currentDatasetIdRef.current = datasetParamRef.current;
      controller.setRequestedDataset(datasetParamRef.current);

      return () => {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
        }
        unsubscribeView();
        unsubscribeDataset();
        controller.dispose();
      };
    },
    [handleDatasetChange, handleViewChange],
  );

  useEffect(() => {
    if (!controllerRef.current) {
      return;
    }

    pendingUrlRequestRef.current = true;
    controllerRef.current.setRequestedView(requestState);
  }, [requestState]);

  useEffect(() => {
    if (!controllerRef.current) {
      return;
    }
    // A change this hook itself wrote already updated currentDatasetIdRef to
    // match, so this only fires for Back/Forward or a hand-edited URL.
    if (datasetParam === currentDatasetIdRef.current) {
      return;
    }

    currentDatasetIdRef.current = datasetParam;
    controllerRef.current.setRequestedDataset(datasetParam);
  }, [datasetParam]);

  return { attachController };
}
