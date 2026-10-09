/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import './annotation-select';
import type { ProjectionStatisticRow } from '@protspace/utils';
import { pushLayer, topLayer } from '../kit/layers';

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

/** Resolves in the task after the next frame, i.e. once a pick made now has been committed. */
const afterNextPaint = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

type PickerElement = AnnotationSelectElement & {
  applySelection(annotation: string): void;
  label: string;
};

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

  it('dispatches tooltip-annotations-change when the toggle is clicked, without selecting', async () => {
    const el = await setup();
    await openDropdown(el);

    const toggleEvents: CustomEvent[] = [];
    const selectEvents: CustomEvent[] = [];
    el.addEventListener('tooltip-annotations-change', (e) => toggleEvents.push(e as CustomEvent));
    el.addEventListener('annotation-change', (e) => selectEvents.push(e as CustomEvent));

    const btn = getRowFor(el, 'gene_name').querySelector(
      '.tooltip-toggle-btn',
    ) as HTMLButtonElement;
    btn.click();
    await el.updateComplete;
    await afterNextPaint();

    expect(toggleEvents).toHaveLength(1);
    expect(toggleEvents[0].detail).toEqual({ tooltipAnnotations: ['gene_name'] });
    expect(selectEvents).toHaveLength(0);
    expect(el.tooltipAnnotations).toEqual(['gene_name']);
  });

  it('removes an annotation from tooltipAnnotations on a second toggle click', async () => {
    const el = await setup({ tooltipAnnotations: ['gene_name'] });
    await openDropdown(el);

    const events: CustomEvent[] = [];
    el.addEventListener('tooltip-annotations-change', (e) => events.push(e as CustomEvent));

    const btn = getRowFor(el, 'gene_name').querySelector(
      '.tooltip-toggle-btn',
    ) as HTMLButtonElement;
    btn.click();
    await el.updateComplete;

    expect(events[0].detail).toEqual({ tooltipAnnotations: [] });
    expect(el.tooltipAnnotations).toEqual([]);
  });

  it('clicking the row label selects the annotation as primary', async () => {
    const el = await setup();
    await openDropdown(el);

    const selectSpy = vi.fn();
    el.addEventListener('annotation-change', selectSpy);

    (getRowFor(el, 'gene_name').querySelector('.dropdown-item-label') as HTMLElement).click();
    await el.updateComplete;
    await afterNextPaint();

    expect(selectSpy).toHaveBeenCalledTimes(1);
    expect((selectSpy.mock.calls[0][0] as CustomEvent).detail).toEqual({ annotation: 'gene_name' });
  });
});

