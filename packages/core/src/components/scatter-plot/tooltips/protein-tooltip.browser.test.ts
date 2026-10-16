import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { TooltipView } from '@protspace/utils';
import { adoptTheme } from '../../kit/adopt-theme';
import './protein-tooltip';

const VIEW: TooltipView = {
  proteinId: 'P12345',
  geneName: [],
  proteinName: [],
  uniprotKbId: [],
  blocks: [],
};

beforeAll(() => adoptTheme());
afterEach(() => document.body.replaceChildren());

/** A tooltip as the plot renders it: hover-visible, or pinned with its links. */
async function mount(pinned: boolean) {
  const tooltip = document.createElement('protspace-protein-tooltip');
  tooltip.view = VIEW;
  tooltip.links = pinned;
  tooltip.className = pinned ? 'visible pinned' : 'visible';
  document.body.append(tooltip);
  await tooltip.updateComplete;
  return tooltip;
}

describe('protspace-protein-tooltip links', () => {
  it('a pinned tooltip lists the resource links; a hover tooltip does not', async () => {
    const pinned = await mount(true);
    const links = Array.from(
      pinned.shadowRoot!.querySelectorAll<HTMLAnchorElement>('.tooltip-links a.header-link'),
    );
    expect(links.map((link) => link.querySelector('.header-link-label')!.textContent)).toEqual([
      'AlphaFold',
      'UniProt',
      'InterPro',
      'TED',
    ]);
    // The pinned tooltip takes the pointer, so its last link can be pressed.
    const ted = links[3].getBoundingClientRect();
    const hit = pinned.shadowRoot!.elementFromPoint(
      ted.left + ted.width / 2,
      ted.top + ted.height / 2,
    );
    expect(hit?.closest('a')).toBe(links[3]);

    pinned.remove();
    const hover = await mount(false);
    expect(hover.shadowRoot!.querySelector('.resource-links')).toBeNull();
  });

  it('a pinned card capped to the room scrolls and keeps its actions in view', async () => {
    const pinned = await mount(true);
    pinned.actions = [{ id: 'structure', label: 'View structure' }];
    pinned.style.setProperty('--protspace-tooltip-max-height', '120px');
    await pinned.updateComplete;

    const card = pinned.shadowRoot!.querySelector<HTMLElement>('.tooltip')!;
    const box = card.getBoundingClientRect();
    expect(box.height).toBeLessThanOrEqual(120);
    expect(card.scrollHeight).toBeGreaterThan(card.clientHeight);
    const actions = pinned.shadowRoot!.querySelector('.tooltip-actions')!.getBoundingClientRect();
    expect(actions.bottom).toBeLessThanOrEqual(box.bottom);
    expect(actions.top).toBeGreaterThanOrEqual(box.top);
  });

  it('the header shows the label, not the key', async () => {
    const tooltip = document.createElement('protspace-protein-tooltip');
    tooltip.view = {
      ...VIEW,
      blocks: [
        {
          key: 'ec',
          label: 'EC number',
          displayValues: ['1.1.1.1'],
          numericValue: null,
          numericType: 'float',
          scores: [],
          evidence: [],
          predicted: null,
        },
      ],
    };
    tooltip.className = 'visible';
    document.body.append(tooltip);
    await tooltip.updateComplete;

    const header = tooltip.shadowRoot!.querySelector('.tooltip-annotation-header span')!;
    expect(header.textContent).toBe('EC number');
  });

  it('a compact card shows the protein, its colour-by value and the actions, and nothing else', async () => {
    const tooltip = document.createElement('protspace-protein-tooltip');
    const block = (key: string, label: string, value: string) => ({
      key,
      label,
      displayValues: [value],
      numericValue: null,
      numericType: 'float' as const,
      scores: [],
      evidence: ['IC'],
      predicted: null,
    });
    tooltip.view = {
      proteinId: 'C0JB21',
      geneName: ['lsct1'],
      proteinName: ['Dermonecrotic toxin LruSicTox-alphaIV1'],
      uniprotKbId: ['A41_LOXRU'],
      blocks: [
        block('family', 'Protein family', 'arthropod phospholipase D family'),
        block('species', 'Species', 'Loxosceles rufescens'),
        block('ec', 'EC number', '4.6.1.-'),
      ],
    };
    tooltip.compact = true;
    tooltip.color = '#0067a5';
    tooltip.links = true;
    tooltip.actions = [{ id: 'structure', label: 'View structure' }];
    tooltip.className = 'visible pinned';
    tooltip.style.setProperty('--protspace-tooltip-effective-width', '240px');
    document.body.append(tooltip);
    await tooltip.updateComplete;

    const root = tooltip.shadowRoot!;
    const card = root.querySelector<HTMLElement>('.tooltip')!;
    expect(card.textContent).toContain('C0JB21');
    expect(card.textContent).toContain('A41_LOXRU');
    expect(card.textContent).toContain('Dermonecrotic toxin');
    expect(card.textContent).toContain('arthropod phospholipase D family');
    for (const gone of ['lsct1', 'Species', 'Loxosceles', 'EC number', 'IC', 'Protein:']) {
      expect(card.textContent).not.toContain(gone);
    }
    expect(root.querySelector('.resource-links')).toBeNull();
    const swatch = root.querySelector<HTMLElement>('.tooltip-swatch')!;
    expect(getComputedStyle(swatch).backgroundColor).toBe('rgb(0, 103, 165)');
    expect(root.querySelector('ps-button')!.textContent).toContain('View structure');
    // About the mockup's card: 240 px wide, short enough to sit beside the protein on a phone.
    const box = card.getBoundingClientRect();
    expect(box.width).toBe(240);
    expect(box.height).toBeLessThanOrEqual(150);
  });
});
