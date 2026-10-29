import type {
  ExportEventDetail,
  ProtspaceEatPanel,
  ProtspaceExportMenu,
  ProtspaceLegend,
  ProtspaceScatterplot,
} from '@protspace/core';
import { EXPORT_DEFAULTS, pxToMm } from '@protspace/core';
import type { BundleSettings } from '@protspace/utils';
import {
  createExporter,
  exportCanvasAsPdf,
  exportParquetBundle,
  generateBundleFilename,
  pngWithDpi,
} from '@protspace/utils';
import type { notify as appNotify } from '../lib/notify';
import { getExportFailureNotification, getExportSuccessNotification } from './notifications';
import { loadPublishState, savePublishState } from './publish-state-store';

/** The menu sends every field; other dispatchers may send only the type, so the rest default. */
type ExportRequest = Pick<ExportEventDetail, 'type'> & Partial<Omit<ExportEventDetail, 'type'>>;

interface ExportHandlerOptions {
  /** The Export menu. Its events arrive through `listen`; the figure editor's host code reads it. */
  exportMenu: ProtspaceExportMenu;
  /** Adds a listener on the Export menu for as long as the runtime lives. */
  listen(type: string, listener: EventListener): void;
  getSelectedProteins(): string[];
  /** Proteins the loaded file holds that the dataset, and so a bundle export, leaves out. */
  getUnplacedProteinCount(): number;
  legendElement: ProtspaceLegend;
  /** The EAT panel, whose reliability filter (Hide) a bundle stores. */
  eatPanel: Pick<ProtspaceEatPanel, 'reliability' | 'outcome'>;
  plotElement: ProtspaceScatterplot;
  notify: Pick<typeof appNotify, 'success' | 'error'>;
}

function generateFilename(ext: string): string {
  const date = new Date().toISOString().split('T')[0];
  return `protspace_figure_${date}.${ext}`;
}

function downloadFile(url: string, filename: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
}

/**
 * The Export menu's two requests: the figure editor (lazy-loaded) and the quick exports. Every
 * export confirms with a toast naming its file (design decision 15), or says why it failed.
 */
