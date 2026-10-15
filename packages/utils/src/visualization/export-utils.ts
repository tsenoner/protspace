/**
 * Export utilities for ProtSpace visualizations
 */

import { SHAPE_PATH_GENERATORS, renderPathOnCanvas, toDisplayValue } from './shapes';
import { NA_VALUE } from './missing-values';
import type { Annotation, AnnotationData, AnnotationPredictedData, Projection } from '../types.js';
import {
  getProteinAnnotationCount,
  getProteinAnnotationIndexAt,
} from './annotation-data-access.js';
import { getEatCompanionColumn, getPredictedCellValues } from './eat-overlay.js';
import { isNumericAnnotation } from './numeric-binning.js';

// PDF generation libraries are imported dynamically for better browser compatibility
declare const window: Window & typeof globalThis;

export interface ExportableData {
  protein_ids: string[];
  annotations: Record<
    string,
    {
      values: (string | null)[];
      colors: string[];
      shapes: string[];
      numericMetadata?: {
        bins?: Array<{ id: string; label: string }>;
      };
      kind?: Annotation['kind'];
      sourceKind?: Annotation['sourceKind'];
      runtime?: Annotation['runtime'];
    }
  >;
  annotation_data: Record<string, AnnotationData>;
  projections?: Array<{ name: string } & Partial<Pick<Projection, 'data' | 'dimension'>>>;
  numeric_annotation_data?: Record<string, Float64Array>;
  annotation_predicted?: AnnotationPredictedData;
}

export interface ExportableElement extends Element {
  getCurrentData(): ExportableData | null;
  selectedAnnotation: string;
  selectedProjectionIndex: number;
  selectedProteinIds?: string[];
  hiddenAnnotationValues?: string[];
}

// Narrow typing for accessing the legend component from this utils package
type LegendExportItem = {
  /** Category value using internal representation. N/A items use '__NA__', "Other" uses 'Other' */
  value: string;
  displayValue?: string;
  color: string;
  shape: string;
  count: number;
  isVisible: boolean;
  zOrder: number;
  extractedFromOther?: boolean;
};
type LegendExportState = {
  annotation: string;
  otherItemsCount: number;
  items: LegendExportItem[];
};

export interface ExportOptions {
  /** Target width for scatterplot in pixels (excluding legend) */
  targetWidth?: number;
  /** Target height for scatterplot in pixels */
  targetHeight?: number;
  /** Legend width as percentage of total image width (15-50%) */
  legendWidthPercent?: number;
  /** Legend font/symbol scale factor (fontSizePx / 24) */
  legendScaleFactor?: number;
  /** Include only selected proteins */
  includeSelection?: boolean;
  /** Custom filename for export */
  exportName?: string;
  /** Background color */
  backgroundColor?: string;
  /** Whether to include the legend panel in the exported image (default: true) */
  includeLegend?: boolean;

  // ── Extended options (used by the publish/figure editor) ──
  /** Legend placement — defaults to 'right' for backwards compatibility */
  legendPosition?: 'right' | 'left' | 'top' | 'bottom' | 'tr' | 'tl' | 'br' | 'bl' | 'none';
  /** Number of legend columns (default: 1) */
  legendColumns?: number;
  /** Strategy when legend items exceed available space */
  legendOverflow?: 'scale' | 'truncate' | 'multi-column';
  /** Target DPI — informational, used for filename/metadata */
  dpi?: number;
}

export class ProtSpaceExporter {
  // Configuration constants
  private static readonly MAX_CANVAS_DIMENSION = 8192; // Browser limit
  private static readonly MAX_CANVAS_AREA = 268435456; // Chrome: ~268M pixels
  private static readonly SAFE_DIMENSION_MARGIN = 0.95; // 5% safety buffer
  private static readonly DEFAULT_LEGEND_SCALE = 1.0;
  private static readonly DEFAULT_BACKGROUND = '#ffffff';
  private static readonly PDF_MARGIN = 2; // mm
  private static readonly PDF_GAP = 4; // mm
  private static readonly PDF_MAX_WIDTH = 210; // A4 width in mm
  private static readonly DEFAULT_INCLUDE_LEGEND = true;

  private element: ExportableElement;
  private selectedProteins: string[];

  constructor(element: ExportableElement, selectedProteins: string[] = []) {
    this.element = element;
    this.selectedProteins = selectedProteins;
  }

  /**
   * Get the scatterplot element from the DOM
   */
  private getScatterplotElement(): HTMLElement | null {
    const element = document.querySelector('protspace-scatterplot') as HTMLElement;
    if (!element) {
      console.error('Could not find protspace-scatterplot element');
    }
    return element;
  }

