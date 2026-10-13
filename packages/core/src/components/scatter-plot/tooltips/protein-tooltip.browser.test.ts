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
});
