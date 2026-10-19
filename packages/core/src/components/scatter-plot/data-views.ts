import type { NumericAnnotationDisplaySettingsMap, VisualizationData } from '@protspace/utils';
import {
  materializeEatOverlay,
  materializeVisualizationData,
  viewVisualizationDataByIndices,
} from '@protspace/utils';
import { sameMaterialization } from './styling/same-materialization';

/** Default number of bins for numeric→categorical materialization. Mirrors
 *  materializeVisualizationData's `defaultBinCount = 10` default. */
const DEFAULT_NUMERIC_BIN_COUNT = 10;

interface DataViewsHost {
  data(): VisualizationData | null;
  selectedAnnotation(): string;
  numericAnnotationSettings(): NumericAnnotationDisplaySettingsMap;
  eatOverlayEnabled(): boolean;
  /** The query filter's kept protein ids, or null while no filter is active. */
  filteredProteinIds(): string[] | null;
  /** The isolation layers, or null outside isolation. */
  isolationHistory(): string[][] | null;
}

/**
 * The host's dataset as the plot, the legend and the export read it: materialized
 * (numeric bins, EAT predictions), through the query filter, and isolated. Each view
 * is built when first asked for and kept while its inputs are the same.
 */
export class DataViews {
  // The materialized data (`value`) and what it was built from. A read is answered in
  // three tiers (`materialized`):
  // 1. The same references and primitives as the build return `value` before the JSON key
  //    is serialized; the staging loops reach this per point (getOpacity -> visibility
  //    model -> materialized data). numericAnnotationSettings is replaced wholesale, so
  //    comparing the selected annotation's settings ref is sound: a rebin yields a new ref.
  // 2. The same data and numeric column with an equal JSON `key` return `value` too.
  // 3. When only the numeric settings moved (same data, annotation and overlay) and they
  //    land on the bins the plot already has (the legend publishing the defaults), the
  //    rebuild keeps handing out the previous `value`. Everything keyed on its identity
  //    (the visibility model, the style getters, the plot data's build, the recompute's
  //    own change check) then holds, instead of rebuilding for an equal copy.
  private _materialized: {
    source: VisualizationData;
    numericValues: Float64Array | null;
    selectedAnnotation: string | null;
    eatOverlayEnabled: boolean;
    selectedSettings: NumericAnnotationDisplaySettingsMap[string] | undefined;
    key: string;
    value: VisualizationData;
  } | null = null;
  // The materialized data through the query filter, kept while the materialized data
  // and the filter's id list are the same references.
  private _filtered: {
    materialized: VisualizationData;
    filteredProteinIds: string[];
    view: VisualizationData;
  } | null = null;
  // The proteins in every isolation layer, as ascending indices into `proteinIds`. Kept so
  // nothing rescans the dataset against the layers: `history`/`layers` identify the
  // isolation state they were taken from (layers are only ever pushed or replaced).
  private _isolatedIndices: {
    history: string[][];
    layers: number;
    proteinIds: readonly string[];
    indices: number[];
  } | null = null;
  // `current()`'s isolated view, reused until its inputs change.
  private _isolatedView: {
    materialized: VisualizationData;
    indices: number[];
    filteredProteinIds: string[] | null;
    view: VisualizationData;
  } | null = null;

  constructor(private readonly host: DataViewsHost) {}

  materialized(): VisualizationData | null {
    const sourceData = this.host.data();
    if (!sourceData) return null;

    const selectedAnnotation = this.host.selectedAnnotation();
    const eatOverlayEnabled = this.host.eatOverlayEnabled();
    const numericAnnotationSettings = this.host.numericAnnotationSettings();
    const selectedNumericValues = selectedAnnotation
      ? sourceData.numeric_annotation_data?.[selectedAnnotation]
      : undefined;
    const selectedNumericValuesCacheRef = selectedNumericValues ?? null;
    const selectedNumericSettings = selectedAnnotation
      ? numericAnnotationSettings?.[selectedAnnotation]
      : undefined;
    const memo = this._materialized;
    const sameColumn =
      memo !== null &&
      memo.source === sourceData &&
      memo.numericValues === selectedNumericValuesCacheRef;

    // Tier 1 (see `_materialized`). The JSON key's selectedNumericType and
    // selectedNumericValuesLength derive from data and selectedAnnotation, both compared here.
    if (
      sameColumn &&
      memo.selectedAnnotation === selectedAnnotation &&
      memo.eatOverlayEnabled === eatOverlayEnabled &&
      memo.selectedSettings === selectedNumericSettings
    ) {
      return memo.value;
    }

    const selectedNumericAnnotation = selectedAnnotation
      ? sourceData.annotations[selectedAnnotation]
      : undefined;
    const selectedNumericType =
      selectedNumericAnnotation?.numericType ??
      selectedNumericAnnotation?.numericMetadata?.numericType ??
      null;

    const cacheKey = JSON.stringify({
      dataRef: sourceData.protein_ids.length,
      selectedAnnotation,
      selectedNumericValuesLength: selectedNumericValues?.length ?? 0,
      selectedNumericType,
      numericAnnotationSettings: selectedNumericSettings ?? null,
      annotationKeys: Object.keys(sourceData.annotations),
      eatOverlayEnabled,
    });

    // Tier 2.
    if (sameColumn && memo.key === cacheKey) return memo.value;

    const rematerialized = materializeEatOverlay(
      materializeVisualizationData(
        sourceData,
        numericAnnotationSettings,
        DEFAULT_NUMERIC_BIN_COUNT,
        selectedAnnotation,
      ),
      selectedAnnotation,
      eatOverlayEnabled,
    );
    // Tier 3.
    const onlySettingsMoved =
      sameColumn &&
      memo.selectedAnnotation === (selectedAnnotation ?? null) &&
      memo.eatOverlayEnabled === eatOverlayEnabled;
    const value =
      onlySettingsMoved && sameMaterialization(memo.value, rematerialized, selectedAnnotation)
        ? memo.value
        : rematerialized;
    this._materialized = {
      source: sourceData,
      numericValues: selectedNumericValuesCacheRef,
      selectedAnnotation: selectedAnnotation ?? null,
      eatOverlayEnabled,
      selectedSettings: selectedNumericSettings,
      key: cacheKey,
      value,
    };
    return value;
  }