export function createExportHandler(options: ExportHandlerOptions): void {
  const {
    listen,
    getSelectedProteins,
    getUnplacedProteinCount,
    legendElement,
    eatPanel,
    plotElement,
    notify,
  } = options;

  async function openPublishEditor(): Promise<void> {
    try {
      // Lazy-import the publish modal component (side-effect registers the custom element on
      // first open).
      const { ProtspacePublishModal } = await import('@protspace/core/publish');

      // Remove any existing modal
      document.querySelector('protspace-publish-modal')?.remove();

      // Construct via the registry, not `new ProtspacePublishModal()`. After Vite HMR
      // re-evaluates publish-modal.ts the class object on the import diverges from the one
      // registered for the tag, and `new` on the unregistered class throws "Illegal
      // constructor". createElement always uses the registered class.
      const modal = document.createElement('protspace-publish-modal') as InstanceType<
        typeof ProtspacePublishModal
      >;
      modal.plotElement = plotElement;
      modal.legendElement = legendElement;
      // Restore the last saved publish state (localStorage), else the modal's defaults.
      modal.savedPublishState = loadPublishState();
      // The editor compares it with the projection its overlays were placed on.
      const projection = plotElement.data?.projections[plotElement.selectedProjectionIndex];
      modal.currentProjection = projection
        ? { projection: projection.name, dimensionality: projection.dimension }
        : null;

      // Handle export from the figure editor
      modal.addEventListener('publish-export', (async (e: CustomEvent) => {
        const { canvas, state } = e.detail as {
          canvas: HTMLCanvasElement;
          state: Record<string, unknown> & { format: string; dpi: number };
        };

        savePublishState(state);

        try {
          const fname = generateFilename(state.format);
          if (state.format === 'pdf') {
            const widthMm = pxToMm(canvas.width, state.dpi);
            const heightMm = pxToMm(canvas.height, state.dpi);
            await exportCanvasAsPdf(canvas, { widthMm, heightMm, filename: fname });
          } else {
            const blob: Blob = await new Promise((resolve, reject) => {
              canvas.toBlob(
                (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob produced no blob'))),
                'image/png',
              );
            });
            const withDpi = await pngWithDpi(blob, state.dpi);
            const url = URL.createObjectURL(withDpi);
            try {
              downloadFile(url, fname);
            } finally {
              URL.revokeObjectURL(url);
            }
          }
          notify.success(getExportSuccessNotification(fname));
          modal.remove();
        } catch (err) {
          console.error('Publish export failed:', err);
          // A toast would sit under the modal dialog, hidden and inert: say it in the editor.
          const failure = getExportFailureNotification(err);
          modal.showExportError(
            failure.description ? `${failure.title} ${failure.description}` : failure.title,
          );
          // Leave the modal open so the user can retry without losing context.
        }
      }) as EventListener);

      // Handle close — persist state to localStorage
      modal.addEventListener('close', ((e: CustomEvent) => {
        if (e.detail?.state) {
          savePublishState(e.detail.state as Record<string, unknown>);
        }
        modal.remove();
      }) as EventListener);

      document.body.appendChild(modal);
    } catch (err) {
      console.error('Failed to open figure editor:', err);
      notify.error(getExportFailureNotification(err));
    }
  }

  async function quickExport(request: ExportRequest): Promise<void> {
    const {
      type,
      imageWidth,
      imageHeight,
      legendWidthPercent,
      legendFontSizePx,
      includeLegend,
      includeLegendSettings,
    } = request;

    try {
      if (type === 'parquet') {
        const currentData = plotElement.getCurrentData();
        if (!currentData) {
          throw new Error('No data available for export');
        }

        const includeSettings = !!includeLegendSettings;
        let settings: BundleSettings | undefined;
        if (includeSettings) {
          settings = {
            legendSettings: legendElement.getAllPersistedSettings(),
            exportOptions: {},
            publishState: loadPublishState() ?? undefined,
            eatOverlayEnabled: plotElement.eatOverlayEnabled,
            // The EAT panel owns the reliability range; a bundle stores both bounds and
            // whether the range hides or fades what it leaves out.
            eatConfidenceThreshold: eatPanel.reliability.min,
            eatConfidenceMax: eatPanel.reliability.max,
            eatOutcome: eatPanel.outcome,
            // Only a picked size: the live one may be seeded from the current annotation, and as
            // a top-level size it would override every other one.
            shapeSize: legendElement.pickedShapeSize,
          };
        }

        const filename = generateBundleFilename(includeSettings);
        // Subset exports carry no statistics by construction: sliceVisualizationDataByIndices
        // strips them, so whole-dataset scores can never describe an isolated/filtered slice.
        exportParquetBundle(currentData, filename, { includeSettings, settings });
        notify.success(getExportSuccessNotification(filename, getUnplacedProteinCount()));
        return;
      }

      const exporter = createExporter(plotElement);
      const shouldIncludeLegend = includeLegend ?? true;
      const totalWidth = imageWidth ?? EXPORT_DEFAULTS.IMAGE_WIDTH;
      const legendPercent = (legendWidthPercent ?? EXPORT_DEFAULTS.LEGEND_WIDTH_PERCENT) / 100;
      const targetWidth = shouldIncludeLegend
        ? Math.round(totalWidth * (1 - legendPercent))
        : totalWidth;
      const targetHeight = imageHeight ?? EXPORT_DEFAULTS.IMAGE_HEIGHT;

      const exportOptions = {
        targetWidth,
        targetHeight,
        legendWidthPercent: legendWidthPercent ?? EXPORT_DEFAULTS.LEGEND_WIDTH_PERCENT,
        legendScaleFactor:
          (legendFontSizePx ?? EXPORT_DEFAULTS.LEGEND_FONT_SIZE_PX) /
          EXPORT_DEFAULTS.BASE_FONT_SIZE,
        includeLegend: shouldIncludeLegend,
        includeSelection: getSelectedProteins().length > 0,
        backgroundColor: 'white' as const,
      };

      // PNG and PDF at 573K points take seconds: the toast waits for the file.
      const fileName =
        type === 'ids'
          ? exporter.exportProteinIds(exportOptions)
          : type === 'tsv'
            ? exporter.exportTable(exportOptions)
            : type === 'png'
              ? await exporter.exportPNG(exportOptions)
              : await exporter.exportPDF(exportOptions);
      if (fileName === null) {
        throw new Error('No data available for export');
      }
      notify.success(getExportSuccessNotification(fileName));
    } catch (error) {
      console.error('Export failed:', error);
      notify.error(getExportFailureNotification(error));
    }
  }

  listen('open-publish-editor', () => {
    void openPublishEditor();
  });
  listen('export', (event) => quickExport((event as CustomEvent<ExportRequest>).detail));
}
