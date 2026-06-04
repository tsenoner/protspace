import type { PropertyValues } from 'lit';
import { LitElement, html } from 'lit';
import { property, state } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import { parquetReadObjects } from 'hyparquet';
import { isParquetBundle, type VisualizationData, type BundleSettings } from '@protspace/utils';
import { dataLoaderStyles } from './data-loader.styles';
import { createDataErrorEventDetail, type DataErrorEventDetail } from './data-loader.events';
import { readFileOptimized } from './utils/file-io';
import { extractRowsFromParquetBundle } from './utils/bundle';
import { convertParquetToVisualizationDataOptimized } from './utils/conversion';
import {
  assertValidFileExtension,
  assertWithinFileSizeLimit,
  assertValidParquetMagic,
  validateRowsBasic,
} from './utils/validation';

/** Whether data was loaded by user action or automatically (e.g. page reload) */
export type DataLoadSource = 'user' | 'auto';
export type DataLoaderFileLoadOptions = { source?: DataLoadSource };
export type DataLoaderFileLoadHandler = (
  file: File,
  options: DataLoaderFileLoadOptions | undefined,
  next: (file: File, options?: DataLoaderFileLoadOptions) => Promise<void>,
) => Promise<void>;

/**
 * Event detail for data-loaded event
 */
export interface DataLoadedEventDetail {
  data: VisualizationData;
  /** Settings loaded from bundle (null if not present or not a bundle) */
  settings: BundleSettings | null;
  source: DataLoadSource;
  /** Original file for file-based loads, used by app-level persistence flows */
  file?: File;
}

/**
 * Parquet Data Loader Web Component
 *
 * Loads protein data from Parquet (.parquet) format files and converts them
 * to the ProtSpace visualization data format. Categories from columns
 * become legend items with unique values as elements.
 */
@customElement('protspace-data-loader')
export class DataLoader extends LitElement {
  static styles = dataLoaderStyles;

  /** URL or File object for the Arrow data source */
  @property({ type: String })
  src = '';

  /** Auto-load when src is provided */
  @property({ type: Boolean, attribute: 'auto-load' })
  autoLoad = false;

  /** Accept drag and drop */
  @property({ type: Boolean, attribute: 'allow-drop' })
  allowDrop = true;

  /** Required column mappings for Arrow data */
  @property({ type: Object, attribute: 'column-mappings' })
  columnMappings: {
    proteinId?: string;
    projection_x?: string;
    projection_y?: string;
    projectionName?: string;
  } = {};

  @property({ attribute: false })
  loadFromFileHandler?: DataLoaderFileLoadHandler;

  private totalSteps = 0;
  private completedSteps = 0;

  @state()
  private error: string | null = null;

  connectedCallback() {
    super.connectedCallback();
    if (this.autoLoad && this.src) {
      this.loadFromUrl(this.src);
    }
  }

  updated(changedProperties: PropertyValues) {
    if (changedProperties.has('src') && this.src && this.autoLoad) {
      this.loadFromUrl(this.src);
    }
  }

  render() {
    return html`
      <input
        type="file"
        class="hidden-input"
        accept=".parquetbundle,.fasta,.fa,.fna"
        @change=${this.handleFileSelect}
        style="display:none"
      />
    `;
  }