  /**
   * Get export options with defaults applied
   */
  private getOptionsWithDefaults(options: ExportOptions = {}) {
    return {
      backgroundColor: options.backgroundColor || ProtSpaceExporter.DEFAULT_BACKGROUND,
      legendScaleFactor: options.legendScaleFactor ?? ProtSpaceExporter.DEFAULT_LEGEND_SCALE,
      legendWidthPercent: options.legendWidthPercent ?? 20,
      targetWidth: options.targetWidth,
      targetHeight: options.targetHeight,
      exportName: options.exportName,
      includeSelection: options.includeSelection,
      includeLegend: options.includeLegend ?? ProtSpaceExporter.DEFAULT_INCLUDE_LEGEND,
    };
  }

  /**
   * Validate that dimensions are within browser canvas limits
   * Returns true if dimensions are safe, false otherwise
   */
  private static validateCanvasDimensions(
    targetWidth: number,
    targetHeight: number,
  ): { isValid: boolean; reason?: string } {
    const effectiveMaxDimension = Math.floor(
      ProtSpaceExporter.MAX_CANVAS_DIMENSION * ProtSpaceExporter.SAFE_DIMENSION_MARGIN,
    );

    // Check dimension limits
    if (targetWidth > effectiveMaxDimension || targetHeight > effectiveMaxDimension) {
      return {
        isValid: false,
        reason: `Dimensions exceed browser limit of ${ProtSpaceExporter.MAX_CANVAS_DIMENSION}px per side. Maximum safe dimension: ${effectiveMaxDimension}px`,
      };
    }

    // Check area limit
    const totalPixels = targetWidth * targetHeight;
    const maxSafeArea = ProtSpaceExporter.MAX_CANVAS_AREA * ProtSpaceExporter.SAFE_DIMENSION_MARGIN;
    if (totalPixels > maxSafeArea) {
      return {
        isValid: false,
        reason: `Total pixel area (${totalPixels.toLocaleString()}) exceeds browser limit (~${Math.floor(maxSafeArea).toLocaleString()} pixels)`,
      };
    }

    return { isValid: true };
  }

  /**
   * Generate consistent export filename: protspace_{projection}_{annotation}_{date}.{ext}
   * Falls back gracefully if data is not available.
   */
  private generateExportFileName(extension: string): string {
    const data = this.element.getCurrentData();
    // Format date as YYYY-MM-DD only (no time)
    const date = new Date().toISOString().split('T')[0];

    // Extract projection and annotation names
    const projection = data?.projections?.[this.element.selectedProjectionIndex]?.name || 'unknown';
    const annotation = this.element.selectedAnnotation || 'unknown';

    // Sanitize names (remove spaces, special chars, convert to lowercase)
    let cleanProjection = projection.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    const cleanAnnotation = annotation.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();

    // Remove dimension suffix after sanitization (e.g., "pca_2" -> "pca", "umap_3" -> "umap")
    cleanProjection = cleanProjection.replace(/_[23]$/, '');

    return `protspace_${cleanProjection}_${cleanAnnotation}_${date}.${extension}`;
  }

  /**
   * Check if an element should be ignored during export (UI overlays, tooltips, etc.)
   */
  private shouldIgnoreElement(element: Element): boolean {
    const ignoredClasses = [
      'projection-metadata',
      'mode-indicator',
      'plot-indicator',
      'tooltip',
      'duplicate-spiderfy-layer',
      'dup-spiderfy',
      'overlay-container',
      'brush-container',
    ];
    return ignoredClasses.some((className) => element.classList?.contains(className));
  }

  /**
   * Generate legend canvas for export
   */
  private generateLegendCanvas(
    scatterCanvas: HTMLCanvasElement,
    options: ReturnType<typeof this.getOptionsWithDefaults>,
  ): HTMLCanvasElement {
    const legendItems = this.buildLegendItems(options);
    const legendExportState = this.readLegendExportState();
    const annotationNameFromLegend = legendExportState?.annotation;

    // Calculate legend width based on percentage of total image width
    // If legendWidthPercent is 25%, then legend takes 25% and scatterplot takes 75%
    const legendPercent = (options.legendWidthPercent || 25) / 100;
    const legendWidth = Math.round(scatterCanvas.width * (legendPercent / (1 - legendPercent)));

    return this.renderLegendToCanvas(
      legendItems,
      legendWidth,
      scatterCanvas.height,
      options,
      annotationNameFromLegend || this.element.selectedAnnotation,
      options.legendScaleFactor,
    );
  }

