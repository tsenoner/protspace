import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { adoptTheme } from '../kit/adopt-theme';
import './search';

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
