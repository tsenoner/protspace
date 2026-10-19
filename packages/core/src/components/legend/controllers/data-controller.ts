import {
  DEFAULT_CATEGORICAL_PALETTE_ID,
  DEFAULT_NUMERIC_STRATEGY,
  annotationCategoryScores,
  getNumericBinLabelMap,
  getNumericBinLowerBoundMap,
  getOrderedNumericBinIds,
  hasEatPredictionsForAnnotation,
  autoClusterScoreCaveat,
  isNumericAnnotation,
  materializeNumericAnnotation,
  normalizeNumericPaletteId,
  resolveNumericAnnotationDisplaySettings,
  type NumericBinningStrategy,
} from '@protspace/utils';
import { perfCounters } from '../../../utils/perf-counters';
import { LEGEND_DEFAULTS, LEGEND_VALUES, toInternalValue } from '../config';
import { computeEatPopulationCounts } from '../eat-population-counts';
import { LegendDataProcessor } from '../legend-data-processor';
import {
  SHAPE_SIZE_FILLER,
  calculatePointSize,
  defaultShapeSize,
  valueToKey,
} from '../legend-helpers';
import {
  applyDerivedNumericColors,
  applyNumericDisplayLabels,
  applyPaletteColors,
  normalizeCategoricalPaletteId,
  normalizeSortModeForType,
  numericOrderFromItems,
  resolvePersistedSettings,
  type ResolvedLegendSettings,
} from '../legend-items-state';
import type { ProtspaceLegend } from '../legend';
import type {
  LegendAnnotationData,
  LegendItem,
  LegendPersistedSettings,
  LegendSortMode,
  PersistedCategoryData,
  ScatterplotData,
} from '../types';
import type { PersistenceCallbacks } from './persistence-controller';

/** The legend's view of one annotation: the fields `annotationData` carries. */
function annotationDataFor(
  name: string,
  annotation: ScatterplotData['annotations'][string],
): LegendAnnotationData {
  return {
    name,
    values: annotation.values,
    colors: annotation.colors,
    shapes: annotation.shapes,
    kind: annotation.kind,
    sourceKind: annotation.sourceKind,
    numericMetadata: annotation.numericMetadata,
    runtime: annotation.runtime,
  };
}

/**
 * The legend's data pipeline: the scatterplot's data and annotation changes, the counts, the
 * item pass and its rebuild, the stored settings' apply, the shape size, the numeric order and
 * signatures. A plain class over its element: it reads and writes the legend's state directly
 * (the members `legend.ts` lists as read and written by its controllers).
 *
 * `updateItems()` has one caller, `ProtspaceLegend._updateLegendItems()`, so
 * `perfCounters.legendUpdate` counts exactly the calls tests and the perf budgets spy on.
 */
export class LegendDataController {
  constructor(private readonly host: ProtspaceLegend) {}

  /** The record `PersistenceController` stores for the selected annotation. */
  currentSettings(): ReturnType<PersistenceCallbacks['getCurrentSettings']> {
    const isNumericAnnotation = this.host._isCurrentAnnotationNumeric();
    return {
      maxVisibleValues: this.host.maxVisibleValues,
      shapeSize: this.host._annotationShapeSize ?? SHAPE_SIZE_FILLER,
      sortMode: normalizeSortModeForType(
        this.host._annotationSortModes[this.host.selectedAnnotation],
        isNumericAnnotation,
      ),
      enableDuplicateStackUI: this.host._enableDuplicateStackUI,
      selectedPaletteId: isNumericAnnotation
        ? normalizeNumericPaletteId(this.host._selectedPaletteId)
        : normalizeCategoricalPaletteId(this.host._selectedPaletteId),
      numericSettings: isNumericAnnotation
        ? {
            strategy:
              this.host._numericSettingsByAnnotation[this.host.selectedAnnotation]?.strategy ??
              DEFAULT_NUMERIC_STRATEGY,
            reverseGradient:
              this.host._numericSettingsByAnnotation[this.host.selectedAnnotation]
                ?.reverseGradient ?? false,
            signature: this.host.annotationData.numericMetadata?.signature ?? '',
            topologySignature: this.host.annotationData.numericMetadata?.topologySignature ?? '',
            manualOrderIds: this.buildNumericManualOrderIds(this.host.selectedAnnotation),
          }
        : undefined,
    };
  }

