import { LitElement, html, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';
import type { PropertyValues } from 'lit';
import { customElement } from '../../../utils/safe-custom-element';
import type {
  AnnotationStatMetric,
  AnnotationStatSummary,
  ClusterAgreement,
  ClusterAgreementEntry,
  Projection,
  ProjectionStatisticRow,
} from '@protspace/utils';
import {
  AUTO_CLUSTER_SCORE_CAVEAT,
  NA_DISPLAY,
  annotationLabel,
  annotationStatSummary,
  clusterAgreement,
  formatStatValue,
  hasAnnotationStats,
  isAutoClusterColumn,
  isAutoClusterColumnName,
  metricDescription,
  metricDisplay,
} from '@protspace/utils';
import { projectionMetadataStyles } from './projection-metadata.styles';
import '../../common/info-popover';

/** One rendered `<dt>/<dd>` pair. An empty `description` renders no ⓘ. */
interface MetadataRow {
  label: string;
  value: string;
  description: string;
  /** Faithfulness scope ("local" / "global"), rendered as a group heading. Null groups first. */
  scope?: string | null;
}

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
 * two numbers, that the second is a ceiling, and that the gap between them is the cost of
 * flattening to 2D. That explanation lives here, behind the section's ⓘ.
 */
const SEPARATION_SCOPE_DESCRIPTION =
  'Two numbers per metric. "Projection" scores the layout you are looking at. "Embedding" ' +
  'scores the same annotation on the full high-dimensional embedding this projection was ' +
  'computed from — flattening it to 2D can only lose structure, never add it, so that column ' +
  'is the best any projection of this data could achieve. A small gap means the projection ' +
  'kept what was there; a large one means it lost it.';

/** A faithfulness metric before display: the raw key is kept so it can be looked up. */
interface QualityEntry {
  metric: string;
  scope: string | null;
  value: unknown;
  /** Proteins the comparison ran over. Shared by every faithfulness metric in a projection. */
  sampleSize: number | null;
  /** Whether that was a subsample rather than everything — a real caveat, previously hidden. */
  sampled: boolean;
}

/**
 * The coverage most annotations in a block share. Modal, not maximal: the interesting case is the
 * one annotation that covers far fewer proteins than the rest, and comparing against the majority
 * is what makes it stand out. Null when nothing carries coverage.
 */
function modalCoverage(entries: readonly ClusterAgreementEntry[]): number | null {
  const counts = new Map<number, number>();
  for (const entry of entries) {
    if (entry.scored === null) continue;
    counts.set(entry.scored, (counts.get(entry.scored) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

@customElement('protspace-projection-metadata')
class ProtspaceProjectionMetadata extends LitElement {
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

  static styles = projectionMetadataStyles;

  /** Smallest card worth showing before scrolling; below this a "scrollable" card is unusable. */
  private static readonly MIN_CARD_HEIGHT = 200;
  /** Breathing room kept between the bottom of the card and the plot's edge. */
  private static readonly CARD_MARGIN = 8;

  /**
   * Created lazily and guarded: `ResizeObserver` is absent in jsdom and under SSR, and as a
   * field initializer its constructor ran before the element could render at all. The measured
   * cap still applies without it; only tracking a later resize is lost.
   */
  private _resize: ResizeObserver | null = null;

  firstUpdated() {
    // No measurement here: Lit runs `updated()` immediately after this in the same pass, and
    // it already writes the cap.
    // The plot host resizes with the window and with the side panels opening/closing.
    if (typeof ResizeObserver === 'undefined' || !this.offsetParent) return;
    this._resize = new ResizeObserver(() => this._updateMaxHeight());
    this._resize.observe(this.offsetParent);
  }

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
   * Cap the card at the space actually left inside the scatter-plot, which clips its overflow.
   *
   * Measured rather than expressed in CSS. The constraint is the plot host's height, and this
   * card cannot reach it: percentages resolve against its own `:host`, which is only as tall as
   * the 32px trigger. Viewport units miss by however far down the page the plot begins —
   * measured at 209px, i.e. a 974px cap where only 827px fits. `container-type: size` on the
   * host would express it exactly but also makes the host the containing block for
   * `position: fixed` descendants, which would strand the side-placed ⓘ popovers.
   */
  private _updateMaxHeight(): void {
    const host = this.offsetParent as HTMLElement | null;
    const content = this.shadowRoot?.querySelector('.content') as HTMLElement | null;
    if (!host || !content) return;
    const { MIN_CARD_HEIGHT, CARD_MARGIN } = ProtspaceProjectionMetadata;
    // Measured, not reconstructed from the trigger's box plus a copy of the stylesheet's gap:
    // that copy had to be kept in step with `--card-gap` by hand, and a drift between them
    // would silently mis-size the cap.
    const cardTop = content.getBoundingClientRect().top - host.getBoundingClientRect().top;
    const available = host.clientHeight - cardTop - CARD_MARGIN;
    content.style.maxHeight = `${Math.max(MIN_CARD_HEIGHT, available)}px`;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._resize?.disconnect();
    this._resize = null;
    this._setPinned(false);
  }

  private _setPinned(pinned: boolean): void {
    if (this._pinned === pinned) return;
    this._pinned = pinned;
    // Bound once per toggle rather than kept for the element's lifetime: an always-on
    // document listener on a component that exists per scatter-plot is a cost for a state
    // that is off almost always.
    if (pinned) {
      document.addEventListener('pointerdown', this._onDocumentPointerDown, true);
      document.addEventListener('keydown', this._onDocumentKeydown, true);
    } else {
      document.removeEventListener('pointerdown', this._onDocumentPointerDown, true);
      document.removeEventListener('keydown', this._onDocumentKeydown, true);
    }
  }

  /** `composedPath` rather than `contains`: the click may originate inside a nested shadow root. */
  private _onDocumentPointerDown = (event: Event) => {
    if (!event.composedPath().includes(this)) this._setPinned(false);
  };

  private _onDocumentKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    // Let a pinned ⓘ inside the panel take Escape first; it closes on its own keydown handler
    // and stopping here would leave the user pressing Escape twice with nothing happening.
    this._setPinned(false);
    (this.shadowRoot?.querySelector('.trigger') as HTMLElement | null)?.focus();
  };

  render() {
    const { parameters, quality, qualityScope } = this._splitMetadata();
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
        <svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3 3v18h18" />
          <path stroke-linecap="round" stroke-linejoin="round" d="M7 14v4" />
          <path stroke-linecap="round" stroke-linejoin="round" d="M11 10v8" />
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 6v12" />
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 8v10" />
        </svg>
      </button>

      <div
        class="content ${this._pinned ? 'is-pinned' : ''}"
        id="projection-metadata-content"
        role="tooltip"
        data-info-popover-boundary
      >
        <!-- The projection's own name, which the panel never showed: _splitMetadata skips
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
    // A bundle prepared without an embedding pass has every ceiling null: naming a column
    // of entirely blank cells would only take width back from the label column for nothing.
    const hasEmbeddingCeiling = summary?.validity.some((metric) => metric.embedding !== null);
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
                    >${annotationLabel(this.selectedAnnotation)}</span
                  ></span
                >
                <protspace-info-popover
                  placement="side"
                  label="separation scores"
                  .description=${SEPARATION_SCOPE_DESCRIPTION}
                ></protspace-info-popover>
              </div>
              ${hasEmbeddingCeiling
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
              ${isAutoClusterColumn(this.statisticsRows, this.selectedAnnotation)
                ? html`<div class="stat-caveat">${AUTO_CLUSTER_SCORE_CAVEAT}</div>`
                : nothing}
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
            >${annotationLabel(entry.annotation)}${entry.categories === null
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
              >${entry.scored.toLocaleString()} of
              ${this._recoversPopulation?.toLocaleString() ?? 'the dataset'} scored</span
            >`
          : nothing}
      </div>
    `;
  }

  /**
   * One metric row: name (with an arrow for the direction that counts as better), its value in
   * this projection, and (for annotation-validity metrics) the same metric in the source
   * embedding, which is the separability ceiling the projection is measured against.
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
      const noun = isClustering
        ? categories === 1
          ? 'cluster'
          : 'clusters'
        : categories === 1
          ? 'category'
          : 'categories';
      parts.push(`${categories} ${noun}`);
    }
    if (scored !== null) {
      parts.push(`${scored.toLocaleString()} ${scored === 1 ? 'protein' : 'proteins'} scored`);
    }
    // Deliberately NOT "full dataset" here. That is true of the faithfulness numbers too —
    // both blocks are computed once at prepare time and neither recomputes on a filter — so
    // stating it per section would repeat it. It is a card-level footer instead.
    return parts.join(' · ');
  }

  /**
   * Reduction parameters and projection quality, kept apart. They answer different
   * questions: the parameters are what was asked for, the quality is what came out, and
   * a single flat list invites reading `n_neighbors` and `trustworthiness` as peers.
   */
  private _splitMetadata(): {
    parameters: MetadataRow[];
    quality: MetadataRow[];
    /** One line under the faithfulness heading saying what it was computed over. */
    qualityScope: string;
  } {
    if (!this.projection?.metadata) return { parameters: [], quality: [], qualityScope: '' };

    const rawMetadata = this.projection.metadata;
    const parameterEntries: Array<[string, unknown]> = [];
    const qualityEntries: QualityEntry[] = [];

    for (const [key, value] of Object.entries(rawMetadata)) {
      const lowerKey = key.toLowerCase();
      if (lowerKey === 'dimension' || lowerKey === 'dimensions' || lowerKey === 'name') {
        continue;
      }

      if (this._isJsonField(lowerKey) && typeof value === 'string') {
        const parsed = this._tryParseJson(value);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          for (const [innerKey, innerValue] of Object.entries(parsed)) {
            if (
              innerKey.toLowerCase() === 'quality' &&
              !!innerValue &&
              typeof innerValue === 'object' &&
              !Array.isArray(innerValue)
            ) {
              qualityEntries.push(...this._qualityEntries(innerValue as Record<string, unknown>));
            } else {
              parameterEntries.push([innerKey, innerValue]);
            }
          }
          continue;
        }
      }

      if (lowerKey === 'quality' && !!value && typeof value === 'object' && !Array.isArray(value)) {
        qualityEntries.push(...this._qualityEntries(value as Record<string, unknown>));
        continue;
      }

      parameterEntries.push([key, value]);
    }

    const parameters: MetadataRow[] = parameterEntries.map(([key, value]) => ({
      label: this._formatMetadataKey(key),
      value: this._formatMetadataValue(value, key),
      // Reduction parameters are the reducer's own knobs, documented by the reducer; only
      // the metrics below have a registry entry to explain them.
      description: '',
    }));

    const quality: MetadataRow[] = qualityEntries.map(({ metric, scope, value }) => {
      const display = metricDisplay(metric);
      // A description is exactly what "the registry knows this metric" means, so it also
      // decides whether the registry's spelling ("kNN Overlap") beats the prettified key.
      const known = display.description.length > 0;
      return {
        // The scope is a group heading now, not a suffix on every row. "(local)" / "(global)"
        // on each of five labels cost more width than the panel has — "Spearman Distance
        // (global) ⓘ" pushed its own value onto a second line.
        label: known ? display.label : this._formatMetadataKey(metric),
        // These are statistics, so they follow `formatStatValue` like every other score in
        // the app rather than the generic metadata formatter's own rounding — which is still
        // right for reduction parameters, and still handles the `value: null` a skipped
        // metric is written as.
        value:
          typeof value === 'number' && Number.isFinite(value)
            ? formatStatValue(value)
            : this._formatMetadataValue(value, metric),
        description: display.description,
        scope,
      };
    });

    return { parameters, quality, qualityScope: this._qualityScopeLine(qualityEntries) };
  }

  /**
   * One entry per faithfulness metric, tagged with its scope ("local" neighbourhoods vs "global"
   * layout). The shared provenance each metric carries (k, seed, sampling, source embedding) is
   * dropped: it repeats per metric and would bury the five numbers worth reading.
   */
  private _qualityEntries(quality: Record<string, unknown>): QualityEntry[] {
    return Object.entries(quality).map(([metric, entry]): QualityEntry => {
      if (!entry || typeof entry !== 'object' || !('value' in entry)) {
        return { metric, scope: null, value: entry, sampleSize: null, sampled: false };
      }
      const {
        value,
        scope,
        sample_size: sampleSize,
        sampled,
      } = entry as {
        value: unknown;
        scope?: unknown;
        sample_size?: unknown;
        sampled?: unknown;
      };
      return {
        metric,
        scope: typeof scope === 'string' ? scope : null,
        value,
        sampleSize:
          typeof sampleSize === 'number' && Number.isFinite(sampleSize) ? sampleSize : null,
        sampled: sampled === true,
      };
    });
  }

  /**
   * What the faithfulness numbers were computed over, which the panel dropped entirely: the
   * provenance repeats identically on every metric, so it belongs once under the section
   * rather than on each row. `sampled` is the part that matters — above a threshold the
   * backend compares a subsample, and nothing said so.
   */
  private _qualityScopeLine(entries: QualityEntry[]): string {
    const withSize = entries.find((entry) => entry.sampleSize !== null);
    if (!withSize) return '';
    const proteins = `${withSize.sampleSize!.toLocaleString()} proteins compared`;
    return entries.some((entry) => entry.sampled) ? `${proteins} · subsampled` : proteins;
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
