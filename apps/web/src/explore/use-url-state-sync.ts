import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigationType, type SetURLSearchParams } from 'react-router';
import type { DatasetChangeSource, ExploreController, ExploreViewChange } from './types';
import {
  decideUrlChange,
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
  const datasetParam = getDatasetParam(searchParams);
  // The dataset id the app currently reflects (last value written by this
  // hook, or last value the controller reported). Lets the effect below tell
  // Back/Forward (or a hand-edited URL) apart from a param change this hook's
  // own write produced, which must not re-trigger a load.
  const currentDatasetIdRef = useRef(datasetParam);
  // The dataset on screen, as its `dataset` parameter: the example id for a
  // menu or URL load, null for the startup demo, a stored import or a user
  // import. Differs from the URL only after a failed Back/Forward, which
  // keeps the plot but leaves the entry naming the example that failed.
  const displayedDatasetIdRef = useRef<string | null>(null);
  // 'POP' for Back/Forward (and the initial entry); 'PUSH'/'REPLACE' for
  // this hook's own writes.
  const navigationType = useNavigationType();
  // Token of the URL-driven dataset switch still loading, or null. Settled by
  // the promise `setRequestedDataset` returns.
  const pendingSwitchRef = useRef<number | null>(null);
  const switchTokenRef = useRef(0);

  useEffect(() => {
    setSearchParamsRef.current = setSearchParams;
    searchParamsRef.current = new URLSearchParams(searchParams);
    requestStateRef.current = requestState;
  }, [requestState, searchParams, setSearchParams]);

  const handleViewChange = useCallback((change: ExploreViewChange) => {
    const update = getExploreViewSearchParamsUpdate(searchParamsRef.current, change, {
      pendingUrlRequest: pendingUrlRequestRef.current,
      // A user change's entry names the dataset on screen, unless a switch
      // is still loading (then the URL already names what's coming).
      displayedDatasetId:
        pendingSwitchRef.current === null ? displayedDatasetIdRef.current : undefined,
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
        displayedDatasetIdRef.current = exampleId;
        return;
      }

      currentDatasetIdRef.current = source === 'menu' ? exampleId : null;
      displayedDatasetIdRef.current = currentDatasetIdRef.current;

      const update = getDatasetSearchParamsUpdate(searchParamsRef.current, exampleId, source);
      if (!update) {
        return;
      }

      searchParamsRef.current = update.next;
      setSearchParamsRef.current(update.next, { replace: update.replace });
    },
    [],
  );

  const startDatasetSwitch = useCallback((controller: ExploreController, id: string | null) => {
    switchTokenRef.current += 1;
    const token = switchTokenRef.current;
    pendingSwitchRef.current = token;
    void controller.setRequestedDataset(id).finally(() => {
      if (pendingSwitchRef.current !== token) {
        return;
      }
      pendingSwitchRef.current = null;
      // A switch that loaded, or fell back, has already reported the dataset
      // now on screen. One that failed with a plot on screen (or was
      // superseded) did not: the app still reflects the displayed dataset,
      // so a later entry naming that dataset must not reload it.
      currentDatasetIdRef.current = displayedDatasetIdRef.current;
    });
  }, []);

  // Retry on a failed `?dataset=` download.
  const handleExampleRetry = useCallback(
    (exampleId: string) => {
      const controller = controllerRef.current;
      if (!controller) {
        return;
      }

      const current = searchParamsRef.current;
      if (getDatasetParam(current) === exampleId) {
        // A failed Back/Forward: the entry still names the example, so load
        // it again with that entry's view parameters.
        controller.recordRequestedView(parseExploreViewRequest(current));
        currentDatasetIdRef.current = exampleId;
        startDatasetSwitch(controller, exampleId);
        return;
      }

      // A failed deep link fell back and removed the parameter, or the user
      // has moved on since: name the example in a new entry, which loads it
      // like a link (the stored import is left alone) on its curated view.
      const update = getDatasetSearchParamsUpdate(current, exampleId, 'menu');
      if (update) {
        searchParamsRef.current = update.next;
        setSearchParamsRef.current(update.next, { replace: update.replace });
      }
    },
    [startDatasetSwitch],
  );

  const attachController = useCallback(
    (controller: ExploreController) => {
      controllerRef.current = controller;
      const unsubscribeView = controller.subscribeToViewChanges(handleViewChange);
      const unsubscribeDataset = controller.subscribeToDatasetChanges(handleDatasetChange);
      const unsubscribeRetries = controller.subscribeToExampleRetries(handleExampleRetry);
      controller.setRequestedView(requestStateRef.current);
      // Kicks off the very first dataset load, so it already knows the
      // requested example instead of loading the demo/stored import first.
      const initialDatasetParam = getDatasetParam(searchParamsRef.current);
      currentDatasetIdRef.current = initialDatasetParam;
      startDatasetSwitch(controller, initialDatasetParam);

      return () => {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
        }
        unsubscribeView();
        unsubscribeDataset();
        unsubscribeRetries();
        controller.dispose();
      };
    },
    [handleDatasetChange, handleExampleRetry, handleViewChange, startDatasetSwitch],
  );

  // One effect, not two, and in this order: when Back/Forward (or a
  // hand-edited URL) changes `dataset` and a view param together, resolving
  // the view param first would run it against whichever dataset is still on
  // screen — the OLD one — normalize it against that dataset's annotations/
  // projections, and write the normalization over the URL entry the switch
  // is headed to (e.g. Back from `?dataset=A&annotation=x` to
  // `?dataset=B&annotation=y` would resolve `y` against A).
  // So when a dataset switch starts, or is still loading, only record the
  // requested view (`recordRequestedView`, no resolve/apply/URL write) and let
  // the dataset load apply the latest one once the new data is in, via
  // `applyLatestViewForDatasetLoad` (dataset-controller.ts).
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) {
      return;
    }

    // A change this hook itself wrote already updated currentDatasetIdRef to
    // match, so a switch is only decided for Back/Forward or a hand-edited
    // URL.
    const action = decideUrlChange({
      datasetParam,
      currentDatasetId: currentDatasetIdRef.current,
      switchPending: pendingSwitchRef.current !== null,
    });

    if (action === 'switch-dataset') {
      // Itself a user request, which supersedes any load still in flight.
      controller.recordRequestedView(requestState);
      currentDatasetIdRef.current = datasetParam;
      startDatasetSwitch(controller, datasetParam);
      return;
    }

    if (navigationType === 'POP') {
      // Back/Forward while an example chosen from the menu is still loading:
      // the user went elsewhere, so that load must not land and push its
      // entry over the one they went to.
      controller.cancelPendingMenuLoad();
    }

    if (action === 'record-view') {
      controller.recordRequestedView(requestState);
      return;
    }

    pendingUrlRequestRef.current = true;
    controller.setRequestedView(requestState);
  }, [datasetParam, navigationType, requestState, startDatasetSwitch]);

  return { attachController };
}
