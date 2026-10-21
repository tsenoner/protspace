import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { adoptTheme } from '../kit/adopt-theme';
import type { PsButton, PsIconButton } from '../kit/button';
import { topLayer } from '../kit/layers';
import type { ProtspaceQueryBuilder } from './query-builder';
import './query-builder';
import { createCondition, createGroup, createNumericCondition } from './query-types';
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

async function mount(
  query: FilterQuery,
  width = 360,
  withData: ProtspaceData = data,
): Promise<ProtspaceQueryBuilder> {
  const builder = document.createElement('protspace-query-builder');
  builder.embedded = true;
  builder.dirty = true;
  builder.annotations = ['organism'];
  builder.data = withData;
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

  it('a group and a card each show a remove button beside their ⋯ menu', async () => {
    const builder = await mount([createGroup()]);
    const groupMenu = builder.shadowRoot!.querySelector<PsIconButton>('.group-menu-trigger')!;
    await groupMenu.updateComplete;
    expect(inner(groupMenu).getAttribute('aria-label')).toBe('Actions for group');
    const groupRemove = builder.shadowRoot!.querySelector<PsIconButton>('.group-remove')!;
    await groupRemove.updateComplete;
    expect(inner(groupRemove).getAttribute('aria-label')).toBe('Remove group');
    expect(builder.shadowRoot!.querySelector('ps-menu-item[value="remove"]')).toBeNull();

    const root = rows(builder)[0].shadowRoot!;
    const menuRow = root.querySelector<PsIconButton>('.condition-menu-trigger')!;
    await menuRow.updateComplete;
    expect(inner(menuRow).getAttribute('aria-label')).toBe('Actions for condition 1');
    const remove = root.querySelector<PsIconButton>('.condition-remove')!;
    await remove.updateComplete;
    expect(remove.checkVisibility()).toBe(true);
    expect(inner(remove).getAttribute('aria-label')).toBe('Remove condition');
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

describe('protspace-query-builder: the locked EAT reliability row', () => {
  const EAT_KEY = 'organism__eat_confidence__runtime_2';
  const eatData: ProtspaceData = {
    ...data,
    annotations: {
      ...data.annotations,
      [EAT_KEY]: {
        kind: 'numeric',
        values: [],
        runtime: { role: 'eat-confidence', baseAnnotation: 'organism' },
      },
    },
    numeric_annotation_data: { [EAT_KEY]: new Float64Array([NaN, 0.2, 0.5, 0.7, 0.9]) },
  };
  const locked = (logicalOp?: 'OR') =>
    createNumericCondition({ annotation: EAT_KEY, min: 0.5, presence: ['N/A'], logicalOp });

  it('inside an "or" group it keeps the group’s joiner', async () => {
    const builder = await mount(
      [
        createGroup({
          conditions: [
            createCondition({ annotation: 'organism', values: ['Human'] }),
            locked('OR'),
          ],
        }),
      ],
      360,
      eatData,
    );
    const group = builder.shadowRoot!.querySelector('.group-container')!;
    expect(group.getAttribute('aria-label')).toBe('Group, joined with or');
    const joiner = group.querySelector<PsButton>('.joiner-pill')!;
    expect(joiner.textContent!.replace(/\s+/g, ' ').trim()).toBe('Joiner for condition 2: or');
    const row = rows(builder)[1].shadowRoot!;
    expect(row.querySelector('.locked-text')).not.toBeNull();
    expect(row.querySelector('.annotation-select-trigger')).toBeNull();
  });

  it('at 260 px wide it fits, the link and the ✕ on screen', async () => {
    const builder = await mount([locked()], 260, eatData);
    const row = rows(builder)[0];
    const box = row.shadowRoot!.querySelector<HTMLElement>('.condition-row')!;
    expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth);
    for (const selector of ['.locked-edit', '.condition-remove']) {
      const target = row.shadowRoot!.querySelector(selector)!.getBoundingClientRect();
      expect(target.right, selector).toBeLessThanOrEqual(box.getBoundingClientRect().right);
    }
  });
});
