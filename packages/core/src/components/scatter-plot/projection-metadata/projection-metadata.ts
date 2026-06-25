import { LitElement, html } from 'lit';
import { property } from 'lit/decorators.js';
import { customElement } from '../../../utils/safe-custom-element';
import type { Projection } from '@protspace/utils';
import { NA_DISPLAY } from '@protspace/utils';
import { projectionMetadataStyles } from './projection-metadata.styles';

@customElement('protspace-projection-metadata')
class ProtspaceProjectionMetadata extends LitElement {
  @property({ type: Object }) projection: Projection | null = null;

  static styles = projectionMetadataStyles;

  render() {
    const metadata = this._getProjectionMetadata();

    if (metadata.length === 0) {
      return html``;
    }

    return html`
      <button
        class="trigger"
        type="button"
        tabindex="0"
        aria-label="View projection metadata"
        aria-describedby="projection-metadata-content"
      >
        <svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3 3v18h18" />
          <path stroke-linecap="round" stroke-linejoin="round" d="M7 14v4" />
          <path stroke-linecap="round" stroke-linejoin="round" d="M11 10v8" />
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 6v12" />
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 8v10" />
        </svg>
      </button>

      <div class="content" id="projection-metadata-content" role="tooltip">
        <div class="header">Projection Metadata</div>
        <dl>
          ${metadata.map(
            ([key, value]) => html`
              <div class="item">
                <dt>${key}</dt>
                <dd>${value}</dd>
              </div>
            `,
          )}
        </dl>
      </div>
    `;
  }

  /**
   * Get formatted projection metadata for display
   */
  private _getProjectionMetadata(): Array<[string, string]> {
    if (!this.projection?.metadata) {
      return [];
    }

    const rawMetadata = this.projection.metadata;
    const processedEntries: Array<[string, unknown]> = [];

    // Filter and process metadata entries
    for (const [key, value] of Object.entries(rawMetadata)) {
      // Skip internal fields
      const lowerKey = key.toLowerCase();
      if (lowerKey === 'dimension' || lowerKey === 'dimensions' || lowerKey === 'name') {
        continue;
      }

      // Parse and flatten JSON fields
      if (this._isJsonField(lowerKey) && typeof value === 'string') {
        const parsed = this._tryParseJson(value);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          processedEntries.push(...Object.entries(parsed));
          continue;
        }
      }

      processedEntries.push([key, value]);
    }

    // Format all entries
    return processedEntries.map(([key, value]) => [
      this._formatMetadataKey(key),
      this._formatMetadataValue(value, key),
    ]);
  }

  /**
   * Check if a key indicates a JSON field
   */
  private _isJsonField(key: string): boolean {
    return key === 'info' || key === 'info_json' || key.includes('json');
  }

  /**
   * Safely parse JSON string
   */
  private _tryParseJson(value: string): unknown {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  /**
   * Format metadata key to Title Case
   */
  private _formatMetadataKey(key: string): string {
    return key
      .replace(/_/g, ' ')
      .replace(/([A-Z])/g, ' $1')
      .split(' ')
      .filter((word) => word.length > 0)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  /**
   * Format metadata value with appropriate precision
   */
  private _formatMetadataValue(value: unknown, key: string): string {
    if (value == null) return NA_DISPLAY;

    const lowerKey = key.toLowerCase();
    const isVarianceRatio =
      lowerKey.includes('explained_variance') || lowerKey.includes('variance_ratio');

    if (Array.isArray(value)) {
      return value.map((item) => this._formatSingleValue(item, isVarianceRatio)).join(', ');
    }

    return this._formatSingleValue(value, isVarianceRatio);
  }

  /**
   * Format a single metadata value
   */
  private _formatSingleValue(value: unknown, isVarianceRatio: boolean): string {
    if (typeof value === 'number') {
      if (Number.isInteger(value)) return value.toString();
      return value.toFixed(isVarianceRatio ? 2 : 3);
    }
    if (typeof value === 'boolean') {
      return value ? 'Yes' : 'No';
    }
    if (typeof value === 'object' && value !== null) {
      return JSON.stringify(value);
    }
    return String(value);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-projection-metadata': ProtspaceProjectionMetadata;
  }
}
