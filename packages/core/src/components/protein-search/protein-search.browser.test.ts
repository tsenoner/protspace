import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { adoptTheme } from '../kit/adopt-theme';
import './protein-search';

beforeAll(() => adoptTheme());
afterEach(() => document.body.replaceChildren());

describe('protspace-protein-search focus', () => {
  it('draws the kit focus ring around the field while the input has focus', async () => {
    const element = document.createElement('protspace-protein-search');
    document.body.append(element);
    await element.updateComplete;
    const field = element.shadowRoot!.querySelector('.search-chips')!;
    expect(getComputedStyle(field).outlineStyle).toBe('none');

    await userEvent.keyboard('{Control>}k{/Control}');
    expect(element.shadowRoot!.activeElement?.id).toBe('protein-search-input');
    expect(getComputedStyle(field).outlineStyle).toBe('solid');
  });
});

describe('protspace-protein-search report', () => {
  it('the report is topmost and inside the viewport at 1280 × 720', async () => {
    await page.viewport(1280, 720);
    const element = document.createElement('protspace-protein-search') as HTMLElement & {
      availableProteinIds: string[];
      updateComplete: Promise<unknown>;
    };
    element.style.cssText = 'display: block; width: 420px; margin: 8px auto';
    element.availableProteinIds = ['P1', 'P2'];
    document.body.append(element);
    await element.updateComplete;
    const input = element.shadowRoot!.querySelector<HTMLInputElement>('#protein-search-input')!;
    input.focus();
    await userEvent.keyboard('NOPE{Enter}');
    await element.updateComplete;

    const report = element.shadowRoot!.querySelector<HTMLElement>('.search-report')!;
    const box = report.getBoundingClientRect();
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.bottom).toBeLessThanOrEqual(720);
    expect(box.right).toBeLessThanOrEqual(1280);
    // Topmost at its centre: the point hits the search's own shadow tree, inside the report.
    const hit = element.shadowRoot!.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2,
    );
    expect(hit && report.contains(hit)).toBe(true);
  });
});
