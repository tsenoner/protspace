import { html } from 'lit';
import {
  DEFAULT_CATEGORICAL_PALETTE_ID,
  DEFAULT_NUMERIC_PALETTE_ID,
  DEFAULT_NUMERIC_STRATEGY,
  normalizeNumericPaletteId,
  type PointShape,
} from '@protspace/utils';
import { LEGEND_DEFAULTS, LEGEND_EVENTS, LEGEND_VALUES } from '../config';
import type { ProtspaceLegend } from '../legend';
import { calculatePointSize, defaultShapeSize, getDefaultSortMode } from '../legend-helpers';
import { applyPaletteColors, normalizeCategoricalPaletteId } from '../legend-items-state';
import type { LegendDisplaySettings, PersistedCategoryData } from '../types';

/**
 * The legend's settings: the settings popover (open, close, render), each edit applied live,
 * Reset, and the colour and shape commits from the picker with their stored categories. A plain
 * class over its element: it reads and writes the legend's state directly (the members
 * `legend.ts` lists as read and written by its controllers).
 */
export class SettingsController {
  constructor(private readonly host: ProtspaceLegend) {}

  /** The header's settings button: opens the settings popover under it, or closes it. */
  toggle(anchor: HTMLElement): void {
    if (this.host._settingsAnchor) {
      this.close();
      return;
    }
    // One legend overlay at a time; a keyboard reorder in progress is dropped, as the dialog did.
    this.host._reorder.clear();
    this.host._colorPicker.close();
    this.host._rowMenu.close();
    this.host._sortMenu = null;
    this.host._otherPopover.close();
    this.host._settingsAnchor = anchor;
    this.host.dispatchEvent(
      new CustomEvent(LEGEND_EVENTS.CUSTOMIZE, { bubbles: true, composed: true }),
    );
  }

  close(): void {
    if (!this.host._settingsAnchor) return;
    // A value typed but not yet committed is kept, not lost with the popover.
    this.host._settingsPopover?.flush();
    this.host._settingsAnchor = null;
  }

  /**
   * Applies one edit from the settings popover at once (design decision 12), then runs the tail
   * the dialog's Save ran, once: the items, the plot and the stored record follow.
   */
  apply(patch: Partial<LegendDisplaySettings>): void {
    const annotation = this.host.selectedAnnotation;
    const current = this.host._numericSettingsByAnnotation[annotation];
    const numeric = this.host._isCurrentAnnotationNumeric()
      ? {
          binCount: current?.binCount ?? this.host.maxVisibleValues,
          strategy: current?.strategy ?? DEFAULT_NUMERIC_STRATEGY,
          paletteId: normalizeNumericPaletteId(current?.paletteId ?? DEFAULT_NUMERIC_PALETTE_ID),
          reverseGradient: current?.reverseGradient ?? false,
        }
      : null;

    if (patch.maxVisibleValues !== undefined) {
      this.host.maxVisibleValues = patch.maxVisibleValues;
      if (numeric) numeric.binCount = patch.maxVisibleValues;
    }
    if (patch.shapeSize !== undefined) {
      if (patch.shapeSize === null) {
        // An emptied size field returns the dataset to its default, as Reset does for the size.
        this.host._data.clearShapeSize();
      } else {
        const size = Math.min(patch.shapeSize, LEGEND_DEFAULTS.maxSymbolSize);
        if (size !== this.host.shapeSize) {
          this.host._persistenceController.saveShapeSize(size);
          this.host.shapeSize = size;
        }
      }
    }
    if (patch.paletteId !== undefined) {
      if (numeric) {
        numeric.paletteId = normalizeNumericPaletteId(patch.paletteId);
        this.host._selectedPaletteId = numeric.paletteId;
      } else {
        this.host._selectedPaletteId = normalizeCategoricalPaletteId(patch.paletteId);
        this.host._legendItems = applyPaletteColors(
          this.host._legendItems,
          this.host._selectedPaletteId,
        );
        // Ahead of the update below, which keeps stored colours over palette ones.
        this.syncColorsToPersistence();
      }
    }
    if (numeric && patch.numericStrategy !== undefined) numeric.strategy = patch.numericStrategy;
    if (numeric && patch.reverseGradient !== undefined) {
      numeric.reverseGradient = patch.reverseGradient;
    }
    if (patch.enableDuplicateStackUI !== undefined) {
      this.host._enableDuplicateStackUI = patch.enableDuplicateStackUI;
    }
    if (numeric) {
      this.host._numericSettingsByAnnotation = {
        ...this.host._numericSettingsByAnnotation,
        [annotation]: numeric,
      };
    }

    this.host._updateLegendItems();
    this.syncColorsToPersistence();
    this.host._scatterplotController.syncHiddenValues();
    this.host._scatterplotController.syncNumericAnnotationSettings();
    this.host._scatterplotController.updateConfig({
      pointSize: calculatePointSize(this.host.shapeSize),
      enableDuplicateStackUI: this.host._enableDuplicateStackUI,
    });
    this.host._persistenceController.saveSettings();
    this.host.requestUpdate();
  }

