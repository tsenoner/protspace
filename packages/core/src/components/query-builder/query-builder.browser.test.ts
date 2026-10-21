import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { adoptTheme } from '../kit/adopt-theme';
import type { PsButton, PsIconButton } from '../kit/button';
import { topLayer } from '../kit/layers';
import type { ProtspaceQueryBuilder } from './query-builder';
import './query-builder';
import { createCondition, createGroup } from './query-types';
import type { FilterQuery } from './query-types';
import type { ProtspaceData } from './types';
import { cdp, page } from 'vitest/browser';

beforeAll(() => adoptTheme());
afterEach(() => document.body.replaceChildren());

const data: ProtspaceData = {
  protein_ids: ['P1', 'P2', 'P3', 'P4', 'P5'],
  annotations: { organism: { kind: 'categorical', values: ['Human', 'Mouse'] } },
  annotation_data: { organism: [[0], [1], [0], [1], [1]] },
};

type Row = HTMLElement & { updateComplete: Promise<unknown> };

async function mount(query: FilterQuery, width = 360): Promise<ProtspaceQueryBuilder> {
  const builder = document.createElement('protspace-query-builder');
  builder.embedded = true;
  builder.dirty = true;
  builder.annotations = ['organism'];
  builder.data = data;
  builder.query = query;
  builder.style.cssText = `display: block; width: ${width}px; height: 600px`;
  document.body.append(builder);
  await builder.updateComplete;
  for (const row of rows(builder)) await row.updateComplete;
  return builder;
}

const rows = (builder: ProtspaceQueryBuilder): Row[] => [
  ...builder.shadowRoot!.querySelectorAll<Row>('protspace-query-condition-row'),
];
const inner = (button: PsButton | PsIconButton) => button.shadowRoot!.querySelector('button')!;

