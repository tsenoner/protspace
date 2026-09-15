import { LitElement, html, css, svg, nothing } from 'lit';
import { property } from 'lit/decorators.js';
import { formatStatValue } from '@protspace/utils';
import { customElement } from '../../utils/safe-custom-element';
import { srOnlyMixin } from '../../styles/mixins';
import '../common/info-popover';

/** One category's position on a score axis, painted in its legend colour. */
export interface ScoreStripPoint {
  category: string;
  value: number;
  color: string;
  /** The same metric on the source embedding, this category's ceiling, shown in the tooltip. */
  ceiling?: number | null;
}

const STRIP_HEIGHT = 44;
const AXIS_Y = 22;
const DOT_RADIUS = 5;
/**
 * Percent inset at either end of the axis, so the extreme dots sit inside the strip
 * rather than on its edge. A percentage of the rendered width, not pixels: the axis is
 * fluid while the height is fixed, so this does not track `DOT_RADIUS`. Dots never clip
 * regardless, because the svg is `overflow: visible`.
 */
const PADDING = 10;
/** Shown in the value gutter while nothing is hovered. */
const NO_VALUE = '—';

/**
 * One metric's distribution across an annotation's categories: a dot per category on a
 * shared axis, coloured to match its legend row.
 *
 * A dot strip rather than a binned histogram. At the cardinalities this tool sees (most
 * datasets under 30 categories) a histogram is a handful of bars of height 0 to 5, and one
 * bar maps to several legend rows, so hovering cannot say which of them is which. One dot
 * per category gives a 1:1 mapping and needs no binning; past roughly 100 categories the
 * dots overlap into a density smear, which is the histogram's behaviour recovered anyway.
 *
 * Stateless: props in, `strip-hover` out. The legend owns the highlight.
 */
@customElement('protspace-score-strip')
class ProtspaceScoreStrip extends LitElement {
  @property({ type: Array }) points: ScoreStripPoint[] = [];
  /** Category to emphasise, driven by the legend's hover state. */
  @property({ type: String }) highlighted: string | null = null;
  @property({ type: String }) label = '';
  /**
   * Explanation behind the header's ⓘ, from the shared metric registry. Empty renders no icon.
   * The strips are where these numbers are actually read — a user scanning the legend may never
   * open the projection-metadata panel, which explains the very same metrics.
   */
  @property({ type: String }) description = '';
  /**
   * Axis bounds. Fixed at [-1, 1] for silhouette so every dataset's strip is directly
   * comparable; derived from the data for unbounded metrics such as Davies-Bouldin.
   */
  @property({ type: Array }) domain: [number, number] = [-1, 1];
  @property({ type: Boolean, attribute: 'higher-is-better' }) higherIsBetter = true;

  static styles = [
    srOnlyMixin,
    css`
      :host {
        display: block;
      }

      .strip-header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        font-size: var(--text-sm);
        color: var(--legend-text-secondary);
        padding: 0 0.25rem;
      }

      .strip-label {
        font-weight: 600;
        color: var(--legend-text-color);
        /* Keeps the ⓘ on the label's baseline rather than letting the 18px button
           stretch the header row. */
        display: inline-flex;
        align-items: center;
        gap: 0.15rem;
      }

      /* Centring lands the readout on the axis line: the svg's layout box is
       STRIP_HEIGHT tall and the axis sits at its midpoint. */
      .strip-body {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      svg {
        display: block;
        width: 100%;
        overflow: visible;
        /* Without a zero min-width the intrinsic svg width would keep the flex item
         from shrinking, and the gutter would push the axis out of the panel. */
        flex: 1;
        min-width: 0;
      }

      /* Fixed width and tabular figures: the gutter must not resize as the hover
       moves between categories, or every dot would shift with it. */
      .strip-value {
        flex: none;
        min-width: 3rem;
        text-align: right;
        font-size: var(--text-sm);
        font-variant-numeric: tabular-nums;
        color: var(--legend-text-color);
      }

      .strip-value.is-empty {
        color: var(--legend-text-secondary);
      }

      .axis {
        stroke: var(--legend-border);
        stroke-width: 1;
      }

      circle {
        stroke: var(--legend-bg);
        stroke-width: 1;
        cursor: pointer;
      }

      circle.is-highlighted {
        stroke: var(--legend-text-color);
        stroke-width: 2;
      }

      .bound {
        font-size: var(--text-caption);
        fill: var(--legend-text-secondary);
      }
    `,
  ];

