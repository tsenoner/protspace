import { afterEach, describe, expect, it, vi } from 'vitest';
import './import-menu';
import type { ProtspaceImportMenu } from './import-menu';

// jsdom has no showPopover, so the case that opens an example's info bubble runs here.

type InfoPopoverElement = HTMLElement & { updateComplete: Promise<unknown> };

afterEach(() => {
  document.body.replaceChildren();
});

describe('protspace-import-menu in a browser', () => {
  it("an example's info control explains it without loading it", async () => {
    const menu = document.createElement('protspace-import-menu') as ProtspaceImportMenu;
    menu.exampleDatasets = [
      {
        id: 'demo',
        label: 'Demo',
        description: 'The startup demo dataset.',
        docsUrl: '/docs/explore/example-datasets#demo',
      },
    ];
    document.body.append(menu);
    await menu.updateComplete;
    const onLoad = vi.fn();
    menu.addEventListener('load-example-dataset', onLoad);
    menu.shadowRoot!.querySelector<HTMLButtonElement>('.trigger')!.click();
    await menu.updateComplete;

    const info = menu.shadowRoot!.querySelector(
      '.import-examples [data-example-info="demo"]',
    ) as InfoPopoverElement;
    (info.shadowRoot!.querySelector('.info-button') as HTMLButtonElement).click();
    await info.updateComplete;
    const popover = info.shadowRoot!.querySelector('.popover');
    expect(popover?.querySelector('.popover-description')?.textContent?.trim()).toBe(
      'The startup demo dataset.',
    );
    expect(popover?.querySelector('.popover-link')?.getAttribute('href')).toBe(
      '/docs/explore/example-datasets#demo',
    );
    expect(onLoad).not.toHaveBeenCalled();
    expect(menu.shadowRoot!.querySelector('.import-menu')).not.toBeNull();
  });
});