  /** Reset from the popover: today's scope, and the popover stays open on the defaults. */
  async resetKeepingOpen(): Promise<void> {
    this.reset();
    await this.host.updateComplete;
    const popover = this.host._settingsPopover;
    // Closed meanwhile, or removed with the legend: there is nothing to focus.
    if (!popover || this.host._settingsAnchor === null || !this.host.isConnected) return;
    await popover.updateComplete;
    // Reset disables itself once nothing is stored; focus moves to the palette, not the body.
    popover.focusFirst();
  }

  /** Something to reset: a record stored for the annotation, or a size picked for the dataset. */
  canReset(): boolean {
    return (
      this.host._persistenceController.hasPersistedSettings() ||
      this.host._persistenceController.loadShapeSize() !== null
    );
  }

  /**
   * The size the size field shows: the live one, capped at the field's bound, or null while it
   * is the dataset's default, which the empty field stands for (its placeholder names it).
   */
  private fieldShapeSize(): number | null {
    // The storage read last: this runs at every legend render, the popover closed or not.
    const isDefault =
      this.host._annotationShapeSize === null &&
      this.host.shapeSize === defaultShapeSize(this.host._datasetProteinCount) &&
      this.host._persistenceController.loadShapeSize() === null;
    return isDefault ? null : Math.min(this.host.shapeSize, LEGEND_DEFAULTS.maxSymbolSize);
  }

  /**
   * The popover's view of the live state; there is no draft. A fresh object at each render is
   * fine: the popover's `settings` compares field by field, so an unchanged one re-renders nothing.
   */
  private displaySettings(isNumeric: boolean): LegendDisplaySettings {
    const numeric = this.host._numericSettingsByAnnotation[this.host.selectedAnnotation];
    return {
      maxVisibleValues: this.host.maxVisibleValues,
      shapeSize: this.fieldShapeSize(),
      enableDuplicateStackUI: this.host._enableDuplicateStackUI,
      paletteId: isNumeric
        ? normalizeNumericPaletteId(numeric?.paletteId ?? DEFAULT_NUMERIC_PALETTE_ID)
        : normalizeCategoricalPaletteId(this.host._selectedPaletteId),
      numericStrategy: numeric?.strategy ?? DEFAULT_NUMERIC_STRATEGY,
      reverseGradient: numeric?.reverseGradient ?? false,
    };
  }

  /**
   * The settings popover, rendered once as the last child of `.legend-container` and never keyed:
   * it flushes a pending edit when removed, so a remount would send a stale `settings-change`.
   */
  render(label: string) {
    const open = this.host._settingsAnchor !== null;
    const isNumeric = this.host._isCurrentAnnotationNumeric();
    return html`<protspace-legend-settings-popover
      .anchor=${this.host._settingsAnchor}
      .open=${open}
      .settings=${this.displaySettings(isNumeric)}
      .numeric=${isNumeric}
      .defaultShapeSize=${defaultShapeSize(this.host._datasetProteinCount)}
      .logBinningAvailable=${this.host.annotationData.numericMetadata?.logSupported ?? true}
      .canReset=${open && this.canReset()}
      .annotationLabel=${label}
      @settings-change=${(event: CustomEvent<Partial<LegendDisplaySettings>>) =>
        this.apply(event.detail)}
      @settings-reset=${() => void this.resetKeepingOpen()}
      @ps-open=${() => this.host._settingsPopover?.focusFirst()}
      @ps-close=${() => {
        this.host._settingsAnchor = null;
      }}
    ></protspace-legend-settings-popover>`;
  }