  private handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      this.loadFromFile(file);
    }
  }

  /**
   * Load Parquet data from a URL
   */
  async loadFromUrl(url: string, options?: { source?: DataLoadSource }) {
    const source: DataLoadSource = options?.source ?? 'auto';
    this.setLoading(true);
    this.error = null;
    this.dispatchLoadingStart();

    try {
      // Steps: fetch -> read ArrayBuffer -> parse parquet -> convert to visualization
      this.beginProgress(4);

      // 1) Fetch
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
      }
      this.completeStep();

      // 2) Read ArrayBuffer
      const arrayBuffer = await response.arrayBuffer();
      this.completeStep();

      // 3) Parse parquet
      const table = await parquetReadObjects({ file: arrayBuffer });
      this.completeStep();

      // 4) Convert
      const visualizationData = await convertParquetToVisualizationDataOptimized(table);
      this.completeStep();
      this.dispatchDataLoaded(visualizationData, null, source);
    } catch (error) {
      const originalError = error instanceof Error ? error : new Error(String(error));
      this.error = originalError.message;
      this.dispatchError(this.error, originalError);
    } finally {
      this.setLoading(false);
    }
  }

  /**
   * Load Parquet data from a File object with performance optimizations
   */
  async loadFromFile(file: File, options?: DataLoaderFileLoadOptions) {
    if (this.loadFromFileHandler) {
      try {
        await this.loadFromFileHandler(file, options, this.loadFromFileDirect.bind(this));
      } catch (error) {
        const originalError = error instanceof Error ? error : new Error(String(error));
        this.error = originalError.message;
        this.dispatchError(this.error, originalError);
      }
      return;
    }

    return this.loadFromFileDirect(file, options);
  }

  private async loadFromFileDirect(file: File, options?: DataLoaderFileLoadOptions) {
    const source: DataLoadSource = options?.source ?? 'user';

    // Validate extension before any loading UI appears
    try {
      assertValidFileExtension(file.name);
    } catch (error) {
      const originalError = error instanceof Error ? error : new Error(String(error));
      this.error = originalError.message;
      this.dispatchError(this.error, originalError);
      return;
    }

    this.setLoading(true);
    this.error = null;
    this.dispatchLoadingStart();

    try {
      // Plan initial steps common to both branches: validate size, read ArrayBuffer
      this.beginProgress(2);

      // 1) Early size validation
      assertWithinFileSizeLimit(file.size);
      this.completeStep();

      // 2) Optimize ArrayBuffer reading for large files
      const arrayBuffer = await readFileOptimized(file);
      this.completeStep();

      // Branch-specific steps
      if (file.name.endsWith('.parquetbundle') || isParquetBundle(arrayBuffer)) {
        // For bundles: extract -> validate -> convert
        this.addSteps(3);
        const extraction = await extractRowsFromParquetBundle(arrayBuffer);
        this.completeStep();
        validateRowsBasic(extraction.projections);
        this.completeStep();
        const visualizationData = await convertParquetToVisualizationDataOptimized(extraction);
        this.completeStep();
        this.dispatchDataLoaded(visualizationData, extraction.settings, source, file);
      } else {
        // For regular parquet: validate magic -> parse -> validate rows -> convert
        this.addSteps(4);
        assertValidParquetMagic(arrayBuffer);
        this.completeStep();
        const table = await parquetReadObjects({ file: arrayBuffer });
        this.completeStep();
        validateRowsBasic(table);
        this.completeStep();
        const visualizationData = await convertParquetToVisualizationDataOptimized(table);
        this.completeStep();
        this.dispatchDataLoaded(visualizationData, null, source, file);
      }
    } catch (error) {
      const originalError = error instanceof Error ? error : new Error(String(error));
      this.error = originalError.message;
      this.dispatchError(this.error, originalError);
    } finally {
      this.setLoading(false);
    }
  }

  private setLoading(loading: boolean) {
    if (loading) {
      this.setAttribute('loading', '');
    } else {
      this.removeAttribute('loading');
    }
  }

  private beginProgress(totalSteps: number) {
    this.totalSteps = totalSteps;
    this.completedSteps = 0;
  }

  private addSteps(additionalSteps: number) {
    this.totalSteps += additionalSteps;
  }

  private completeStep() {
    this.completedSteps += 1;
    this.dispatchProgress();
  }

  private dispatchLoadingStart() {
    this.dispatchEvent(
      new CustomEvent('data-loading-start', {
        bubbles: true,
        composed: true,
      }),
    );
  }

  private dispatchProgress() {
    this.dispatchEvent(
      new CustomEvent('data-loading-progress', {
        detail: {
          current: this.completedSteps,
          total: this.totalSteps,
          percentage: Math.round((this.completedSteps / this.totalSteps) * 100),
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private dispatchDataLoaded(
    data: VisualizationData,
    settings: BundleSettings | null,
    source: DataLoadSource,
    file?: File,
  ) {
    const detail: DataLoadedEventDetail = { data, settings, source, file };
    this.dispatchEvent(
      new CustomEvent('data-loaded', {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private dispatchError(error: string, originalError?: Error) {
    const detail: DataErrorEventDetail = createDataErrorEventDetail(error, originalError);

    this.dispatchEvent(
      new CustomEvent<DataErrorEventDetail>('data-error', {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-data-loader': DataLoader;
  }
}