  render() {
    if (this.points.length === 0) return nothing;

    const [min, max] = this.domain;
    // A degenerate domain (every category identical) would divide by zero; centre instead.
    const span = max - min;
    // Percent of the SVG's own (fluid) width, not a viewBox coordinate: the strip has no
    // viewBox, so an explicit `height` attribute alone fixes its height regardless of the
    // panel width, and `%` keeps this positioning in step with that width unscaled.
    const position = (value: number): number =>
      span === 0 ? 50 : PADDING + ((value - min) / span) * (100 - PADDING * 2);

    // The hovered category's own number, read straight off the points this strip
    // already holds — no extra property to keep in step with `highlighted`. A
    // category hovered in the legend that this metric could not score (a singleton
    // has no Davies-Bouldin) simply has no point here, and the gutter stays empty,
    // which is the honest reading rather than a gap to paper over.
    const hovered = this.points.find((point) => point.category === this.highlighted);

    return html`
      <div class="strip-header">
        <span class="strip-label"
          >${this.label}${this.description
            ? html`<protspace-info-popover
                .description=${this.description}
                label=${this.label}
              ></protspace-info-popover>`
            : nothing}</span
        >
        <span>${this.higherIsBetter ? 'higher is better' : 'lower is better'}</span>
      </div>
      <div class="strip-body">
        <svg height="${STRIP_HEIGHT}" role="img" aria-label="${this.label} per category">
          <line
            class="axis"
            x1="${PADDING}%"
            y1="${AXIS_Y}"
            x2="${100 - PADDING}%"
            y2="${AXIS_Y}"
          />
          ${this.points.map(
            (point) =>
              svg`<circle
            class="${point.category === this.highlighted ? 'is-highlighted' : ''}"
            data-category="${point.category}"
            cx="${position(point.value)}%"
            cy="${AXIS_Y}"
            r="${DOT_RADIUS}"
            fill="${point.color}"
            @mouseenter=${() => this._emitHover(point.category)}
            @mouseleave=${() => this._emitHover(null)}
            @click=${() => this._emitClick(point.category)}
          ><title>${point.category}: ${formatStatValue(point.value)}${
            point.ceiling == null ? '' : ` (embedding ceiling ${formatStatValue(point.ceiling)})`
          }</title></circle>`,
          )}
          <text class="bound" x="${PADDING}%" y="${STRIP_HEIGHT - 4}" text-anchor="start">
            ${this._formatBound(min)}
          </text>
          <text class="bound" x="${100 - PADDING}%" y="${STRIP_HEIGHT - 4}" text-anchor="end">
            ${this._formatBound(max)}
          </text>
        </svg>
        <!-- aria-hidden: the gutter is a pointer-driven readout, so it is never populated for
             a keyboard or screen-reader user, and announcing an em dash on every render is
             noise. The values themselves are reachable through the list below instead. -->
        <span class="strip-value ${hovered ? '' : 'is-empty'}" aria-hidden="true"
          >${hovered ? formatStatValue(hovered.value) : NO_VALUE}</span
        >
      </div>
      <!-- The strip's only accessible surface. The dots carry their values in <title>, but the
           <svg> is role="img" with an aria-label, which replaces its whole subtree in the
           accessibility tree, and the legend rows deliberately do not repeat the number (see
           legend.score-sync.test.ts, "keeps a scored row down to its label and count"). Without
           this list the per-category scores — the entire point of the strip — are unreachable
           to assistive tech. -->
      <ul class="sr-only">
        ${this.points.map(
          (point) => html`<li>${point.category}: ${formatStatValue(point.value)}</li>`,
        )}
      </ul>
    `;
  }

  /** Bounds are axis furniture, so they stay short: two decimals, no trailing noise. */
  private _formatBound(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }

  private _emitHover(category: string | null): void {
    this.dispatchEvent(
      new CustomEvent<{ category: string | null }>('strip-hover', {
        detail: { category },
        bubbles: true,
      }),
    );
  }

  private _emitClick(category: string): void {
    this.dispatchEvent(
      new CustomEvent<{ category: string }>('strip-click', {
        detail: { category },
        bubbles: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-score-strip': ProtspaceScoreStrip;
  }
}