  commitColor(value: string, newColor: string): void {
    // Update the color immediately
    this.host._legendItems = this.host._legendItems.map((item) =>
      item.value === value ? { ...item, color: newColor } : item,
    );

    // Sync to persistence
    this.syncColorsToPersistence();

    // Update scatterplot and save (color-only change, no z-order change)
    this.host._scatterplotController.dispatchColorMappingChange(true);
    this.host._persistenceController.saveSettings();
    this.host.requestUpdate();
  }

  /**
   * Shows a colour while it is dragged: the row repaints now, the plot when the edit commits. The
   * item is changed in place, as before the split, so a drag does not re-sort the list or
   * re-derive the score strips on every tick.
   */
  previewColor(value: string, color: string): void {
    const item = this.host._legendItems.find((i) => i.value === value);
    if (!item) return;
    item.color = color;
    this.host.requestUpdate();
  }

  commitShape(value: string, newShape: PointShape): void {
    // Update the shape immediately
    this.host._legendItems = this.host._legendItems.map((item) =>
      item.value === value ? { ...item, shape: newShape } : item,
    );

    // Sync to persistence
    this.syncColorsToPersistence();

    // Update scatterplot and save (shape change, no z-order change)
    this.host._scatterplotController.dispatchColorMappingChange(true);
    this.host._persistenceController.saveSettings();
    this.host.requestUpdate();
  }

  reset(): void {
    // Remove localStorage and clear pending categories
    this.host._persistenceController.removeSettings();
    this.host._persistenceController.clearPendingCategories();

    // Reset all settings to defaults. The shape size is the dataset's, so it is cleared for every
    // annotation rather than stored, and the default from the protein count applies again.
    this.host.maxVisibleValues = LEGEND_DEFAULTS.maxVisibleValues;
    this.host._data.clearShapeSize();
    const isNumericAnnotation = this.host._isCurrentAnnotationNumeric();

    this.host._selectedPaletteId = isNumericAnnotation
      ? DEFAULT_NUMERIC_PALETTE_ID
      : DEFAULT_CATEGORICAL_PALETTE_ID;
    if (isNumericAnnotation) {
      this.host._numericSettingsByAnnotation = {
        ...this.host._numericSettingsByAnnotation,
        [this.host.selectedAnnotation]: {
          binCount: LEGEND_DEFAULTS.maxVisibleValues,
          strategy: DEFAULT_NUMERIC_STRATEGY,
          paletteId: DEFAULT_NUMERIC_PALETTE_ID,
          reverseGradient: false,
        },
      };
      this.host._data.setNumericManualOrderIds(this.host.selectedAnnotation, undefined);
    }

    this.host._annotationSortModes = {
      ...this.host._annotationSortModes,
      [this.host.selectedAnnotation]: isNumericAnnotation
        ? 'alpha-asc'
        : getDefaultSortMode(this.host.selectedAnnotation),
    };

    this.host._hiddenValues = [];
    this.host._enableDuplicateStackUI = false;

    // Reset slot tracker so colors are reassigned from scratch
    this.host._processorContext.slotTracker.reset();

    // Clear legend items so processor creates fresh ones with default colors
    this.host._legendItems = [];

    this.host._scatterplotController.updateConfig({
      pointSize: calculatePointSize(this.host.shapeSize),
      enableDuplicateStackUI: this.host._enableDuplicateStackUI,
    });

    this.host._updateLegendItems();
    this.host._scatterplotController.syncNumericAnnotationSettings();
    this.host._scatterplotController.dispatchColorMappingChange();
    this.host.requestUpdate();
  }

  private syncColorsToPersistence(): void {
    const categories: Record<string, PersistedCategoryData> = {};
    const persistVisualEncodings = !this.host._isCurrentAnnotationNumeric();
    this.host._legendItems.forEach((item) => {
      if (item.value !== LEGEND_VALUES.OTHER) {
        categories[item.value] = {
          zOrder: item.zOrder,
          color: persistVisualEncodings ? item.color : '',
          shape: persistVisualEncodings ? item.shape : '',
        };
      }
    });
    this.host._persistenceController.setPendingCategories(categories);
  }
}