  onDataChange(
    data: ScatterplotData,
    selectedAnnotation: string,
    selectedProjectionName: string,
  ): void {
    // A pending edit lands on the annotation it was made for, before the plot moves to another.
    if (selectedAnnotation !== this.host.selectedAnnotation) this.host._closeAnnotationOverlays();
    this.host._reorder.clear();
    const scatterplot = this.host._scatterplotController.scatterplot;
    this.host._eatControls.mirrorOverlayEnabled(scatterplot?.eatOverlayEnabled ?? true);
    // The reliability slider position is legend-owned now (it drives the query
    // filter, not scatter-plot dimming), so it is preserved across data-change
    // rather than re-read from the scatter plot.
    this.host.data = {
      annotations: data.annotations,
      protein_ids: data.protein_ids,
      numeric_annotation_data: data.numeric_annotation_data,
      annotation_predicted: data.annotation_predicted,
    };
    this.host.selectedAnnotation = selectedAnnotation;
    this.host.annotationData = annotationDataFor(
      selectedAnnotation,
      data.annotations[selectedAnnotation],
    );
    this.updateAnnotationValues(data, selectedAnnotation);
    this.host._eatCounts = computeEatPopulationCounts(
      data,
      selectedAnnotation,
      this.host._eatControls.overlayEnabled,
    );
    // Taken from the unsliced element, not from the incoming payload.
    // `sliceWith` in utils strips `statisticsRows` from a filtered or isolated
    // view on purpose (a slice must not carry scores that describe the whole dataset), so
    // reading them off `data` made every filter look identical to "this annotation was never
    // scored" -- which is why this used to need a sticky per-annotation memory to tell the two
    // apart. The scores are whole-dataset facts about the annotation, so the legend reads them
    // from the whole dataset and decides separately whether to plot them (`_renderScoreStrips`).
    // Same escape hatch the dataset hash in `updated()` already uses, and the same source the
    // sibling projection-metadata panel is handed.
    const statisticsRows = scatterplot?.data?.statisticsRows ?? data.statisticsRows;
    this.host._categoryScores = annotationCategoryScores(
      statisticsRows,
      selectedAnnotation,
      selectedProjectionName,
    );
    this.host._clusterCaveat = autoClusterScoreCaveat(statisticsRows, selectedAnnotation);
    this.host.proteinIds = data.protein_ids;

    // Sync isolation state
    const { isolationMode, isolationHistory } =
      this.host._scatterplotController.getIsolationState();

    // Save visible values before entering isolation so "Other" items stay grouped
    if (isolationMode && !this.host.isolationMode) {
      this.host._preIsolationVisibleValues = this.host._visibleValues;
    }

    this.host.isolationMode = isolationMode;
    this.host.isolationHistory = isolationHistory;
  }

  onAnnotationChange(annotation: string): void {
    // A value still being typed belongs to the annotation it was typed for.
    this.host._closeAnnotationOverlays();
    this.host._reorder.clear();
    this.host.selectedAnnotation = annotation;
    this.host._hiddenValues = [];
    // Reset pre-isolation visible values so the new annotation uses maxVisibleValues
    // instead of being constrained to the old annotation's visible set
    if (this.host.isolationMode) {
      this.host._preIsolationVisibleValues = new Set<string>();
    }
    this.host._scatterplotController.forceSync();
  }

  refreshAnnotationData(): void {
    const annotationInfo = this.host.data?.annotations?.[this.host.selectedAnnotation] ?? null;
    this.host.annotationData = annotationInfo
      ? annotationDataFor(this.host.selectedAnnotation, annotationInfo)
      : { name: '', values: [] };
  }

  private updateAnnotationValues(data: ScatterplotData, selectedAnnotation: string): void {
    this.host._countSource = {
      colData: data.annotation_data[selectedAnnotation],
      values: data.annotations[selectedAnnotation].values,
      proteinCount: data.protein_ids.length,
    };
  }

  /**
   * Legend counts, isolation applied: from the synced storage, or from the public
   * `annotationValues` array when there is none. Either way the processor only ever
   * sees the counted map.
   *
   * Recomputed per rebuild rather than cached: the bincount is ~2 ms at 573K,
   * cheaper than the array scan it replaces, and it depends on the isolation
   * state, which changes independently of the storage.
   */
  private computeAnnotationCounts(knownValues: string[]): ReadonlyMap<string, number> {
    const isolating = this.host.isolationMode && this.host.isolationHistory?.length > 0;
    const filteredIndices = isolating
      ? LegendDataProcessor.getFilteredIndices(
          true,
          this.host.isolationHistory,
          this.host.proteinIds,
        )
      : null;
    const source = this.host._countSource;
    if (!source) {
      // The array holds one value per protein in `proteinIds` order, so the filter's
      // protein indices address it directly.
      return LegendDataProcessor.countAnnotationFrequencies(
        this.host.annotationValues,
        filteredIndices,
        knownValues,
      );
    }
    // Protein order while host-driven, the order a per-protein `annotationValues` feed
    // gives, so the legend comes out the same whether its host feeds it or it counts the
    // synced storage. Tied counts keep this order, which settles their rows and colours.
    return LegendDataProcessor.countFromStorage(
      source.colData,
      source.values,
      source.proteinCount,
      filteredIndices,
      knownValues,
      this.host._hostDriven,
    );
  }

