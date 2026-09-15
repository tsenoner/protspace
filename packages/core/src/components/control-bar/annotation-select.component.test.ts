/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import './annotation-select';
import './control-bar';
import type { ProjectionStatisticRow } from '@protspace/utils';
import type { ProtspaceData } from './types';

type AnnotationSelectElement = HTMLElement & {
  annotations: string[];
  selectedAnnotation: string;
  selectedProjection: string;
  tooltipAnnotations: string[];
  eatAnnotations: string[];
  statisticsRows: readonly ProjectionStatisticRow[];
  updateComplete: Promise<unknown>;
};

async function setup(initial: Partial<AnnotationSelectElement> = {}) {
  const el = document.createElement('protspace-annotation-select') as AnnotationSelectElement;
  el.annotations = initial.annotations ?? ['gene_name', 'pfam', 'species'];
  el.selectedAnnotation = initial.selectedAnnotation ?? 'pfam';
  el.selectedProjection = initial.selectedProjection ?? '';
  el.tooltipAnnotations = initial.tooltipAnnotations ?? [];
  el.eatAnnotations = initial.eatAnnotations ?? [];
  el.statisticsRows = initial.statisticsRows ?? [];
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

async function openDropdown(el: AnnotationSelectElement): Promise<void> {
  const trigger = el.shadowRoot!.querySelector('.dropdown-trigger') as HTMLButtonElement;
  trigger.click();
  await el.updateComplete;
}

function getRowFor(el: AnnotationSelectElement, annotation: string): HTMLElement {
  const items = Array.from(el.shadowRoot!.querySelectorAll('.dropdown-item')) as HTMLElement[];
  const row = items.find((item) => item.getAttribute('data-annotation') === annotation);
  if (!row) {
    throw new Error(`row for annotation "${annotation}" not found`);
  }
  return row;
}

describe('protspace-annotation-select tooltip extras', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders a primary indicator only on the selected row', async () => {
    const el = await setup();
    await openDropdown(el);

    const primary = getRowFor(el, 'pfam');
    const other = getRowFor(el, 'gene_name');

    expect(primary.querySelector('.primary-dot')).not.toBeNull();
    expect(other.querySelector('.primary-dot')).toBeNull();
  });

  it('marks only EAT-capable annotation options with a text badge', async () => {
    const el = await setup({ eatAnnotations: ['pfam'] });
    await openDropdown(el);

    expect(getRowFor(el, 'pfam').querySelector('.eat-badge')?.textContent).toBe('EAT');
    expect(getRowFor(el, 'species').querySelector('.eat-badge')).toBeNull();
  });

  it('hides the tooltip toggle on the primary row and shows it on other rows', async () => {
    const el = await setup();
    await openDropdown(el);

    const primary = getRowFor(el, 'pfam');
    const other = getRowFor(el, 'gene_name');

    expect(primary.querySelector('.tooltip-toggle-btn')).toBeNull();
    expect(other.querySelector('.tooltip-toggle-btn')).not.toBeNull();
  });

  it('reflects active state on the toggle for annotations in tooltipAnnotations', async () => {
    const el = await setup({ tooltipAnnotations: ['gene_name'] });
    await openDropdown(el);

    const activeBtn = getRowFor(el, 'gene_name').querySelector(
      '.tooltip-toggle-btn',
    ) as HTMLButtonElement;
    const inactiveBtn = getRowFor(el, 'species').querySelector(
      '.tooltip-toggle-btn',
    ) as HTMLButtonElement;

    expect(activeBtn.classList.contains('is-active')).toBe(true);
    expect(activeBtn.getAttribute('aria-pressed')).toBe('true');
    expect(inactiveBtn.classList.contains('is-active')).toBe(false);
    expect(inactiveBtn.getAttribute('aria-pressed')).toBe('false');
  });

  it('dispatches tooltip-annotation-toggle when the toggle is clicked, without selecting', async () => {
    const el = await setup();
    await openDropdown(el);

    const toggleEvents: CustomEvent[] = [];
    const selectEvents: CustomEvent[] = [];
    el.addEventListener('tooltip-annotation-toggle', (e) => toggleEvents.push(e as CustomEvent));
    el.addEventListener('annotation-select', (e) => selectEvents.push(e as CustomEvent));

    const btn = getRowFor(el, 'gene_name').querySelector(
      '.tooltip-toggle-btn',
    ) as HTMLButtonElement;
    btn.click();
    await el.updateComplete;

    expect(toggleEvents).toHaveLength(1);
    expect(toggleEvents[0].detail).toEqual({
      annotation: 'gene_name',
      active: true,
      tooltipAnnotations: ['gene_name'],
    });
    expect(selectEvents).toHaveLength(0);
    expect(el.tooltipAnnotations).toEqual(['gene_name']);
  });

  it('removes an annotation from tooltipAnnotations on a second toggle click', async () => {
    const el = await setup({ tooltipAnnotations: ['gene_name'] });
    await openDropdown(el);

    const events: CustomEvent[] = [];
    el.addEventListener('tooltip-annotation-toggle', (e) => events.push(e as CustomEvent));

    const btn = getRowFor(el, 'gene_name').querySelector(
      '.tooltip-toggle-btn',
    ) as HTMLButtonElement;
    btn.click();
    await el.updateComplete;

    expect(events[0].detail).toEqual({
      annotation: 'gene_name',
      active: false,
      tooltipAnnotations: [],
    });
    expect(el.tooltipAnnotations).toEqual([]);
  });

  it('clicking the row label selects the annotation as primary', async () => {
    const el = await setup();
    await openDropdown(el);

    const selectSpy = vi.fn();
    el.addEventListener('annotation-select', selectSpy);

    (getRowFor(el, 'gene_name').querySelector('.dropdown-item-label') as HTMLElement).click();
    await el.updateComplete;

    expect(selectSpy).toHaveBeenCalledTimes(1);
    expect((selectSpy.mock.calls[0][0] as CustomEvent).detail).toEqual({ annotation: 'gene_name' });
  });
});

