/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import './control-bar';

type ControlBarElement = HTMLElement & {
  autoSync?: boolean;
  updateComplete?: Promise<unknown>;
};

describe('control-bar export menu', () => {
  let controlBar: ControlBarElement;

  beforeEach(async () => {
    document.body.innerHTML = '';
    controlBar = document.createElement('protspace-control-bar') as ControlBarElement;
    controlBar.autoSync = false;
    document.body.appendChild(controlBar);
    await controlBar.updateComplete;
  });

  function button(scope: string, text: string): HTMLButtonElement {
    const found = [
      ...(controlBar.shadowRoot?.querySelectorAll<HTMLButtonElement>(`${scope} button`) ?? []),
    ].find((candidate) => candidate.textContent?.trim() === text);
    expect(found, `${text} button`).toBeDefined();
    return found!;
  }

  it('offers a Table format that requests a tsv export', async () => {
    (
      controlBar.shadowRoot?.querySelector('.right-controls-export .dropdown-trigger') as
        | HTMLButtonElement
        | undefined
    )?.click();
    await controlBar.updateComplete;

    const formats = [
      ...(controlBar.shadowRoot?.querySelectorAll('.export-format-options button') ?? []),
    ].map((candidate) => candidate.textContent?.trim());
    expect(formats).toEqual(['PNG', 'PDF', 'IDs', 'Table', 'Parquet']);

    button('.export-format-options', 'Table').click();
    await controlBar.updateComplete;

    const requested: string[] = [];
    controlBar.addEventListener('export', (event) =>
      requested.push((event as CustomEvent<{ type: string }>).detail.type),
    );
    button('.export-menu', 'Export TSV').click();
    expect(requested).toEqual(['tsv']);
  });
});