  /** The query filter's kept ids, or null while no filter is active. */
  filterSet(): Set<string> | null {
    const ids = this.host.filteredProteinIds();
    return ids ? new Set(ids) : null;
  }

  /**
   * The proteins in every isolation layer, as ascending indices into `proteinIds`, or `null`
   * outside isolation. Isolation is a set of proteins, not what is drawn: the plotted set
   * also lacks every protein the selected projection does not place, which stays part of
   * the isolated subset.
   */
  isolatedIndices(proteinIds: readonly string[]): number[] | null {
    const history = this.host.isolationHistory();
    if (!history || history.length === 0) return null;
    const memo = this._isolatedIndices;
    if (
      memo &&
      memo.history === history &&
      memo.layers === history.length &&
      memo.proteinIds === proteinIds
    ) {
      return memo.indices;
    }
    const layers = history.map((layer) => new Set(layer));
    const indices: number[] = [];
    for (let index = 0; index < proteinIds.length; index++) {
      const id = proteinIds[index];
      if (layers.every((layer) => layer.has(id))) indices.push(index);
    }
    this._isolatedIndices = { history, layers: history.length, proteinIds, indices };
    return indices;
  }

  /** Records `indices` as the isolated subset of `history`, just pushed by its caller. */
  noteIsolated(history: string[][], proteinIds: readonly string[], indices: number[]): void {
    this._isolatedIndices = { history, layers: history.length, proteinIds, indices };
  }

  /**
   * The materialized data through the query filter, or in isolation the isolated subset
   * through it. The isolated subset is taken from the isolation layers, not from the plot
   * data: a protein the selected projection does not place is culled from the plot but
   * stays in the dataset, so the .parquetbundle export and the legend counts keep it, and
   * an isolated subset of which no point is placed is still that subset, not the whole
   * dataset.
   */
  current(options?: { includeFilteredProteinIds?: boolean }): VisualizationData | null {
    const materialized = this.materialized();
    if (!materialized) return null;

    const filteredProteinIds =
      options?.includeFilteredProteinIds === false ? null : this.host.filteredProteinIds();
    const isolated = this.isolatedIndices(materialized.protein_ids);
    if (!isolated) {
      return filteredProteinIds
        ? this._filteredView(materialized, filteredProteinIds)
        : materialized;
    }

    const memo = this._isolatedView;
    if (
      memo &&
      memo.materialized === materialized &&
      memo.indices === isolated &&
      memo.filteredProteinIds === filteredProteinIds
    ) {
      return memo.view;
    }
    let keptIndices = isolated;
    if (filteredProteinIds) {
      const visible = new Set(filteredProteinIds);
      keptIndices = isolated.filter((index) => visible.has(materialized.protein_ids[index]));
    }
    const view = viewVisualizationDataByIndices(materialized, keptIndices);
    this._isolatedView = { materialized, indices: isolated, filteredProteinIds, view };
    return view;
  }

  /**
   * Drops the filtered view on a dataset swap. Its key already misses then, as the
   * materialized data is a new object, but the old slice must not outlive its dataset.
   * The materialization itself is replaced by the next read.
   */
  releaseDataset(): void {
    this._filtered = null;
  }

  /** Drops the isolated indices and view when isolation ends. */
  releaseIsolation(): void {
    this._isolatedIndices = null;
    this._isolatedView = null;
  }

  private _filteredView(
    materialized: VisualizationData,
    filteredProteinIds: string[],
  ): VisualizationData {
    const memo = this._filtered;
    if (
      memo &&
      memo.materialized === materialized &&
      memo.filteredProteinIds === filteredProteinIds
    ) {
      return memo.view;
    }
    const visible = new Set(filteredProteinIds);
    const keptIndices: number[] = [];
    materialized.protein_ids.forEach((proteinId, index) => {
      if (visible.has(proteinId)) keptIndices.push(index);
    });
    const view = viewVisualizationDataByIndices(materialized, keptIndices);
    this._filtered = { materialized, filteredProteinIds, view };
    return view;
  }
}