  hasSelectedEatAnnotation(): boolean {
    const stableData = this.host._scatterplotController.scatterplot?.data ?? this.host.data;
    return hasEatPredictionsForAnnotation(stableData, this.host.selectedAnnotation);
  }

  ensureSortModeDefaults(): void {
    const annotationNames = this.host.data?.annotations
      ? Object.keys(this.host.data.annotations)
      : [];
    if (annotationNames.length === 0) return;

    const updated: Record<string, LegendSortMode> = { ...this.host._annotationSortModes };
    for (const aname of annotationNames) {
      updated[aname] = this.normalizeSortMode(aname, updated[aname]);
    }
    this.host._annotationSortModes = updated;
  }

  /**
   * Rebuild legend items and apply persisted z-order.
   * Use when forcing a full rebuild outside the updated() lifecycle.
   */
  rebuildItems(): void {
    if (perfCounters) perfCounters.legendRebuild++;
    this.host._updateLegendItems();

    if (
      !this.host._isNumericAnnotation() &&
      this.host._persistenceController.hasPendingCategories()
    ) {
      this.host._legendItems = this.host._persistenceController.applyPendingZOrder(
        this.host._legendItems,
      );
    }
  }

  buildNumericManualOrderIds(annotationName: string): string[] | undefined {
    if (!annotationName) return undefined;
    const manualOrderIds = this.host._numericManualOrderIdsByAnnotation[annotationName];
    if (manualOrderIds?.length) {
      return manualOrderIds;
    }

    if (annotationName !== this.host.selectedAnnotation || !this.host._isNumericAnnotation()) {
      return undefined;
    }

    return numericOrderFromItems(this.host._legendItems);
  }

  setNumericManualOrderIds(annotationName: string, orderIds: string[] | undefined): void {
    if (!annotationName) return;

    if (!orderIds || orderIds.length === 0) {
      const rest = { ...this.host._numericManualOrderIdsByAnnotation };
      delete rest[annotationName];
      this.host._numericManualOrderIdsByAnnotation = rest;
      return;
    }

    this.host._numericManualOrderIdsByAnnotation = {
      ...this.host._numericManualOrderIdsByAnnotation,
      [annotationName]: [...orderIds],
    };
  }