describe('protspace-query-builder in a narrow panel', () => {
  it('Apply is described by the visible reason', async () => {
    const builder = await mount([createCondition({ annotation: 'organism' })]);
    const apply = builder.shadowRoot!.querySelector<PsButton>('.query-footer-apply')!;
    await apply.updateComplete;
    const reason = builder.shadowRoot!.querySelector<HTMLElement>('#apply-reason')!;

    expect(reason.textContent!.trim()).toBe('Choose a value for condition 1');
    expect(reason.checkVisibility()).toBe(true);
    expect(inner(apply).disabled).toBe(true);
    expect(inner(apply).ariaDescribedByElements?.[0]).toBe(reason);
  });

  it('a group offers Remove group in its ⋯ menu; a card offers Remove in its own', async () => {
    const builder = await mount([createGroup()]);
    const groupMenu = builder.shadowRoot!.querySelector<PsIconButton>('.group-menu-trigger')!;
    await groupMenu.updateComplete;
    expect(inner(groupMenu).getAttribute('aria-label')).toBe('Actions for group');
    expect(
      builder.shadowRoot!.querySelector('ps-menu-item[value="remove"]')!.textContent!.trim(),
    ).toBe('Remove group');

    const menuRow =
      rows(builder)[0].shadowRoot!.querySelector<PsIconButton>('.condition-menu-trigger')!;
    await menuRow.updateComplete;
    expect(inner(menuRow).getAttribute('aria-label')).toBe('Actions for condition 1');
    expect(
      rows(builder)[0].shadowRoot!.querySelector('ps-menu-item[value="remove"]'),
    ).not.toBeNull();
  });

  it('at 260 px wide a row stacks and nothing overflows horizontally', async () => {
    const builder = await mount(
      [createCondition({ annotation: 'organism', values: ['Human', 'Mouse'] })],
      260,
    );
    const row = rows(builder)[0];
    const root = row.shadowRoot!;
    const trigger = root.querySelector('.annotation-select-trigger')!.getBoundingClientRect();
    const values = root.querySelector('.condition-values')!.getBoundingClientRect();
    const box = root.querySelector<HTMLElement>('.condition-row')!;

    expect(values.top).toBeGreaterThanOrEqual(trigger.bottom - 1);
    expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth);
    expect(row.getBoundingClientRect().right).toBeLessThanOrEqual(
      builder.getBoundingClientRect().right + 0.5,
    );
    const footer = builder.shadowRoot!.querySelector<HTMLElement>('.query-footer')!;
    expect(footer.scrollWidth).toBeLessThanOrEqual(footer.clientWidth);
  });

  it('rows are named by their numbers, group leaves included', async () => {
    const builder = await mount([
      createCondition({ annotation: 'organism', values: ['Human'] }),
      createGroup({
        logicalOp: 'AND',
        conditions: [createCondition(), createCondition({ logicalOp: 'OR' })],
      }),
    ]);
    const all = rows(builder);
    expect(
      all.map((row) => row.shadowRoot!.querySelector('.condition-row')!.getAttribute('aria-label')),
    ).toEqual([
      'Condition 1: Organism is Human',
      'Condition 2: no annotation chosen',
      'Condition 3: no annotation chosen',
    ]);
  });

  it('closePopups releases an open picker’s layer', async () => {
    const builder = await mount([createCondition()]);
    const row = rows(builder)[0];
    row.shadowRoot!.querySelector<HTMLButtonElement>('.annotation-select-trigger')!.click();
    await row.updateComplete;
    expect(topLayer()).toBeDefined();

    builder.closePopups();
    await row.updateComplete;
    await row.updateComplete;

    expect(topLayer()).toBeUndefined();
  });

  it('under a coarse pointer a value chip’s remove is a 40 px target and the chip stays 22 px tall', async () => {
    const session = cdp();
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    try {
      expect(matchMedia('(pointer: coarse)').matches).toBe(true);
      const builder = await mount([
        createCondition({ annotation: 'organism', values: ['Human', 'Mouse'] }),
      ]);
      const row = rows(builder)[0].shadowRoot!;
      const chip = row.querySelector('.value-chip')!.getBoundingClientRect();
      const remove = row.querySelector<HTMLElement>('.value-chip-remove')!;
      const box = remove.getBoundingClientRect();
      expect(chip.height).toBeCloseTo(22, 0);
      expect(box.width).toBeGreaterThanOrEqual(40 - 0.5);
      expect(box.height).toBeGreaterThanOrEqual(40 - 0.5);
      // A press near the target's corner, outside the chip, still reaches the button.
      expect(row.elementFromPoint(box.left + 2, box.top + 2)).toBe(remove);
    } finally {
      await session.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    }
  });

  it('under a coarse pointer a chip’s remove target never covers another chip', async () => {
    const session = cdp();
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    try {
      const values = ['Human', 'Mouse', 'Yeast', 'Fly', 'Worm', 'Frog'];
      const builder = await mount([createCondition({ annotation: 'organism', values })], 200);
      const row = rows(builder)[0].shadowRoot!;
      const chips = [...row.querySelectorAll<HTMLElement>('.value-chip')];
      const lines = new Set(chips.map((chip) => Math.round(chip.getBoundingClientRect().top)));
      expect(lines.size).toBeGreaterThan(1);
      for (const [i, chip] of chips.entries()) {
        const c = chip.getBoundingClientRect();
        const midY = c.top + c.height / 2;
        // The chip's own left edge and its top and bottom edges belong to it, not to a
        // neighbour's remove target.
        for (const [x, y] of [
          [c.left + 3, midY],
          [c.left + c.width / 3, c.top + 1],
          [c.left + c.width / 3, c.bottom - 1],
        ]) {
          const hit = row.elementFromPoint(x, y)!;
          expect(hit.closest('.value-chip'), `chip ${i} at ${x},${y}`).toBe(chip);
        }
      }
    } finally {
      await session.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    }
  });

  it('a picker opened near the bottom of the screen stays on it, clear of its trigger', async () => {
    // Wider than a phone, where the picker is a bottom sheet instead.
    await page.viewport(1024, 896);
    try {
      const builder = await mount([createCondition()]);
      builder.style.cssText =
        'display: block; width: 360px; height: 160px; position: fixed; left: 0; bottom: 40px';
      await builder.updateComplete;
      const row = rows(builder)[0];
      row.shadowRoot!.querySelector<HTMLButtonElement>('.annotation-select-trigger')!.click();
      await row.updateComplete;

      const picker = row.shadowRoot!.querySelector<HTMLElement>('.annotation-picker')!;
      const trigger = row.shadowRoot!.querySelector('.annotation-select-trigger')!;
      // The popover places itself asynchronously (Floating UI), after the row's update.
      const placed = () => {
        const box = picker.getBoundingClientRect();
        const t = trigger.getBoundingClientRect();
        return {
          onScreen: box.top >= 8 && box.bottom <= innerHeight - 8,
          clear: box.bottom <= t.top || box.top >= t.bottom,
        };
      };
      await expect.poll(placed).toEqual({ onScreen: true, clear: true });
    } finally {
      await page.viewport(414, 896);
    }
  });
});