describe('protspace-annotation-select statistics badge', () => {
  const statRow = (over: Partial<ProjectionStatisticRow> = {}): ProjectionStatisticRow => ({
    space_kind: 'projection',
    space_name: 'umap',
    annotation: 'major_group',
    stat_family: 'annotation_validity',
    label_kind: 'annotation',
    metric: 'silhouette',
    metric_kind: 'validity',
    value: 0.42,
    ...over,
  });

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  // Neither annotation ships built-in docs, so neither row has an ⓘ of its own.
  const CUSTOM_ANNOTATIONS = ['major_group', 'seq_start'];

  /** A `cluster_agreement` row for the elbow-K clustering on `umap`, recovering `major_group`. */
  const agreementRow = (over: Partial<ProjectionStatisticRow> = {}): ProjectionStatisticRow =>
    statRow({
      stat_family: 'cluster_agreement',
      label_kind: 'kmeans_elbow',
      metric: 'adjusted_rand',
      metric_kind: 'agreement',
      value: 0.62,
      ...over,
    });

  it('badges only the annotations the bundle scored, without adding an icon', async () => {
    // The numbers live in the projection-metadata panel now; the badge only says they exist.
    const el = await setup({
      annotations: [...CUSTOM_ANNOTATIONS, 'gene_name'],
      statisticsRows: [statRow()],
      selectedProjection: 'umap',
    });
    await openDropdown(el);

    expect(getRowFor(el, 'major_group').querySelector('.stats-badge')?.textContent).toBe('STATS');
    expect(getRowFor(el, 'seq_start').querySelector('.stats-badge')).toBeNull();

    // `major_group` ships no description, so a badge must not conjure an ⓘ; `gene_name` has one
    // and keeps it.
    expect(getRowFor(el, 'major_group').querySelector('protspace-info-popover')).toBeNull();
    expect(getRowFor(el, 'gene_name').querySelector('protspace-info-popover')).not.toBeNull();
  });

  it('drops the badge when the statistics are for a different projection', async () => {
    const el = await setup({
      annotations: CUSTOM_ANNOTATIONS,
      statisticsRows: [statRow()],
      selectedProjection: 'pca',
    });
    await openDropdown(el);

    expect(getRowFor(el, 'major_group').querySelector('.stats-badge')).toBeNull();
  });

  it('updates the badge when selectedProjection changes after the first render', async () => {
    // The cold-cache case above (projection set before first render) cannot see a stale
    // `hasStats` cache: willUpdate's `changed.has('selectedProjection')` clear is what makes
    // a LIVE projection switch drop a badge that was already true for the old projection.
    const el = await setup({
      annotations: CUSTOM_ANNOTATIONS,
      statisticsRows: [statRow()],
      selectedProjection: 'umap',
    });
    await openDropdown(el);
    expect(getRowFor(el, 'major_group').querySelector('.stats-badge')?.textContent).toBe('STATS');

    el.selectedProjection = 'pca';
    await el.updateComplete;

    expect(getRowFor(el, 'major_group').querySelector('.stats-badge')).toBeNull();
  });

  it('drops the badge for an ordinary annotation whose only score is an agreement row', async () => {
    // A category can vanish from validity under subsampling while the (unsampled) agreement
    // pass still recovers it. annotationStatSummary alone stays non-null on that agreement row,
    // but the panel renders no block for it (no validity, and this isn't a cluster_* column),
    // so the badge must not claim otherwise.
    const el = await setup({
      annotations: CUSTOM_ANNOTATIONS,
      statisticsRows: [agreementRow()],
      selectedProjection: 'umap',
    });
    await openDropdown(el);

    expect(getRowFor(el, 'major_group').querySelector('.stats-badge')).toBeNull();
  });

  it('badges a cluster_* column from the agreement rows naming its own clustering', async () => {
    // annotationStatSummary is always null for a cluster_* column (cluster columns are never
    // scored annotations), so the badge must come from clusterAgreement instead.
    const el = await setup({
      annotations: [...CUSTOM_ANNOTATIONS, 'cluster_elbow_umap'],
      statisticsRows: [agreementRow()],
      selectedProjection: 'umap',
    });
    await openDropdown(el);

    expect(getRowFor(el, 'cluster_elbow_umap').querySelector('.stats-badge')?.textContent).toBe(
      'STATS',
    );
  });

  it('does not rebuild the list when the pointer crosses a row', async () => {
    const el = await setup({
      annotations: CUSTOM_ANNOTATIONS,
      statisticsRows: [statRow()],
      selectedProjection: 'umap',
    });
    await openDropdown(el);

    // Node-identity alone passes vacuously: lit's keyless `.map()` diffing reuses each row's DOM
    // node in place regardless of whether the handler runs. Watch for any DOM mutation instead —
    // hovering is presentation (CSS `:hover`) and must not touch the DOM at all.
    const container = el.shadowRoot!.querySelector('.annotation-list-container') as HTMLElement;
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((mutations) => records.push(...mutations));
    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });

    getRowFor(el, 'seq_start').dispatchEvent(new MouseEvent('mouseenter'));
    await el.updateComplete;
    records.push(...observer.takeRecords());
    observer.disconnect();

    expect(records).toHaveLength(0);
  });
});

