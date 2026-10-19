/**
 * @vitest-environment jsdom
 *
 * A pick from the annotation, projection or contour menu, the search box or the
 * Clear button closes the menu and shows the pick in the frame of the input, and
 * only after that frame is painted does it reach the scatter plot (which re-stages
 * every point for it) and the change events. These tests pin that split, the
 * last-pick-wins rule, and that programmatic applies stay synchronous.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './control-bar';

interface StubScatterplot {
  selectedAnnotation: string;
  selectedProjectionIndex: number;
  selectedProteinIds: string[];
  isolateSelection: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
}

interface ControlBarInternals extends HTMLElement {
  autoSync: boolean;
  annotations: string[];
  projections: string[];
  selectedAnnotation: string;
  selectedProjection: string;
  selectedProteinsCount: number;
  allProteinIds: string[];
  selectedIdsChips: string[];
  _scatterplotElement: StubScatterplot | null;
  applyAnnotationSelection(annotation: string): void;
  applyProjectionSelection(projection: string): void;
  clearForNewDataset(datasetHash: string): void;
  updateComplete: Promise<unknown>;
}

/** Resolves in the task after the next frame, i.e. once a pick made now has been committed. */
const afterNextPaint = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

describe('control-bar commits user picks after the paint', () => {
  let controlBar: ControlBarInternals;
  let plot: StubScatterplot;

  beforeEach(async () => {
    document.body.innerHTML = '';
    controlBar = document.createElement('protspace-control-bar') as ControlBarInternals;
    controlBar.autoSync = false;
    controlBar.annotations = ['alpha', 'beta', 'gamma'];
    controlBar.selectedAnnotation = 'alpha';
    controlBar.projections = ['UMAP', 'PCA', 't-SNE'];
    controlBar.selectedProjection = 'UMAP';
    controlBar.allProteinIds = ['P1', 'P2', 'P3'];
    document.body.appendChild(controlBar);
    await controlBar.updateComplete;

    plot = {
      selectedAnnotation: 'alpha',
      selectedProjectionIndex: 0,
      selectedProteinIds: [],
      isolateSelection: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    controlBar._scatterplotElement = plot;
    controlBar.autoSync = true;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  const shadow = () => controlBar.shadowRoot!;
  const annotationSelect = () =>
    shadow().querySelector('protspace-annotation-select') as HTMLElement & {
      selectedAnnotation: string;
      updateComplete: Promise<unknown>;
    };
  /** The annotation the menu trigger shows (its text is the annotation's display label). */
  const annotationShown = () => annotationSelect().selectedAnnotation;
  const projectionTriggerText = () =>
    shadow().querySelector('#projection-trigger .dropdown-trigger-text')?.textContent?.trim();
  const search = () => shadow().querySelector('protspace-protein-search') as HTMLElement;
  const fromSearch = (type: string, detail: unknown) =>
    search().dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));

  async function pickAnnotation(annotation: string) {
    const select = annotationSelect();
    (select.shadowRoot!.querySelector('.dropdown-trigger') as HTMLButtonElement).click();
    await select.updateComplete;
    (select.shadowRoot!.querySelector(`.dropdown-item[data-annotation="${annotation}"]`) as
      | HTMLElement
      | undefined)!.click();
    await controlBar.updateComplete;
    await select.updateComplete;
  }

  describe('annotation menu', () => {
    it('shows the pick and closes the menu now, switches the plot after the paint', async () => {
      const changed = vi.fn();
      controlBar.addEventListener('annotation-change', changed);

      await pickAnnotation('beta');

      expect(annotationShown()).toBe('beta');
      expect(annotationSelect().shadowRoot!.querySelector('.dropdown-menu')).toBeNull();
      expect(controlBar.selectedAnnotation).toBe('alpha');
      expect(plot.selectedAnnotation).toBe('alpha');
      expect(changed).not.toHaveBeenCalled();

      await afterNextPaint();

      expect(controlBar.selectedAnnotation).toBe('beta');
      expect(plot.selectedAnnotation).toBe('beta');
      expect(changed).toHaveBeenCalledTimes(1);
      expect((changed.mock.calls[0][0] as CustomEvent).detail).toEqual({ annotation: 'beta' });
    });

    it('takes a keyboard pick down the same path', async () => {
      const select = annotationSelect();
      const trigger = select.shadowRoot!.querySelector('.dropdown-trigger') as HTMLButtonElement;
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      await select.updateComplete;
      const input = select.shadowRoot!.querySelector('#annotation-search-input') as HTMLElement;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      await select.updateComplete;

      const picked = annotationShown();
      expect(picked).not.toBe('alpha');
      expect(plot.selectedAnnotation).toBe('alpha');

      await afterNextPaint();

      expect(plot.selectedAnnotation).toBe(picked);
    });

    it('applies only the last of several picks made before the paint', async () => {
      const changed = vi.fn();
      controlBar.addEventListener('annotation-change', changed);

      await pickAnnotation('beta');
      await pickAnnotation('gamma');
      expect(annotationShown()).toBe('gamma');

      await afterNextPaint();

      expect(plot.selectedAnnotation).toBe('gamma');
      expect(changed).toHaveBeenCalledTimes(1);
      expect((changed.mock.calls[0][0] as CustomEvent).detail).toEqual({ annotation: 'gamma' });
    });

    it('applies programmatically at once and drops a pick still waiting', async () => {
      await pickAnnotation('beta');

      controlBar.applyAnnotationSelection('gamma');
      expect(plot.selectedAnnotation).toBe('gamma');

      await afterNextPaint();
      await controlBar.updateComplete;
      await annotationSelect().updateComplete;

      expect(plot.selectedAnnotation).toBe('gamma');
      expect(annotationShown()).toBe('gamma');
    });

    it('drops the shown pick when a programmatic apply keeps the current annotation', async () => {
      await pickAnnotation('beta');

      controlBar.applyAnnotationSelection('alpha');
      await controlBar.updateComplete;
      await annotationSelect().updateComplete;
      expect(annotationShown()).toBe('alpha');

      await afterNextPaint();

      expect(plot.selectedAnnotation).toBe('alpha');
    });
  });

  describe('projection menu', () => {
    const options = () => [...shadow().querySelectorAll('.projection-container .dropdown-item')];
    const trigger = () => shadow().querySelector('#projection-trigger') as HTMLButtonElement;

    it('shows the pick and closes the menu now, switches the plot after the paint', async () => {
      const changed = vi.fn();
      controlBar.addEventListener('projection-change', changed);

      trigger().click();
      await controlBar.updateComplete;
      (options()[1] as HTMLElement).click();
      await controlBar.updateComplete;

      expect(projectionTriggerText()).toBe('PCA');
      expect(options()).toHaveLength(0);
      expect(plot.selectedProjectionIndex).toBe(0);
      expect(changed).not.toHaveBeenCalled();

      await afterNextPaint();

      expect(controlBar.selectedProjection).toBe('PCA');
      expect(plot.selectedProjectionIndex).toBe(1);
      expect(changed).toHaveBeenCalledTimes(1);
      expect((changed.mock.calls[0][0] as CustomEvent).detail).toEqual({ projection: 'PCA' });
    });

    it('takes a keyboard pick down the same path', async () => {
      trigger().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      await controlBar.updateComplete;
      trigger().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      trigger().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      await controlBar.updateComplete;
      trigger().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      await controlBar.updateComplete;

      expect(projectionTriggerText()).toBe('t-SNE');
      expect(plot.selectedProjectionIndex).toBe(0);

      await afterNextPaint();

      expect(plot.selectedProjectionIndex).toBe(2);
    });

    it('applies programmatically at once and drops a pick still waiting', async () => {
      trigger().click();
      await controlBar.updateComplete;
      (options()[1] as HTMLElement).click();

      controlBar.applyProjectionSelection('UMAP');
      await controlBar.updateComplete;
      expect(projectionTriggerText()).toBe('UMAP');

      await afterNextPaint();

      expect(plot.selectedProjectionIndex).toBe(0);
      expect(controlBar.selectedProjection).toBe('UMAP');
    });
  });

  describe('search box', () => {
    it('updates the chips now and pushes the selection after the paint', async () => {
      const changed = vi.fn();
      controlBar.addEventListener('protein-selection-change', changed);
      const viewer = document.createElement('protspace-structure-viewer') as HTMLElement & {
        loadProtein: ReturnType<typeof vi.fn>;
      };
      viewer.loadProtein = vi.fn();
      document.body.appendChild(viewer);

      fromSearch('add-selection', { proteinId: 'P2' });

      expect(controlBar.selectedIdsChips).toEqual(['P2']);
      expect(controlBar.selectedProteinsCount).toBe(1);
      expect(plot.selectedProteinIds).toEqual([]);
      expect(changed).not.toHaveBeenCalled();
      expect(viewer.loadProtein).not.toHaveBeenCalled();

      await afterNextPaint();

      expect(plot.selectedProteinIds).toEqual(['P2']);
      expect(changed).toHaveBeenCalledTimes(1);
      expect(viewer.loadProtein).toHaveBeenCalledWith('P2');
    });

    it('builds each pick on the last and pushes them once', async () => {
      const changed = vi.fn();
      controlBar.addEventListener('protein-selection-change', changed);

      fromSearch('add-selection', { proteinId: 'P1' });
      fromSearch('add-selection-multiple', { proteinIds: ['P2', 'P3'] });
      fromSearch('remove-selection', { proteinId: 'P2' });
      expect(controlBar.selectedIdsChips).toEqual(['P1', 'P3']);

      await afterNextPaint();

      expect(plot.selectedProteinIds).toEqual(['P1', 'P3']);
      expect(changed).toHaveBeenCalledTimes(1);
      expect((changed.mock.calls[0][0] as CustomEvent).detail).toEqual({
        proteinIds: ['P1', 'P3'],
      });
    });

    it('lands a waiting pick before isolating', async () => {
      plot.isolateSelection.mockImplementation(() => {
        expect(plot.selectedProteinIds).toEqual(['P1']);
      });
      fromSearch('add-selection', { proteinId: 'P1' });
      await controlBar.updateComplete;

      (shadow().querySelector('.right-controls-split') as HTMLButtonElement).click();

      expect(plot.isolateSelection).toHaveBeenCalledTimes(1);
      expect(plot.selectedProteinIds).toEqual(['P1']);
    });

    it('is dropped by a selection committed at once elsewhere', async () => {
      fromSearch('add-selection', { proteinId: 'P1' });
      fromSearch('selection-change', { proteinIds: ['P3'] });
      expect(plot.selectedProteinIds).toEqual(['P3']);

      await afterNextPaint();

      expect(plot.selectedProteinIds).toEqual(['P3']);
      expect(controlBar.selectedIdsChips).toEqual(['P3']);
    });
  });

  it('Clear empties the chips now and the plot selection after the paint', async () => {
    fromSearch('add-selection', { proteinId: 'P1' });
    await afterNextPaint();
    await controlBar.updateComplete;
    const cleared = vi.fn();
    controlBar.addEventListener('clear-selections', cleared);

    (shadow().querySelector('.right-controls-clear') as HTMLButtonElement).click();

    expect(cleared).toHaveBeenCalledTimes(1);
    expect(controlBar.selectedProteinsCount).toBe(0);
    expect(plot.selectedProteinIds).toEqual(['P1']);

    await afterNextPaint();

    expect(plot.selectedProteinIds).toEqual([]);
  });

  it('a new dataset drops every pick still waiting', async () => {
    await pickAnnotation('beta');
    fromSearch('add-selection', { proteinId: 'P1' });

    controlBar.clearForNewDataset('hash');
    await afterNextPaint();

    expect(plot.selectedAnnotation).toBe('alpha');
    expect(plot.selectedProteinIds).toEqual([]);
  });
});
