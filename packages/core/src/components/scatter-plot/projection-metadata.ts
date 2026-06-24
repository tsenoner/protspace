import { LitElement, html } from 'lit';
import { property } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import type { Projection } from '@protspace/utils';
import { projectionMetadataStyles } from './projection-metadata.styles';
import { buildProjectionMetadataRows } from './projection-metadata-helpers';

@customElement('protspace-projection-metadata')
class ProtspaceProjectionMetadata extends LitElement {
  @property({ type: Object }) projection: Projection | null = null;

  static styles = projectionMetadataStyles;

  render() {
    const metadata = buildProjectionMetadataRows(this.projection?.metadata);

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
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-projection-metadata': ProtspaceProjectionMetadata;
  }
}
