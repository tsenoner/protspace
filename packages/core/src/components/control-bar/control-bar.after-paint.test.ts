/**
 * @vitest-environment jsdom
 *
 * A pick from the search box or the Clear button updates the chips in the frame of the input,
 * and only after that frame is painted does it reach the scatter plot (which re-stages every
 * point for it) and the selection event. These tests pin that split, the last-pick-wins rule,
 * and that a selection committed at once drops a pick still waiting. The view pickers carry the
 * same rules in their own tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './control-bar';

interface StubScatterplot {
  selectedProteinIds: string[];
  isolateSelection: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
}

interface ControlBarInternals extends HTMLElement {
  autoSync: boolean;
  selectedProteinsCount: number;
  allProteinIds: string[];
  selectedIdsChips: string[];
  _scatterplotElement: StubScatterplot | null;
  clearForNewDataset(): void;
  updateComplete: Promise<unknown>;
}

/** Resolves in the task after the next frame, i.e. once a pick made now has been committed. */
const afterNextPaint = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

describe('control-bar commits search picks after the paint', () => {
  let controlBar: ControlBarInternals;
  let plot: StubScatterplot;

  beforeEach(async () => {
    document.body.innerHTML = '';
    controlBar = document.createElement('protspace-control-bar') as ControlBarInternals;
    controlBar.autoSync = false;
    controlBar.allProteinIds = ['P1', 'P2', 'P3'];
    document.body.appendChild(controlBar);
    await controlBar.updateComplete;

    plot = {
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
  const search = () => shadow().querySelector('protspace-protein-search') as HTMLElement;
  const fromSearch = (type: string, detail: unknown) =>
    search().dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));

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

  it('a new dataset drops a search pick still waiting', async () => {
    fromSearch('add-selection', { proteinId: 'P1' });

    controlBar.clearForNewDataset();
    await afterNextPaint();

    expect(plot.selectedProteinIds).toEqual([]);
  });
});