  /**
   * Capture scatterplot element as canvas using native high-resolution WebGL rendering.
   * Falls back to html2canvas for older component versions without captureAtResolution.
   */
  private async captureScatterplotCanvas(
    scatterplotElement: HTMLElement,
    targetWidth?: number,
    targetHeight?: number,
    backgroundColor: string = ProtSpaceExporter.DEFAULT_BACKGROUND,
  ): Promise<HTMLCanvasElement> {
    // Cast to access the capture method
    const scatterplot = scatterplotElement as HTMLElement & {
      captureAtResolution?: (
        width: number,
        height: number,
        options?: { dpr?: number; backgroundColor?: string },
      ) => HTMLCanvasElement;
    };

    // Use current dimensions if not specified
    const width = targetWidth ?? scatterplotElement.clientWidth;
    const height = targetHeight ?? scatterplotElement.clientHeight;

    // Validate dimensions
    const validation = ProtSpaceExporter.validateCanvasDimensions(width, height);
    if (!validation.isValid) {
      throw new Error(`Export dimensions too large: ${validation.reason}`);
    }

    // Use native high-resolution capture if available
    if (typeof scatterplot.captureAtResolution === 'function') {
      try {
        return scatterplot.captureAtResolution(width, height, {
          dpr: 1, // Use DPR=1 for exact pixel output
          backgroundColor,
        });
      } catch {
        // Fall through to fallback capture
      }
    }

    // Fallback: Direct canvas capture (for older component versions)
    return this.fallbackCanvasCapture(scatterplotElement, width, height, backgroundColor);
  }

  /**
   * Fallback capture method using direct WebGL canvas copy and html2canvas.
   * Used when native captureAtResolution is not available.
   */
  private async fallbackCanvasCapture(
    scatterplotElement: HTMLElement,
    width: number,
    height: number,
    backgroundColor: string,
  ): Promise<HTMLCanvasElement> {
    // Try direct WebGL canvas capture first (faster, simpler)
    const webglCanvas = scatterplotElement.querySelector(
      'canvas:not(.badges-canvas)',
    ) as HTMLCanvasElement | null;

    if (webglCanvas) {
      try {
        const outputCanvas = document.createElement('canvas');
        outputCanvas.width = width;
        outputCanvas.height = height;

        const ctx = outputCanvas.getContext('2d');
        if (!ctx) {
          throw new Error('Failed to create 2D context');
        }

        // Fill with background color
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, width, height);

        // Draw WebGL canvas with scaling
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(
          webglCanvas,
          0,
          0,
          webglCanvas.width,
          webglCanvas.height,
          0,
          0,
          width,
          height,
        );

        // Also composite badges canvas if present
        const badgesCanvas = scatterplotElement.querySelector(
          'canvas.badges-canvas',
        ) as HTMLCanvasElement | null;
        if (badgesCanvas && badgesCanvas.width > 0) {
          ctx.drawImage(
            badgesCanvas,
            0,
            0,
            badgesCanvas.width,
            badgesCanvas.height,
            0,
            0,
            width,
            height,
          );
        }

        return outputCanvas;
      } catch {
        // Fall through to html2canvas fallback
      }
    }

    // Last resort: html2canvas
    const { default: html2canvas } = await import('html2canvas-pro');
    const rawCanvas = await html2canvas(scatterplotElement, {
      backgroundColor,
      scale: 1,
      useCORS: true,
      allowTaint: false,
      logging: false,
      width: scatterplotElement.clientWidth,
      height: scatterplotElement.clientHeight,
      scrollX: -window.scrollX,
      scrollY: -window.scrollY,
      ignoreElements: (element) => this.shouldIgnoreElement(element),
    });