interface ControlBarInternals extends HTMLElement {
  annotations: string[];
  _filterableAnnotations: string[];
  selectedAnnotation: string;
  _updateOptionsFromData(data: ProtspaceData, capabilityData?: ProtspaceData): void;
  updateComplete: Promise<unknown>;
}

describe('protspace-control-bar annotation list splitting', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('excludes eat-confidence annotations from the color-by list but keeps them in the filterable list', async () => {
    const controlBar = document.createElement('protspace-control-bar') as ControlBarInternals;
    document.body.appendChild(controlBar);
    await controlBar.updateComplete;

    const data: ProtspaceData = {
      projections: [{ name: 'umap' }],
      annotations: {
        pfam: { kind: 'categorical', values: ['a', 'b'] },
        pfam__eat_confidence: {
          kind: 'numeric',
          values: ['0.9', '0.4'],
          runtime: { role: 'eat-confidence', baseAnnotation: 'pfam' },
        },
        // Collision-renamed variant (real allocateEatConfidenceAnnotationKey output shape:
        // `<base>__eat_confidence__runtime_N`) — identity must still key off runtime.role,
        // not the `__eat_confidence` suffix.
        pfam__eat_confidence__runtime_2: {
          kind: 'numeric',
          values: ['0.1', '0.7'],
          runtime: { role: 'eat-confidence', baseAnnotation: 'pfam' },
        },
      },
    };

    controlBar._updateOptionsFromData(data);

    expect(controlBar.annotations).toEqual(['pfam']);
    expect(controlBar._filterableAnnotations).toEqual([
      'pfam',
      'pfam__eat_confidence',
      'pfam__eat_confidence__runtime_2',
    ]);
    // The default color-by selection must never land on an eat-confidence key.
    expect(controlBar.selectedAnnotation).toBe('pfam');
  });
});
