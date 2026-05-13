/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import './annotation-select';

type AnnotationSelectElement = HTMLElement & {
  annotations: string[];
  selectedAnnotation: string;
  tooltipAnnotations: string[];
  updateComplete: Promise<unknown>;
};

async function setup(initial: Partial<AnnotationSelectElement> = {}) {
  const el = document.createElement('protspace-annotation-select') as AnnotationSelectElement;
  el.annotations = initial.annotations ?? ['gene_name', 'pfam', 'species'];
  el.selectedAnnotation = initial.selectedAnnotation ?? 'pfam';
  el.tooltipAnnotations = initial.tooltipAnnotations ?? [];
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
  const row = items.find(
    (item) => item.querySelector('.dropdown-item-label')?.textContent?.trim() === annotation,
  );
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