    // Crop the 1px border from all sides
    const borderWidth = 1;
    return this.cropCanvas(
      rawCanvas,
      borderWidth,
      borderWidth,
      rawCanvas.width - borderWidth * 2,
      rawCanvas.height - borderWidth * 2,
    );
  }

  /**
   * Crop a canvas to remove borders
   */
  private cropCanvas(
    sourceCanvas: HTMLCanvasElement,
    x: number,
    y: number,
    width: number,
    height: number,
  ): HTMLCanvasElement {
    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = width;
    croppedCanvas.height = height;
    const ctx = croppedCanvas.getContext('2d');
    if (!ctx) {
      return sourceCanvas; // Fallback to source if context unavailable
    }
    ctx.drawImage(sourceCanvas, x, y, width, height, 0, 0, width, height);
    return croppedCanvas;
  }

  /**
   * Build legend items for export from live legend state or computed data
   */
  private buildLegendItems(options: ExportOptions): Array<{
    value: string;
    displayValue?: string;
    color: string;
    shape: string;
    count: number;
    annotation: string;
  }> {
    const currentData = this.element.getCurrentData();
    if (!currentData) return [];

    const legendExportState = this.readLegendExportState();
    const annotationNameFromLegend = legendExportState?.annotation;
    const hiddenSet = this.readHiddenAnnotationValueKeys();

    if (legendExportState) {
      const otherItemsCount = legendExportState.otherItemsCount;
      return legendExportState.items
        .filter((it) => it.isVisible)
        .map((it) => ({
          value: it.value,
          displayValue: it.displayValue ?? toDisplayValue(it.value, otherItemsCount),
          color: it.color,
          shape: it.shape,
          count: it.count,
          annotation: annotationNameFromLegend || this.element.selectedAnnotation,
        }));
    }

    return this.computeLegendFromData(
      currentData,
      this.element.selectedAnnotation,
      options.includeSelection === true ? this.selectedProteins : undefined,
    ).filter((it) => {
      return !hiddenSet.has(it.value);
    });
  }

  /**
   * Indices into `data.protein_ids` of the proteins the plot shows. `getCurrentData()` has
   * already applied the filter query and isolation; this drops the proteins whose values of the
   * coloured annotation are all hidden in the legend. Shared by the ID and table exports, so the
   * two always hold the same proteins.
   */
  private visibleProteinIndices(data: ExportableData): number[] {
    const all = data.protein_ids.map((_id, i) => i);
    const selectedAnnotation = this.element.selectedAnnotation;
    const annotationIndices = data.annotation_data?.[selectedAnnotation];
    const annotationInfo = data.annotations?.[selectedAnnotation];
    const hiddenValues: string[] = Array.isArray(this.element.hiddenAnnotationValues)
      ? (this.element.hiddenAnnotationValues as string[])
      : [];

    if (!annotationIndices || !annotationInfo || !Array.isArray(annotationInfo.values)) {
      // Fallback: if we cannot determine annotation visibility, export all proteins
      return all;
    }
    const hiddenSet = new Set(hiddenValues);
    return all.filter((i) => {
      const count = getProteinAnnotationCount(annotationIndices, i);
      // A protein is visible if at least one of its annotation values is not hidden
      if (count === 0) {
        return !hiddenSet.has(NA_VALUE);
      }
      for (let k = 0; k < count; k++) {
        const vi = getProteinAnnotationIndexAt(annotationIndices, i, k);
        const value: string | null =
          vi >= 0 && vi < annotationInfo.values.length ? (annotationInfo.values[vi] ?? null) : null;
        const key = value === null ? NA_VALUE : String(value);
        if (!hiddenSet.has(key)) return true;
      }
      return false;
    });
  }

  /**
   * Export protein IDs as text file
   */
  exportProteinIds(_options: ExportOptions = {}): void {
    const data = this.element.getCurrentData();
    if (!data) {
      console.error('No data available for export');
      return;
    }

    const visibleIds = this.visibleProteinIndices(data).map((i) => data.protein_ids[i]);
    const idsStr = visibleIds.join('\n');
    const idsUri = `data:text/plain;charset=utf-8,${encodeURIComponent(idsStr)}`;
    const fileName = 'protein_ids.txt';

    this.downloadFile(idsUri, fileName);
  }

  /**
   * Export the visible proteins (the ID export's set) as a tab-separated table: `protein_id`,
   * the selected projection's coordinates, then one column per annotation. Column names and cell
   * values match `protspace export`, so a script reads either file.
   */
  exportTable(_options: ExportOptions = {}): void {
    const data = this.element.getCurrentData();
    if (!data) {
      console.error('No data available for export');
      return;
    }

    const tsv = buildProteinTable(
      data,
      this.visibleProteinIndices(data),
      this.element.selectedProjectionIndex,
    );
    // A Blob, not a data: URI as for the IDs: a table can be megabytes, past some browsers'
    // URI length limit.
    const url = URL.createObjectURL(new Blob([tsv], { type: 'text/tab-separated-values' }));
    try {
      this.downloadFile(url, this.generateExportFileName('tsv'));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /**
   * Export visualization as a single PNG with a programmatic legend on the right (legend width = 1/5 of total)
   */
  async exportPNG(options: ExportOptions = {}): Promise<void> {
    try {
      await this.exportCombinedPNG(options);
    } catch (error) {
      console.error('PNG export failed:', error);
      throw error;
    }
  }

  /**
   * Create a combined PNG with scatterplot and legend side-by-side
   */
  private async exportCombinedPNG(options: ExportOptions = {}): Promise<void> {
    const scatterplotElement = this.getScatterplotElement();
    if (!scatterplotElement) return;

    const opts = this.getOptionsWithDefaults(options);

    // Capture scatterplot at target dimensions with quality scaling
    const scatterCanvas = await this.captureScatterplotCanvas(
      scatterplotElement,
      opts.targetWidth,
      opts.targetHeight,
      opts.backgroundColor,
    );

    let outCanvas: HTMLCanvasElement;

    if (opts.includeLegend) {
      // Generate legend canvas
      const legendCanvas = this.generateLegendCanvas(scatterCanvas, opts);

      // Composite scatterplot and legend
      const combinedWidth = scatterCanvas.width + legendCanvas.width;
      const combinedHeight = Math.max(scatterCanvas.height, legendCanvas.height);
      outCanvas = document.createElement('canvas');
      outCanvas.width = combinedWidth;
      outCanvas.height = combinedHeight;
      const ctx = outCanvas.getContext('2d');
      if (!ctx) {
        console.error('Could not get 2D context for output canvas');
        return;
      }

      ctx.fillStyle = opts.backgroundColor;
      ctx.fillRect(0, 0, combinedWidth, combinedHeight);
      ctx.drawImage(scatterCanvas, 0, 0);
      ctx.drawImage(legendCanvas, scatterCanvas.width, 0);
    } else {
      // Export scatterplot only (no legend)
      outCanvas = scatterCanvas;
    }

    // Download
    const dataUrl = outCanvas.toDataURL('image/png');
    const fileName = opts.exportName || this.generateExportFileName('png');
    this.downloadFile(dataUrl, fileName);
  }

  /**
   * Compute legend items (value, color, shape, count) from raw data and selected annotation.
   * If selectedProteinIds provided, counts will be based on the selection subset.
   */
  private computeLegendFromData(
    data: ExportableData,
    selectedAnnotation: string,
    selectedProteinIds?: string[],
  ): Array<{
    value: string;
    displayValue?: string;
    color: string;
    shape: string;
    count: number;
    annotation: string;
  }> {
    const annotation = selectedAnnotation || Object.keys(data.annotations || {})[0] || '';
    const annotationInfo = data.annotations?.[annotation];
    const indices = data.annotation_data?.[annotation];
    if (!annotationInfo || !indices || !Array.isArray(annotationInfo.values)) {
      return [];
    }

    // Map protein id -> index for selection filtering
    let allowedIndexSet: Set<number> | null = null;
    if (selectedProteinIds && Array.isArray(selectedProteinIds) && selectedProteinIds.length > 0) {
      const idToIndex = new Map<string, number>();
      for (let i = 0; i < data.protein_ids.length; i += 1) {
        idToIndex.set(data.protein_ids[i], i);
      }
      allowedIndexSet = new Set<number>();
      selectedProteinIds.forEach((pid) => {
        const idx = idToIndex.get(pid);
        if (typeof idx === 'number') allowedIndexSet!.add(idx);
      });
    }

    const counts = new Array(annotationInfo.values.length).fill(0) as number[];
    for (let i = 0; i < indices.length; i += 1) {
      if (allowedIndexSet && !allowedIndexSet.has(i)) continue;
      const count = getProteinAnnotationCount(indices, i);
      for (let k = 0; k < count; k++) {
        const vi = getProteinAnnotationIndexAt(indices, i, k);
        if (vi >= 0 && vi < counts.length) {
          counts[vi] += 1;
        }
      }
    }

    const items: Array<{
      value: string;
      displayValue?: string;
      color: string;
      shape: string;
      count: number;
      annotation: string;
    }> = [];
    const numericLabelMap = new Map(
      (annotationInfo.numericMetadata?.bins ?? []).map((bin) => [bin.id, bin.label]),
    );
    for (let i = 0; i < annotationInfo.values.length; i += 1) {
      const value = annotationInfo.values[i] ?? NA_VALUE;
      const color = annotationInfo.colors?.[i] ?? '#888';
      const shape = annotationInfo.shapes?.[i] ?? 'circle';
      const count = counts[i] ?? 0;
      items.push({
        value: String(value),
        displayValue: numericLabelMap.get(String(value)),
        color,
        shape,
        count,
        annotation,
      });
    }
    return items;
  }

  /**
   * Render a legend using Canvas 2D API (no dependency on legend component)
   */
  private renderLegendToCanvas(
    items: Array<{
      value: string;
      displayValue?: string;
      color: string;
      shape: string;
      count: number;
      annotation: string;
    }>,
    width: number,
    height: number,
    options: ExportOptions,
    overrideAnnotationName?: string,
    scaleFactor: number = 1.0,
  ): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(100, Math.floor(width));
    canvas.height = Math.max(100, Math.floor(height));
    const ctx = canvas.getContext('2d')!;

    const basePadding = 24;
    const baseHeaderHeight = 60;
    const baseItemHeight = 56;
    const baseSymbolSize = 28;
    const baseHeaderFont = 28;
    const baseItemFont = 24;

    const padding = basePadding * scaleFactor;
    const headerHeight = baseHeaderHeight * scaleFactor;
    const itemHeight = baseItemHeight * scaleFactor;
    const symbolSize = baseSymbolSize * scaleFactor;
    const headerFontSize = baseHeaderFont * scaleFactor;
    const itemFontSize = baseItemFont * scaleFactor;
    const bg = options.backgroundColor || '#ffffff';

    // ── Overflow strategy ────────────────────────────────
    // Extended options from the publish editor; default to legacy 'scale' for
    // backwards compatibility with the quick-export flow.
    const overflowMode = options.legendOverflow ?? 'scale';
    let columns = Math.max(1, options.legendColumns ?? 1);
    const availableContentHeight = canvas.height - padding * 2 - headerHeight;

    // Auto-compute columns for multi-column overflow
    if (overflowMode === 'multi-column' && columns === 1) {
      const singleColHeight = items.length * itemHeight;
      if (singleColHeight > availableContentHeight && availableContentHeight > 0) {
        columns = Math.ceil(singleColHeight / availableContentHeight);
      }
    }

    // Decide which items to render (truncation)
    let renderItems = items;
    let truncatedCount = 0;
    if (overflowMode === 'truncate') {
      const maxPerCol = Math.max(1, Math.floor(availableContentHeight / itemHeight));
      const maxItems = maxPerCol * columns;
      if (items.length > maxItems) {
        truncatedCount = items.length - maxItems;
        renderItems = items.slice(0, maxItems);
      }
    }

    // Legacy Y-scale mode (only when explicitly requested or defaulting)
    let scaleY = 1;
    if (overflowMode === 'scale') {
      const requiredHeight = padding + headerHeight + items.length * itemHeight + padding;
      scaleY = Math.min(1, canvas.height / requiredHeight);
    }

    ctx.save();
    if (scaleY < 1) ctx.scale(1, scaleY);

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, scaleY < 1 ? canvas.height / scaleY : canvas.height);

    ctx.fillStyle = '#1f2937';
    ctx.font = `600 ${headerFontSize}px Arial, sans-serif`;
    ctx.textBaseline = 'middle';
    const headerLabel = overrideAnnotationName || items[0]?.annotation || 'Legend';
    ctx.fillText(`${headerLabel}`, padding, padding + headerHeight / 2);

    // Items — distribute across columns
    const colWidth = (canvas.width - padding * 2) / columns;
    const itemsPerCol = Math.ceil(renderItems.length / columns);

    for (let i = 0; i < renderItems.length; i++) {
      const col = Math.floor(i / itemsPerCol);
      const row = i % itemsPerCol;
      const it = renderItems[i];

      const xBase = padding + col * colWidth;
      const y = padding + headerHeight + row * itemHeight;
      const cx = xBase + symbolSize / 2;
      const cy = y + itemHeight / 2;

      this.drawCanvasSymbol(ctx, it.shape, it.color, cx, cy, symbolSize);

      // Draw label (left-aligned)
      ctx.fillStyle = '#1f2937';
      ctx.font = `500 ${itemFontSize}px Arial, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      const textOffset = 8 * scaleFactor;
      const maxTextWidth = colWidth - symbolSize - textOffset - padding;
      ctx.fillText(
        it.displayValue ?? toDisplayValue(it.value),
        xBase + symbolSize + textOffset,
        cy,
        maxTextWidth > 0 ? maxTextWidth : undefined,
      );

      // Draw count (right-aligned, only for single-column)
      if (columns === 1) {
        const countStr = String(it.count);
        ctx.font = `500 ${itemFontSize}px Arial, sans-serif`;
        ctx.fillStyle = '#4b5563';
        ctx.textAlign = 'right';
        const countX = canvas.width - padding;
        ctx.fillText(countStr, countX, cy);
      }
    }

    // Truncation notice
    if (truncatedCount > 0) {
      const lastRow = Math.min(itemsPerCol, renderItems.length);
      const y = padding + headerHeight + lastRow * itemHeight + itemHeight / 2;
      ctx.fillStyle = '#6b7280';
      ctx.font = `italic 500 ${itemFontSize * 0.85}px Arial, sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(`+ ${truncatedCount} more`, padding, y);
    }

    ctx.restore();
    return canvas;
  }

  /**
   * Read hidden annotation values from the live scatterplot so exports mirror visibility.
   * Returns keys in the same format used internally (e.g., "__NA__" for N/A values).
   */
  private readHiddenAnnotationValueKeys(): Set<string> {
    try {
      const raw = Array.isArray(this.element.hiddenAnnotationValues)
        ? (this.element.hiddenAnnotationValues as string[])
        : [];
      return new Set(raw);
    } catch (_e) {
      console.error('Error reading hidden annotation values:', _e);
      return new Set<string>();
    }
  }

  /**
   * Draw a symbol on canvas using the same custom shapes as the legend component and WebGL renderer
   */
  private drawCanvasSymbol(
    ctx: CanvasRenderingContext2D,
    shape: string,
    color: string,
    cx: number,
    cy: number,
    size: number,
  ) {
    const shapeKey = (shape || 'circle').toLowerCase();
    const pathGenerator = SHAPE_PATH_GENERATORS[shapeKey] || SHAPE_PATH_GENERATORS.circle;
    const pathString = pathGenerator(size);

    // All shapes use the same rendering: filled with color, stroked with default stroke color
    renderPathOnCanvas(ctx, pathString, cx, cy, color || '#888', '#394150', 1);
  }

  /**
   * Read legend export state from the live legend component if available.
   */
  private readLegendExportState(): LegendExportState | null {
    const legendEl = document.querySelector('protspace-legend') as
      | (Element & { getLegendExportData?: () => LegendExportState })
      | null;
    try {
      if (legendEl && typeof legendEl.getLegendExportData === 'function') {
        const state = legendEl.getLegendExportData();
        if (state && Array.isArray(state.items)) return state as LegendExportState;
      }
    } catch (_e) {
      console.error('Error reading legend export state:', _e);
    }
    return null;
  }

  /**
   * Export visualization as a single PDF file (scatterplot on first page, legend on second if present)
   */
  async exportPDF(options: ExportOptions = {}): Promise<void> {
    try {
      await this.exportCombinedPDF(options);
    } catch (error) {
      console.error('PDF export failed:', error);
      throw error;
    }
  }

  /**
   * Create a single-page PDF with scatterplot and legend side-by-side
   */
  private async exportCombinedPDF(options: ExportOptions = {}): Promise<void> {
    const scatterplotElement = this.getScatterplotElement();
    if (!scatterplotElement) return;

    const opts = this.getOptionsWithDefaults(options);
    const { default: jsPDF } = await import('jspdf');

    // Capture scatterplot at target dimensions with quality scaling
    const scatterCanvas = await this.captureScatterplotCanvas(
      scatterplotElement,
      opts.targetWidth,
      opts.targetHeight,
      opts.backgroundColor,
    );

    const scatterImg = scatterCanvas.toDataURL('image/png', 1.0);
    const scatterRatio = scatterCanvas.width / scatterCanvas.height;
    const margin = ProtSpaceExporter.PDF_MARGIN;
    const maxWidth = ProtSpaceExporter.PDF_MAX_WIDTH - 2 * margin;

    let pdfWidth: number;
    let pdfHeight: number;

    if (opts.includeLegend) {
      // Generate legend canvas
      const legendCanvas = this.generateLegendCanvas(scatterCanvas, opts);
      const legendImg = legendCanvas.toDataURL('image/png', 1.0);
      const legendRatio = legendCanvas.width / legendCanvas.height;

      const gap = ProtSpaceExporter.PDF_GAP;
      const availableWidth = maxWidth - gap;

      // Distribute width proportionally based on aspect ratios
      const totalRatioWidth = scatterRatio + legendRatio;
      const scatterTargetW = availableWidth * (scatterRatio / totalRatioWidth);
      const legendTargetW = availableWidth * (legendRatio / totalRatioWidth);

      // Calculate heights maintaining aspect ratios
      const scatterTargetH = scatterTargetW / scatterRatio;
      const legendTargetH = legendTargetW / legendRatio;
      const contentHeight = Math.max(scatterTargetH, legendTargetH);

      pdfWidth = maxWidth + 2 * margin;
      pdfHeight = contentHeight + 2 * margin;

      const pdf = this.createPdfDocument(jsPDF, pdfWidth, pdfHeight);

      const xScatter = margin;
      const xLegend = xScatter + scatterTargetW + gap;
      pdf.addImage(scatterImg, 'PNG', xScatter, margin, scatterTargetW, scatterTargetH);
      pdf.addImage(legendImg, 'PNG', xLegend, margin, legendTargetW, legendTargetH);

      this.savePdf(pdf, opts.exportName);
    } else {
      // Export scatterplot only (no legend)
      const scatterTargetW = maxWidth;
      const scatterTargetH = scatterTargetW / scatterRatio;

      pdfWidth = maxWidth + 2 * margin;
      pdfHeight = scatterTargetH + 2 * margin;

      const pdf = this.createPdfDocument(jsPDF, pdfWidth, pdfHeight);

      pdf.addImage(scatterImg, 'PNG', margin, margin, scatterTargetW, scatterTargetH);

      this.savePdf(pdf, opts.exportName);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private createPdfDocument(jsPDF: any, width: number, height: number): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdf: any = new (jsPDF as any)({
      orientation: width > height ? 'landscape' : 'portrait',
      unit: 'mm',
      format: [width, height],
    });
    pdf.setProperties({
      title: 'ProtSpace Visualization',
      subject: 'ProtSpace export',
      author: 'ProtSpace',
      creator: 'ProtSpace',
    });
    return pdf;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private savePdf(pdf: any, exportName?: string): void {
    const fileName = exportName || this.generateExportFileName('pdf');
    pdf.save(fileName);
  }

  /**
   * Download file helper
   */
  private downloadFile(url: string, filename: string): void {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
  }
}

/** Shortest decimal that reads back as the same float32, as Python prints a float32 column. */
function formatFloat32(value: number): string {
  if (!Number.isFinite(value)) return '';
  for (let digits = 1; digits < 9; digits++) {
    const text = String(Number(value.toPrecision(digits)));
    if (Math.fround(Number(text)) === value) return text;
  }
  return String(Number(value.toPrecision(9)));
}

/** A TSV field, quoted as pandas quotes one when it holds a tab, line break or quote. */
function tsvField(value: string): string {
  return /[\t\n\r"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * The table `exportTable` writes, for the proteins at `rows`. A categorical cell holds its labels
 * joined with `;`, a numeric one its raw value (not its bin), a missing one nothing. An annotation
 * with EAT predictions keeps its curated values only and is followed by the `__pred_*` columns
 * `protspace transfer` writes; the synthetic confidence view is not a column of its own.
 */
function buildProteinTable(
  data: ExportableData,
  rows: readonly number[],
  projectionIndex: number,
): string {
  const columns: Array<{ name: string; cell: (row: number) => string }> = [];

  const projection = data.projections?.[projectionIndex];
  if (projection?.data && projection.dimension) {
    const { data: coords, dimension } = projection;
    ['x', 'y', 'z'].slice(0, dimension).forEach((axis, offset) => {
      columns.push({
        name: `${projection.name}_${axis}`,
        cell: (row) => formatFloat32(coords[row * dimension + offset]),
      });
    });
  }

  for (const [name, annotation] of Object.entries(data.annotations)) {
    if (annotation.runtime?.role === 'eat-confidence') continue;

    const numeric = data.numeric_annotation_data?.[name];
    if (isNumericAnnotation(annotation) && numeric) {
      columns.push({
        name,
        cell: (row) => (Number.isFinite(numeric[row]) ? String(numeric[row]) : ''),
      });
      continue;
    }

    const storage = data.annotation_data[name];
    if (!storage) continue;
    const predicted = data.annotation_predicted?.[name];
    columns.push({
      name,
      cell: (row) => {
        if (predicted?.[row]) return '';
        const labels: string[] = [];
        const count = getProteinAnnotationCount(storage, row);
        for (let k = 0; k < count; k++) {
          const label = annotation.values[getProteinAnnotationIndexAt(storage, row, k)];
          if (label != null) labels.push(label);
        }
        return labels.join(';');
      },
    });

    if (predicted?.some(Boolean)) {
      columns.push(
        {
          name: getEatCompanionColumn(name, 'value'),
          cell: (row) => (predicted[row] ? getPredictedCellValues(predicted[row]!).join(';') : ''),
        },
        {
          name: getEatCompanionColumn(name, 'confidence'),
          cell: (row) => (predicted[row] ? formatFloat32(predicted[row]!.confidence) : ''),
        },
        {
          name: getEatCompanionColumn(name, 'source'),
          cell: (row) => predicted[row]?.source ?? '',
        },
      );
    }
  }

  const lines = [['protein_id', ...columns.map(({ name }) => name)]];
  for (const row of rows) {
    lines.push([data.protein_ids[row], ...columns.map(({ cell }) => cell(row))]);
  }
  return lines.map((fields) => fields.map(tsvField).join('\t')).join('\n') + '\n';
}

/**
 * Convenience function to create an exporter instance
 */
export function createExporter(
  element: ExportableElement,
  selectedProteins: string[] = [],
): ProtSpaceExporter {
  return new ProtSpaceExporter(element, selectedProteins);
}

/**
 * Quick export functions for common use cases
 */
export const exportUtils = {
  /**
   * Export protein IDs
   */
  exportProteinIds: (
    element: ExportableElement,
    selectedProteins?: string[],
    options?: ExportOptions,
  ) => {
    const exporter = createExporter(element, selectedProteins);
    exporter.exportProteinIds(options);
  },

  /**
   * Export as PNG
   */
  exportPNG: async (element: ExportableElement, options?: ExportOptions) => {
    const exporter = createExporter(element);
    return exporter.exportPNG(options);
  },

  /**
   * Export as PDF
   */
  exportPDF: async (element: ExportableElement, options?: ExportOptions) => {
    const exporter = createExporter(element);
    return exporter.exportPDF(options);
  },

  // SVG export removed per requirements
};

/**
 * Export an already-composited canvas as a single-page PDF whose page size
 * is exactly the chosen physical dimensions in mm. Drop into a Word/InDesign
 * placeholder at 100% and the figure lands at the journal's required width.
 */
export async function exportCanvasAsPdf(
  canvas: HTMLCanvasElement,
  opts: { widthMm: number; heightMm: number; filename?: string },
): Promise<void> {
  const { default: jsPDF } = await import('jspdf');
  const imgData = canvas.toDataURL('image/png', 1.0);
  const { widthMm, heightMm, filename } = opts;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdf: any = new (jsPDF as any)({
    orientation: widthMm > heightMm ? 'landscape' : 'portrait',
    unit: 'mm',
    format: [widthMm, heightMm],
  });
  pdf.setProperties({
    title: 'ProtSpace Figure',
    subject: 'ProtSpace export',
    author: 'ProtSpace',
    creator: 'ProtSpace',
  });
  pdf.addImage(imgData, 'PNG', 0, 0, widthMm, heightMm);
  pdf.save(filename || 'protspace_figure.pdf');
}
