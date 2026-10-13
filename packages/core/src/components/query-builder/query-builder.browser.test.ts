import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { adoptTheme } from '../kit/adopt-theme';
import type { PsButton, PsIconButton } from '../kit/button';
import type { ProtspaceQueryBuilder } from './query-builder';
import './query-builder';
import { createCondition, createGroup } from './query-types';
import type { FilterQuery } from './query-types';
import type { ProtspaceData } from './types';

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

  it('the ✕ buttons are named Remove condition / Remove group', async () => {
    const builder = await mount([createGroup()]);
    const removeGroup = builder.shadowRoot!.querySelector<PsIconButton>(
      '.group-header .condition-remove',
    )!;
    await removeGroup.updateComplete;
    expect(inner(removeGroup).getAttribute('aria-label')).toBe('Remove group');

    const removeRow =
      rows(builder)[0].shadowRoot!.querySelector<PsIconButton>('.condition-remove')!;
    await removeRow.updateComplete;
    expect(inner(removeRow).getAttribute('aria-label')).toBe('Remove condition');
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

  it('rows show their numbers, group leaves included', async () => {
    const builder = await mount([
      createCondition({ annotation: 'organism', values: ['Human'] }),
      createGroup({
        logicalOp: 'AND',
        conditions: [createCondition(), createCondition({ logicalOp: 'OR' })],
      }),
    ]);
    const all = rows(builder);
    expect(
      all.map((row) => row.shadowRoot!.querySelector('.condition-number')!.textContent!.trim()),
    ).toEqual(['1', '2', '3']);
    expect(
      all.map((row) => row.shadowRoot!.querySelector('.condition-row')!.getAttribute('aria-label')),
    ).toEqual(['Condition 1', 'Condition 2', 'Condition 3']);
  });
});
