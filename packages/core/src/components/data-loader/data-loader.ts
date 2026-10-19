import type { PropertyValues } from 'lit';
import { LitElement, html } from 'lit';
import { property, state } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import type { VisualizationData, BundleSettings } from '@protspace/utils';
import { dataLoaderStyles } from './data-loader.styles';
import { createDataErrorEventDetail, type DataErrorEventDetail } from './data-loader.events';
import { assertValidFileExtension, assertWithinFileSizeLimit } from './utils/validation';
import { decodeBundle } from './bundle-decoder';
import { decodePlainParquet } from './legacy';

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
  /**
   * Container format version of a loaded `.parquetbundle` (see `decodeParquetBundle`);
   * absent for plain parquet. Below 3 is a legacy bundle, readable until protspace 5.0.0.
   */
  bundleFormatVersion?: number;
  /**
   * Proteins the loaded bundle holds that no projection places, which `data` leaves out
   * (see `decodeParquetBundle`); absent for plain parquet.
   */
  unplacedProteinCount?: number;
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
    // Clear the selection: the input only fires `change` when the picked file
    // differs from the one it holds, so re-picking the same file would be a
    // silent no-op (and would leave the app on the previously loaded dataset).
    input.value = '';
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

      // 3) Parse parquet, 4) Convert
      const visualizationData = await decodePlainParquet(arrayBuffer, () => this.completeStep());
      this.completeStep();
      this.dispatchDataLoaded({ data: visualizationData, settings: null, source });
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
      // Plan initial steps: validate size, read ArrayBuffer
      this.beginProgress(2);

      // 1) Early size validation
      assertWithinFileSizeLimit(file.size);
      this.completeStep();

      // 2) Read the file into one ArrayBuffer
      const arrayBuffer = await file.arrayBuffer();
      this.completeStep();

      // 3) Decode+convert in worker (or main-thread fallback). Only a .parquetbundle
      // gets this far: assertValidFileExtension turned anything else away.
      this.addSteps(1);
      const decoded = await decodeBundle(arrayBuffer, () => file.arrayBuffer());
      this.completeStep();
      this.dispatchDataLoaded({
        data: decoded.data,
        settings: decoded.settings,
        source,
        file,
        bundleFormatVersion: decoded.formatVersion,
        unplacedProteinCount: decoded.unplacedProteinCount,
      });
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

  private dispatchDataLoaded(detail: DataLoadedEventDetail) {
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
