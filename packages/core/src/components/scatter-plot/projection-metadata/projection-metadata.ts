import { LitElement, html, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';
import type { PropertyValues } from 'lit';
import { customElement } from '../../../utils/safe-custom-element';
import type {
  Annotation,
  AnnotationStatMetric,
  AnnotationStatSummary,
  ClusterAgreement,
  ClusterAgreementEntry,
  Projection,
  ProjectionStatisticRow,
} from '@protspace/utils';
import {
  NA_DISPLAY,
  annotationLabel,
  annotationStatSummary,
  autoClusterScoreCaveat,
  clusterAgreement,
  countNoun,
  formatCount,
  formatStatValue,
  hasAnnotationStats,
  isAutoClusterColumnName,
  metricDescription,
  metricDisplay,
} from '@protspace/utils';
import { projectionMetadataStyles } from './projection-metadata.styles';
import { modalCoverage, splitMetadata, type MetadataRow } from './projection-metadata-format';
import '../../common/info-popover';
import { icon } from '../../kit/icon';
import { pushLayer } from '../../kit/layers';

/**
 * The two agreement metrics, in the order the columns appear. Fixed rather than derived from the
 * rows: the header is rendered once, so the columns cannot be whatever the first annotation
 * happened to carry, and an annotation missing one shows N/A in that cell instead of shifting
 * every row after it.
 */
const RECOVERS_METRICS = ['adjusted_rand', 'normalized_mutual_info'] as const;

/**
 * Rows shown before the expander. A count cap, never a value cap: the chance band here is about
 * 0.011 and its spread varies ~45x within one block, so no score threshold is meaningful across
 * annotations — and a clustering that recovers nothing is itself the finding, which a value cut
 * would delete.
 */
const RECOVERS_COLLAPSED = 12;

/** What the Recovers block is, behind the heading's ⓘ. */
const RECOVERS_DESCRIPTION =
  'How closely this automatic clustering reproduces each annotation it was compared against, ' +
  'best match first. Unlike the separation scores above, these compare the clusters to ' +
  'something the clustering did not choose, so they are not optimistic. Read them together ' +
  "with each annotation's category count: ARI's achievable maximum drops as an annotation's " +
  'number of categories diverges from the number of clusters, so a low ARI beside a very ' +
  'different category count can still mean a clean correspondence — which is what NMI shows.';

/** Human-readable heading for a faithfulness scope group. */
const SCOPE_HEADINGS: Record<string, string> = {
  local: 'Local — are the same proteins still neighbours?',
  global: 'Global — is the overall layout preserved?',
};

/**
 * What the two value columns mean. Their headings are one word each ("Projection" /
 * "Embedding") because the longer forms sized the grid's auto tracks and squeezed the
 * metric-name column down to 36px — so the headings cannot themselves explain *why* there are
 * two numbers, that the second is the embedding reference, and what a gap between them means.
 * That explanation lives here, behind the section's ⓘ.
 *
 * It says "reference", not "ceiling": a projection can score higher than its embedding. The
 * example bundles show it (β-lactamase `signal_peptide` silhouette 0.20 in PCA against 0.07 in
 * the embedding), because flattening can pull an annotation's categories apart as well as merge
 * them.
 */
const SEPARATION_SCOPE_DESCRIPTION =
  'Two numbers per metric. "Projection" scores the layout you are looking at. "Embedding" ' +
  'scores the same annotation on the full high-dimensional embedding this projection was ' +
  'computed from, the reference to read the projection against. Usually the projection ' +
  'keeps less: a small gap means it kept what was there, a large one means it lost some. ' +
  'A projection can also score higher than its embedding, when flattening happens to pull ' +
  'the categories apart; that describes the layout, not the proteins.';

@customElement('protspace-projection-metadata')
export class ProtspaceProjectionMetadata extends LitElement {
  @property({ type: Object }) projection: Projection | null = null;
  /** Rows of the optional `statistics.parquet` part; absent unless prepared with `--stats`. */
  @property({ type: Array }) statisticsRows?: readonly ProjectionStatisticRow[];
  /** Annotation currently coloring the plot, which the quality section is scored on. */
  @property({ type: String, attribute: 'selected-annotation' }) selectedAnnotation = '';
  /**
   * Whether the plot is currently showing less than the whole dataset (a query filter or an
   * isolation). The scores never are — they are computed once by the backend over everything —
   * so this only changes how the scope line describes them, never the numbers.
   */
  @property({ type: Boolean }) viewIsSubset = false;
  /** The dataset's annotation definitions: runtime columns (EAT confidence) are named by them. */
  @property({ attribute: false })
  annotationDefinitions: Readonly<Record<string, Pick<Annotation, 'runtime'>>> = {};

  /** Whether the Recovers list is showing every annotation or just the best `RECOVERS_COLLAPSED`. */
  @state() private _recoversExpanded = false;

  /**
   * The protein count most Recovers rows share, so a row is only annotated with its own coverage
   * when it actually differs. Taken as the modal value rather than the maximum: the common case
   * is "every annotation covers the dataset except one", and calling that one out is the point.
   */
  private _recoversPopulation: number | null = null;

  /**
   * Click-pinned open, so the panel survives the pointer leaving it — the same affordance the
   * ⓘ popovers inside it already have. Hover alone made the panel unusable for its own content:
   * reading a metric's ⓘ, or selecting a number, means travelling outside the card.
   */
  @state() private _pinned = false;
  // While pinned the card is a layer (decision 11): Escape and a press outside close it before
  // the page's own Escape (the selection) hears the press.
  private _releaseLayer: (() => void) | null = null;

  static styles = projectionMetadataStyles;

  /** Smallest card worth showing before scrolling; below this a "scrollable" card is unusable. */
  private static readonly MIN_CARD_HEIGHT = 200;
  /** Breathing room kept between the bottom of the card and the viewport's edge. */
  private static readonly CARD_MARGIN = 8;

  updated(changed: PropertyValues) {
    // Only when the content that sets the natural height can actually have changed. This reads
    // the host's clientHeight and writes an inline maxHeight, so running it on every update
    // forces a synchronous layout — free today, a per-frame cost the moment anything on this
    // card gains hover state. `_pinned` counts: the card has no measurable box until it opens.
    if (
      changed.has('projection') ||
      changed.has('statisticsRows') ||
      changed.has('selectedAnnotation') ||
      changed.has('_pinned') ||
      changed.has('_recoversExpanded')
    ) {
      this._updateMaxHeight();
    }
  }

  /**
   * Caps the card at the room left below it in the viewport, and keeps it inside the viewport's
   * width. The card opens from the view bar, with the whole plot height free below it, so the
   * viewport is the bound; a measured cap still beats a CSS one because the card's top depends on
   * where the bar sits.
   */
  private _updateMaxHeight(): void {
    const content = this.shadowRoot?.querySelector('.content') as HTMLElement | null;
    if (!content) return;
    const { MIN_CARD_HEIGHT, CARD_MARGIN } = ProtspaceProjectionMetadata;
    const available = window.innerHeight - content.getBoundingClientRect().top - CARD_MARGIN;
    // max-height caps the content box: the card's borders come on top of it.
    const borders = content.offsetHeight - content.clientHeight;
    content.style.maxHeight = `${Math.max(MIN_CARD_HEIGHT, available - borders)}px`;
    this._keepInsideViewport(content);
  }

  /**
   * Slides the card left when it would cross the viewport's right edge (the button sits far right
   * on a phone's view bar), never past the left margin. Measured from the host, so the card's own
   * inline offset never feeds back into the next measurement.
   */
  private _keepInsideViewport(content: HTMLElement): void {
    const { CARD_MARGIN } = ProtspaceProjectionMetadata;
    const hostLeft = this.getBoundingClientRect().left;
    const overflow = hostLeft + content.offsetWidth - (window.innerWidth - CARD_MARGIN);
    if (overflow <= 0) {
      content.style.left = '';
      return;
    }
    content.style.left = `${Math.max(CARD_MARGIN, hostLeft - overflow) - hostLeft}px`;
  }

  private _onWindowResize = () => this._updateMaxHeight();

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('resize', this._onWindowResize);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('resize', this._onWindowResize);
    this._setPinned(false);
  }

  private _setPinned(pinned: boolean): void {
    if (this._pinned === pinned) return;
    this._pinned = pinned;
    if (pinned) {
      this._releaseLayer = pushLayer({ close: () => this._closeFromLayer(), elements: [this] });
    } else {
      this._releaseLayer?.();
      this._releaseLayer = null;
    }
  }

  /**
   * Escape or a press outside the card. Focus goes back to the trigger only when it was in the
   * card: a press outside leaves it on what the user pressed.
   */
  private _closeFromLayer(): void {
    const focusWasInside = this.shadowRoot?.activeElement != null;
    this._setPinned(false);
    if (focusWasInside) {
      (this.shadowRoot?.querySelector('.trigger') as HTMLElement | null)?.focus();
    }
  }

  render() {
    const { parameters, quality, qualityScope } = splitMetadata(this.projection?.metadata);
    // `stats`: validity scored for this exact projection, so it is scoped by the panel it sits
    // in. `agreement` (below) is deliberately not scoped that way: ARI/NMI describe the
    // clustering itself, not whichever projection the panel happens to be open on, and the
    // stats header already names the clustering via the selected `cluster_*` column. Filtering
    // it to `this.projection` would leave a user who just selected, say, `cluster_elbow_ProtT5
    // — PCA 2` while viewing `ProtT5 — UMAP 2` staring at nothing instead of PCA 2's numbers.
    const stats = annotationStatSummary(
      this.statisticsRows,
      this.selectedAnnotation,
      this.projection?.name ?? '',
    );
    // Non-empty only when the selected annotation is itself a `cluster_elbow_*` /
    // `cluster_silhouette_*` column. That column now also carries its own validity scores,
    // so the two blocks below routinely render together for a clustering: "how separated is
    // it" (optimistic, it drew its own boundaries) above "what does it recover" (independent).
    const agreement = clusterAgreement(this.statisticsRows, this.selectedAnnotation);
    // Asked once. Three separate calls could drift apart under a later edit, which is the
    // very drift the shared predicate exists to prevent.
    const showStats = hasAnnotationStats(stats, agreement);

    // The stats block counts toward "is there anything to show". A projection whose
    // `info_json` is empty or absent yields no parameters AND no quality rows, so gating on
    // those alone hid a fully populated statistics section — while the color-by dropdown still
    // badged the annotation with "select this annotation and open the projection metadata
    // panel". Both sides ask `hasAnnotationStats`, so both must agree on whether it renders.
    if (parameters.length === 0 && quality.length === 0 && !showStats) {
      return html``;
    }

    return html`
      <button
        class="trigger"
        type="button"
        tabindex="0"
        aria-label="View projection metadata"
        aria-expanded=${this._pinned}
        aria-describedby="projection-metadata-content"
        @click=${() => this._setPinned(!this._pinned)}
      >
        ${icon('info', 16)}
      </button>

      <div
        class="content ${this._pinned ? 'is-pinned' : ''}"
        id="projection-metadata-content"
        role="tooltip"
      >
        <!-- The projection's own name, which the panel never showed: splitMetadata skips
             the "name" key, so a card describing one projection out of several did not say
             which. It also replaces the second header bar the stats block used to print
             (the annotation name), which duplicated the legend panel's own title and made
             that block read as a stray card. -->
        <div class="header">${this.projection?.name || 'Projection metadata'}</div>
        <!-- Ordered by what the reader came for, now that the card scrolls. Separation is
             what the color-by dropdown's STATS badge points at and the only block that
             changes when you recolour, so it must not open below the fold; the reduction
             parameters never change and are the reference material, so they go last. -->
        ${showStats ? this._renderAnnotationStats(stats, agreement) : nothing}
        ${this._renderSection('Faithfulness to the embedding', 'quality', quality, qualityScope)}
        ${this._renderSection('How it was made', 'parameters', parameters)}
        <!-- Card-level, because it governs both score blocks equally: separation and
             faithfulness are both computed once at prepare time and neither recomputes when
             the view narrows. Stating it inside one section implied it applied only there. -->
        ${quality.length > 0 || showStats
          ? html`<div class="card-scope">
              ${this.viewIsSubset
                ? 'All scores are for the full dataset, not this view.'
                : 'All scores are for the full dataset.'}
            </div>`
          : nothing}
      </div>
    `;
  }

  /**
   * One labelled block. Absent rather than empty when the projection carries no such data.
   *
   * A row carrying a `description` gets the same ⓘ as the separation metrics below it. The
   * faithfulness names ("Random Triplet", "Spearman Distance") say least to a biologist of
   * anything in this panel, so leaving them bare made the one section that most needed
   * explaining the only one without it.
   */
  private _renderSection(title: string, id: string, rows: MetadataRow[], scopeLine = '') {
    if (rows.length === 0) return nothing;
    let renderedScope: string | null | undefined;
    return html`
      <div class="section-heading">${title}</div>
      <dl data-section="${id}">
        ${scopeLine ? html`<div class="section-scope">${scopeLine}</div>` : nothing}
        ${rows.map((row) => {
          // A heading once per scope run rather than "(local)" on every label. The backend
          // emits the metrics grouped, so a change of scope is a change of group.
          const heading =
            row.scope && row.scope !== renderedScope ? SCOPE_HEADINGS[row.scope] : null;
          renderedScope = row.scope;
          return html`
            ${heading ? html`<div class="scope-heading">${heading}</div>` : nothing}
            <div class="item">
              <dt>
                <span class="item-label">${row.label}</span>
                ${row.description
                  ? html`<protspace-info-popover
                      placement="side"
                      .description=${row.description}
                      label=${row.label}
                    ></protspace-info-popover>`
                  : nothing}
              </dt>
              <dd>${row.value}</dd>
            </div>
          `;
        })}
      </dl>
    `;
  }

  /**
   * How well the selected annotation separates in this projection (`summary`), and/or how well
   * the selected auto-clustering recovers every annotation it was compared against
   * (`agreement`). For a `cluster_*` column both carry content: the clustering is scored on its
   * own labels *and* compared against every annotation. For an ordinary annotation `agreement`
   * is empty. Each is rendered independently rather than assumed exclusive, which is also what
   * keeps a bundle written before clusterings were self-scored (agreement only) rendering.
   */
  private _renderAnnotationStats(
    summary: AnnotationStatSummary | null,
    agreement: ClusterAgreement,
  ) {
    const scope = summary ? this._statScopeLine(summary) : '';
    // A bundle prepared without an embedding pass has every embedding value null: naming a column
    // of entirely blank cells would only take width back from the label column for nothing.
    const hasEmbeddingReference = summary?.validity.some((metric) => metric.embedding !== null);
    const clusterCaveat = autoClusterScoreCaveat(this.statisticsRows, this.selectedAnnotation);
    return html`
      <div class="annotation-stats">
        ${summary && summary.validity.length > 0
          ? html`
              <!-- The annotation is a chip inside the heading, not a header bar of its own.
                   It is an INPUT to this section (same report, recoloured), not a change of
                   subject, and a second bar printing the annotation name simply repeated the
                   legend panel's title one column over. -->
              <div class="stat-heading">
                <span
                  >Separation, scored on
                  <span class="stat-annotation-chip"
                    >${annotationLabel(
                      this.selectedAnnotation,
                      this.annotationDefinitions[this.selectedAnnotation],
                    )}</span
                  ></span
                >
                <protspace-info-popover
                  placement="side"
                  label="separation scores"
                  .description=${SEPARATION_SCOPE_DESCRIPTION}
                ></protspace-info-popover>
              </div>
              ${hasEmbeddingReference
                ? html`
                    <!-- One word each. These sit in the grid's two auto-sized columns, which
                         size to max-content, so the longer headings "This projection" and
                         "Source embedding" set those widths from the widest HEADING rather
                         than the widest number. Measured: that left the metric-name column
                         36px and pushed its info icon out over the values. The heading's own
                         info icon carries the full explanation instead. -->
                    <div class="stat-columns">
                      <span></span>
                      <span>Projection</span>
                      <span>Embedding</span>
                    </div>
                  `
                : ''}
              ${summary.validity.map((metric) => this._renderStatMetric(metric))}
              ${scope ? html`<div class="stat-caveat">${scope}</div>` : ''}
              <!-- Directly under Separation, which is what it caveats: the clustering drew the
                   boundaries these silhouette/DBI/CH numbers score, so they read high by
                   construction. It sat below "Recovers" before, which reads as if it qualifies
                   the ARI/NMI rows — and those are the honest half, measured against
                   annotations the clustering did not choose. -->
              ${clusterCaveat ? html`<div class="stat-caveat">${clusterCaveat}</div>` : nothing}
            `
          : ''}
        ${agreement.entries.length > 0 ? this._renderRecovers(agreement) : ''}
      </div>
    `;
  }

  /**
   * How well the selected clustering recovers each annotation: one ROW per annotation, with the
   * metric names in a single header instead of on every line.
   *
   * The old shape was metric-major — a heading per annotation, then an ARI line and an NMI line,
   * each repeating the metric name, its direction arrow and its own ⓘ. Ten annotations cost 30
   * lines and 20 focusable icons to convey ten names and twenty numbers, and `auto` selection can
   * pick far more than ten. Transposed, ten annotations are ten lines and two icons.
   *
   * Sorted best-first, because the question this answers is "which known biology do these
   * clusters correspond to?" — a ranking, not a lookup.
   *
   * Both metrics stay. ARI is chance-corrected and NMI is not, but the difference that matters
   * here is that ARI's achievable maximum falls as the annotation's cardinality diverges from K:
   * a clustering that is perfectly pure with respect to a 2-category annotation at K=50 scores
   * ARI 0.04 and NMI 0.30. Showing ARI alone would print 0.04 for a perfect result, so the
   * category count sits beside each name to make both numbers readable.
   */
  private _renderRecovers(agreement: ClusterAgreement) {
    const { clusters, entries } = agreement;
    this._recoversPopulation = modalCoverage(entries);
    const shown = this._recoversExpanded ? entries : entries.slice(0, RECOVERS_COLLAPSED);
    const hidden = entries.length - shown.length;
    const nextBest = hidden > 0 ? entries[shown.length]!.metrics[0] : undefined;

    return html`
      <div class="stat-heading">
        <span>Recovers</span>
        <protspace-info-popover
          placement="side"
          label="cluster agreement"
          .description=${RECOVERS_DESCRIPTION}
        ></protspace-info-popover>
      </div>
      <!-- K goes in the header's otherwise-empty first cell, so it is stated once and every row
           below reads as a sentence: "6 clusters vs Family (42 categories): ARI 0.21, NMI 0.42."
           Without K the ARI column has no denominator. -->
      <div class="stat-columns">
        <span>${clusters === null ? 'Clusters vs' : `${clusters} clusters vs`}</span>
        ${RECOVERS_METRICS.map((metric) => {
          const { label, higherIsBetter, description } = metricDisplay(metric);
          return html`<span class="recovers-metric-head"
            >${label}${higherIsBetter ? ' ↑' : ' ↓'}
            <protspace-info-popover
              placement="side"
              label=${label}
              .description=${description}
            ></protspace-info-popover
          ></span>`;
        })}
      </div>
      ${shown.map((entry) => this._renderRecoversRow(entry))}
      ${hidden > 0
        ? html`<button
            class="recovers-more"
            type="button"
            aria-expanded=${this._recoversExpanded}
            @click=${() => {
              this._recoversExpanded = true;
            }}
          >
            Show ${hidden} more${nextBest ? ` (best ${formatStatValue(nextBest.value)})` : ''}
          </button>`
        : nothing}
    `;
  }

  /** One annotation's row: name and category count, then one cell per metric. */
  private _renderRecoversRow(entry: ClusterAgreementEntry) {
    const valueOf = (metric: string) => entry.metrics.find((m) => m.metric === metric);
    return html`
      <div class="stat-metric">
        <span class="stat-metric-label">
          <span class="stat-metric-name"
            >${annotationLabel(
              entry.annotation,
              this.annotationDefinitions[entry.annotation],
            )}${entry.categories === null
              ? nothing
              : html`<span class="recovers-meta"> · ${entry.categories} cat</span>`}</span
          >
        </span>
        ${RECOVERS_METRICS.map((metric) => {
          const found = valueOf(metric);
          return html`<span class="stat-metric-value"
            >${found ? formatStatValue(found.value) : NA_DISPLAY}</span
          >`;
        })}
        <!-- Only when it differs from the block's own population. An annotation that labels a
             fraction of the dataset is scored on that fraction, and a high number on thin
             coverage reads identically to a high number on all of it. -->
        ${entry.scored !== null && entry.scored !== this._recoversPopulation
          ? html`<span class="recovers-coverage"
              >${formatCount(entry.scored)} of
              ${this._recoversPopulation === null
                ? 'the dataset'
                : formatCount(this._recoversPopulation)}
              scored</span
            >`
          : nothing}
      </div>
    `;
  }

  /**
   * One metric row: name (with an arrow for the direction that counts as better), its value in
   * this projection, and (for annotation-validity metrics) the same metric in the source
   * embedding, the reference the projection's separation is read against.
   */
  private _renderStatMetric(metric: AnnotationStatMetric) {
    // Marked on every metric, not only on the one that inverts: an arrow that shows up on
    // Davies-Bouldin alone reads as a warning about that row rather than as a direction.
    const better = metric.higherIsBetter ? 'Higher' : 'Lower';
    const description = metricDescription(metric.metric);
    return html`
      <div class="stat-metric">
        <span class="stat-metric-label">
          <span class="stat-metric-name"
            >${metric.label}<span
              class="stat-direction"
              aria-hidden="true"
              title="${better} is better"
              >${metric.higherIsBetter ? '↑' : '↓'}</span
            ><span class="sr-only"> (${better.toLowerCase()} is better)</span></span
          >
          <!-- info-popover already renders nothing without a description; the guard here
               still avoids constructing an element per metric row that would render nothing
               anyway (every non-empty metric list runs through this once per row). -->
          ${description
            ? html`<protspace-info-popover
                placement="side"
                .description=${description}
                label=${metric.label}
              ></protspace-info-popover>`
            : nothing}
        </span>
        <span class="stat-metric-value">${formatStatValue(metric.value)}</span>
        <!-- The cell stays even when empty: \`.stat-metric\` is \`display: contents\`, so dropping
             it would shift every following row one column across the shared grid. -->
        <span class="stat-metric-embedding">
          ${metric.embedding === null
            ? ''
            : html`<span class="sr-only">in embedding </span>${formatStatValue(metric.embedding)}`}
        </span>
      </div>
    `;
  }

  /**
   * What the scores cover: "5 categories · 1,427 proteins scored", dropping whichever count the
   * bundle left out. An annotation rarely labels every protein, so the second number is also the
   * closest thing the bundle has to per-category coverage.
   */
  private _statScopeLine(summary: AnnotationStatSummary): string {
    const parts: string[] = [];
    const { categories, scored } = summary;
    if (categories !== null) {
      // For a cluster_* column the "categories" being scored ARE the clusters, so this count is
      // K. Saying "categories" there hid that, and left K unstated in the one section whose
      // numbers are about the clusters themselves.
      const isClustering = isAutoClusterColumnName(this.selectedAnnotation);
      parts.push(
        isClustering
          ? countNoun(categories, 'cluster', 'clusters')
          : countNoun(categories, 'category', 'categories'),
      );
    }
    if (scored !== null) {
      parts.push(`${countNoun(scored, 'protein', 'proteins')} scored`);
    }
    // Deliberately NOT "full dataset" here. That is true of the faithfulness numbers too —
    // both blocks are computed once at prepare time and neither recomputes on a filter — so
    // stating it per section would repeat it. It is a card-level footer instead.
    return parts.join(' · ');
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-projection-metadata': ProtspaceProjectionMetadata;
  }
}