  updateItems(): void {
    if (perfCounters) perfCounters.legendUpdate++;
    // Aligned with PersistenceController's isNumericAnnotation callback so the
    // processor and the persistence layer agree on numeric-ness in transient states.
    const isNumericAnnotation = this.host._isCurrentAnnotationNumeric();
    // Ahead of the bincount below, which is O(proteins) and has nothing to count for
    // an annotation with no values at all.
    if (!this.host.annotationData?.values?.length) {
      this.host._legendItems = [];
      return;
    }
    const knownValues = isNumericAnnotation
      ? this.host.annotationData.values.map((value) => toInternalValue(value))
      : [];
    const frequencies = this.computeAnnotationCounts(knownValues);
    if (!isNumericAnnotation && frequencies.size === 0) {
      this.host._legendItems = [];
      return;
    }

    try {
      // Get persisted categories from persistence controller
      const persistedCategories: Record<string, PersistedCategoryData> =
        this.host._isNumericAnnotation() ? {} : this.host._persistenceController.pendingCategories;

      // Get pending values for extract/merge operations
      // undefined = no pending operation, string = value (including '__NA__' for N/A)
      const pendingExtract = this.host._pendingExtractValue;
      const pendingMerge = this.host._pendingMergeValue;

      // Use visibleValues to preserve the current visible set when:
      // - There are persisted settings in localStorage
      // - There are pending extract/merge operations
      // - There are already legend items (e.g., switching sort mode before persistence)
      // When none of these apply (true initial load), use empty set so maxVisibleValues is respected.
      const hasPendingOps = pendingExtract !== undefined || pendingMerge !== undefined;
      const hasExistingItems = this.host._legendItems.some((i) => i.value !== LEGEND_VALUES.OTHER);
      const visibleValues = this.host.isolationMode
        ? this.host._preIsolationVisibleValues
        : this.host._persistenceController.hasPersistedSettings() ||
            hasPendingOps ||
            hasExistingItems
          ? this.host._visibleValues
          : new Set<string>();
      const numericOrderValues = getNumericBinLowerBoundMap(this.host.annotationData);
      const numericDisplayLabels = getNumericBinLabelMap(this.host.annotationData);
      const numericManualOrderIds = isNumericAnnotation
        ? (this.buildNumericManualOrderIds(this.host.selectedAnnotation) ?? [])
        : [];
      const existingLegendItems =
        isNumericAnnotation && this.host._currentSortMode.startsWith('manual')
          ? getOrderedNumericBinIds(this.host.annotationData, 'manual', numericManualOrderIds).map(
              (id, index) => ({
                value: id,
                displayValue: numericDisplayLabels.get(id) ?? id,
                color: '',
                shape: 'circle',
                count: 0,
                isVisible: true,
                zOrder: index,
              }),
            )
          : this.host._legendItems;

      const { legendItems, otherItems } = LegendDataProcessor.processLegendItems(
        this.host._processorContext,
        this.host.annotationData.name || this.host.selectedAnnotation,
        frequencies,
        this.host.maxVisibleValues,
        this.host.isolationMode,
        existingLegendItems,
        this.host._currentSortMode,
        persistedCategories,
        visibleValues,
        numericOrderValues,
        !isNumericAnnotation,
        pendingExtract,
        pendingMerge,
        isNumericAnnotation,
      );

      // Apply hidden values
      if (this.host._hiddenValues.length > 0) {
        this.host._legendItems = legendItems.map((item: LegendItem) => ({
          ...item,
          isVisible: !this.host._hiddenValues.includes(valueToKey(item.value)),
        }));
      } else {
        this.host._legendItems = legendItems;
      }
      this.host._otherItems = otherItems;

      if (isNumericAnnotation) {
        // Only once the annotation itself reads as numeric: a plot-side numeric column whose
        // legend data has not caught up yet keeps the processor's labels and colours.
        if (this.host._isNumericAnnotation()) {
          this.host._legendItems = applyDerivedNumericColors(
            applyNumericDisplayLabels(this.host._legendItems, this.host.annotationData),
            this.host.annotationData,
          );
        }
      } else if (this.host._selectedPaletteId !== DEFAULT_CATEGORICAL_PALETTE_ID) {
        this.host._legendItems = applyPaletteColors(
          this.host._legendItems,
          this.host._selectedPaletteId,
        );
      }

      // Clear pending extract/merge values after they've been applied
      this.host._pendingExtractValue = undefined;
      this.host._pendingMergeValue = undefined;
      // Note: We do NOT clear pendingCategories here because subsequent update cycles
      // (triggered by property changes in applyPersistedSettings) may rebuild legend items
      // and need the persisted colors/shapes. Categories are cleared when loadSettings()
      // is called for a new annotation.

      // Sync with scatterplot
      this.host._scatterplotController.dispatchZOrderChange();
      this.host._scatterplotController.dispatchColorMappingChange();
      this.host._scatterplotController.syncOtherValues();
      this.host._scatterplotController.syncHiddenValues();
    } catch (error) {
      this.host._dispatchError(
        'Failed to process legend data',
        'data-processing',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  applyPersistedSettings(settings: LegendPersistedSettings): void {
    try {
      const resolved: ResolvedLegendSettings = resolvePersistedSettings(settings, {
        isNumeric: this.host._isCurrentAnnotationNumeric(),
        liveNumeric: this.host._numericSettingsByAnnotation[this.host.selectedAnnotation],
        signatures: (binCount, strategy, paletteId, reverseGradient) =>
          this.computeNumericSettingsSignatures(binCount, strategy, paletteId, reverseGradient),
      });

      if (resolved.clearPendingCategories) {
        this.host._persistenceController.clearPendingCategories();
      }
      this.host.maxVisibleValues = resolved.maxVisibleValues;
      this.host._annotationShapeSize = resolved.annotationShapeSize;
      this.host.shapeSize = this.resolveShapeSize();
      this.host._hiddenValues = resolved.hiddenValues;
      this.host._selectedPaletteId = resolved.paletteId;

      if (resolved.numeric) {
        const { manualOrderIds, ...numericSettings } = resolved.numeric;
        this.host._numericSettingsByAnnotation = {
          ...this.host._numericSettingsByAnnotation,
          [this.host.selectedAnnotation]: numericSettings,
        };
        this.setNumericManualOrderIds(this.host.selectedAnnotation, manualOrderIds);
      }

      this.host._annotationSortModes = {
        ...this.host._annotationSortModes,
        [this.host.selectedAnnotation]: resolved.sortMode,
      };

      this.host._enableDuplicateStackUI = resolved.enableDuplicateStackUI === true;
      this.host._scatterplotController.updateConfig({
        pointSize: calculatePointSize(this.host.shapeSize),
        enableDuplicateStackUI: this.host._enableDuplicateStackUI,
      });
      this.host._scatterplotController.syncNumericAnnotationSettings();
    } catch (error) {
      this.host._dispatchError(
        'Failed to apply persisted settings',
        'persistence',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * The dataset's stored size (picked, or a bundle's top-level size), else the annotation's own,
   * else the default from the dataset's protein count; capped at the dialog's bound.
   */
  resolveShapeSize(): number {
    return Math.min(
      this.host._persistenceController.loadShapeSize() ??
        this.host._annotationShapeSize ??
        defaultShapeSize(this.host._datasetProteinCount),
      LEGEND_DEFAULTS.maxSymbolSize,
    );
  }

  /**
   * Forget the dataset's picked size and every annotation's own, so the default from the
   * protein count applies; that default is never stored.
   */
  clearShapeSize(): void {
    this.host._persistenceController.clearShapeSize(Object.keys(this.host.data?.annotations ?? {}));
    this.host._annotationShapeSize = null;
    this.host.shapeSize = this.resolveShapeSize();
  }

  private computeNumericSettingsSignatures(
    binCount: number,
    strategy: NumericBinningStrategy,
    paletteId: string,
    reverseGradient: boolean,
  ): { signature: string | null; topologySignature: string | null } {
    const rawNumericValues =
      this.host._scatterplotController.scatterplot?.data?.numeric_annotation_data?.[
        this.host.selectedAnnotation
      ] ?? this.host.data?.numeric_annotation_data?.[this.host.selectedAnnotation];

    if (!rawNumericValues) {
      return {
        signature: this.host.annotationData.numericMetadata?.signature ?? null,
        topologySignature: this.host.annotationData.numericMetadata?.topologySignature ?? null,
      };
    }

    const metadata = materializeNumericAnnotation(rawNumericValues, {
      binCount,
      strategy,
      paletteId,
      reverseGradient,
    }).annotation.numericMetadata;
    return {
      signature: metadata?.signature ?? null,
      topologySignature: metadata?.topologySignature ?? null,
    };
  }

  normalizeSortMode(annotationName: string, sortMode: LegendSortMode | undefined): LegendSortMode {
    const annotation =
      this.host.data?.annotations?.[annotationName] ??
      (annotationName === this.host.selectedAnnotation ? this.host.annotationData : undefined);
    const isNumeric = isNumericAnnotation(annotation);

    return normalizeSortModeForType(sortMode, isNumeric);
  }

  syncNumericSettingsFromPersistence(): void {
    const annotationEntries = Object.entries(this.host.data?.annotations ?? {});
    if (annotationEntries.length === 0) {
      return;
    }

    const persistedSettings = this.host.getAllPersistedSettings();
    const nextNumericSettings = { ...this.host._numericSettingsByAnnotation };
    let didChange = false;

    for (const [annotationName, annotation] of annotationEntries) {
      if (!isNumericAnnotation(annotation)) {
        continue;
      }

      const persisted = persistedSettings[annotationName];
      const { settings: nextSettings } = resolveNumericAnnotationDisplaySettings({
        persistedSettings: persisted,
        liveSettings: nextNumericSettings[annotationName],
        defaultBinCount: LEGEND_DEFAULTS.maxVisibleValues,
      });

      const currentSettings = nextNumericSettings[annotationName];
      if (
        !currentSettings ||
        currentSettings.binCount !== nextSettings.binCount ||
        currentSettings.strategy !== nextSettings.strategy ||
        currentSettings.paletteId !== nextSettings.paletteId ||
        currentSettings.reverseGradient !== nextSettings.reverseGradient
      ) {
        nextNumericSettings[annotationName] = nextSettings;
        didChange = true;
      }
    }

    if (didChange) {
      this.host._numericSettingsByAnnotation = nextNumericSettings;
      this.host._scatterplotController.syncNumericAnnotationSettings();
    }
  }
}