describe('protspace-annotation-select annotation names', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('searches only the labels it displays', async () => {
    const el = await setup({
      annotations: ['predicted_membrane', 'predicted_signal_peptide', 'ted_domains', 'gene_name'],
      selectedAnnotation: 'gene_name',
    });
    await openDropdown(el);
    const search = async (query: string) => {
      const input = el.shadowRoot!.querySelector('.annotation-search-input') as HTMLInputElement;
      input.value = query;
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      await el.updateComplete;
      return Array.from(
        el.shadowRoot!.querySelectorAll<HTMLElement>('.dropdown-item[data-annotation]'),
      ).map((row) => row.querySelector('.dropdown-item-label')!.textContent!.trim());
    };

    // "Membrane" and "Signal peptide" do not say "predicted"
    expect(await search('predicted')).toEqual([]);
    expect(el.shadowRoot!.querySelector('.no-results')).not.toBeNull();
    expect(await search('ted')).toEqual(['TED domains']);
    expect(await search('membrane')).toEqual(['Membrane']);
  });

  it('names the selected annotation by label, with the predicted badge', async () => {
    const el = await setup({
      annotations: ['cc_subcellular_location', 'predicted_subcellular_location'],
      selectedAnnotation: 'predicted_subcellular_location',
    });
    const trigger = el.shadowRoot!.querySelector('.dropdown-trigger')!;
    expect(trigger.querySelector('.dropdown-trigger-text')!.textContent!.trim()).toBe(
      'Subcellular location',
    );
    expect(trigger.querySelector('.predicted-badge')).not.toBeNull();

    el.selectedAnnotation = 'cc_subcellular_location';
    await el.updateComplete;
    expect(trigger.querySelector('.predicted-badge')).toBeNull();
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

describe('protspace-annotation-select picks', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  const shown = (el: AnnotationSelectElement) =>
    el.shadowRoot!.querySelector('.dropdown-trigger .dropdown-trigger-text')!.textContent!.trim();
  const rowLabel = (el: AnnotationSelectElement, annotation: string) =>
    getRowFor(el, annotation).querySelector('.dropdown-item-label')!.textContent!.trim();

  async function pick(el: AnnotationSelectElement, annotation: string): Promise<string> {
    await openDropdown(el);
    const label = rowLabel(el, annotation);
    (getRowFor(el, annotation).querySelector('.dropdown-item-label') as HTMLElement).click();
    await el.updateComplete;
    return label;
  }

  it('a pick shows at once, closes the list and dispatches annotation-change after the paint', async () => {
    const el = await setup();
    const changed = vi.fn();
    el.addEventListener('annotation-change', changed);

    const label = await pick(el, 'species');

    expect(shown(el)).toBe(label);
    expect(el.shadowRoot!.querySelector('.dropdown-menu')).toBeNull();
    expect(el.selectedAnnotation).toBe('pfam');
    expect(changed).not.toHaveBeenCalled();

    await afterNextPaint();

    expect(el.selectedAnnotation).toBe('species');
    expect(changed).toHaveBeenCalledTimes(1);
    expect((changed.mock.calls[0][0] as CustomEvent).detail).toEqual({ annotation: 'species' });
  });

  it('takes a keyboard pick down the same path', async () => {
    const el = await setup();
    const trigger = el.shadowRoot!.querySelector('.dropdown-trigger') as HTMLButtonElement;
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await el.updateComplete;
    const input = el.shadowRoot!.querySelector('#annotation-search-input') as HTMLElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await el.updateComplete;

    expect(el.selectedAnnotation).toBe('pfam');
    await afterNextPaint();
    expect(el.selectedAnnotation).not.toBe('pfam');
  });

  it('re-picking the annotation on screen dispatches nothing and drops a waiting pick', async () => {
    const el = await setup();
    const changed = vi.fn();
    el.addEventListener('annotation-change', changed);

    await pick(el, 'species'); // waits for the paint
    const label = await pick(el, 'pfam'); // back to the committed one before it
    await afterNextPaint();

    expect(changed).not.toHaveBeenCalled();
    expect(el.selectedAnnotation).toBe('pfam');
    expect(shown(el)).toBe(label);
  });

  it('applies only the last of several picks made before the paint', async () => {
    const el = await setup();
    const changed = vi.fn();
    el.addEventListener('annotation-change', changed);

    await pick(el, 'species');
    const label = await pick(el, 'gene_name');
    expect(shown(el)).toBe(label);

    await afterNextPaint();

    expect(el.selectedAnnotation).toBe('gene_name');
    expect(changed).toHaveBeenCalledTimes(1);
    expect((changed.mock.calls[0][0] as CustomEvent).detail).toEqual({ annotation: 'gene_name' });
  });

  it('picking a tooltip extra as the primary then removes it from the tooltip annotations', async () => {
    const el = await setup({ tooltipAnnotations: ['species', 'gene_name'] });
    const events: Array<[string, unknown]> = [];
    el.addEventListener('annotation-change', (e) =>
      events.push(['annotation-change', (e as CustomEvent).detail]),
    );
    el.addEventListener('tooltip-annotations-change', (e) =>
      events.push(['tooltip-annotations-change', (e as CustomEvent).detail]),
    );

    await pick(el, 'species');
    await afterNextPaint();

    expect(events).toEqual([
      ['annotation-change', { annotation: 'species' }],
      ['tooltip-annotations-change', { tooltipAnnotations: ['gene_name'] }],
    ]);
    expect(el.tooltipAnnotations).toEqual(['gene_name']);
  });

  it('applySelection dispatches at once and drops a pick still waiting', async () => {
    const el = (await setup()) as PickerElement;
    const changed = vi.fn();
    el.addEventListener('annotation-change', changed);
    await pick(el, 'species');

    el.applySelection('gene_name');

    expect(changed).toHaveBeenCalledTimes(1);
    expect((changed.mock.calls[0][0] as CustomEvent).detail).toEqual({ annotation: 'gene_name' });
    await afterNextPaint();
    await el.updateComplete;
    expect(changed).toHaveBeenCalledTimes(1);
    expect(el.selectedAnnotation).toBe('gene_name');
    const label = await rowLabelAfterOpen(el, 'gene_name');
    expect(shown(el)).toBe(label);
  });

  it('drops the shown pick when a programmatic apply keeps the current annotation', async () => {
    const el = (await setup()) as PickerElement;
    await pick(el, 'species');

    el.applySelection('pfam');
    await el.updateComplete;
    await afterNextPaint();

    expect(el.selectedAnnotation).toBe('pfam');
    const label = await rowLabelAfterOpen(el, 'pfam');
    expect(shown(el)).toBe(label);
  });

  it('Escape closes the list before anything else', async () => {
    const dialogClose = vi.fn();
    const releaseDialog = pushLayer({ close: dialogClose, elements: [] });
    const el = await setup();
    await openDropdown(el);
    expect(el.shadowRoot!.querySelector('.dropdown-menu')).not.toBeNull();

    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }),
    );
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector('.dropdown-menu')).toBeNull();
    expect(dialogClose).not.toHaveBeenCalled();
    expect(topLayer()?.close).toBe(dialogClose);
    releaseDialog();
  });

  it('the trigger reads Color by and the annotation', async () => {
    const el = (await setup()) as PickerElement;
    const trigger = el.shadowRoot!.querySelector('.dropdown-trigger')!;
    const key = trigger.querySelector('[part="key"]')!;

    expect(key.textContent!.trim()).toBe('Color by');
    expect(trigger.textContent!.replace(/\s+/g, ' ').trim()).toMatch(/^Color by \S/);

    el.label = 'Colour';
    await el.updateComplete;
    expect(key.textContent!.trim()).toBe('Colour');
  });
});

/** The label a row shows for `annotation`, read from the opened list, which closes again. */
async function rowLabelAfterOpen(el: AnnotationSelectElement, annotation: string): Promise<string> {
  await openDropdown(el);
  const label = getRowFor(el, annotation)
    .querySelector('.dropdown-item-label')!
    .textContent!.trim();
  (el.shadowRoot!.querySelector('.dropdown-trigger') as HTMLButtonElement).click();
  await el.updateComplete;
  return label;
}
